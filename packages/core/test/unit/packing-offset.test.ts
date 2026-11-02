import { describe, expect, it } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import {
  type PackedIdentity,
  type PackedOperation,
  PackedRevision,
} from '../../src/packing-revision'
import { PackedSession } from '../../src/packing-session'
import type { PackedView } from '../../src/packing-view'
import { parseMarkdown } from '../../src/parse'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB }
const open = (value: unknown) => PackedArena.open(packValue(value, limits.bytes), limits)
const identity = (source: string, revision = 0): PackedIdentity => ({
  generation: 1,
  documentId: 'offset-tests',
  revision,
  sourceHash: sourceHash(source),
  parserVersion: 'test',
  rendererVersion: 'test',
  options: 'default',
})
const position = (from: number, to = from + 1) => ({
  start: { line: 2, column: 3, offset: from },
  end: { line: 2, column: 4, offset: to },
})
function read(view: PackedView): unknown {
  switch (view.kind()) {
    case 'scalar':
      return view.readScalar(limits)
    case 'position':
      return view.position()
    case 'array':
      return [...view.elements()].map(read)
    case 'object':
      return Object.fromEntries(view.keys().map((key) => [key, read(view.at([key]))]))
  }
}
const full = (value: unknown) =>
  PackedRevision.full(open(value), 'source', identity('source'), limits)
function apply(
  base: PackedRevision,
  operations: readonly PackedOperation[],
  arena = open(null),
  changed = {},
) {
  const source = `${base.source}x`
  return base.apply(
    {
      base: base.identity,
      baseSource: base.source,
      result: identity(source, base.identity.revision + 1),
      source,
      operations,
      arena,
    },
    { ...limits, ...changed },
  )
}
const shift = (
  start: number,
  offset: number,
  path: readonly (string | number)[] = [],
): PackedOperation => ({ kind: 'offset', start, offset, path })

describe('immutable packed suffix position shifts', () => {
  it('shifts every descendant position while preserving all other fields and old aliases', () => {
    const shared = {
      type: 'text',
      value: 'same',
      from: 10,
      to: 11,
      offset: 12,
      position: position(10),
    }
    const base = full({
      children: [shared, { nested: [shared, { value: 4, position: position(20) }] }],
      alias: shared,
    })
    const next = apply(base, [shift(1, 7, ['children'])])
    expect(read(next.root)).toEqual({
      children: [
        shared,
        {
          nested: [
            { ...shared, position: position(17) },
            { value: 4, position: position(27) },
          ],
        },
      ],
      alias: shared,
    })
    expect(read(base.root)).toEqual({
      children: [shared, { nested: [shared, { value: 4, position: position(20) }] }],
      alias: shared,
    })
    const child = [...next.root.at(['children']).elements()][1]
    expect(child?.at(['nested', 0, 'position']).position()).toEqual(position(17))
    expect(child?.at(['nested', 0, 'value']).textLength()).toBe(4)
    expect(child?.at(['nested', 0, 'value']).scalarCost()).toEqual(
      base.root.at(['alias', 'value']).scalarCost(),
    )
    expect(Object.isFrozen(child?.at(['nested', 0, 'position']).position().start)).toBe(true)
  })

  it('composes and reverses repeated offsets without recursively nested transform chains', () => {
    let current = full([{ position: position(100) }])
    const original = current
    for (let index = 0; index < 300; index++) current = apply(current, [shift(0, 1)])
    expect(current.root.at([0, 'position']).position()).toEqual(position(400))
    for (let index = 0; index < 300; index++) current = apply(current, [shift(0, -1)])
    expect(read(current.root)).toEqual(read(original.root))
  })

  it('keeps newly replaced fields absolute while later shifts affect the whole current subtree', () => {
    const base = full([
      { position: position(10), nested: { position: position(20), value: 'old' } },
    ])
    const replacement = open({ position: position(40), value: 'new' })
    const next = apply(
      base,
      [
        shift(0, 5),
        { kind: 'replace', path: [0, 'nested'], record: replacement.root },
        shift(0, -2),
      ],
      replacement,
    )
    expect(read(next.root)).toEqual([
      { position: position(13), nested: { position: position(38), value: 'new' } },
    ])
    expect(read(base.root)).toEqual([
      { position: position(10), nested: { position: position(20), value: 'old' } },
    ])
  })

  it('preserves transforms through splices, scalar text edits, and nested array replacements', () => {
    const base = full([
      {
        nested: [
          { position: position(10), text: 'hello' },
          { position: position(20), text: 'two' },
        ],
      },
    ])
    const shifted = apply(base, [shift(0, 5)])
    const data = open({ insert: [{ position: position(60), text: 'new' }], text: 'X' })
    const insert = data.field(data.root, 'insert')
    const text = data.field(data.root, 'text')
    if (insert === undefined || text === undefined) throw new Error('fixture')
    const next = apply(
      shifted,
      [
        { kind: 'text', path: [0, 'nested', 0, 'text'], start: 1, remove: 2, record: text },
        { kind: 'splice', path: [0, 'nested'], start: 1, remove: 0, record: insert },
        shift(1, -3, [0, 'nested']),
      ],
      data,
    )
    expect(read(next.root)).toEqual([
      {
        nested: [
          { position: position(15), text: 'hXlo' },
          { position: position(57), text: 'new' },
          { position: position(22), text: 'two' },
        ],
      },
    ])
    expect(read(shifted.root)).toEqual([
      {
        nested: [
          { position: position(15), text: 'hello' },
          { position: position(25), text: 'two' },
        ],
      },
    ])
  })

  it.each([
    [-1, 1],
    [2, 1],
    [0.5, 1],
    [NaN, 1],
    [0, NaN],
    [0, Infinity],
    [0, 0.5],
    [0, 0x100000000],
  ])('rejects malformed suffix range/offset %s %s atomically', (start, offset) => {
    const base = full([{ position: position(10) }])
    expect(() => apply(base, [shift(start, offset)])).toThrow('position shift')
    expect(read(base.root)).toEqual([{ position: position(10) }])
  })

  it('rejects overflow and underflow before publishing any successful prefix operation', () => {
    for (const [value, offset] of [
      [position(0), -1],
      [position(0xfffffffe, 0xffffffff), 1],
    ] as const) {
      const base = full([{ value: 1, position: value }])
      const replacement = open(2)
      expect(() =>
        apply(
          base,
          [{ kind: 'replace', path: [0, 'value'], record: replacement.root }, shift(0, offset)],
          replacement,
        ),
      ).toThrow('offset range')
      expect(read(base.root)).toEqual([{ value: 1, position: value }])
    }
    const base = full([{ position: position(1, 0xfffffffe) }])
    expect(
      apply(base, [shift(0, 1)])
        .root.at([0, 'position'])
        .position(),
    ).toEqual(position(2, 0xffffffff))
  })

  it('allows empty suffixes and scalar-only suffixes without shifting numeric properties', () => {
    const base = full([0, null, 'value', { offset: 6 }])
    expect(read(apply(base, [shift(0, -0xffffffff)]).root)).toEqual([
      0,
      null,
      'value',
      { offset: 6 },
    ])
    expect(read(apply(base, [shift(4, 1)]).root)).toEqual(read(base.root))
    expect(() => apply(full({ a: 1 }), [shift(0, 1)])).toThrow('array')
  })

  it('bounds validation traversal and retained output without truncating a shifted graph', () => {
    const base = full([{ nested: [{ nested: [{ position: position(10) }] }] }])
    const result = apply(base, [shift(0, 1)])
    expect(() =>
      apply(base, [shift(0, 1)], open(null), { staging: result.stagingBytes - 1 }),
    ).toThrow('staging limit')
    expect(() =>
      apply(base, [shift(0, 1)], open(null), { retained: result.preparationBytes - 1 }),
    ).toThrow('retained limit')
    expect(
      apply(base, [shift(0, 1)], open(null), { retained: result.preparationBytes }).retainedBytes,
    ).toBe(result.retainedBytes)
  })

  it('rejects excessive validation depth and expanded aliases without a recursive stack walk', () => {
    let deep: unknown = { position: position(10) }
    for (let index = 0; index < 260; index++) deep = [deep]
    expect(() => apply(full([deep]), [shift(0, 1)])).toThrow('depth limit')
    let aliases: unknown = { position: position(10) }
    for (let index = 0; index < 20; index++) aliases = [aliases, aliases]
    expect(() => apply(full([aliases]), [shift(0, 1)])).toThrow('node limit')
  })

  it('matches independent complete roots through repeated length changes in different blocks', () => {
    let source =
      '# Heading\n\nFirst writing.\n\n> Later writing and [r].\n\nLast writing.\n\n[r]: /r\n'
    let root = parseMarkdown(source).root
    let current = PackedRevision.full(open(root), source, identity(source), limits)
    const captures = [{ revision: current, root }]
    for (let index = 0; index < 12; index++) {
      const block = [1, 2, 3][index % 3] ?? 1
      const original = root.children[block]
      const from = original?.position?.start.offset
      const to = original?.position?.end.offset
      if (from === undefined || to === undefined) throw new Error('fixture')
      const word = source.indexOf('writing', from)
      const insertion = `${index % 2 ? 'Longer中文' : 'X'} writing`
      const after = source.slice(0, word) + insertion + source.slice(word + 7)
      const expected = parseMarkdown(after).root
      const data = open({ children: [expected.children[block]], position: expected.position })
      const children = data.field(data.root, 'children')
      const position = data.field(data.root, 'position')
      if (children === undefined || position === undefined) throw new Error('fixture')
      current = current.apply(
        {
          base: current.identity,
          baseSource: source,
          source: after,
          result: identity(after, index + 1),
          arena: data,
          operations: [
            { kind: 'splice', path: ['children'], start: block, remove: 1, record: children },
            shift(block + 1, insertion.length - 7, ['children']),
            { kind: 'replace', path: ['position'], record: position },
          ],
        },
        limits,
      )
      expect(read(current.root)).toEqual(expected)
      if (index === 5) captures.push({ revision: current, root: expected })
      source = after
      root = expected
    }
    for (const capture of captures) expect(read(capture.revision.root)).toEqual(capture.root)
  })

  it('revokes session readers and rejects a late invalid transform without changing accepted data', () => {
    const owner = new PackedSession({ ...limits, captures: 4, readers: 16 })
    const first = identity('source')
    owner.commit(
      owner.prepareFull(
        owner.begin(first, 'source'),
        first,
        packValue([{ position: position(1) }], limits.bytes),
      ),
    )
    const old = owner.capture()
    const second = identity('next', 1)
    const request = owner.begin(second, 'next')
    const before = owner.stats
    expect(() =>
      owner.prepareDelta(request, {
        base: first,
        baseSource: 'source',
        result: second,
        payload: packValue(null, limits.bytes),
        operations: [shift(0, -2)],
      }),
    ).toThrow('offset range')
    expect(owner.stats).toEqual(before)
    const prepared = owner.prepareDelta(request, {
      base: first,
      baseSource: 'source',
      result: second,
      payload: packValue(null, limits.bytes),
      operations: [shift(0, 5)],
    })
    owner.commit(prepared)
    const current = owner.capture()
    expect(current.reader.position([0, 'position'], limits)).toEqual(position(6))
    expect(old.reader.position([0, 'position'], limits)).toEqual(position(1))
    owner.dispose()
    expect(() => current.reader.kind()).toThrow('released')
    expect(owner.stats.retainedBytes).toBe(0)
  })
})
