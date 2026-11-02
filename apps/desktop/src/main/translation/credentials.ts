import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import type { ProviderDescriptor } from '@manuslip/translate'
import type { CredentialRequest, TranslationState } from '../../shared/translation-contracts'
import { maybeDisk } from '../files/disk'
import { TranslationFailure } from './errors'
import { writePrivateJson } from './json-file'

export interface KeyStore {
  available(): Promise<boolean>
  encrypt(value: string): Promise<Buffer>
  decrypt(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}
interface StoredKey {
  schemaVersion: 1
  binding: string
  encrypted: string
}
export function credentialBinding(provider: ProviderDescriptor): string {
  return createHash('sha256')
    .update(JSON.stringify([provider.adapter, provider.baseUrl, provider.profile]))
    .digest('hex')
}
async function keyStoreCall<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TranslationFailure('translation-key-store')), 5000)
      }),
    ])
  } catch {
    throw new TranslationFailure('translation-key-store')
  } finally {
    clearTimeout(timer)
  }
}
/** The only plaintext key owner. No getter is exposed through IPC. */
export class TranslationCredentials {
  private stored: StoredKey | null = null
  private session: { binding: string; key: string } | null = null
  private loaded: Promise<void> | null = null
  private readOnly = false
  private queue: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly path: string,
    private readonly keyStore: KeyStore,
  ) {}
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => {})
    return result
  }
  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const file = await maybeDisk(this.path, 32 * 1024)
        if (!file) return
        const value = JSON.parse(file.bytes.toString('utf8'))
        if (typeof value?.schemaVersion === 'number' && value.schemaVersion > 1) {
          this.readOnly = true
          return
        }
        if (
          value?.schemaVersion !== 1 ||
          typeof value.binding !== 'string' ||
          !/^[a-f0-9]{64}$/.test(value.binding) ||
          typeof value.encrypted !== 'string' ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(value.encrypted) ||
          value.encrypted.length > 24 * 1024 ||
          Object.keys(value).some((key) => !['schemaVersion', 'binding', 'encrypted'].includes(key))
        )
          return
        this.stored = value
      } catch {
        // Unreadable/over-limit metadata may belong to a future schema; never overwrite it.
        this.readOnly = true
      }
    })()
    return this.loaded
  }
  async status(binding: string | null): Promise<TranslationState['credential']> {
    await this.load()
    return binding && this.session?.binding === binding
      ? 'session'
      : binding && this.stored?.binding === binding
        ? 'stored'
        : 'none'
  }
  set(binding: string, request: CredentialRequest): Promise<void> {
    return this.serialize(async () => {
      await this.load()
      if (this.readOnly) throw new TranslationFailure('translation-storage')
      let stored: StoredKey | null = null
      if (request.key !== null && request.persist) {
        if (!(await keyStoreCall(this.keyStore.available())))
          throw new TranslationFailure('translation-key-store')
        const encrypted = await keyStoreCall(this.keyStore.encrypt(request.key))
        if (!encrypted.length || encrypted.length > 16 * 1024)
          throw new TranslationFailure('translation-key-store')
        stored = { schemaVersion: 1, binding, encrypted: encrypted.toString('base64') }
      }
      try {
        if (stored) await writePrivateJson(this.path, stored)
        else await rm(this.path, { force: true })
      } catch {
        throw new TranslationFailure('translation-storage')
      }
      this.stored = stored
      this.session = request.key !== null && !request.persist ? { binding, key: request.key } : null
    })
  }
  get(binding: string): Promise<string | null> {
    return this.serialize(async () => {
      await this.load()
      if (this.session?.binding === binding) return this.session.key
      const stored = this.stored
      if (!stored || stored.binding !== binding) return null
      if (!(await keyStoreCall(this.keyStore.available())))
        throw new TranslationFailure('translation-key-store')
      const result = await keyStoreCall(
        this.keyStore.decrypt(Buffer.from(stored.encrypted, 'base64')),
      )
      if (!/^[\x21-\x7e]{1,4096}$/.test(result.result))
        throw new TranslationFailure('translation-key-store')
      if (result.shouldReEncrypt) {
        const encrypted = await keyStoreCall(this.keyStore.encrypt(result.result))
        if (!encrypted.length || encrypted.length > 16 * 1024)
          throw new TranslationFailure('translation-key-store')
        const next = { ...stored, encrypted: encrypted.toString('base64') }
        try {
          await writePrivateJson(this.path, next)
        } catch {
          throw new TranslationFailure('translation-storage')
        }
        this.stored = next
      }
      return result.result
    })
  }
  forgetSession(): void {
    this.session = null
  }
}
