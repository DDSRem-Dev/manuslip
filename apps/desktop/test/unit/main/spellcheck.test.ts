import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { prepareDictionary } from '../../../src/main/spellcheck'

vi.mock('electron', () => ({ Menu: {} }))
const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})
it('seeds a verified offline dictionary, preserves valid caches and replaces damaged copies', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'manuslip-dictionary-'))
  directories.push(profile)
  const assets = resolve('apps/desktop/vendor/dictionaries')
  const target = join(profile, 'Dictionaries', 'en-US-10-2.bdic')
  expect(await prepareDictionary(assets, profile)).toBe(true)
  const expected = await readFile(join(assets, 'en-US-10-2.bdic'))
  expect(await readFile(target)).toEqual(expected)
  expect(await prepareDictionary(assets, profile)).toBe(true)
  await writeFile(target, 'damaged')
  expect(await prepareDictionary(assets, profile)).toBe(true)
  expect(await readFile(target)).toEqual(expected)
})
it('disables spelling when the packaged dictionary is missing or fails size/hash verification', async () => {
  const assets = await mkdtemp(join(tmpdir(), 'manuslip-dictionary-assets-'))
  const profile = await mkdtemp(join(tmpdir(), 'manuslip-dictionary-profile-'))
  directories.push(assets, profile)
  expect(await prepareDictionary(assets, profile)).toBe(false)
  await writeFile(join(assets, 'en-US-10-2.bdic'), 'incorrect')
  expect(await prepareDictionary(assets, profile)).toBe(false)
  await writeFile(join(assets, 'en-US-10-2.bdic'), Buffer.alloc(451982))
  expect(await prepareDictionary(assets, profile)).toBe(false)
})
