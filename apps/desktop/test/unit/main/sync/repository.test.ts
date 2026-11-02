import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { FileOperationError } from '../../../../src/main/files/errors'
import { type SyncConnection, SyncRepository } from '../../../../src/main/sync/repository'

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'manuslip-sync-repository-'))
  if (!directory.startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture path')
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})
function connection(): SyncConnection {
  return {
    id: randomUUID(),
    localPath: join(directory, 'source.md'),
    configuration: { kind: 'webdav', url: 'https://example.org/document.md' },
    baseline: null,
    syncedAt: null,
    intent: null,
    encryptedCredential: null,
  }
}
it('retains a baseline and interrupted publication journal across restart without aliasing live state', async () => {
  const path = join(directory, 'sync.json'),
    repository = new SyncRepository(path),
    row = connection(),
    base = 'a'.repeat(64),
    next = 'b'.repeat(64)
  await repository.load()
  await repository.mutate(
    () => [{ ...row, baseline: base }],
    () => {},
  )
  await repository.mutate(
    (rows) =>
      rows.map((row) => ({
        ...row,
        intent: {
          direction: 'download',
          localHash: base,
          remoteHash: next,
          outputHash: next,
          recoveryId: randomUUID(),
        },
      })),
    () => {},
  )
  const restarted = new SyncRepository(path)
  await restarted.load()
  expect(restarted.list()).toEqual(repository.list())
  expect(restarted.list()[0]).toMatchObject({ baseline: base, intent: { outputHash: next } })
  const detached = restarted.list()
  if (!detached[0]) throw new Error('Missing stored connection')
  detached[0].baseline = next
  expect(restarted.list()[0]?.baseline).toBe(base)
})
it('keeps the previous baseline when storage changed outside the app or authorization expires', async () => {
  const path = join(directory, 'sync.json'),
    repository = new SyncRepository(path),
    row = connection()
  await repository.load()
  await repository.mutate(
    () => [row],
    () => {},
  )
  const original = await readFile(path)
  await expect(
    repository.mutate(
      (rows) => rows.map((row) => ({ ...row, baseline: 'b'.repeat(64) })),
      () => {
        throw new FileOperationError('file-session')
      },
    ),
  ).rejects.toMatchObject({ code: 'file-session' })
  expect(await readFile(path)).toEqual(original)
  const outside = '{"schemaVersion":99,"private":"future"}'
  await writeFile(path, outside)
  await expect(
    repository.mutate(
      () => [],
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'sync-storage' })
  expect(await readFile(path, 'utf8')).toBe(outside)
  expect(repository.list()).toEqual([row])
})
it('backs up corrupt data, keeps future data read-only and rejects credential leakage or duplicate connections', async () => {
  const path = join(directory, 'sync.json')
  await writeFile(path, 'corrupt')
  const broken = new SyncRepository(path)
  await broken.load()
  expect(broken.recovered).toBe(true)
  const backups = (await readdir(directory)).filter((name) => name.startsWith('sync.json.backup-'))
  if (!backups[0]) throw new Error('Missing corrupt settings backup')
  expect(await readFile(join(directory, backups[0]), 'utf8')).toBe('corrupt')
  const future = '{"schemaVersion":2,"connections":[]}'
  await writeFile(path, future)
  const newer = new SyncRepository(path)
  await newer.load()
  expect(newer.readOnly).toBe(true)
  await expect(
    newer.mutate(
      () => [],
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'sync-readonly' })
  expect(await readFile(path, 'utf8')).toBe(future)
  const row = connection()
  await expect(
    broken.mutate(
      () => [row, { ...row, id: randomUUID() }],
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'sync-storage' })
  await expect(
    broken.mutate(
      () => [{ ...row, encryptedCredential: 'plaintext password' }],
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'sync-storage' })
})
