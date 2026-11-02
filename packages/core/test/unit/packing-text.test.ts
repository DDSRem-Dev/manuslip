import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import {
  type PackedIdentity,
  type PackedOperation,
  PackedRevision,
} from '../../src/packing-revision'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB }
const open = (value: unknown) => PackedArena.open(packValue(value, limits.bytes), limits)
const identity = (source: string, revision: number): PackedIdentity => ({
  generation: 1,
  documentId: 'test',
  revision,
  sourceHash: sourceHash(source),
  parserVersion: 'parser',
  rendererVersion: 'renderer',
  options: 'default',
})
function full(value: unknown) {
  return PackedRevision.full(open(value), 'source', identity('source', 0), limits)
}
function edit(
  base: PackedRevision,
  inserted: unknown,
  start: number,
  remove: number,
  path: readonly (string | number)[] = [],
) {
  const arena = open(inserted)
  const source = `${base.source}x`
  return {
    base: base.identity,
    baseSource: base.source,
    result: identity(source, base.identity.revision + 1),
    source,
    arena,
    operations: [
      { kind: 'text', path, start, remove, record: arena.root },
    ] as readonly PackedOperation[],
  }
}
const scalarLimits = { retained: 8 * MiB, staging: 8 * MiB }

describe('persistent packed UTF-16 text changes', () => {
  it.each([
    ['', 0, 0, 'start'],
    ['old', 0, 0, 'prefix'],
    ['old', 3, 0, 'suffix'],
    ['old', 0, 3, ''],
    ['old', 0, 3, 'new'],
    ['old', 1, 0, ''],
    ['A😀Z', 2, 0, 'X'],
    ['\ud800\udfff', 1, 1, '\ud800'],
    ['"\\\r\n\t', 1, 3, '\0\b\f'],
  ] as const)('uses exact code-unit offsets: %j', (original, start, remove, inserted) => {
    const base = full(original)
    const next = base.apply(edit(base, inserted, start, remove), limits)
    const expected = original.slice(0, start) + inserted + original.slice(start + remove)
    expect(next.root.kind()).toBe('scalar')
    expect(next.root.textLength()).toBe(expected.length)
    expect(next.root.readScalar(scalarLimits)).toBe(expected)
    expect(base.root.readScalar(scalarLimits)).toBe(original)
  })

  it('isolates shared aliases, nested array elements and captured old text views', () => {
    const base = full({ a: ['same'], b: ['same'] })
    const captured = base.root.at(['a', 0])
    const next = base.apply(edit(base, 'other', 0, 4, ['a', 0]), limits)
    expect(next.root.at(['a', 0]).readScalar(scalarLimits)).toBe('other')
    expect(next.root.at(['b', 0]).readScalar(scalarLimits)).toBe('same')
    expect(captured.readScalar(scalarLimits)).toBe('same')
    expect(Object.isFrozen(next.root)).toBe(true)
    expect(Reflect.ownKeys(next.root)).toEqual([])
  })

  it('matches an independent native-string oracle through randomized Unicode edit sequences', () => {
    let expected = 'Start 😀 界\n"\\\ud800 end'
    let revision = full(expected)
    let seed = 20261024
    const captures = [{ view: revision.root, value: expected }]
    const insertions = ['', 'x', '😀', '\ud800', '\udfff', '\n"\\', '界']
    for (let index = 0; index < 150; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const start = seed % (expected.length + 1)
      const remove = Math.min(index % 4, expected.length - start)
      const inserted = insertions[index % insertions.length] ?? ''
      revision = revision.apply(edit(revision, inserted, start, remove), limits)
      expected = expected.slice(0, start) + inserted + expected.slice(start + remove)
      expect(revision.root.readScalar(scalarLimits)).toBe(expected)
      expect(revision.root.textLength()).toBe(expected.length)
      if (index % 30 === 0) captures.push({ view: revision.root, value: expected })
    }
    for (const capture of captures)
      expect(capture.view.readScalar(scalarLimits)).toBe(capture.value)
  })

  it('can reuse one arena string more than once, including backwards source ranges', () => {
    const arena = open('abcdef')
    const base = PackedRevision.full(arena, 'source', identity('source', 0), limits)
    const message = edit(base, null, 3, 0)
    message.arena = arena
    message.operations = [{ kind: 'text', path: [], start: 3, remove: 0, record: arena.root }]
    const next = base.apply(message, limits)
    expect(next.root.readScalar(scalarLimits)).toBe('abcabcdefdef')
    expect(next.root.readScalar(scalarLimits)).toBe('abcabcdefdef')
    expect(base.root.scalar()).toBe('abcdef')
  })

  it('reuses a large base stream across unchanged spans and never decodes an unrelated scalar', () => {
    const original = `${'a'.repeat(30000)}😀${'b'.repeat(30000)}界${'c'.repeat(30000)}`
    const base = full({ html: original, unrelated: 'z'.repeat(2 * MiB) })
    let revision = base
    let expected = original
    for (let index = 0; index < 20; index++) {
      const start = 100 + index * 3000
      revision = revision.apply(edit(revision, `${index}😀`, start, 2, ['html']), limits)
      expected = `${expected.slice(0, start)}${index}😀${expected.slice(start + 2)}`
    }
    expect(revision.retainedBytes - base.retainedBytes).toBeLessThan(256 * 1024)
    const scalarSpy = vi.spyOn(PackedArena.prototype, 'scalar').mockImplementation(() => {
      throw new Error('Full scalar decoder must not be used')
    })
    const streamSpy = vi.spyOn(PackedArena.prototype, 'stringChunks')
    try {
      expect(revision.root.at(['html']).readScalar(scalarLimits)).toBe(expected)
      // One scan for the large base plus one per small insertion, not one scan per base span.
      expect(streamSpy).toHaveBeenCalledTimes(21)
      expect(scalarSpy).not.toHaveBeenCalled()
    } finally {
      scalarSpy.mockRestore()
      streamSpy.mockRestore()
    }
    expect(base.root.at(['html']).scalar()).toBe(original)
  })

  it('checks output and temporary-join admission before reading any packed chunks', () => {
    const base = full('x'.repeat(20000))
    const next = base.apply(edit(base, '😀', 100, 1), limits)
    const cost = next.root.scalarCost()
    const streamSpy = vi.spyOn(PackedArena.prototype, 'stringChunks')
    try {
      expect(() =>
        next.root.readScalar({ retained: cost.retained - 1, staging: cost.workspace }),
      ).toThrow('retained')
      expect(() =>
        next.root.readScalar({ retained: cost.retained, staging: cost.workspace - 1 }),
      ).toThrow('staging')
      expect(streamSpy).not.toHaveBeenCalled()
      expect(next.root.readScalar({ retained: cost.retained, staging: cost.workspace })).toBe(
        `${'x'.repeat(100)}😀${'x'.repeat(19899)}`,
      )
      for (const value of [-1, NaN, Infinity, 0.5])
        for (const key of ['retained', 'staging'])
          expect(() => next.root.readScalar({ ...scalarLimits, [key]: value })).toThrow('limits')
    } finally {
      streamSpy.mockRestore()
    }
  })

  it('rejects a huge logical repeated string without expanding its compact shared spans', () => {
    const arena = open('x'.repeat(MiB))
    let revision = PackedRevision.full(arena, 'source', identity('source', 0), limits)
    for (let index = 0; index < 32; index++) {
      const message = edit(revision, null, revision.root.textLength(), 0)
      message.arena = arena
      message.operations = [
        {
          kind: 'text',
          path: [],
          start: revision.root.textLength(),
          remove: 0,
          record: arena.root,
        },
      ]
      revision = revision.apply(message, limits)
    }
    expect(revision.root.textLength()).toBe(33 * MiB)
    expect(revision.retainedBytes).toBeLessThan(2 * MiB)
    const streamSpy = vi.spyOn(PackedArena.prototype, 'stringChunks')
    try {
      expect(() => revision.root.readScalar(scalarLimits)).toThrow('retained')
      expect(streamSpy).not.toHaveBeenCalled()
    } finally {
      streamSpy.mockRestore()
    }
  })

  it.each([null, false, 0, [], {}])('rejects non-string target or insertion: %j', (value) => {
    const base = full(value)
    expect(() => base.apply(edit(base, 'new', 0, 0), limits)).toThrow()
    const text = full('old')
    expect(() => text.apply(edit(text, value, 0, 0), limits)).toThrow()
    expect(text.root.scalar()).toBe('old')
  })

  it.each([
    [-1, 0],
    [0, -1],
    [4, 0],
    [1, 3],
    [0.5, 0],
    [NaN, 0],
    [0, Infinity],
  ])('rejects an invalid text range (%s, %s)', (start, remove) => {
    const base = full('old')
    expect(() => base.apply(edit(base, 'new', start, remove), limits)).toThrow('text splice range')
    expect(base.root.scalar()).toBe('old')
  })

  it('keeps a failed later operation and a failed metadata admission private', () => {
    const base = full({ html: 'original' })
    const message = edit(base, 'new', 0, 3, ['html'])
    const next = base.apply(message, limits)
    expect(() => base.apply(message, { ...limits, retained: next.preparationBytes - 1 })).toThrow(
      'retained',
    )
    message.operations = [
      ...message.operations,
      { kind: 'text', path: ['html'], start: 100, remove: 0, record: message.arena.root },
    ]
    expect(() => base.apply(message, limits)).toThrow('text splice range')
    expect(base.root.at(['html']).scalar()).toBe('original')
    expect(next.root.at(['html']).readScalar(scalarLimits)).toBe('newginal')
  })
})
