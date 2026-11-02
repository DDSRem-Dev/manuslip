import { describe, expect, it, vi } from 'vitest'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { offsetSuffix, offsetSuffixSteps } from '../../src/packing-offsets'
import { rangeSuffix } from '../../src/packing-ranges'
import { type PackedNode, type PackedSegment, PackedView, segments } from '../../src/packing-view'

const limits = { bytes: 8 * 1024 * 1024, retained: 16 * 1024 * 1024, staging: 8 * 1024 * 1024 }
const position = (offset: number) => ({
  start: { line: 2, column: 3, offset },
  end: { line: 2, column: 4, offset: offset + 1 },
})
const open = (value: unknown) => {
  const arena = PackedArena.open(packValue(value, limits.bytes), limits)
  return { arena, id: arena.root }
}
const shift = (node: PackedNode, start: number, offset: number, charge = (_bytes: number) => {}) =>
  offsetSuffix(node, start, offset, charge, () => {})
const arenaSegment = (node: PackedNode) => {
  const segment = segments(node)[0]
  if (!segment || 'value' in segment) throw new Error('Missing arena segment')
  return segment
}
const nodeFrom = (...items: PackedSegment[]): PackedNode => ({
  segments: items,
  length: items.reduce((sum, item) => sum + item.length, 0),
})

describe('sealed position segment evidence', () => {
  it('reuses exact bounds, expanded counts and depth across cumulative shifts without decoding', () => {
    const original = open([{ from: 10, to: 20, position: position(10), text: 'Unchanged' }])
    const charges: number[] = []
    const first = shift(original, 0, 3, (bytes) => charges.push(bytes))
    expect(charges).toEqual([768, 512])
    const proof = arenaSegment(first).positionProof
    expect(proof).toBeDefined()
    expect(Object.isFrozen(proof)).toBe(true)
    if (!proof) throw new Error('Missing proof')
    expect(Object.isFrozen(proof.constructor)).toBe(true)
    expect(Object.isFrozen(Object.getPrototypeOf(proof))).toBe(true)
    expect(Reflect.set(proof.constructor, 'for', () => ({ visits: 0, depth: 0 }))).toBe(false)
    expect(Reflect.set(Object.getPrototypeOf(proof), 'visits', 0)).toBe(false)
    const read = vi.spyOn(PackedArena.prototype, 'kind')
    let next: PackedNode
    try {
      const nextCharges: number[] = []
      next = shift(first, 0, -1, (bytes) => nextCharges.push(bytes))
      expect(nextCharges).toEqual([768])
      expect(read).not.toHaveBeenCalled()
    } finally {
      read.mockRestore()
    }
    expect(arenaSegment(next).positionProof).toBe(proof)
    const view = new PackedView(next)
    expect(view.position([0, 'position'])).toEqual(position(12))
    expect(view.readScalar(limits, [0, 'from'])).toBe(10)
    expect(view.readScalar(limits, [0, 'to'])).toBe(20)
    expect(view.readScalar(limits, [0, 'text'])).toBe('Unchanged')
    expect(new PackedView(first).position([0, 'position'])).toEqual(position(13))
    expect(new PackedView(original).position([0, 'position'])).toEqual(position(10))
  })

  it('still yields before publishing a proven transform', () => {
    const first = shift(open([position(10)]), 0, 1)
    const work = offsetSuffixSteps(
      first,
      0,
      1,
      () => {},
      () => {},
    )
    const read = vi.spyOn(PackedArena.prototype, 'kind')
    try {
      expect(work.next()).toEqual({ done: false, value: undefined })
      expect(read).not.toHaveBeenCalled()
      expect(new PackedView(first).position([0])).toEqual(position(11))
      work.return()
      expect(work.next().done).toBe(true)
    } finally {
      read.mockRestore()
    }
  })

  it('fully scans a narrowed suffix to preserve exact expanded counts and safe bounds', () => {
    const first = shift(open([position(0), position(10)]), 0, 1)
    const next = shift(first, 1, -5)
    expect(new PackedView(next).position([0])).toEqual(position(1))
    expect(new PackedView(next).position([1])).toEqual(position(6))
    const narrowed = segments(next)[1]
    if (!narrowed || 'value' in narrowed) throw new Error('Missing suffix')
    expect(narrowed.positionProof).toBeDefined()
    expect(narrowed.positionProof).not.toBe(arenaSegment(first).positionProof)
  })

  it.each([-2, 0xffffffff])('rejects cached offsets outside uint32 bounds: %s', (offset) => {
    const first = shift(open([position(0)]), 0, 1)
    expect(() => shift(first, 0, offset)).toThrow('offset range')
    expect(new PackedView(first).position([0])).toEqual(position(1))
  })

  it.each(['plain', 'prototype', 'other-arena', 'other-record', 'widened', 'changed-offset'])(
    'cannot authorize unsafe positions using %s evidence',
    (kind) => {
      const source = open([[position(0)], [position(10)]])
      const [bad, good] = [...source.arena.elements(source.id)]
      if (good === undefined || bad === undefined) throw new Error('Missing array')
      const first = shift({ arena: source.arena, id: good }, 0, 1)
      const segment = arenaSegment(first)
      const proof = segment.positionProof
      if (!proof) throw new Error('Missing proof')
      let selected: PackedNode
      if (kind === 'other-record') selected = nodeFrom({ ...segment, id: bad, offset: 0 })
      else if (kind === 'changed-offset') selected = nodeFrom({ ...segment, offset: -100 })
      else if (kind === 'widened') {
        const full = open([position(0), position(10)])
        const tail = shift(full, 1, 1)
        const covered = segments(tail)[1]
        if (!covered || 'value' in covered) throw new Error('Missing suffix')
        selected = nodeFrom({ ...covered, from: 0, length: 2, offset: 0 })
      } else {
        selected = nodeFrom({
          ...arenaSegment(open([position(0)])),
          positionProof:
            kind === 'plain'
              ? {}
              : kind === 'prototype'
                ? Object.create(Object.getPrototypeOf(proof))
                : proof,
        })
      }
      expect(() => shift(selected, 0, -1)).toThrow('offset range')
    },
  )

  it('does not reuse evidence after a range transform changes field traversal', () => {
    const first = shift(open([{ from: position(10), to: 20 }]), 0, 1)
    const changed = nodeFrom({ ...arenaSegment(first), rangeOffset: 1 })
    expect(() => shift(changed, 0, 1)).toThrow('scalar')
    const numeric = shift(open([{ from: 10, to: 20, position: position(10) }]), 0, 1)
    const ranged = rangeSuffix(
      numeric,
      0,
      2,
      () => {},
      () => {},
    )
    const next = shift(ranged, 0, 1)
    expect(new PackedView(next).position([0, 'position'])).toEqual(position(12))
    expect(new PackedView(next).readScalar(limits, [0, 'from'])).toBe(12)
  })

  it('preserves numbers and strings when the complete segment contains no positions', () => {
    const first = shift(open([0, 'text', true, null, { value: 100 }]), 0, 0xffffffff)
    const next = shift(first, 0, -0xffffffff)
    const view = new PackedView(next)
    expect(view.readScalar(limits, [0])).toBe(0)
    expect(view.readScalar(limits, [1])).toBe('text')
    expect(view.readScalar(limits, [2])).toBe(true)
    expect(view.readScalar(limits, [3])).toBeNull()
    expect(view.readScalar(limits, [4, 'value'])).toBe(100)
  })

  it('rejects expanded aliases even when every top-level segment has valid evidence', () => {
    const first = shift(open(Array(5000).fill({ position: position(10) })), 0, 1)
    const repeated = nodeFrom(...Array(81).fill(arenaSegment(first)))
    expect(() => shift(repeated, 0, 1)).toThrow('node limit')
  })

  it('fully checks new nesting around a proven array', () => {
    let node = shift(open([position(10)]), 0, 1)
    for (let index = 0; index < 260; index++) node = nodeFrom({ value: node, length: 1 })
    expect(() => shift(node, 0, 1)).toThrow('depth limit')
  })

  it('cannot issue proofs through a reflected constructor', () => {
    const first = shift(open([position(10)]), 0, 1)
    const segment = arenaSegment(first)
    const proof = segment.positionProof
    if (!proof) throw new Error('Missing proof')
    expect(() => Reflect.construct(proof.constructor, [{}, segment, 0, 0, 0, 0])).toThrow(
      'Invalid packed position proof',
    )
  })

  it('leaves the original graph exact when new proof admission fails', () => {
    const original = open([position(10)])
    expect(() =>
      shift(original, 0, 1, (bytes) => {
        if (bytes === 512) throw new Error('No proof capacity')
      }),
    ).toThrow('No proof capacity')
    expect(arenaSegment(original).positionProof).toBeUndefined()
    expect(new PackedView(original).position([0])).toEqual(position(10))
    expect(new PackedView(shift(original, 0, 2)).position([0])).toEqual(position(12))
  })
})
