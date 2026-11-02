import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { IncomingFiles, launchPaths, parseDroppedPaths } from '../../../src/main/incoming'
import type { FileSnapshot } from '../../../src/shared/file-contracts'

describe('native incoming files', () => {
  it('extracts native launch paths without treating switches, URLs or the development app as files', () => {
    const cwd = resolve('.')
    expect(
      launchPaths(
        [
          'electron',
          'app.md',
          '--inspect=123',
          '--user-data-dir',
          'secret.md',
          '笔记.MD',
          'https://example.com/file.md',
          'image.png',
          '--',
          '-draft.txt',
        ],
        cwd,
        true,
      ),
    ).toEqual([resolve('笔记.MD'), resolve('-draft.txt')])
    expect(launchPaths(['manuslip', resolve('notes.markdown')], cwd, false)).toEqual([
      resolve('notes.markdown'),
    ])
    expect(
      launchPaths(['app', ...Array.from({ length: 100 }, (_, index) => `${index}.md`)], cwd, false),
    ).toHaveLength(33)
  })
  it('admits only bounded absolute native-drop paths', () => {
    expect(parseDroppedPaths([resolve('notes.md')])).toEqual([resolve('notes.md')])
    for (const value of [
      ['relative.md'],
      ['bad\0.md'],
      { path: resolve('notes.md') },
      Array(34).fill(resolve('notes.md')),
    ])
      expect(() => parseDroppedPaths(value)).toThrow()
  })
  it('deduplicates and bounds path metadata, reports unsupported types, and isolates request owners', async () => {
    const changed = vi.fn()
    const incoming = new IncomingFiles(changed)
    incoming.enqueue([resolve('notes.md'), resolve('notes.md'), resolve('image.png')])
    const state = incoming.list(1)
    expect(state.requests).toHaveLength(1)
    expect(state.issue).toBe('file-incoming-type')
    expect(incoming.list(2).requests).toHaveLength(0)
    const id = state.requests[0]?.id || ''
    await expect(incoming.open(2, id, vi.fn())).rejects.toMatchObject({ code: 'file-session' })
    expect(() => incoming.dismiss(1, randomUUID())).toThrow()
    incoming.dismiss(1, null)
    expect(incoming.list(1).issue).toBeNull()
    incoming.enqueue(Array.from({ length: 33 }, (_, index) => resolve(`${index}.md`)))
    expect(incoming.list(1).requests).toHaveLength(1)
    expect(incoming.list(1).issue).toBe('file-incoming-limit')
    incoming.enqueue(Array.from({ length: 32 }, (_, index) => resolve(`${index}.md`)))
    expect(incoming.list(1).requests).toHaveLength(32)
    expect(changed).toHaveBeenCalled()
    incoming.closeOwner(1)
    expect(incoming.list(1).requests).toEqual([])
  })
  it('retains failed requests for retry and rejects concurrent reads and late-owner results', async () => {
    const incoming = new IncomingFiles(() => {})
    incoming.enqueue([resolve('one.md'), resolve('two.md')])
    const [one, two] = incoming.list(1).requests
    if (!one || !two) throw new Error('Missing requests')
    await expect(
      incoming.open(1, one.id, async () => {
        throw new Error('disk')
      }),
    ).rejects.toThrow('disk')
    expect(incoming.list(1).requests).toHaveLength(2)
    let finish!: (snapshot: FileSnapshot) => void
    const pending = incoming.open(
      1,
      one.id,
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await expect(incoming.open(1, two.id, vi.fn())).rejects.toMatchObject({
      code: 'file-incoming-busy',
    })
    expect(() => incoming.dismiss(1, one.id)).toThrow()
    incoming.closeOwner(1)
    finish({ text: '' } as FileSnapshot)
    await expect(pending).rejects.toMatchObject({ code: 'file-session' })
    incoming.enqueue([resolve('one.md')])
    const next = incoming.list(1).requests[0]
    if (!next) throw new Error('Missing retry')
    await incoming.open(1, next.id, async () => ({ text: '' }) as FileSnapshot)
    expect(incoming.list(1).requests).toEqual([])
  })
})
