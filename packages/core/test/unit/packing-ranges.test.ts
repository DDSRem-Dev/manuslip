import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { type PackedOperation, PackedRevision } from '../../src/packing-revision'
import type { PackedView } from '../../src/packing-view'

const limits = { bytes: 8 * 1024 * 1024, retained: 16 * 1024 * 1024, staging: 8 * 1024 * 1024 }
const open = (value: unknown) => PackedArena.open(packValue(value, limits.bytes), limits)
const identity = (source: string, revision = 0) => ({
  generation: 1,
  documentId: 'ranges',
  revision,
  sourceHash: sourceHash(source),
  parserVersion: 'test',
  rendererVersion: 'test',
  options: 'test',
})
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
const range = (start: number, offset: number): PackedOperation => ({
  kind: 'range',
  path: [],
  start,
  offset,
})
const position = {
  start: { line: 1, column: 1, offset: 10 },
  end: { line: 1, column: 2, offset: 11 },
}

describe('immutable packed from/to suffix transforms', () => {
  it('shifts only immediate fields, preserving nested ranges, positions, scalars, aliases and old data', () => {
    const shared = {
      from: 10,
      to: 11,
      nested: { from: 1, to: 2 },
      position,
      offset: 7,
      text: 'same',
    }
    const base = full([shared, shared, { from: 20, to: 30 }])
    const next = apply(base, [range(1, 4)])
    const expected = [shared, { ...shared, from: 14, to: 15 }, { from: 24, to: 34 }]
    expect(read(next.root)).toEqual(expected)
    expect(read(base.root)).toEqual([shared, shared, { from: 20, to: 30 }])
    expect(read(next.root.at([1]))).toEqual(expected[1])
    expect(next.root.at([1, 'from']).scalarCost()).toEqual({ retained: 16, workspace: 0 })
    expect(() => next.root.at([1, 'from']).readScalar({ retained: 15, staging: 0 })).toThrow(
      'retained limit',
    )
    expect(() => next.root.at([1, 'from']).textLength()).toThrow('not a string')
  })
  it('combines repeated shifts and composes independently with descendant position transforms', () => {
    let current = full([{ from: 10, to: 11, position }])
    for (let iteration = 0; iteration < 600; iteration++)
      current = apply(current, [range(0, 1), { kind: 'offset', path: [], start: 0, offset: 1 }])
    expect(read(current.root)).toEqual([
      {
        from: 610,
        to: 611,
        position: {
          start: { ...position.start, offset: 610 },
          end: { ...position.end, offset: 611 },
        },
      },
    ])
    for (let iteration = 0; iteration < 600; iteration++)
      current = apply(current, [{ kind: 'offset', path: [], start: 0, offset: -1 }, range(0, -1)])
    expect(read(current.root)).toEqual([{ from: 10, to: 11, position }])
  })
  it('preserves absolute replacements, singleton/array splices and previously transformed siblings', () => {
    const base = apply(
      full([
        { from: 10, to: 20, text: 'old' },
        { from: 30, to: 40 },
      ]),
      [range(0, 3)],
    )
    const data = open({ number: 5, inserted: [{ from: 80, to: 90 }], word: 'new' })
    const number = data.field(data.root, 'number')
    const inserted = data.field(data.root, 'inserted')
    const word = data.field(data.root, 'word')
    if (number === undefined || inserted === undefined || word === undefined)
      throw new Error('fixture')
    const next = apply(
      base,
      [
        { kind: 'replace', path: [0, 'from'], record: number },
        { kind: 'text', path: [0, 'text'], start: 0, remove: 3, record: word },
        { kind: 'splice', path: [], start: 1, remove: 0, record: inserted },
        range(0, 2),
      ],
      data,
    )
    expect(read(next.root)).toEqual([
      { from: 7, to: 25, text: 'new' },
      { from: 82, to: 92 },
      { from: 35, to: 45 },
    ])
    expect(read(base.root)).toEqual([
      { from: 13, to: 23, text: 'old' },
      { from: 33, to: 43 },
    ])
  })
  it.each([
    null,
    1,
    [],
    { from: 1 },
    { from: true, to: 2 },
    { from: 'x', to: 2 },
    { from: -1, to: 2 },
    { from: 2, to: 1 },
    { from: 1.5, to: 2 },
    { from: 0, to: 0x100000000 },
  ])('rejects malformed ranges atomically: %j', (value) => {
    const base = full([{ from: 1, to: 2 }, value])
    expect(() => apply(base, [range(0, 1)])).toThrow()
    expect(read(base.root)).toEqual([{ from: 1, to: 2 }, value])
  })
  it('rejects underflow/overflow, malformed operations and non-array selections', () => {
    const base = full([{ from: 0, to: 0xffffffff }])
    for (const offset of [-1, 1, NaN, Infinity, 0.5, 0x100000000])
      expect(() => apply(base, [range(0, offset)])).toThrow()
    for (const start of [-1, 2, NaN, 0.5]) expect(() => apply(base, [range(start, 0)])).toThrow()
    expect(() => apply(full({ from: 1, to: 2 }), [range(0, 0)])).toThrow()
    expect(read(apply(base, [range(1, 0)]).root)).toEqual([{ from: 0, to: 0xffffffff }])
  })
  it('admits exact retained/staging boundaries and rejects a late failure without publishing', () => {
    const base = full([{ from: 10, to: 20 }])
    const data = open(null)
    const probe = apply(base, [range(0, 2)], data)
    expect(
      read(
        apply(base, [range(0, 2)], data, {
          retained: probe.preparationBytes,
          staging: probe.stagingBytes,
        }).root,
      ),
    ).toEqual([{ from: 12, to: 22 }])
    expect(() =>
      apply(base, [range(0, 2)], data, { retained: probe.preparationBytes - 1 }),
    ).toThrow('retained limit')
    expect(() => apply(base, [range(0, 2)], data, { staging: probe.stagingBytes - 1 })).toThrow(
      'staging limit',
    )
    expect(() => apply(base, [range(0, 3), range(0, -14)])).toThrow('offset range')
    expect(read(base.root)).toEqual([{ from: 10, to: 20 }])
  })
  it('bounds an expanded alias suffix before visiting an unbounded number of records', () => {
    const base = full(Array(800001).fill({ from: 1, to: 2 }))
    expect(() => apply(base, [range(0, 1)])).toThrow('node limit')
    expect(base.root.length()).toBe(800001)
    expect(read(base.root.at([800000]))).toEqual({ from: 1, to: 2 })
  })
  it('rejects oversized scalar fields before materializing their strings', () => {
    const base = full([{ from: 'x'.repeat(1024 * 1024), to: 2 }])
    const scalar = vi.spyOn(PackedArena.prototype, 'scalar')
    try {
      expect(() => apply(base, [range(0, 1)])).toThrow('scalar exceeds retained limit')
      expect(scalar).not.toHaveBeenCalled()
    } finally {
      scalar.mockRestore()
    }
  })
})
