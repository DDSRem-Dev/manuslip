import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { startWebDavServer } from '../../../../../../test/helpers/webdav-server'
import { FileSessions } from '../../../../src/main/files/sessions'
import { SyncRecoveryRepository } from '../../../../src/main/sync/recovery'
import { SyncRepository } from '../../../../src/main/sync/repository'
import { SyncService } from '../../../../src/main/sync/service'
import { syncHash } from '../../../../src/main/sync/webdav'

const original = Buffer.from('\ufeff# Local 世界\r\nOriginal 😀\r\n')
const current = () => {}
const dialogs = { folder: async () => null, save: async () => null }
const keys = {
  available: async () => false,
  encrypt: async (): Promise<Buffer> => {
    throw new Error('Session credentials must not use the key store')
  },
  decrypt: async (): Promise<{ result: string; shouldReEncrypt: boolean }> => {
    throw new Error('Session credentials must not use the key store')
  },
}
let directory: string,
  path: string,
  files: FileSessions,
  service: SyncService,
  registry: SyncRepository,
  copies: SyncRecoveryRepository,
  server: Awaited<ReturnType<typeof startWebDavServer>>,
  id: string

async function start(): Promise<void> {
  files = new FileSessions(() => {})
  id = (await files.open(1, path)).info.id
  registry = new SyncRepository(join(directory, 'sync.json'))
  copies = new SyncRecoveryRepository(join(directory, 'copies'))
  service = new SyncService(registry, copies, files, keys)
  await service.state(1, id, current)
}
async function connect(): Promise<void> {
  await service.connect(
    1,
    { documentId: id, kind: 'webdav', url: server.resource },
    dialogs,
    current,
  )
}
async function review(): Promise<string> {
  const state = await service.review(1, id, current)
  if (!state.review) throw new Error('Expected a review before transfer')
  return state.review.id
}
async function save(text: string): Promise<void> {
  await files.save(
    1,
    {
      id,
      text,
      revision: 1,
      action: 'save',
      expectedFingerprint: files.describe(1, id).fingerprint,
      normalize: null,
      utf8: false,
    },
    { open: async () => null, save: async () => null, overwrite: async () => false },
  )
}

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'manuslip-webdav-flow-')))
  path = join(directory, 'writing.md')
  await writeFile(path, original)
  server = await startWebDavServer()
  await start()
})
afterEach(async () => {
  service.closeOwner(1)
  await files.closeOwner(1)
  try {
    await server.close()
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

it('creates and downloads exact bytes, persists its baseline and exports the displaced local version after restart', async () => {
  await connect()
  expect(server.remote.requests).toEqual([])
  await service.resolve(1, await review(), 'upload', dialogs, current)
  expect(server.remote.bytes).toEqual(original)
  expect(server.remote.requests.map((request) => request.method)).toEqual([
    'GET',
    'GET',
    'PUT',
    'GET',
  ])
  expect(server.remote.requests[2]?.headers['if-none-match']).toBe('*')
  expect(registry.list()[0]).toMatchObject({ baseline: syncHash(original), intent: null })

  const incoming = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from('# Incoming\r\n世界\r\n', 'utf16le'),
  ])
  server.remote.set(incoming)
  const token = await review()
  expect((await service.state(1, id, current)).review?.kind).toBe('download')
  await service.resolve(1, token, 'download', dialogs, current)
  expect(await readFile(path)).toEqual(incoming)
  expect((await files.reload(1, id)).text).toBe('# Incoming\n世界\n')

  service.closeOwner(1)
  await files.closeOwner(1)
  await start()
  const state = await service.state(1, id, current)
  expect(state.connection).toMatchObject({ interrupted: false, scope: server.resource })
  expect(state.copies).toMatchObject([{ side: 'local', state: 'verified', bytes: original.length }])
  const copy = state.copies[0]
  if (!copy) throw new Error('Missing displaced local version')
  const exported = join(directory, 'recovered.md')
  await service.exportRecovery(1, copy.id, { ...dialogs, save: async () => exported }, current)
  expect(await readFile(exported)).toEqual(original)
  expect((await service.review(1, id, current)).review).toBeNull()
  await service.disconnect(1, id, current)
  expect((await service.state(1, id, current)).copies).toHaveLength(1)
  expect(await readFile(path)).toEqual(incoming)
})

it('refuses a competing create at PUT and resumes the durable interrupted intent after restart', async () => {
  await connect()
  const token = await review()
  const competing = Buffer.from('# Created by another client\r\n')
  server.remote.beforePut = () => server.remote.set(competing)
  await expect(service.resolve(1, token, 'upload', dialogs, current)).rejects.toMatchObject({
    code: 'sync-changed',
  })
  expect(server.remote.bytes).toEqual(competing)
  expect(await readFile(path)).toEqual(original)
  expect(registry.list()[0]).toMatchObject({
    baseline: null,
    intent: { direction: 'upload', remoteHash: null },
  })

  service.closeOwner(1)
  await files.closeOwner(1)
  await start()
  expect((await service.state(1, id, current)).connection?.interrupted).toBe(true)
  const next = await review()
  expect((await service.state(1, id, current)).review).toMatchObject({
    kind: 'conflict',
    reason: 'initial',
  })
  await service.resolve(1, next, 'upload', dialogs, current)
  expect(server.remote.bytes).toEqual(original)
  expect(registry.list()[0]).toMatchObject({ baseline: syncHash(original), intent: null })
  const inventory = await copies.list()
  expect(inventory.copies).toHaveLength(1)
  expect((await copies.restore(inventory.copies[0]?.id || '')).bytes).toEqual(competing)
})

it('rejects a changed ETag at publication, retaining the reviewed remote bytes in recovery', async () => {
  server.remote.set(original)
  await connect()
  expect((await service.review(1, id, current)).review).toBeNull()
  await save('# Local revision\n')
  const token = await review(),
    expected = server.remote.etag
  const competing = Buffer.from('# Concurrent remote revision\n')
  server.remote.beforePut = () => server.remote.set(competing)
  await expect(service.resolve(1, token, 'upload', dialogs, current)).rejects.toMatchObject({
    code: 'sync-changed',
  })
  const put = server.remote.requests.find((request) => request.method === 'PUT')
  expect(put?.headers['if-match']).toBe(expected)
  expect(put?.headers['if-none-match']).toBeUndefined()
  expect(server.remote.bytes).toEqual(competing)
  expect(await readFile(path, 'utf8')).toBe('\ufeff# Local revision\r\n')
  const inventory = await copies.list()
  expect(inventory.copies).toHaveLength(1)
  expect((await copies.restore(inventory.copies[0]?.id || '')).bytes).toEqual(original)
  expect((await service.state(1, id, current)).connection?.interrupted).toBe(true)
})

it('rejects a saved local revision after review before sending any remote write', async () => {
  await connect()
  const token = await review()
  await save('# A later local edit\n')
  await expect(service.resolve(1, token, 'upload', dialogs, current)).rejects.toMatchObject({
    code: 'sync-changed',
  })
  expect(server.remote.requests.some((request) => request.method === 'PUT')).toBe(false)
  expect(server.remote.bytes).toBeNull()
  expect(await readFile(path, 'utf8')).toBe('\ufeff# A later local edit\r\n')
  expect((await copies.list()).copies).toEqual([])
})

it('sends session credentials only on explicit review and forgets them on restart', async () => {
  await connect()
  server.remote.authorization = `Basic ${Buffer.from('writer:dummy-secret').toString('base64')}`
  await expect(service.review(1, id, current)).rejects.toMatchObject({ code: 'sync-auth' })
  await service.credential(
    1,
    { documentId: id, username: 'writer', password: 'dummy-secret', persist: false },
    current,
  )
  expect(server.remote.requests).toHaveLength(1)
  await service.resolve(1, await review(), 'upload', dialogs, current)
  expect(
    server.remote.requests
      .slice(1)
      .every((request) => request.headers.authorization === server.remote.authorization),
  ).toBe(true)
  const persisted = await readFile(join(directory, 'sync.json'), 'utf8')
  expect(persisted).not.toContain('dummy-secret')
  expect(persisted).not.toContain(server.remote.authorization)

  service.closeOwner(1)
  await files.closeOwner(1)
  const count = server.remote.requests.length
  await start()
  expect((await service.state(1, id, current)).connection?.credential).toBe('none')
  expect(server.remote.requests).toHaveLength(count)
  await expect(service.review(1, id, current)).rejects.toMatchObject({ code: 'sync-auth' })
  expect(server.remote.bytes).toEqual(original)
})
