import { describe, expect, it, vi } from 'vitest'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { offsetSuffix } from '../../src/packing-offsets'
import { rangeSuffix } from '../../src/packing-ranges'
import { type PackedNode, type PackedSegment, PackedView, segments } from '../../src/packing-view'

const limits = { bytes: 8 * 1024 * 1024, retained: 16 * 1024 * 1024, staging: 8 * 1024 * 1024 }
const open = (value: unknown) => {
  const arena = PackedArena.open(packValue(value, limits.bytes), limits)
  return { arena, id: arena.root }
}
const shift = (node: PackedNode, start: number, offset: number, charge = (_bytes: number) => {}) =>
  rangeSuffix(node, start, offset, charge, () => {})
const ranges = (node: PackedNode) =>
  [...new PackedView(node).elements()].map((item) => [
    item.readScalar(limits, ['from']),
    item.readScalar(limits, ['to']),
  ])
const arenaSegment = (node: PackedNode) => {
  const segment = segments(node)[0]
  if (!segment || 'value' in segment) throw new Error('Missing arena segment')
  return segment
}
const nodeFrom = (...items: PackedSegment[]): PackedNode => ({
  segments: items,
  length: items.reduce((sum, item) => sum + item.length, 0),
})

describe('sealed immediate range evidence', () => {
  it('reuses complete immutable bounds across cumulative shifts and independent position shifts', () => {
    const original = open([
      { from: 10, to: 20 },
      { from: 30, to: 40 },
    ])
    const firstCharges: number[] = []
    const first = shift(original, 0, 3, (bytes) => firstCharges.push(bytes))
    expect(firstCharges).toEqual([768, 512])
    const proof = arenaSegment(first).rangeProof
    expect(proof).toBeDefined()
    expect(Object.isFrozen(proof)).toBe(true)
    if (!proof) throw new Error('Missing proof')
    expect(Object.isFrozen(proof.constructor)).toBe(true)
    expect(Object.isFrozen(Object.getPrototypeOf(proof))).toBe(true)
    expect(Reflect.set(proof.constructor, 'covers', () => true)).toBe(false)
    const fields = vi.spyOn(PackedArena.prototype, 'field')
    let next: PackedNode
    const charges: number[] = []
    try {
      const positioned = offsetSuffix(
        first,
        0,
        2,
        () => {},
        () => {},
      )
      next = shift(positioned, 0, -1, (bytes) => charges.push(bytes))
      expect(fields).not.toHaveBeenCalled()
    } finally {
      fields.mockRestore()
    }
    expect(charges).toEqual([768])
    expect(arenaSegment(next).rangeProof).toBe(proof)
    expect(ranges(next)).toEqual([
      [12, 22],
      [32, 42],
    ])
    expect(ranges(first)).toEqual([
      [13, 23],
      [33, 43],
    ])
    expect(ranges(original)).toEqual([
      [10, 20],
      [30, 40],
    ])
  })

  it('fully checks a narrowed suffix when old extrema cannot prove the new shift', () => {
    const first = shift(
      open([
        { from: 0, to: 1 },
        { from: 10, to: 11 },
      ]),
      0,
      1,
    )
    const next = shift(first, 1, -5)
    expect(ranges(next)).toEqual([
      [1, 2],
      [6, 7],
    ])
    expect(segments(next)[1]).toHaveProperty('rangeProof')
    const nextSegment = segments(next)[1]
    if (!nextSegment || 'value' in nextSegment) throw new Error('Missing narrowed suffix')
    expect(nextSegment.rangeProof).not.toBe(arenaSegment(first).rangeProof)
  })

  it.each([-2, 0xffffffff])('rejects a cached shift outside uint32 bounds: %s', (offset) => {
    const first = shift(open([{ from: 0, to: 1 }]), 0, 1)
    expect(() => shift(first, 0, offset)).toThrow('offset range')
    expect(ranges(first)).toEqual([[1, 2]])
  })

  it.each(['plain', 'prototype', 'other-arena', 'other-record', 'widened', 'changed-offset'])(
    'does not authorize unproved records with %s evidence',
    (kind) => {
      const source = open([[{ missing: true }], [{ from: 10, to: 20 }]])
      const arrays = [...source.arena.elements(source.id)]
      const good = arrays[1]
      const bad = arrays[0]
      if (good === undefined || bad === undefined) throw new Error('Missing array')
      const validated = shift({ arena: source.arena, id: good }, 0, 1)
      const segment = arenaSegment(validated)
      const proof = segment.rangeProof
      if (!proof) throw new Error('Missing proof')
      let selected: PackedNode
      if (kind === 'other-record') selected = nodeFrom({ ...segment, id: bad })
      else if (kind === 'changed-offset') selected = nodeFrom({ ...segment, rangeOffset: -100 })
      else if (kind === 'widened') {
        const full = open([{ missing: true }, { from: 10, to: 20 }])
        const tail = shift(full, 1, 1)
        const covered = segments(tail)[1]
        if (!covered || 'value' in covered) throw new Error('Missing suffix')
        selected = nodeFrom({ ...covered, from: 0, length: 2 })
      } else {
        const invalid = open([{ missing: true }])
        selected = nodeFrom({
          ...arenaSegment(invalid),
          rangeProof:
            kind === 'plain'
              ? {}
              : kind === 'prototype'
                ? Object.create(Object.getPrototypeOf(proof))
                : proof,
        })
      }
      expect(() => shift(selected, 0, 1)).toThrow(
        kind === 'changed-offset' ? 'offset range' : 'Missing packed range field',
      )
    },
  )

  it('cannot mint evidence through its reflected constructor', () => {
    const first = shift(open([{ from: 10, to: 20 }]), 0, 1)
    const segment = arenaSegment(first)
    const proof = segment.rangeProof
    if (!proof) throw new Error('Missing proof')
    expect(() => Reflect.construct(proof.constructor, [{}, segment, 0, 0])).toThrow(
      'Invalid packed range proof',
    )
  })

  it('counts expanded segment multiplicity even when every segment has proven bounds', () => {
    const first = shift(open(Array(5000).fill({ from: 10, to: 20 })), 0, 1)
    const repeated = nodeFrom(...Array(161).fill(arenaSegment(first)))
    expect(() => shift(repeated, 0, 1)).toThrow('node limit')
  })

  it('admits new evidence before retaining it and leaves the original graph exact on rejection', () => {
    const original = open([{ from: 10, to: 20 }])
    expect(() =>
      shift(original, 0, 1, (bytes) => {
        if (bytes === 512) throw new Error('No proof capacity')
      }),
    ).toThrow('No proof capacity')
    expect(ranges(original)).toEqual([[10, 20]])
    expect(arenaSegment(original).rangeProof).toBeUndefined()
    expect(ranges(shift(original, 0, 2))).toEqual([[12, 22]])
  })
})
