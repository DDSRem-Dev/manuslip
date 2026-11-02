import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { assertPandocTool, inspectPandocBinary } from '../../../../src/main/pandoc/binary'
import { PandocRepository } from '../../../../src/main/pandoc/repository'

let directory: string
beforeEach(async () => {
  await mkdir(resolve(tmpdir()), { recursive: true })
  directory = await mkdtemp(join(tmpdir(), 'manuslip-pandoc-repository-'))
  if (!directory.startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture path')
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})
const tool = () => ({
  path: join(directory, 'pandoc.exe'),
  version: '3.13',
  fingerprint: 'a'.repeat(64),
})
it('serializes selection and forget, restores it, and returns detached metadata', async () => {
  const path = join(directory, 'tool.json'),
    repository = new PandocRepository(path)
  await repository.load()
  await Promise.all([repository.set(tool()), repository.set(null), repository.set(tool())])
  expect(repository.get()).toEqual(tool())
  const copy = repository.get()
  if (copy) copy.version = '3.1'
  expect(repository.get()?.version).toBe('3.13')
  const reopened = new PandocRepository(path)
  await reopened.load()
  expect(reopened.get()).toEqual(tool())
  await reopened.set(null)
  expect(JSON.parse(await readFile(path, 'utf8')).tool).toBeNull()
})
it('backs up corrupt settings and preserves future schemas read-only', async () => {
  const path = join(directory, 'tool.json')
  await writeFile(path, '{broken')
  const repository = new PandocRepository(path)
  await repository.load()
  expect(repository.recovered).toBe(true)
  const backup = (await readdir(directory)).find((name) => name.startsWith('tool.json.backup-'))
  expect(await readFile(join(directory, backup || ''), 'utf8')).toBe('{broken')
  await repository.set(tool())
  const future = JSON.stringify({ schemaVersion: 2, private: 'keep' })
  await writeFile(path, future)
  const newer = new PandocRepository(path)
  await newer.load()
  expect(newer.readOnly).toBe(true)
  await expect(newer.set(null)).rejects.toMatchObject({ code: 'pandoc-storage' })
  expect(await readFile(path, 'utf8')).toBe(future)
})
it('retains repository memory on stale authorization and external changes', async () => {
  const path = join(directory, 'tool.json'),
    repository = new PandocRepository(path)
  await repository.set(tool())
  await expect(
    repository.set(null, () => {
      throw new Error('stale')
    }),
  ).rejects.toThrow('stale')
  expect(repository.get()).toEqual(tool())
  const external = JSON.stringify({ schemaVersion: 2, private: 'do not overwrite' })
  await writeFile(path, external)
  await expect(repository.set(null)).rejects.toThrow()
  expect(repository.get()).toEqual(tool())
  expect(await readFile(path, 'utf8')).toBe(external)
})
it('detects executable replacement even when its path stays unchanged', async () => {
  const path = join(directory, 'pandoc.exe')
  await writeFile(path, 'first executable')
  const selected = await inspectPandocBinary(path, new AbortController().signal)
  const capture = { ...selected, version: '3.13' }
  await assertPandocTool(capture, new AbortController().signal)
  await writeFile(path, 'other executable')
  await expect(assertPandocTool(capture, new AbortController().signal)).rejects.toMatchObject({
    code: 'pandoc-changed',
  })
  await expect(inspectPandocBinary(directory, new AbortController().signal)).rejects.toThrow()
})
