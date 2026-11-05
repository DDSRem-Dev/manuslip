import { expect, it } from 'vitest'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { PackedMetadataBudget } from '../../src/packing-metadata-budget'
import { offsetSuffix, offsetSuffixSteps } from '../../src/packing-offsets'
import { rangeSuffix, rangeSuffixSteps } from '../../src/packing-ranges'
import { appendSegmentSliceSteps, segmentGeometrySteps } from '../../src/packing-segment-steps'
import {
  offsetNode,
  type PackedNode,
  type PackedSegment,
  PackedView,
  rangeSegment,
} from '../../src/packing-view'
import type { PackedWork } from '../../src/packing-work'

const limits = { bytes: 8 * 1024 * 1024, retained: 16 * 1024 * 1024, staging: 8 * 1024 * 1024 }
const open = (value: unknown) => PackedArena.open(packValue(value, limits.bytes), limits)
const point = (offset: number) => ({ line: 7, column: 11, offset })
const position = (offset: number) => ({ start: point(offset), end: point(offset + 3) })
const values = Array.from({ length: 4097 }, (_, index) => ({
  from: 10 + index * 4,
  to: 13 + index * 4,
  text: `value-${index}😀`,
  position: position(10 + index * 4),
  nested: { from: 2, to: 3, position: position(10 + index * 4) },
}))
const arena = open(values)
const base: PackedNode = { arena, id: arena.root }
const segments: PackedSegment[] = values.map((_, from) =>
  Object.freeze({ arena, id: arena.root, from, length: 1 }),
)
const segmented: PackedNode = Object.freeze({ segments: Object.freeze(segments), length: 4097 })
const singletonArena = open(values[0])
const singletons: PackedNode = Object.freeze({
  segments: Object.freeze(
    values.map(() =>
      Object.freeze({
        value: { arena: singletonArena, id: singletonArena.root },
        length: 1 as const,
      }),
    ),
  ),
  length: 4097,
})
const ranged: PackedNode = Object.freeze({
  segments: Object.freeze(segments.map((segment) => rangeSegment(segment, 7))),
  length: 4097,
})
const cases = [
  ['arena', base],
  ['segmented', segmented],
  ['shifted', offsetNode(segmented, 31)],
  ['ranged', ranged],
  ['mixed', offsetNode(ranged, 31)],
  ['singletons', singletons],
] as const
function read(view: PackedView): unknown {
  switch (view.kind()) {
    case 'scalar':
      return view.scalar()
    case 'position':
      return view.position()
    case 'array':
      return [...view.elements()].map(read)
    case 'object':
      return Object.fromEntries(view.keys().map((key) => [key, read(view.at([key]))]))
  }
}
function finish<T>(work: PackedWork<T>): { value: T; pauses: number } {
  let pauses = 0
  while (true) {
    const step = work.next()
    if (step.done) {
      if (step.value === undefined) throw new Error('Cancelled suffix')
      return { value: step.value, pauses }
    }
    pauses++
  }
}
function shiftPositions(value: unknown, offset: number): unknown {
  if (Array.isArray(value)) return value.map((item) => shiftPositions(item, offset))
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if ('start' in record && 'end' in record) {
    const start = record.start as ReturnType<typeof point>,
      end = record.end as ReturnType<typeof point>
    return {
      start: { ...start, offset: start.offset + offset },
      end: { ...end, offset: end.offset + offset },
    }
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, shiftPositions(item, offset)]),
  )
}

for (const kind of ['offset', 'range'] as const)
  for (const [name, original] of cases)
    it.each([0, 2048, 4097])(
      `preserves ${kind} ${name} suffix at %s and exact admission`,
      (start) => {
        const before = read(new PackedView(original)) as Record<string, unknown>[],
          offset = name === 'mixed' ? -3 : 3,
          oldCharges: number[] = [],
          oldStages: number[] = [],
          newCharges: number[] = [],
          newStages: number[] = []
        const expected = (kind === 'offset' ? offsetSuffix : rangeSuffix)(
          original,
          start,
          offset,
          (bytes) => oldCharges.push(bytes),
          (bytes) => oldStages.push(bytes),
        )
        const actual = finish(
          (kind === 'offset' ? offsetSuffixSteps : rangeSuffixSteps)(
            original,
            start,
            offset,
            (bytes) => newCharges.push(bytes),
            (bytes) => newStages.push(bytes),
          ),
        )
        const native = before.map((value, index) =>
          index < start
            ? value
            : kind === 'offset'
              ? shiftPositions(value, offset)
              : {
                  ...value,
                  from: (value.from as number) + offset,
                  to: (value.to as number) + offset,
                },
        )
        expect(read(new PackedView(actual.value))).toEqual(native)
        expect(read(new PackedView(actual.value))).toEqual(read(new PackedView(expected)))
        expect(read(new PackedView(original))).toEqual(before)
        expect(newCharges).toEqual(oldCharges)
        expect(newStages).toEqual(oldStages)
        if (name === 'arena' && start === 4097) expect(actual.pauses).toBe(0)
        else expect(actual.pauses).toBeGreaterThan(10)
        expect('segments' in actual.value && actual.value.segments.every(Object.isFrozen)).toBe(
          true,
        )
        expect(Object.isFrozen(actual.value)).toBe(true)
      },
      // Complete 4,097-value comparisons also run under coverage instrumentation.
      15_000,
    )

for (const kind of ['offset', 'range'] as const) {
  it(`reuses complete ${kind} proofs without changing copy charges or results`, () => {
    const transform = kind === 'offset' ? offsetSuffix : rangeSuffix
    const original = transform(
      segmented,
      0,
      7,
      () => {},
      () => {},
    )
    const oldCharges: number[] = [],
      newCharges: number[] = []
    const expected = transform(
      original,
      0,
      -3,
      (bytes) => oldCharges.push(bytes),
      () => {},
    )
    const actual = finish(
      (kind === 'offset' ? offsetSuffixSteps : rangeSuffixSteps)(
        original,
        0,
        -3,
        (bytes) => newCharges.push(bytes),
        () => {},
      ),
    ).value
    expect(read(new PackedView(actual))).toEqual(read(new PackedView(expected)))
    expect(newCharges).toEqual(oldCharges)
  })

  it.each([
    [-1, 0],
    [4098, 0],
    [0.5, 0],
    [NaN, 0],
    [0, Infinity],
    [0, 0x100000000],
  ])(`rejects invalid ${kind} range %s/%s before charging`, (start, offset) => {
    let charges = 0
    expect(() =>
      finish(
        (kind === 'offset' ? offsetSuffixSteps : rangeSuffixSteps)(
          segmented,
          start,
          offset,
          () => charges++,
          () => {},
        ),
      ),
    ).toThrow(kind === 'offset' ? 'Invalid packed position shift' : 'Invalid packed range shift')
    expect(charges).toBe(0)
  })

  for (const action of ['return', 'throw'] as const)
    it.each([false, true])(`revokes ${kind} copies on ${action}, started=%s`, (started) => {
      const work = (kind === 'offset' ? offsetSuffixSteps : rangeSuffixSteps)(
        segmented,
        2048,
        3,
        () => {},
        () => {},
      )
      if (started) expect(work.next().done).toBe(false)
      if (action === 'return') work.return()
      else expect(() => work.throw(new Error('cancel suffix'))).toThrow('cancel suffix')
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(new PackedView(segmented).position([4096, 'position'])).toEqual(
        position(10 + 4096 * 4),
      )
    })

  it.each(['charge', 'stage'])(`revokes ${kind} copies after %s rejection`, (rejected) => {
    const fail = () => {
      throw new Error('admission')
    }
    const work = (kind === 'offset' ? offsetSuffixSteps : rangeSuffixSteps)(
      segmented,
      2048,
      3,
      rejected === 'charge' ? fail : () => {},
      rejected === 'stage' ? fail : () => {},
    )
    expect(() => finish(work)).toThrow('admission')
    expect(work.next().done).toBe(true)
    expect(new PackedView(segmented).position([4096, 'position'])).toEqual(position(10 + 4096 * 4))
  })
}

it('keeps a borrowed append target intact when the helper is cancelled', () => {
  const target: PackedSegment[] = []
  const work = appendSegmentSliceSteps(target, segmented, 0, 4097, new PackedMetadataBudget())
  expect(work.next().done).toBe(false)
  expect(target.length).toBeGreaterThan(0)
  const copied = [...target]
  work.return()
  expect(target).toEqual(copied)
  expect(work.next().done).toBe(true)
})

it('bounds geometry through a long private position-wrapper prefix', () => {
  let node: PackedNode = segmented
  for (let index = 0; index < 1025; index++) node = { shifted: node, offset: 1 }
  const actual = finish(segmentGeometrySteps(node, new PackedMetadataBudget()))
  expect(actual.value).toEqual({ size: 4097, count: 4097 })
  expect(actual.pauses).toBe(4)
})
