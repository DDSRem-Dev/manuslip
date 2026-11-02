import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type FileDialogs, FileSessions } from '../../../../src/main/files/sessions'
import type { FileInfo, SaveRequest } from '../../../../src/shared/file-contracts'

function request(info: FileInfo, text: string, patch: Partial<SaveRequest> = {}): SaveRequest {
  return {
    id: info.id,
    text,
    revision: 1,
    expectedFingerprint: info.fingerprint,
    action: 'save',
    normalize: null,
    utf8: false,
    ...patch,
  }
}
describe('main-owned file sessions', () => {
  let directory: string
  let path: string
  let files: FileSessions
  let dialogs: FileDialogs
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'manuslip-sessions-'))
    path = join(directory, 'test.md')
    files = new FileSessions(vi.fn())
    dialogs = { open: async () => path, save: async () => path, overwrite: async () => true }
  })
  afterEach(async () => {
    await files.closeOwner(1)
    await files.closeOwner(2)
    await rm(directory, { recursive: true, force: true, maxRetries: 3 })
  })
  it('opens, edits, saves, and reopens BOM/CRLF Unicode without changing bytes unintentionally', async () => {
    await writeFile(path, Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('# 世界\r\n')]))
    const opened = await files.open(1, path)
    expect(opened.text).toBe('# 世界\n')
    const result = await files.save(1, request(opened.info, '# 世界\n编辑\n'), dialogs)
    expect(result).toMatchObject({ kind: 'saved', revision: 1 })
    expect(await readFile(path)).toEqual(
      Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('# 世界\r\n编辑\r\n')]),
    )
    expect((await files.open(2, path)).text).toBe('# 世界\n编辑\n')
  })
  it('deduplicates same-file records and directory watchers across windows', async () => {
    await writeFile(path, 'base')
    const a = await files.open(1, path)
    const b = await files.open(2, join(directory, '.', 'test.md'))
    expect(files.diagnostics).toEqual({ sessions: 2, files: 1, watchers: 1 })
    await files.save(1, request(a.info, 'first window'), dialogs)
    await expect(files.save(2, request(b.info, 'second window'), dialogs)).rejects.toMatchObject({
      code: 'file-changed',
    })
    expect(await readFile(path, 'utf8')).toBe('first window')
    await files.close(1, a.info.id)
    expect(files.diagnostics.watchers).toBe(1)
    await files.close(2, b.info.id)
    expect(files.diagnostics).toEqual({ sessions: 0, files: 0, watchers: 0 })
  })
  it('reuses a file session only for its owning window when requested', async () => {
    await writeFile(path, 'base')
    const first = await files.open(1, path, undefined, true)
    const reopened = await files.open(1, join(directory, '.', 'test.md'), undefined, true)
    const otherWindow = await files.open(2, path, undefined, true)
    expect(reopened.info.id).toBe(first.info.id)
    expect(otherWindow.info.id).not.toBe(first.info.id)
    expect(files.diagnostics).toEqual({ sessions: 2, files: 1, watchers: 1 })
  })
  it('enforces the tab cap without leaking a watcher and still allows activation of an open file', async () => {
    await writeFile(path, 'base')
    const first = await files.open(1, path, undefined, true)
    for (let index = 1; index < 32; index++) files.create(1)
    expect(() => files.create(1)).toThrow('32-tab')
    expect((await files.open(1, path, undefined, true)).info.id).toBe(first.info.id)
    const other = join(directory, 'other.md')
    await writeFile(other, 'other')
    await expect(files.open(1, other, undefined, true)).rejects.toMatchObject({ code: 'file-tabs' })
    expect(files.diagnostics).toEqual({ sessions: 32, files: 1, watchers: 1 })
  })
  it('refuses Save As onto another tab without replacing either file or reassigning the session', async () => {
    await writeFile(path, 'first')
    const otherPath = join(directory, 'other.md')
    await writeFile(otherPath, 'second')
    const first = await files.open(1, path, undefined, true)
    await files.open(1, otherPath, undefined, true)
    await expect(
      files.save(1, request(first.info, 'replacement', { action: 'save-as' }), {
        ...dialogs,
        save: async () => otherPath,
      }),
    ).rejects.toMatchObject({ code: 'file-open' })
    expect(await readFile(otherPath, 'utf8')).toBe('second')
    expect(files.describe(1, first.info.id).displayPath).toBe(path)
  })
  it('rejects unauthorized/revoked session IDs and cancellation never creates a file', async () => {
    const draft = files.create(1)
    await expect(files.save(2, request(draft.info, 'private'), dialogs)).rejects.toMatchObject({
      code: 'file-session',
    })
    expect(
      await files.save(1, request(draft.info, 'draft'), { ...dialogs, save: async () => null }),
    ).toEqual({ kind: 'cancelled' })
    await files.close(1, draft.info.id)
    await expect(files.reload(1, draft.info.id)).rejects.toMatchObject({ code: 'file-session' })
  })
  it('Save Copy preserves the session path and saved fingerprint, and refuses an existing copy', async () => {
    await writeFile(path, 'base')
    const opened = await files.open(1, path)
    const copy = join(directory, 'copy.md')
    const copyDialogs = { ...dialogs, save: async () => copy }
    const result = await files.save(
      1,
      request(opened.info, 'draft', { action: 'save-copy' }),
      copyDialogs,
    )
    expect(result).toMatchObject({ kind: 'copy', displayPath: copy })
    expect((await files.reload(1, opened.info.id)).info.fingerprint).toBe(opened.info.fingerprint)
    expect(await readFile(path, 'utf8')).toBe('base')
    expect(await readFile(copy, 'utf8')).toBe('draft')
    await expect(
      files.save(1, request(opened.info, 'replace', { action: 'save-copy' }), copyDialogs),
    ).rejects.toMatchObject({ code: 'file-changed' })
  })
  it('does not switch the session path when Save As fails', async () => {
    await writeFile(path, 'base')
    const opened = await files.open(1, path)
    const destination = join(directory, 'missing', 'new.md')
    await expect(
      files.save(1, request(opened.info, 'new', { action: 'save-as' }), {
        ...dialogs,
        save: async () => destination,
      }),
    ).rejects.toThrow()
    expect((await files.reload(1, opened.info.id)).info.displayPath).toBe(path)
  })
  it('follows the filesystem actual case behavior when deduplicating names', async () => {
    await writeFile(path, 'lowercase')
    await files.open(1, path)
    const variant = join(directory, 'TEST.MD')
    let same = false
    try {
      same = (await stat(path)).ino === (await stat(variant)).ino
    } catch {
      await writeFile(variant, 'distinct file')
    }
    await files.open(2, variant)
    expect(files.diagnostics).toEqual({ sessions: 2, files: same ? 1 : 2, watchers: 1 })
  })
  it('cleans an unattached target record after a failed Save As to an existing hard-linked file', async () => {
    const { link } = await import('node:fs/promises')
    await writeFile(path, 'old file')
    const original = await files.open(1, path)
    const destination = join(directory, 'target.md')
    await writeFile(destination, 'target original')
    await link(destination, join(directory, 'alias.md'))
    await expect(
      files.save(1, request(original.info, 'draft', { action: 'save-as' }), {
        ...dialogs,
        save: async () => destination,
      }),
    ).rejects.toMatchObject({ code: 'file-metadata' })
    expect(files.diagnostics).toEqual({ sessions: 1, files: 1, watchers: 1 })
    expect(files.describe(1, original.info.id).displayPath).toBe(path)
    expect(await readFile(destination, 'utf8')).toBe('target original')
  })
})
