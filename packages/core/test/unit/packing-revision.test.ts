import { describe, expect, it } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import {
  type PackedIdentity,
  type PackedOperation,
  PackedRevision,
  type PackedUpdate,
} from '../../src/packing-revision'
import type { PackedView } from '../../src/packing-view'
import { parseMarkdown } from '../../src/parse'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB }
const open = (value: unknown) => PackedArena.open(packValue(value, limits.bytes), limits)
const identity = (source: string, revision = 0): PackedIdentity => ({
  generation: 1,
  documentId: 'document-one',
  revision,
  sourceHash: sourceHash(source),
  parserVersion: 'parser-test',
  rendererVersion: 'renderer-test',
  options: 'manuslip/rawHtml=false',
})
function materialize(view: PackedView): unknown {
  switch (view.kind()) {
    case 'scalar':
      return view.scalar()
    case 'position':
      return view.position()
    case 'array':
      return [...view.elements()].map(materialize)
    case 'object':
      return Object.fromEntries(view.keys().map((key) => [key, materialize(view.at([key]))]))
  }
}
function update(
  base: PackedRevision,
  value: unknown,
  operations?: readonly PackedOperation[],
  source = `${base.source}x`,
): PackedUpdate {
  const arena = open(value)
  return {
    base: { ...base.identity },
    baseSource: base.source,
    result: identity(source, base.identity.revision + 1),
    source,
    arena,
    operations: operations ?? [{ kind: 'replace', path: [], record: arena.root }],
  }
}
const full = (value: unknown, source = 'original') =>
  PackedRevision.full(open(value), source, identity(source), limits)

describe('experimental revision-checked persistent packed changes', () => {
  it.each(['世', '😀', '\ud800'])(
    'checks the exact UTF-8 source cap without a full encoding buffer: %s',
    (unit) => {
      const width = new TextEncoder().encode(unit).byteLength
      const source = unit.repeat(Math.floor((2 * MiB) / width)) + 'x'.repeat((2 * MiB) % width)
      expect(new TextEncoder().encode(source).byteLength).toBe(2 * MiB)
      expect(full(null, source).source).toBe(source)
      expect(() => full(null, `${source}x`)).toThrow('identity')
    },
  )

  it('changes one alias without changing another reference to the same interned record', () => {
    const shared = { value: [1, 2] }
    const base = full({ a: shared, b: shared })
    const message = update(base, 3)
    message.operations = [{ kind: 'replace', path: ['a', 'value', 1], record: message.arena.root }]
    const next = base.apply(message, limits)
    expect(materialize(next.root)).toEqual({ a: { value: [1, 3] }, b: shared })
    expect(materialize(base.root)).toEqual({ a: shared, b: shared })
  })

  it('replaces nested values and splices arrays in order without mutating captured revisions', () => {
    const base = full({ list: [{ text: 'old' }, 2, 3], untouched: ['same'] })
    const arena = open({ text: 'new', items: [4, 5], other: -0 })
    const text = arena.field(arena.root, 'text')
    const items = arena.field(arena.root, 'items')
    const other = arena.field(arena.root, 'other')
    if (text === undefined || items === undefined || other === undefined) throw new Error('fixture')
    const message = {
      ...update(base, null),
      arena,
      operations: [
        { kind: 'replace', path: ['list', 0, 'text'], record: text },
        { kind: 'splice', path: ['list'], start: 1, remove: 1, record: items },
        { kind: 'replace', path: ['list', 3], record: other },
      ] as const,
    }
    const next = base.apply(message, limits)
    expect(materialize(next.root)).toEqual({
      list: [{ text: 'new' }, 4, 5, -0],
      untouched: ['same'],
    })
    expect(materialize(base.root)).toEqual({ list: [{ text: 'old' }, 2, 3], untouched: ['same'] })
    expect(Object.is(next.root.at(['list', 3]).scalar(), -0)).toBe(true)
    expect(Object.isFrozen(next.identity)).toBe(true)
    expect(Object.isFrozen(next.root.keys())).toBe(true)
    expect(Reflect.ownKeys(next).some((key) => Reflect.get(next, key) instanceof Set)).toBe(false)
    message.base.documentId = 'changed-input'
    expect(next.identity.documentId).toBe('document-one')
  })

  it.each([
    '# Heading\n\nPlain **prose**.\n',
    'Read [link][r] and note[^one].\n\n[r]: https://example.invalid/\n\n[^one]: Note\n',
    '---\ntitle: 世界\n---\n\n- [x] task\n\n| A | B |\n| - | - |\n| 😀 | $x$ |\n',
    '> > nested [text][r]\r\n\r\n[r]: /before\r\n\r\n```math\r\nx\r\n```\r\n',
  ])('retains complete fresh-parse roots through sequential edits: %s', (initial) => {
    let source = initial
    let revision = full(parseMarkdown(source).root, source)
    const captures = [{ revision, root: parseMarkdown(source).root }]
    for (const addition of [
      '\nNew [reference][r].\n',
      '\n[r]: /after\n',
      '\n[^one]: Duplicate\n',
      '\n~~~\n',
      '😀\ud800\n',
    ]) {
      source += addition
      const expected = parseMarkdown(source).root
      const arena = open({ children: expected.children, position: expected.position })
      const children = arena.field(arena.root, 'children')
      const position = arena.field(arena.root, 'position')
      if (children === undefined || position === undefined) throw new Error('fixture')
      const message = {
        ...update(revision, null, [], source),
        arena,
        operations: [
          {
            kind: 'splice',
            path: ['children'],
            start: 0,
            remove: revision.root.at(['children']).length(),
            record: children,
          },
          { kind: 'replace', path: ['position'], record: position },
        ] as const,
      }
      revision = revision.apply(message, limits)
      expect(materialize(revision.root)).toEqual(expected)
      captures.push({ revision, root: expected })
    }
    for (const capture of captures) expect(materialize(capture.revision.root)).toEqual(capture.root)
  })

  it('checks every base identity field and the exact source, rather than trusting a cache hash', () => {
    const base = full([1])
    for (const key of Object.keys(base.identity) as (keyof PackedIdentity)[]) {
      const message = update(base, [2])
      Object.assign(message.base, { [key]: typeof message.base[key] === 'number' ? 9 : 'wrong' })
      expect(() => base.apply(message, limits)).toThrow('base mismatch')
    }
    const message = update(base, [2])
    message.baseSource = 'hash-is-not-authority'
    expect(() => base.apply(message, limits)).toThrow('base mismatch')
    const newer = base.apply(update(base, [2]), limits)
    expect(() => newer.apply(update(base, [3]), limits)).toThrow('base mismatch')
    expect(materialize(newer.root)).toEqual([2])
  })

  it('requires resync for ownership/version changes and accepts coalesced forward revisions', () => {
    const base = full('old')
    for (const key of [
      'generation',
      'documentId',
      'parserVersion',
      'rendererVersion',
      'options',
    ] as const) {
      const message = update(base, 'new')
      Object.assign(message.result, { [key]: key === 'generation' ? 2 : 'changed' })
      expect(() => base.apply(message, limits)).toThrow('ownership changed')
    }
    for (const revision of [-1, 0, 0.5, NaN, Infinity]) {
      const message = update(base, 'new')
      message.result.revision = revision
      expect(() => base.apply(message, limits)).toThrow()
    }
    const message = update(base, 'new')
    message.result.revision = 100
    expect(base.apply(message, limits).identity.revision).toBe(100)
    message.result.sourceHash = 'false'
    expect(() => base.apply(message, limits)).toThrow('identity')
  })

  it('fails atomically after a valid prefix, including nonexistent fields and invalid references', () => {
    const base = full({ list: [1, 2], text: 'old' })
    const arena = open('new')
    for (const operation of [
      { kind: 'replace', path: ['missing'], record: arena.root },
      { kind: 'replace', path: ['list', 2], record: arena.root },
      { kind: 'replace', path: ['list', '0'], record: arena.root },
      { kind: 'replace', path: ['text', 'length'], record: arena.root },
      { kind: 'replace', path: ['text'], record: arena.records },
      { kind: 'splice', path: ['list'], start: 0, remove: 1, record: arena.root },
    ] as const) {
      const message = {
        ...update(base, null),
        arena,
        operations: [{ kind: 'replace', path: ['text'], record: arena.root } as const, operation],
      }
      expect(() => base.apply(message, limits)).toThrow()
      expect(materialize(base.root)).toEqual({ list: [1, 2], text: 'old' })
    }
  })

  it('rejects invalid splice ranges without JavaScript negative-index or clamping semantics', () => {
    const base = full([1, 2])
    const arena = open([3])
    for (const [start, remove] of [
      [-1, 0],
      [0, -1],
      [3, 0],
      [1, 2],
      [0.5, 0],
      [NaN, 0],
      [0, Infinity],
    ]) {
      const message = {
        ...update(base, null),
        arena,
        operations: [{ kind: 'splice', path: [], start, remove, record: arena.root }],
      } as PackedUpdate
      expect(() => base.apply(message, limits)).toThrow('splice range')
    }
  })

  it('handles empty arrays, complete removal, insertion at either edge and repeated segments', () => {
    let revision = full([])
    const expected: number[] = []
    // Deterministic independent JS-array oracle; boundaries move after every splice.
    let seed = 12345
    for (let index = 0; index < 200; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const start = seed % (expected.length + 1)
      const remove = Math.min(index % 4, expected.length - start)
      const inserted = index % 7 === 0 ? [] : [index, -index]
      const message = update(revision, inserted)
      message.operations = [{ kind: 'splice', path: [], start, remove, record: message.arena.root }]
      revision = revision.apply(message, limits)
      expected.splice(start, remove, ...inserted)
      expect(materialize(revision.root)).toEqual(expected)
    }
    const message = update(revision, [])
    message.operations = [
      { kind: 'splice', path: [], start: 0, remove: expected.length, record: message.arena.root },
    ]
    expect(materialize(revision.apply(message, limits).root)).toEqual([])
  })

  it('charges segment metadata rather than expanding a large unchanged descriptor array', () => {
    const values = Array.from({ length: 40000 }, (_, index) => ({ from: index, to: index + 1 }))
    const base = full({ blocks: values })
    const message = update(base, [{ from: 99, to: 100 }])
    message.operations = [
      { kind: 'splice', path: ['blocks'], start: 20000, remove: 1, record: message.arena.root },
    ]
    const next = base.apply(message, limits)
    expect(next.retainedBytes - base.retainedBytes).toBeLessThan(4096)
    expect(next.root.at(['blocks']).length()).toBe(40000)
    expect(next.root.at(['blocks', 19999, 'from']).scalar()).toBe(19999)
    expect(next.root.at(['blocks', 20000, 'from']).scalar()).toBe(99)
    expect(next.root.at(['blocks', 20001, 'from']).scalar()).toBe(20001)
    expect(base.root.at(['blocks', 20000, 'from']).scalar()).toBe(20000)
  })

  it('admits source overlap, all dependent arenas and metadata before returning a revision', () => {
    const base = full({ a: [1, 2] })
    const message = update(base, [3])
    message.operations = [
      { kind: 'splice', path: ['a'], start: 1, remove: 0, record: message.arena.root },
    ]
    const next = base.apply(message, limits)
    // Preparation includes both source strings, so the live result's weight alone is too low.
    expect(() => base.apply(message, { ...limits, retained: next.retainedBytes })).toThrow(
      'retained',
    )
    expect(() => base.apply(message, { ...limits, retained: next.preparationBytes - 1 })).toThrow(
      'retained',
    )
    expect(base.apply(message, { ...limits, retained: next.preparationBytes }).retainedBytes).toBe(
      next.retainedBytes,
    )
    expect(() => base.apply(message, { ...limits, staging: next.stagingBytes - 1 })).toThrow(
      'staging',
    )
    expect(
      materialize(base.apply(message, { ...limits, staging: next.stagingBytes }).root),
    ).toEqual({ a: [1, 3, 2] })
    for (const value of [-1, NaN, Infinity, 0.5])
      for (const key of ['retained', 'staging'])
        expect(() => base.apply(message, { ...limits, [key]: value })).toThrow('limits')
    expect(materialize(base.root)).toEqual({ a: [1, 2] })
  })

  it('preserves own special keys, lone surrogates and caller-admitted uncached scalar costs', () => {
    const base = full(JSON.parse('{"__proto__":"safe","constructor":[0]}'))
    const message = update(base, '\ud800'.repeat(5000))
    message.operations = [{ kind: 'replace', path: ['__proto__'], record: message.arena.root }]
    const next = base.apply(message, limits)
    expect(next.root.at(['__proto__']).scalar()).toBe('\ud800'.repeat(5000))
    expect(next.root.at(['__proto__']).scalarCost().retained).toBe(10032)
    expect(next.root.at(['__proto__']).scalarCost().workspace).toBeGreaterThan(10000)
    expect(next.root.at(['constructor', 0]).scalar()).toBe(0)
    expect(Reflect.get({}, 'polluted')).toBeUndefined()
  })

  it('bounds malformed operations, paths, sources and identity strings', () => {
    const base = full([1])
    for (const operation of [
      { kind: 'unknown', path: [], record: 0 },
      { kind: 'replace', path: Array(129).fill(0), record: 0 },
      { kind: 'replace', path: [0.5], record: 0 },
      { kind: 'replace', path: ['x'.repeat(1025)], record: 0 },
      { kind: 'replace', path: [null], record: 0 },
    ]) {
      const message = update(base, [2])
      message.operations = [operation] as unknown as PackedOperation[]
      expect(() => base.apply(message, limits)).toThrow('operation')
    }
    const tooMany = update(base, 1)
    tooMany.operations = Array(1025).fill({ kind: 'replace', path: [], record: tooMany.arena.root })
    expect(() => base.apply(tooMany, limits)).toThrow('update')
    for (const source of ['x'.repeat(2 * MiB + 1), '世'.repeat(MiB)])
      expect(() => PackedRevision.full(open(null), source, identity(source), limits)).toThrow(
        'identity',
      )
    expect(() =>
      PackedRevision.full(open(null), '', { ...identity(''), options: '' }, limits),
    ).toThrow('identity')
  })
})
