import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultWritingStyle, WritingStyleRepository } from '../../../../src/main/styles/repository'
import { styleLimits } from '../../../../src/shared/style-contracts'

describe('bounded per-document appearance storage', () => {
  let directory: string, path: string
  const key = createHash('sha256').update('document').digest('hex')
  const style = {
    ...defaultWritingStyle(),
    typography: { ...defaultWritingStyle().typography, size: 20 as const },
    stylesheet: { name: 'local.css', source: 'h1 { color: red }' },
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'manuslip-style-'))
    path = join(directory, 'writing-styles.json')
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  it('atomically restores appearance and reset removes its entry', async () => {
    const repository = new WritingStyleRepository(path)
    await repository.load()
    expect(repository.get(key)).toEqual(defaultWritingStyle())
    await repository.set(key, style)
    const restored = new WritingStyleRepository(path)
    await restored.load()
    expect(restored.get(key)).toEqual(style)
    await restored.set(key, defaultWritingStyle())
    expect(JSON.parse(await readFile(path, 'utf8')).entries).toEqual({})
    expect(await readdir(directory)).toEqual(['writing-styles.json'])
  })
  it.each([
    '{broken',
    JSON.stringify({
      schemaVersion: 1,
      entries: {
        [key]: { ...style, stylesheet: { name: 'unsafe.css', source: 'button { display:none }' } },
      },
    }),
  ])('preserves invalid data before defaults: %s', async (text) => {
    await writeFile(path, text)
    const repository = new WritingStyleRepository(path)
    await repository.load()
    expect(repository.recovered).toBe(true)
    expect(repository.get(key)).toEqual(defaultWritingStyle())
    const backup = (await readdir(directory)).find((name) => name.includes('.backup-'))
    expect(backup).toBeDefined()
    expect(await readFile(join(directory, backup ?? ''), 'utf8')).toBe(text)
  })
  it('preserves a future schema unchanged and refuses writes', async () => {
    const text = '{"schemaVersion":2,"newAppearance":true}'
    await writeFile(path, text)
    const repository = new WritingStyleRepository(path)
    await repository.load()
    expect(repository.readOnly).toBe(true)
    await expect(repository.set(key, style)).rejects.toMatchObject({ code: 'style-readonly' })
    expect(await readFile(path, 'utf8')).toBe(text)
    const backup = (await readdir(directory)).find((name) => name.includes('.backup-'))
    expect(await readFile(join(directory, backup ?? ''), 'utf8')).toBe(text)
  })
  it('serializes different-document writes and does not advance state on failed writes or stale commits', async () => {
    const repository = new WritingStyleRepository(path),
      second = createHash('sha256').update('second').digest('hex')
    await repository.load()
    await Promise.all([repository.set(key, style), repository.set(second, style)])
    expect(Object.keys(JSON.parse(await readFile(path, 'utf8')).entries)).toHaveLength(2)
    const prior = await readFile(path, 'utf8')
    await expect(
      repository.set(key, defaultWritingStyle(), () => {
        throw new Error('stale')
      }),
    ).rejects.toThrow('stale')
    expect(await readFile(path, 'utf8')).toBe(prior)
    await rm(path)
    await writeFile(path, '')
    await rm(path)
    await rm(directory, { recursive: true })
    await writeFile(directory, 'blocked')
    await expect(repository.set(key, defaultWritingStyle())).rejects.toThrow()
    expect(repository.get(key)).toEqual(style)
    await rm(directory)
    await repository.set(key, defaultWritingStyle())
    expect(repository.get(key)).toEqual(defaultWritingStyle())
  })
  it('rejects new entries at capacity without evicting existing styles and reset frees a slot', async () => {
    const entries = Object.fromEntries(
      Array.from({ length: styleLimits.documents }, (_, index) => [
        createHash('sha256').update(String(index)).digest('hex'),
        style,
      ]),
    )
    await writeFile(path, JSON.stringify({ schemaVersion: 1, entries }))
    const repository = new WritingStyleRepository(path)
    await repository.load()
    await expect(repository.set(key, style)).rejects.toMatchObject({ code: 'style-capacity' })
    expect(Object.keys(JSON.parse(await readFile(path, 'utf8')).entries)).toHaveLength(
      styleLimits.documents,
    )
    await repository.set(Object.keys(entries)[0] ?? '', defaultWritingStyle())
    await repository.set(key, style)
    expect(repository.get(key)).toEqual(style)
  })
})
