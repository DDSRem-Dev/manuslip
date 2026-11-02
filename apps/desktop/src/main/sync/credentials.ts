import type { SyncCredentialRequest } from '../../shared/sync-contracts'
import { FileOperationError } from '../files/errors'
import type { KeyStore } from '../translation/credentials'
import type { SyncConnection, SyncRepository } from './repository'

export type TrackSyncWork = <T>(operation: Promise<T>) => Promise<T>
/** Plaintext stays in main memory; only platform-encrypted Basic credentials reach disk. */
export class SyncCredentials {
  private readonly sessions = new Map<string, string>()
  constructor(
    private readonly repository: SyncRepository,
    private readonly keyStore: KeyStore,
  ) {}
  status(connection: SyncConnection): 'none' | 'session' | 'stored' {
    return this.sessions.has(connection.id)
      ? 'session'
      : connection.encryptedCredential
        ? 'stored'
        : 'none'
  }
  forget(id: string): void {
    this.sessions.delete(id)
  }
  private async call<T>(operation: Promise<T>, track: TrackSyncWork): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        track(operation),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new FileOperationError('sync-key-store')), 5000)
        }),
      ])
    } catch {
      throw new FileOperationError('sync-key-store')
    } finally {
      clearTimeout(timer)
    }
  }
  async set(
    connection: SyncConnection,
    request: SyncCredentialRequest,
    current: () => void,
    track: TrackSyncWork,
  ): Promise<void> {
    if (connection.configuration.kind !== 'webdav') throw new FileOperationError('sync-invalid')
    const authorization =
      request.username === null
        ? null
        : `Basic ${Buffer.from(`${request.username}:${request.password}`, 'utf8').toString('base64')}`
    if (authorization && authorization.length > 8192) throw new FileOperationError('sync-invalid')
    let encrypted: string | null = null
    if (authorization && request.persist) {
      if (!(await this.call(this.keyStore.available(), track)))
        throw new FileOperationError('sync-key-store')
      current()
      const bytes = await this.call(this.keyStore.encrypt(authorization), track)
      current()
      if (!bytes.length || bytes.length > 24 * 1024) throw new FileOperationError('sync-key-store')
      encrypted = bytes.toString('base64')
    }
    current()
    await this.repository.mutate(
      (rows) =>
        rows.map((row) =>
          row.id === connection.id ? { ...row, encryptedCredential: encrypted } : row,
        ),
      current,
    )
    current()
    this.forget(connection.id)
    if (authorization && !request.persist) this.sessions.set(connection.id, authorization)
  }
  async get(
    connection: SyncConnection,
    current: () => void,
    track: TrackSyncWork,
  ): Promise<string | null> {
    current()
    const session = this.sessions.get(connection.id)
    if (session) return session
    if (!connection.encryptedCredential) return null
    if (!(await this.call(this.keyStore.available(), track)))
      throw new FileOperationError('sync-key-store')
    current()
    const decrypted = await this.call(
      this.keyStore.decrypt(Buffer.from(connection.encryptedCredential, 'base64')),
      track,
    )
    current()
    if (!/^Basic [A-Za-z0-9+/]+={0,2}$/.test(decrypted.result) || decrypted.result.length > 8192)
      throw new FileOperationError('sync-key-store')
    return decrypted.result
  }
}
