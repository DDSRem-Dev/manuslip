import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { type PackedOperation, PackedRevision } from '../../src/packing-revision'
import { parseMarkdown } from '../../src/parse'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB }
const open = (value: unknown) => PackedArena.open(packValue(value, limits.bytes), limits)
const identity = (source: string, revision = 0) => ({
  generation: 1,
  documentId: 'summary-tests',
  revision,
  sourceHash: sourceHash(source),
  parserVersion: 'test',
  rendererVersion: 'test',
  options: 'test',
})
const position = (from: number, to = from + 1) => ({
  start: { line: 1, column: 1, offset: from },
  end: { line: 1, column: 2, offset: to },
})
function apply(
  base: PackedRevision,
  operations: PackedOperation[],
  arena = open(null),
  changed = {},
) {
  const source = `${base.source}x`
  return base.apply(
    {
      base: base.identity,
      baseSource: base.source,
      source,
      result: identity(source, base.identity.revision + 1),
      arena,
      operations,
    },
    { ...limits, ...changed },
  )
}
const shift = (start = 0, offset = 1): PackedOperation => ({
  kind: 'offset',
  path: [],
  start,
  offset,
})
const full = (value: unknown) =>
  PackedRevision.full(open(value), 'source', identity('source'), limits)

describe('temporary packed DAG position summaries', () => {
  it.each([
    [],
    [null, false, 12, 'text', {}, { position: position(0, 0) }],
    [{ position: position(0xfffffffe, 0xffffffff) }, { arbitrary: [position(1, 99)] }],
    parseMarkdown('> > Deep **prose**.\n\nCall[^a].\n\n[^a]: Footnote\n').root,
  ])(
    'matches complete expanded traversal, including positions under arbitrary keys: %j',
    (value) => {
      const arena = open(value)
      const initialWeight = arena.retainedBytes
      let staging = 0
      const summary = arena.summarizePositions((bytes) => {
        staging = Math.max(staging, bytes)
      })
      const oracle = (
        reference: number,
      ): { minimum: number; maximum: number; visits: number; depth: number } => {
        const type = arena.kind(reference)
        if (type === 'position') {
          const p = arena.position(reference)
          return {
            minimum: Math.min(p.start.offset, p.end.offset),
            maximum: Math.max(p.start.offset, p.end.offset),
            visits: 1,
            depth: 0,
          }
        }
        const result = { minimum: 0xffffffff, maximum: 0, visits: 1, depth: 0 }
        const children =
          type === 'array'
            ? [...arena.elements(reference)]
            : type === 'object'
              ? arena.keys(reference).map((key) => arena.field(reference, key))
              : []
        if (type === 'array' || type === 'object') result.depth = 1
        for (const child of children) {
          if (child === undefined) throw new Error('Missing test child')
          const next = oracle(child)
          result.minimum = Math.min(result.minimum, next.minimum)
          result.maximum = Math.max(result.maximum, next.maximum)
          result.visits += next.visits
          result.depth = Math.max(result.depth, 1 + next.depth)
        }
        return result
      }
      for (let reference = 0; reference < arena.records; reference++)
        expect(summary.at(reference)).toEqual(oracle(reference))
      expect(summary.stagingBytes).toBe(staging)
      expect(arena.retainedBytes).toBe(initialWeight)
      expect(Object.isFrozen(summary)).toBe(true)
      expect(Object.isFrozen(summary.at(arena.root))).toBe(true)
      for (const reference of [-1, NaN, Infinity, 0.5, arena.records])
        expect(() => summary.at(reference)).toThrow('record')
    },
  )
  it('charges scratch before allocation or record reads and never decodes large scalar strings', () => {
    const arena = open([{ text: '文'.repeat(300000), position: position(7, 31) }])
    const scalar = vi.spyOn(PackedArena.prototype, 'scalar')
    try {
      const first = arena.summarizePositions(() => {})
      expect(first.at(arena.root)).toMatchObject({ minimum: 7, maximum: 31 })
      expect(() =>
        arena.summarizePositions((bytes) => {
          if (bytes > first.stagingBytes - 1) throw new Error('scratch denied')
        }),
      ).toThrow('scratch denied')
      expect(
        arena
          .summarizePositions((bytes) => {
            expect(bytes).toBeLessThanOrEqual(first.stagingBytes)
          })
          .at(arena.root),
      ).toEqual(first.at(arena.root))
      expect(scalar).not.toHaveBeenCalled()
    } finally {
      scalar.mockRestore()
    }
  })
  it('retains expanded alias multiplicity and saturates only beyond the rejection thresholds', () => {
    let value: unknown = position(10, 20)
    for (let index = 0; index < 22; index++) value = [value, value]
    let arena = open(value)
    expect(arena.summarizePositions(() => {}).at(arena.root)).toEqual({
      minimum: 10,
      maximum: 20,
      visits: 800001,
      depth: 22,
    })
    value = position(10)
    for (let index = 0; index < 300; index++) value = [value]
    arena = open(value)
    expect(arena.summarizePositions(() => {}).at(arena.root)).toMatchObject({
      visits: 301,
      depth: 257,
    })
  })
  it('uses temporary summaries once, then reuses sealed bounds while preserving transformed values', () => {
    const value = Array.from({ length: 3000 }, (_, index) => ({
      position: position(index + 20),
      number: index,
    }))
    const base = full(value)
    const build = vi.spyOn(PackedArena.prototype, 'summarizePositions')
    try {
      const next = apply(base, [shift(1, 5)])
      expect(build).toHaveBeenCalledTimes(1)
      expect(next.stagingBytes).toBeGreaterThan(next.retainedBytes - base.retainedBytes)
      for (let index = 0; index < value.length; index++) {
        const p = next.root.at([index, 'position']).position()
        expect(p).toEqual(position(index + 20 + (index > 0 ? 5 : 0)))
      }
      const reversed = apply(next, [shift(1, -5)])
      expect(build).toHaveBeenCalledTimes(1)
      expect(reversed.stagingBytes).toBeLessThan(next.stagingBytes)
      expect(reversed.root.at([2999, 'position']).position()).toEqual(position(3019))
      expect(base.root.at([2999, 'position']).position()).toEqual(position(3019))
      const summary = build.mock.results[0]?.value
      expect([...next.resources()].some((resource) => resource.key === summary)).toBe(false)
      const probe = apply(base, [shift(1, 5)])
      expect(() =>
        apply(base, [shift(1, 5)], open(null), { staging: probe.stagingBytes - 1 }),
      ).toThrow('staging')
      expect(
        apply(base, [shift(1, 5)], open(null), { staging: probe.stagingBytes }).stagingBytes,
      ).toBe(probe.stagingBytes)
    } finally {
      build.mockRestore()
    }
  })
  it.each([
    { value: position(0, 0), offset: -1 },
    { value: position(0xfffffffe, 0xffffffff), offset: 1 },
  ])(
    'rejects a late invalid offset after summarized records, preserving all old data: %j',
    ({ value, offset }) => {
      const values = Array(3000).fill({ position: position(20) })
      values.push({ position: value })
      const base = full(values)
      const replacement = open('changed')
      expect(() =>
        apply(
          base,
          [{ kind: 'replace', path: [0], record: replacement.root }, shift(1, offset)],
          replacement,
        ),
      ).toThrow('offset range')
      expect(base.root.at([0, 'position']).position()).toEqual(position(20))
      expect(base.root.at([3000, 'position']).position()).toEqual(value)
    },
  )
  it('preserves exact limits for large expanded aliases and deep records after switching strategies', () => {
    const prefix = Array(4000).fill({ position: position(20) })
    let deep: unknown = position(20)
    for (let index = 0; index < 260; index++) deep = [deep]
    expect(() => apply(full([...prefix, deep]), [shift()])).toThrow('depth limit')
    let aliases: unknown = position(20)
    for (let index = 0; index < 20; index++) aliases = [aliases, aliases]
    expect(() => apply(full([...prefix, aliases]), [shift()])).toThrow('node limit')
  })
  it('combines summaries from multiple arenas and absolute edits inside shifted ancestors', () => {
    const base = full(Array(3000).fill({ from: 20, to: 21, position: position(20) }))
    const next = apply(base, [shift(0, 3)])
    const payload = open([{ from: 50, to: 51, position: position(50) }])
    const mixed = apply(
      next,
      [{ kind: 'splice', path: [], start: 2200, remove: 1, record: payload.root }],
      payload,
    )
    const build = vi.spyOn(PackedArena.prototype, 'summarizePositions')
    let changed: PackedRevision
    try {
      changed = apply(mixed, [shift(0, -2)])
      expect(build).toHaveBeenCalledTimes(2)
    } finally {
      build.mockRestore()
    }
    changed = apply(changed, [{ kind: 'range', path: [], start: 0, offset: 2 }])
    expect(changed.root.at([2199, 'position']).position()).toEqual(position(21))
    expect(changed.root.at([2200, 'position']).position()).toEqual(position(48))
    expect(changed.root.at([2200, 'from']).readScalar(limits)).toBe(52)
    expect(changed.root.at([2201, 'position']).position()).toEqual(position(21))
    expect(next.root.at([2200, 'position']).position()).toEqual(position(23))
  })
  it('keeps small late suffixes on the direct path rather than building a whole-arena table', () => {
    const base = full(Array(10000).fill({ position: position(10) }))
    const build = vi.spyOn(PackedArena.prototype, 'summarizePositions')
    try {
      const next = apply(base, [shift(9999, 1)])
      expect(next.root.at([9999, 'position']).position()).toEqual(position(11))
      expect(build).not.toHaveBeenCalled()
    } finally {
      build.mockRestore()
    }
  })
  it('avoids a whole-arena table when observed work predicts a short remaining suffix', () => {
    const base = full(
      Array.from({ length: 6000 }, (_, index) => ({
        position: position(index + 10),
        number: index,
      })),
    )
    const build = vi.spyOn(PackedArena.prototype, 'summarizePositions')
    try {
      const next = apply(base, [shift(4000, 1)])
      expect(next.root.at([5999, 'position']).position()).toEqual(position(6010))
      expect(build).not.toHaveBeenCalled()
    } finally {
      build.mockRestore()
    }
  })
  it('checks selected subtrees rather than rejecting invalid unselected prefixes in the same arena', () => {
    let deep: unknown = position(0)
    for (let index = 0; index < 260; index++) deep = [deep]
    let aliases: unknown = position(0)
    for (let index = 0; index < 20; index++) aliases = [aliases, aliases]
    const base = full([deep, aliases, ...Array(5000).fill({ position: position(20) })])
    const build = vi.spyOn(PackedArena.prototype, 'summarizePositions')
    try {
      const changed = apply(base, [shift(2, -1)])
      expect(build).toHaveBeenCalledTimes(1)
      expect(changed.root.at([5001, 'position']).position()).toEqual(position(19))
      expect(base.root.at([5001, 'position']).position()).toEqual(position(20))
    } finally {
      build.mockRestore()
    }
  })
})
