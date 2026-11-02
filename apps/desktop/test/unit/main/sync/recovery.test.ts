import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { FileOperationError } from '../../../../src/main/files/errors'
import { SyncRecoveryRepository } from '../../../../src/main/sync/recovery'

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'manuslip-sync-recovery-'))
  if (!directory.startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture path')
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})
const current = () => {}
it('retains verified original bytes across restart and removes only the explicitly chosen copy', async () => {
  const store = new SyncRecoveryRepository(directory),
    bytes = Buffer.from([0xff, 0xfe, 0x41, 0, 13, 0, 10, 0]),
    first = await store.preserve(randomUUID(), '中文.md', 'remote', bytes, current),
    second = await store.preserve(
      randomUUID(),
      'Other.md',
      'local',
      Buffer.from('Second'),
      current,
    ),
    restarted = new SyncRecoveryRepository(directory)
  expect((await restarted.list()).copies).toEqual(expect.arrayContaining([first, second]))
  expect(await restarted.restore(first.id)).toEqual({ bytes, artifact: false })
  await restarted.remove(first.id, current)
  expect((await restarted.list()).copies).toEqual([second])
  expect(await restarted.restore(second.id)).toEqual({
    bytes: Buffer.from('Second'),
    artifact: false,
  })
})
it('refuses new admission at quota without evicting an earlier recovery', async () => {
  const store = new SyncRecoveryRepository(directory, 4096, 1),
    first = await store.preserve(randomUUID(), 'source.md', 'local', Buffer.from('First'), current)
  await expect(
    store.preserve(randomUUID(), 'source.md', 'remote', Buffer.from('Second'), current),
  ).rejects.toMatchObject({ code: 'sync-limit' })
  expect((await store.restore(first.id)).bytes).toEqual(Buffer.from('First'))
  expect((await store.list()).copies).toEqual([first])
})
it('detects altered body bytes during inventory and offers the damaged artifact for explicit export/removal', async () => {
  const store = new SyncRecoveryRepository(directory),
    first = await store.preserve(randomUUID(), 'source.md', 'local', Buffer.from('First'), current),
    path = join(directory, `${first.id}.sync-copy`),
    artifact = await readFile(path)
  artifact[artifact.length - 1] = (artifact[artifact.length - 1] || 0) ^ 1
  await writeFile(path, artifact)
  expect(await store.list()).toMatchObject({
    blocked: true,
    copies: [{ id: first.id, state: 'damaged' }],
  })
  expect(await store.restore(first.id)).toEqual({ bytes: artifact, artifact: true })
  await expect(
    store.preserve(randomUUID(), 'source.md', 'remote', Buffer.from('Second'), current),
  ).rejects.toMatchObject({ code: 'sync-recovery' })
  expect(await readFile(path)).toEqual(artifact)
  await store.remove(first.id, current)
  expect(await store.list()).toEqual({ copies: [], blocked: false })
})
it('retains and counts an interrupted pending artifact after restart until explicit removal', async () => {
  const store = new SyncRecoveryRepository(directory),
    first = await store.preserve(randomUUID(), 'source.md', 'local', Buffer.from('First'), current)
  await rename(join(directory, `${first.id}.sync-copy`), join(directory, `${first.id}.pending`))
  const restarted = new SyncRecoveryRepository(directory),
    key = `${first.id}-pending`
  expect(await restarted.list()).toMatchObject({
    blocked: true,
    copies: [{ id: key, state: 'incomplete' }],
  })
  expect((await restarted.restore(key)).artifact).toBe(true)
  await expect(
    restarted.preserve(randomUUID(), 'source.md', 'remote', Buffer.from('Second'), current),
  ).rejects.toMatchObject({ code: 'sync-recovery' })
  await restarted.remove(key, current)
  expect((await restarted.list()).copies).toEqual([])
})
it('cleans a revoked pending copy and preserves a previously durable version', async () => {
  const store = new SyncRecoveryRepository(directory),
    first = await store.preserve(randomUUID(), 'source.md', 'local', Buffer.from('First'), current)
  let calls = 0
  await expect(
    store.preserve(randomUUID(), 'source.md', 'remote', Buffer.from('Second'), () => {
      if (++calls === 3) throw new FileOperationError('file-session')
    }),
  ).rejects.toMatchObject({ code: 'file-session' })
  expect(await readdir(directory)).toEqual([`${first.id}.sync-copy`])
  expect((await store.restore(first.id)).bytes).toEqual(Buffer.from('First'))
  await expect(
    store.remove(first.id, () => {
      throw new FileOperationError('file-session')
    }),
  ).rejects.toMatchObject({ code: 'file-session' })
  expect((await store.restore(first.id)).bytes).toEqual(Buffer.from('First'))
})
