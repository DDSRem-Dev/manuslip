import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { FileOperationError } from '../../../../src/main/files/errors'
import { chooseFolderScope, FolderAdapter, syncFilename } from '../../../../src/main/sync/folder'

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'manuslip-sync-folder-draft-'))
  if (!directory.startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture path')
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})
const signal = () => new AbortController().signal,
  current = () => {}
it('keeps the connection scope to one safe, portable direct filename', () => {
  for (const filename of [
    '../outside.md',
    'sub/path.md',
    'NUL.md',
    'LPT1.txt',
    'x.md:stream',
    '.secret.md',
    'x.exe',
    ' notes.md',
  ])
    expect(() => syncFilename(filename)).toThrow()
  expect(syncFilename('中文 notes.md')).toBe('中文 notes.md')
})
it('creates and updates raw bytes, rejecting stale baseline writes without replacing remote content', async () => {
  const scope = await chooseFolderScope(directory, 'remote.md'),
    adapter = new FolderAdapter(scope, async () => {}),
    path = join(directory, scope.filename)
  expect(await adapter.read(signal(), current)).toBeNull()
  const first = Buffer.from([0xff, 0xfe, 0x41, 0, 13, 0, 10, 0]),
    created = await adapter.write(first, null, signal(), current)
  expect(await readFile(path)).toEqual(first)
  const second = Buffer.from('中文\r\n😀\r\n'),
    updated = await adapter.write(second, created, signal(), current)
  expect(updated.bytes).toEqual(second)
  await expect(
    adapter.write(Buffer.from('stale'), created, signal(), current),
  ).rejects.toMatchObject({ code: 'sync-changed' })
  expect(await readFile(path)).toEqual(second)
  expect((await adapter.read(signal(), current))?.hash).toBe(updated.hash)
})
it('rechecks picked root identity after replacement instead of granting the replacement directory', async () => {
  const root = join(directory, 'chosen')
  await mkdir(root)
  const adapter = new FolderAdapter(await chooseFolderScope(root, 'remote.md'), async () => {})
  await rename(root, join(directory, 'old'))
  await mkdir(root)
  await expect(
    adapter.write(Buffer.from('private'), null, signal(), current),
  ).rejects.toMatchObject({ code: 'sync-changed' })
})
it('preserves a remote file on revocation immediately before publication', async () => {
  const scope = await chooseFolderScope(directory, 'remote.md'),
    path = join(directory, scope.filename)
  await writeFile(path, 'original')
  let checks = 0,
    armed = false
  const adapter = new FolderAdapter(scope, async () => {
    if (armed && ++checks >= 3) throw new FileOperationError('file-session')
  })
  const snapshot = await adapter.read(signal(), current)
  armed = true
  await expect(
    adapter.write(Buffer.from('must not publish'), snapshot, signal(), current),
  ).rejects.toMatchObject({ code: 'file-session' })
  expect(await readFile(path, 'utf8')).toBe('original')
})
