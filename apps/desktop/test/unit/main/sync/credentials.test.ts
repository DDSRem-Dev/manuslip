import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FileOperationError } from '../../../../src/main/files/errors'
import { SyncCredentials } from '../../../../src/main/sync/credentials'
import { type SyncConnection, SyncRepository } from '../../../../src/main/sync/repository'
import type { KeyStore } from '../../../../src/main/translation/credentials'

let directory: string, repository: SyncRepository, row: SyncConnection
const current = () => {},
  track = <T>(operation: Promise<T>) => operation
const keyStore: KeyStore = {
  available: async () => true,
  encrypt: async (value) => Buffer.from(Array.from(Buffer.from(value), (byte) => byte ^ 42)),
  decrypt: async (value) => ({
    result: Buffer.from(Array.from(value, (byte) => byte ^ 42)).toString('utf8'),
    shouldReEncrypt: false,
  }),
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'manuslip-sync-credentials-'))
  if (!directory.startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture')
  repository = new SyncRepository(join(directory, 'connections.json'))
  await repository.load()
  row = {
    id: randomUUID(),
    localPath: join(directory, 'writing.md'),
    configuration: { kind: 'webdav', url: 'https://example.org/writing.md' },
    baseline: null,
    syncedAt: null,
    intent: null,
    encryptedCredential: null,
  }
  await repository.mutate(() => [row], current)
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(directory, { recursive: true, force: true, maxRetries: 3 })
})
const request = () => ({
  documentId: randomUUID(),
  username: 'user',
  password: 'secret',
  persist: false,
})
it('keeps session credentials in memory and persists only platform encrypted credentials across restart', async () => {
  const credentials = new SyncCredentials(repository, keyStore)
  await credentials.set(row, request(), current, track)
  expect(await credentials.get(row, current, track)).toBe('Basic dXNlcjpzZWNyZXQ=')
  expect(await new SyncCredentials(repository, keyStore).get(row, current, track)).toBeNull()
  await credentials.set(row, { ...request(), persist: true }, current, track)
  const stored = await readFile(join(directory, 'connections.json'), 'utf8')
  expect(stored).not.toContain('secret')
  expect(stored).not.toContain('Basic')
  expect(stored).not.toContain('dXNlcjpzZWNyZXQ=')
  const restart = new SyncRepository(join(directory, 'connections.json'))
  await restart.load()
  const saved = restart.list()[0]
  if (!saved) throw new Error('Missing connection')
  expect(await new SyncCredentials(restart, keyStore).get(saved, current, track)).toBe(
    'Basic dXNlcjpzZWNyZXQ=',
  )
})
it('preserves a previous session and registry when secure persistence is unavailable', async () => {
  const credentials = new SyncCredentials(repository, { ...keyStore, available: async () => false })
  await credentials.set(row, request(), current, track)
  const before = await readFile(join(directory, 'connections.json'))
  await expect(
    credentials.set(row, { ...request(), password: 'Other', persist: true }, current, track),
  ).rejects.toMatchObject({ code: 'sync-key-store' })
  expect(await readFile(join(directory, 'connections.json'))).toEqual(before)
  expect(await credentials.get(row, current, track)).toBe('Basic dXNlcjpzZWNyZXQ=')
})
it('rechecks authorization after encryption settles and does not install a revoked late result', async () => {
  let release: (value: Buffer) => void = () => {},
    valid = true
  const credentials = new SyncCredentials(repository, {
    ...keyStore,
    encrypt: () =>
      new Promise<Buffer>((resolve) => {
        release = resolve
      }),
  })
  const before = await readFile(join(directory, 'connections.json'))
  const pending = credentials.set(
    row,
    { ...request(), persist: true },
    () => {
      if (!valid) throw new FileOperationError('file-session')
    },
    track,
  )
  await vi.waitFor(() => expect(credentials.status(row)).toBe('none'))
  await new Promise<void>((resolve) => setImmediate(resolve))
  valid = false
  release(Buffer.from('Encrypted'))
  await expect(pending).rejects.toMatchObject({ code: 'file-session' })
  expect(await readFile(join(directory, 'connections.json'))).toEqual(before)
})
it('bounds an unresponsive key store and tracks its actual unsettled operation for the service slot', async () => {
  vi.useFakeTimers()
  let release: (value: boolean) => void = () => {}
  const hanging = new Promise<boolean>((resolve) => {
      release = resolve
    }),
    tracked: Promise<unknown>[] = [],
    credentials = new SyncCredentials(repository, { ...keyStore, available: () => hanging })
  const pending = credentials.set(row, { ...request(), persist: true }, current, (operation) => {
    tracked.push(operation)
    return operation
  })
  const failure = expect(pending).rejects.toMatchObject({ code: 'sync-key-store' })
  await vi.advanceTimersByTimeAsync(5001)
  await failure
  expect(tracked).toEqual([hanging])
  expect(repository.list()[0]?.encryptedCredential).toBeNull()
  release(true)
  await Promise.allSettled(tracked)
})
