import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WritingStyleRepository } from '../../../../src/main/styles/repository'
import { WritingStyles } from '../../../../src/main/styles/service'
import type { FileInfo } from '../../../../src/shared/file-contracts'
import { defaultTypography } from '../../../../src/shared/style-contracts'

describe('owned document appearance and import races', () => {
  let directory: string,
    profile: string,
    css: string,
    info: FileInfo,
    repository: WritingStyleRepository,
    styles: WritingStyles
  const files = {
    describe(owner: number, id: string): FileInfo {
      if (owner !== 7 || id !== info.id) throw new Error('unowned')
      return { ...info }
    },
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'manuslip-appearance-'))
    profile = join(directory, 'writing-styles.json')
    css = join(directory, 'local.css')
    info = {
      id: randomUUID(),
      name: 'draft.md',
      displayPath: null,
      fingerprint: null,
      encoding: 'utf8',
      bom: false,
      newline: 'lf',
      unsafeDecoding: false,
    }
    repository = new WritingStyleRepository(profile)
    await repository.load()
    styles = new WritingStyles(files, repository)
    await writeFile(css, 'body { color: red } h1 { font-size: 28px }')
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  it('persists first-save and Save As inheritance while retaining the old path profile', async () => {
    expect((await styles.set(7, info.id, { ...defaultTypography, size: 20 })).storage).toBe(
      'session',
    )
    await expect(readFile(profile)).rejects.toMatchObject({ code: 'ENOENT' })
    info.displayPath = join(directory, 'first.md')
    expect((await styles.get(7, info.id)).storage).toBe('saved')
    await styles.import(7, info.id, async () => css)
    info.displayPath = join(directory, 'second.md')
    await styles.get(7, info.id)
    expect(Object.keys(JSON.parse(await readFile(profile, 'utf8')).entries)).toHaveLength(2)
    const restored = new WritingStyleRepository(profile)
    await restored.load()
    styles = new WritingStyles(files, restored)
    expect(await styles.get(7, info.id)).toMatchObject({
      typography: { size: 20 },
      name: 'local.css',
    })
    info.displayPath = join(directory, 'first.md')
    styles.closeDocument(7, info.id)
    expect((await styles.get(7, info.id)).name).toBe('local.css')
  })
  it('rejects unowned IDs before opening a picker and preserves the prior stylesheet on invalid import', async () => {
    const choose = vi.fn(async () => css)
    await expect(styles.import(8, info.id, choose)).rejects.toThrow('unowned')
    expect(choose).not.toHaveBeenCalled()
    await styles.import(7, info.id, choose)
    const before = styles.capture(7, info.id)
    await writeFile(css, '@import "https://example.invalid/unsafe.css";')
    await expect(styles.import(7, info.id, choose)).rejects.toMatchObject({ code: 'style-invalid' })
    expect(styles.capture(7, info.id)).toEqual(before)
    expect(await styles.import(7, info.id, async () => null)).toBeNull()
  })
  it.each(['reset', 'path', 'close', 'frame'])('rejects a late picker after %s', async (action) => {
    let finish: (value: string | null) => void = () => {}
    const chosen = new Promise<string | null>((resolve) => {
      finish = resolve
    })
    let currentFrame = true
    const pending = styles.import(
      7,
      info.id,
      () => chosen,
      () => {
        if (!currentFrame) throw new Error('frame')
      },
    )
    const rejected = expect(pending).rejects.toThrow()
    if (action === 'reset') await styles.reset(7, info.id, false)
    if (action === 'path') info.displayPath = join(directory, 'moved.md')
    if (action === 'close') styles.closeDocument(7, info.id)
    if (action === 'frame') currentFrame = false
    finish(css)
    await rejected
    expect(styles.capture(7, info.id).stylesheet).toBeNull()
  })
  it('bounds concurrent pickers without invalidating the first import', async () => {
    let finish: (value: string | null) => void = () => {}
    const chosen = new Promise<string | null>((resolve) => {
      finish = resolve
    })
    const pending = styles.import(7, info.id, () => chosen)
    await expect(styles.import(7, info.id, async () => css)).rejects.toMatchObject({
      code: 'style-busy',
    })
    finish(css)
    expect((await pending)?.name).toBe('local.css')
  })
  it('retains session changes after failed writes and makes reset usable before retry', async () => {
    info.displayPath = join(directory, 'saved.md')
    await styles.import(7, info.id, async () => css)
    const failed = vi.spyOn(repository, 'set').mockRejectedValue(new Error('disk full'))
    expect(await styles.reset(7, info.id, false)).toMatchObject({
      name: null,
      css: '',
      storage: 'unavailable',
      error: 'style-persist',
    })
    expect(styles.capture(7, info.id).stylesheet).toBeNull()
    failed.mockRestore()
    expect((await styles.set(7, info.id, defaultTypography)).storage).toBe('saved')
    expect(JSON.parse(await readFile(profile, 'utf8')).entries).toEqual({})
  })
  it('rejects oversized and invalid UTF-8 files without replacing a valid stylesheet', async () => {
    await styles.import(7, info.id, async () => css)
    const prior = styles.capture(7, info.id)
    await writeFile(css, ' '.repeat(64 * 1024 + 1))
    await expect(styles.import(7, info.id, async () => css)).rejects.toMatchObject({
      code: 'style-limit',
    })
    await writeFile(css, Buffer.from([0xc0, 0xaf]))
    await expect(styles.import(7, info.id, async () => css)).rejects.toMatchObject({
      code: 'style-io',
    })
    expect(styles.capture(7, info.id)).toEqual(prior)
  })
})
