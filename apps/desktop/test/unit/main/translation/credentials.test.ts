import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TranslationSettings } from '@manuslip/translate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TranslationConfiguration } from '../../../../src/main/translation/configuration'
import {
  credentialBinding,
  type KeyStore,
  TranslationCredentials,
} from '../../../../src/main/translation/credentials'

const directories: string[] = []
async function location() {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-translation-keys-'))
  directories.push(directory)
  return join(directory, 'credentials.json')
}
function keyStore() {
  return {
    available: vi.fn(async () => true),
    encrypt: vi.fn(async (text: string) =>
      Buffer.from(`encrypted:${Buffer.from(text).toString('base64')}`),
    ),
    decrypt: vi.fn(async (value: Buffer) => ({
      result: Buffer.from(value.toString().slice(10), 'base64').toString(),
      shouldReEncrypt: false,
    })),
  }
}
const binding = 'a'.repeat(64)
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
describe('main-only translation credentials', () => {
  it('does not contact the key store during status/load and keeps session keys off disk', async () => {
    const path = await location(),
      storage = keyStore()
    const keys = new TranslationCredentials(path, storage)
    expect(await keys.status(binding)).toBe('none')
    expect(storage.available).not.toHaveBeenCalled()
    await keys.set(binding, { key: 'dummy-session', persist: false, settingsRevision: 0 })
    expect(await keys.get(binding)).toBe('dummy-session')
    expect(await keys.get('b'.repeat(64))).toBeNull()
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(storage.encrypt).not.toHaveBeenCalled()
    keys.forgetSession()
    expect(await keys.get(binding)).toBeNull()
  })
  it('persists encrypted bytes only, binds keys to their endpoint/profile and decrypts on demand after restart', async () => {
    const path = await location(),
      storage = keyStore()
    await new TranslationCredentials(path, storage).set(binding, {
      key: 'dummy-persisted',
      persist: true,
      settingsRevision: 0,
    })
    expect(await readFile(path, 'utf8')).not.toContain('dummy-persisted')
    const keys = new TranslationCredentials(path, storage)
    expect(await keys.status(binding)).toBe('stored')
    expect(storage.decrypt).not.toHaveBeenCalled()
    expect(await keys.get('b'.repeat(64))).toBeNull()
    expect(await keys.get(binding)).toBe('dummy-persisted')
    const provider = {
      adapter: 'openai-compatible',
      version: '1',
      baseUrl: 'https://provider.example/a',
      model: 'model',
      profile: null,
      options: {},
    }
    expect(credentialBinding(provider)).not.toBe(
      credentialBinding({ ...provider, baseUrl: `${provider.baseUrl}/` }),
    )
    await keys.set(binding, { key: null, persist: false, settingsRevision: 0 })
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('rejects locked/unavailable key stores, permits an explicit session alternative, and handles rotated keys', async () => {
    const path = await location(),
      storage = keyStore()
    storage.available.mockResolvedValue(false)
    const keys = new TranslationCredentials(path, storage)
    await expect(
      keys.set(binding, { key: 'dummy', persist: true, settingsRevision: 0 }),
    ).rejects.toMatchObject({ code: 'translation-key-store' })
    expect(await keys.status(binding)).toBe('none')
    await keys.set(binding, { key: 'dummy', persist: false, settingsRevision: 0 })
    expect(await keys.get(binding)).toBe('dummy')
    storage.available.mockResolvedValue(true)
    await keys.set(binding, { key: 'rotated', persist: true, settingsRevision: 0 })
    storage.decrypt.mockResolvedValue({ result: 'rotated', shouldReEncrypt: true })
    expect(await keys.get(binding)).toBe('rotated')
    expect(storage.encrypt).toHaveBeenCalledTimes(2)
    storage.decrypt.mockRejectedValue(new Error('PRIVATE KEY STORE ERROR'))
    await expect(keys.get(binding)).rejects.toMatchObject({ code: 'translation-key-store' })
  })
  it('times out a stalled key store without a late write', async () => {
    const path = await location()
    let release: ((value: boolean) => void) | undefined
    const storage: KeyStore = {
      ...keyStore(),
      available: () =>
        new Promise((resolve) => {
          release = resolve
        }),
    }
    const keys = new TranslationCredentials(path, storage)
    await keys.status(binding)
    vi.useFakeTimers()
    const pending = keys.set(binding, { key: 'dummy', persist: true, settingsRevision: 0 })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'translation-key-store' })
    await vi.advanceTimersByTimeAsync(5001)
    await assertion
    release?.(true)
    await vi.advanceTimersByTimeAsync(0)
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('preserves future settings and quarantines malformed nonsecret configuration', async () => {
    const path = await location()
    await writeFile(path, JSON.stringify({ schemaVersion: 7, settings: { keep: true } }))
    const config = new TranslationConfiguration(path)
    await config.load()
    expect(config.status).toBe('read-only')
    expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).toBe(7)
    const invalidPath = await location()
    await writeFile(invalidPath, '{broken')
    const invalid = new TranslationConfiguration(invalidPath)
    await invalid.load()
    expect(invalid.status).toBe('recovered')
    expect(invalid.current).toBeNull()
  })
  it('reads legacy configuration without rewriting it and saves new provider settings as schema 2', async () => {
    const path = await location()
    const settings: TranslationSettings = {
      provider: {
        adapter: 'ollama',
        version: '1',
        baseUrl: 'http://localhost:11434/api/chat',
        model: 'local',
        profile: null,
        options: {},
      },
      sourceLanguage: 'auto',
      targetLanguage: 'de',
      glossary: [],
      formality: 'default',
      promptVersion: 'prose-translation/v1',
    }
    const original = JSON.stringify({ schemaVersion: 1, settings })
    await writeFile(path, original)
    const config = new TranslationConfiguration(path)
    await config.load()
    expect(config.current).toEqual(settings)
    expect(await readFile(path, 'utf8')).toBe(original)
    await config.save({
      ...settings,
      provider: {
        ...settings.provider,
        adapter: 'deepl',
        baseUrl: 'https://api-free.deepl.com/v2/translate',
        model: null,
      },
    })
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      schemaVersion: 2,
      settings: { provider: { adapter: 'deepl', model: null } },
    })
    const reopened = new TranslationConfiguration(path)
    await reopened.load()
    expect(reopened.current?.provider.adapter).toBe('deepl')
    expect(reopened.status).toBe('ready')
  })
  it('preserves future and oversized credential files instead of overwriting unknown data', async () => {
    for (const source of [
      JSON.stringify({ schemaVersion: 9, keep: 'future-key-format' }),
      'x'.repeat(32769),
    ]) {
      const path = await location()
      await writeFile(path, source)
      const keys = new TranslationCredentials(path, keyStore())
      expect(await keys.status(binding)).toBe('none')
      await expect(
        keys.set(binding, { key: 'dummy', persist: true, settingsRevision: 0 }),
      ).rejects.toMatchObject({ code: 'translation-storage' })
      expect(await readFile(path, 'utf8')).toBe(source)
    }
  })
})
