import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FileSessions } from '../../../../src/main/files/sessions'
import { SyncRecoveryRepository } from '../../../../src/main/sync/recovery'
import { SyncRepository } from '../../../../src/main/sync/repository'
import { type SyncDialogs, SyncService } from '../../../../src/main/sync/service'
import type { KeyStore } from '../../../../src/main/translation/credentials'

let directory: string,
  path: string,
  remote: string,
  files: FileSessions,
  service: SyncService,
  id: string
const changed = vi.fn(),
  current = () => {},
  keys: KeyStore = {
    available: async () => false,
    encrypt: async () => {
      throw new Error('Unavailable')
    },
    decrypt: async () => {
      throw new Error('Unavailable')
    },
  }
const raw = Buffer.from([0xff, 0xfe, 0x41, 0, 13, 0, 10, 0])
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing fixture result')
  return value
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'manuslip-sync-service-'))
  if (!directory.startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture')
  path = join(directory, 'source.md')
  remote = join(directory, 'remote')
  await mkdir(remote)
  await writeFile(path, raw)
  changed.mockClear()
  files = new FileSessions(changed)
  id = (await files.open(1, path)).info.id
  service = new SyncService(
    new SyncRepository(join(directory, 'sync.json')),
    new SyncRecoveryRepository(join(directory, 'copies')),
    files,
    keys,
  )
})
afterEach(async () => {
  vi.useRealTimers()
  service.closeOwner(1)
  await files.closeOwner(1)
  await rm(directory, { recursive: true, force: true, maxRetries: 3 })
})
const dialogs = (): SyncDialogs => ({ folder: async () => remote, save: async () => null })
async function connect(): Promise<void> {
  await service.connect(
    1,
    { documentId: id, kind: 'folder', filename: 'copy.md' },
    dialogs(),
    current,
  )
}
async function save(text: string): Promise<void> {
  const info = files.describe(1, id)
  await files.save(
    1,
    {
      id,
      text,
      revision: 1,
      expectedFingerprint: info.fingerprint,
      action: 'save',
      normalize: null,
      utf8: false,
    },
    { open: async () => null, save: async () => null, overwrite: async () => false },
  )
}
// These round trips perform several durable writes and native metadata copies.
it('reviews both directions, preserves exact overwritten bytes, and retains copies/files after disconnect', async () => {
  await connect()
  const initial = await service.review(1, id, current)
  expect(initial).toMatchObject({
    busy: false,
    review: { kind: 'upload', localBytes: raw.length, remoteBytes: null },
  })
  await service.resolve(1, required(initial.review).id, 'upload', dialogs(), current)
  expect(await readFile(join(remote, 'copy.md'))).toEqual(raw)
  expect((await service.review(1, id, current)).review).toBeNull()
  const replacement = Buffer.from('# Remote\r\n中文\r\n')
  await writeFile(join(remote, 'copy.md'), replacement)
  const incoming = await service.review(1, id, current)
  expect(incoming.review?.kind).toBe('download')
  const received = await service.resolve(
    1,
    required(incoming.review).id,
    'download',
    dialogs(),
    current,
  )
  expect(await readFile(path)).toEqual(replacement)
  expect(changed).toHaveBeenCalledWith(1, id)
  expect(files.describe(1, id).encoding).toBe('utf16le')
  expect(received.copies).toHaveLength(1)
  expect((await files.reload(1, id)).text).toBe('# Remote\n中文\n')
  const exported = join(directory, 'recovered.md')
  await service.exportRecovery(
    1,
    required(received.copies[0]).id,
    { ...dialogs(), save: async () => exported },
    current,
  )
  expect(await readFile(exported)).toEqual(raw)
  const disconnected = await service.disconnect(1, id, current)
  expect(disconnected.connection).toBeNull()
  expect(disconnected.copies).toHaveLength(1)
  expect(await readFile(path)).toEqual(replacement)
  expect(await readFile(join(remote, 'copy.md'))).toEqual(replacement)
}, 30000)
it('detects divergence and refuses a review after another save without replacing either version', async () => {
  await connect()
  await writeFile(join(remote, 'copy.md'), 'Unrelated remote')
  const review = await service.review(1, id, current)
  expect(review.review).toMatchObject({ kind: 'conflict', reason: 'initial' })
  await save('A later local edit\n')
  await expect(
    service.resolve(1, required(review.review).id, 'download', dialogs(), current),
  ).rejects.toMatchObject({ code: 'sync-changed' })
  expect((await files.reload(1, id)).text).toBe('A later local edit\n')
  expect(await readFile(join(remote, 'copy.md'), 'utf8')).toBe('Unrelated remote')
})
it('preserves raw bytes when a long Unicode filename crosses the recovery label boundary', async () => {
  await files.closeOwner(1)
  path = join(directory, `${'a'.repeat(159)}🚀.md`)
  await writeFile(path, raw)
  id = (await files.open(1, path)).info.id
  await connect()
  const initial = await service.review(1, id, current)
  await service.resolve(1, required(initial.review).id, 'upload', dialogs(), current)
  const replacement = Buffer.from('# Remote\r\n中文\r\n')
  await writeFile(join(remote, 'copy.md'), replacement)
  const incoming = await service.review(1, id, current)
  const received = await service.resolve(
    1,
    required(incoming.review).id,
    'download',
    dialogs(),
    current,
  )
  expect(received.copies).toHaveLength(1)
  const copy = required(received.copies[0])
  expect(copy.name.length).toBeLessThanOrEqual(160)
  expect(copy.name.isWellFormed()).toBe(true)
  expect(copy.state).toBe('verified')
  const destination = join(directory, 'unicode-recovery.md')
  await service.exportRecovery(1, copy.id, { ...dialogs(), save: async () => destination }, current)
  expect(await readFile(destination)).toEqual(raw)
  expect(await readFile(path)).toEqual(replacement)
  expect(await readFile(join(remote, 'copy.md'))).toEqual(replacement)
}, 30000)
it('keeps both only after a native copy destination is accepted and preserves the remote again in recovery', async () => {
  await connect()
  await writeFile(join(remote, 'copy.md'), 'Remote to preserve')
  const review = await service.review(1, id, current)
  const cancelled = await service.resolve(
    1,
    required(review.review).id,
    'keep-both',
    dialogs(),
    current,
  )
  expect(cancelled.review?.id).toBe(review.review?.id)
  expect(cancelled.copies).toEqual([])
  expect(
    JSON.parse(await readFile(join(directory, 'sync.json'), 'utf8')).connections[0].intent,
  ).toBeNull()
  const destination = join(directory, 'remote-original.md')
  const completed = await service.resolve(
    1,
    required(review.review).id,
    'keep-both',
    { ...dialogs(), save: async () => destination },
    current,
  )
  expect(await readFile(destination, 'utf8')).toBe('Remote to preserve')
  expect(await readFile(join(remote, 'copy.md'))).toEqual(raw)
  expect(completed.copies).toHaveLength(1)
})
it('charges a cancelled native picker until it settles and never installs its late result', async () => {
  let finish!: (path: string | null) => void, entered!: () => void
  const started = new Promise<void>((resolve) => {
      entered = resolve
    }),
    picker = new Promise<string | null>((resolve) => {
      finish = resolve
    })
  const pending = service.connect(
    1,
    { documentId: id, kind: 'folder', filename: 'copy.md' },
    {
      ...dialogs(),
      folder: async () => {
        entered()
        return picker
      },
    },
    current,
  )
  await started
  service.cancel(1, id)
  await expect(pending).rejects.toMatchObject({ code: 'sync-cancelled' })
  expect((await service.state(1, id, current)).busy).toBe(true)
  await expect(connect()).rejects.toMatchObject({ code: 'sync-busy' })
  finish(remote)
  await vi.waitFor(async () => expect((await service.state(1, id, current)).busy).toBe(false))
  expect((await service.state(1, id, current)).connection).toBeNull()
})
it('rejects a folder destination aliasing an open local source before granting a connection', async () => {
  await expect(
    service.connect(
      1,
      { documentId: id, kind: 'folder', filename: 'source.md' },
      { ...dialogs(), folder: async () => directory },
      current,
    ),
  ).rejects.toMatchObject({ code: 'export-target' })
  expect((await service.state(1, id, current)).connection).toBeNull()
  expect(await readFile(path)).toEqual(raw)
})
it('cancels a recovery export from document controls and rejects its late native destination', async () => {
  const copy = await new SyncRecoveryRepository(join(directory, 'copies')).preserve(
    crypto.randomUUID(),
    'source.md',
    'local',
    raw,
    current,
  )
  let finish: (path: string | null) => void = () => {},
    entered: () => void = () => {}
  const started = new Promise<void>((resolve) => {
      entered = resolve
    }),
    picker = new Promise<string | null>((resolve) => {
      finish = resolve
    })
  const pending = service.exportRecovery(
    1,
    copy.id,
    {
      ...dialogs(),
      save: async () => {
        entered()
        return picker
      },
    },
    current,
  )
  await started
  service.cancel(1, id)
  await expect(pending).rejects.toMatchObject({ code: 'sync-cancelled' })
  expect((await service.state(1, id, current)).busy).toBe(true)
  const destination = join(directory, 'cancelled-export.md')
  finish(destination)
  await vi.waitFor(async () => expect((await service.state(1, id, current)).busy).toBe(false))
  await expect(readFile(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await service.state(1, id, current)).copies).toHaveLength(1)
})
it('persists an interrupted intent if publication fails and retries by comparing actual bytes', async () => {
  await connect()
  const review = await service.review(1, id, current)
  const original = files.captureSaved.bind(files)
  let calls = 0
  vi.spyOn(files, 'captureSaved').mockImplementation(async (...args) => {
    const captured = await original(...args)
    if (++calls === 2) await writeFile(join(remote, 'copy.md'), 'Concurrent writer')
    return captured
  })
  await expect(
    service.resolve(1, required(review.review).id, 'upload', dialogs(), current),
  ).rejects.toMatchObject({ code: 'sync-changed' })
  expect((await service.state(1, id, current)).connection?.interrupted).toBe(true)
  expect(await readFile(path)).toEqual(raw)
  expect(await readFile(join(remote, 'copy.md'), 'utf8')).toBe('Concurrent writer')
  vi.restoreAllMocks()
  expect((await service.review(1, id, current)).review).toMatchObject({
    kind: 'conflict',
    reason: 'initial',
  })
})
