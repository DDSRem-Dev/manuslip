import { expect, it } from 'vitest'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { replaceChildSteps, spliceSteps } from '../../src/packing-copy-steps'
import {
  elements,
  fields,
  offsetNode,
  type PackedNode,
  type PackedSegment,
  PackedView,
  rangeNode,
  replaceChild,
  splice,
} from '../../src/packing-view'
import type { PackedWork } from '../../src/packing-work'

const limits = { bytes: 8 * 1024 * 1024, retained: 16 * 1024 * 1024, staging: 8 * 1024 * 1024 }
function node(value: unknown): PackedNode {
  const arena = PackedArena.open(packValue(value, limits.bytes), limits)
  return { arena, id: arena.root }
}
function materialize(node: PackedNode): unknown {
  const view = new PackedView(node)
  switch (view.kind()) {
    case 'scalar':
      return view.scalar()
    case 'position':
      return view.position()
    case 'object':
      // Enumerate once; per-key path lookups rescan copied fields and make this oracle quadratic.
      return Object.fromEntries(fields(node).map(([key, value]) => [key, materialize(value)]))
    case 'array':
      return [...elements(node)].map(materialize)
  }
}
function finish(work: PackedWork<PackedNode>): { node: PackedNode; pauses: number } {
  let pauses = 0
  while (true) {
    const step = work.next()
    if (step.done) {
      if (!step.value) throw new Error('Cancelled copy')
      return { node: step.value, pauses }
    }
    pauses++
  }
}
const position = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 4, offset: 3 },
}
const wide = Object.fromEntries(Array.from({ length: 4097 }, (_, i) => [`field-${i}`, i]))
const replacement = node({ value: 'new', position })
for (const [name, original] of [
  ['arena', node({ ...wide, from: 0, to: 3, position })],
  [
    'fields',
    replaceChild(node({ ...wide, from: 0, to: 3, position }), 'field-0', node(123), () => {}),
  ],
  ['shifted', offsetNode(node({ ...wide, from: 0, to: 3, position }), 7)],
  ['ranged', rangeNode(node({ ...wide, from: 0, to: 3, position }), 11)],
  ['mixed', offsetNode(rangeNode(node({ ...wide, from: 0, to: 3, position }), 11), 7)],
] as const) {
  it(`preserves complete ${name} object fields, transformations and admission weights`, () => {
    const before = materialize(original),
      expectedCharges: number[] = [],
      actualCharges: number[] = []
    const expected = replaceChild(original, 'field-4096', replacement, (bytes) =>
      expectedCharges.push(bytes),
    )
    const actual = finish(
      replaceChildSteps(original, 'field-4096', replacement, (bytes) => actualCharges.push(bytes)),
    )
    expect(actual.pauses).toBeGreaterThan(20)
    expect(materialize(actual.node)).toEqual(materialize(expected))
    expect(actualCharges).toEqual(expectedCharges)
    expect(materialize(original)).toEqual(before)
    expect(Object.isFrozen(actual.node)).toBe(true)
    expect('fields' in actual.node && Object.isFrozen(actual.node.fields)).toBe(true)
  })
}

const segments: PackedSegment[] = Array.from({ length: 4097 }, (_, i) =>
  Object.freeze({ value: node(i), length: 1 }),
)
const segmented: PackedNode = Object.freeze({
  segments: Object.freeze(segments),
  length: segments.length,
})
const inserted = node(['甲', '😀', -0])
for (const shifted of [false, true])
  for (const [start, remove] of [
    [0, 0],
    [2050, 1],
    [4097, 0],
    [0, 4097],
    [4096, 1],
  ] as const)
    it(`preserves complete segmented splice ${start}/${remove}, shifted=${shifted}`, () => {
      const original = shifted ? offsetNode(segmented, 31) : segmented
      const a: number[] = [],
        b: number[] = []
      const expected = splice(original, start, remove, inserted, false, (bytes) => a.push(bytes))
      const actual = finish(
        spliceSteps(original, start, remove, inserted, false, (bytes) => b.push(bytes)),
      )
      expect(actual.pauses).toBeGreaterThan(10)
      expect(materialize(actual.node)).toEqual(materialize(expected))
      expect(a).toEqual(b)
      expect(new PackedView(original).length()).toBe(4097)
      expect('segments' in actual.node && actual.node.segments.every(Object.isFrozen)).toBe(true)
    })

it.each([undefined, node([]), inserted])(
  'preserves zero-length, absent and nonempty insertions',
  (insert) => {
    for (const original of [node([]), node([1, 2, 3]), segmented])
      for (const singleton of [false, true]) {
        const a: number[] = [],
          b: number[] = []
        const expected = splice(original, 0, 0, insert, singleton, (bytes) => a.push(bytes))
        const actual = finish(
          spliceSteps(original, 0, 0, insert, singleton, (bytes) => b.push(bytes)),
        ).node
        expect(materialize(actual)).toEqual(materialize(expected))
        expect(a).toEqual(b)
      }
  },
)

it('preserves singleton ancestor replacement and missing-field copy behavior', () => {
  const actual = finish(replaceChildSteps(segmented, 2048, replacement, () => {})).node
  expect(materialize(actual)).toEqual(
    materialize(replaceChild(segmented, 2048, replacement, () => {})),
  )
  const original = node({ a: 1 })
  expect(
    materialize(finish(replaceChildSteps(original, 'missing', replacement, () => {})).node),
  ).toEqual({ a: 1 })
})

it.each([
  [-1, 0],
  [0, -1],
  [4098, 0],
  [4097, 1],
  [0, 0.5],
  [NaN, 0],
  [0, Infinity],
])('preserves rejected range %s/%s without charging', (start, remove) => {
  let charges = 0
  const charge = () => charges++
  expect(() => splice(segmented, start, remove, inserted, false, charge)).toThrow(
    'Invalid packed splice range',
  )
  expect(() => finish(spliceSteps(segmented, start, remove, inserted, false, charge))).toThrow(
    'Invalid packed splice range',
  )
  expect(charges).toBe(0)
})

for (const method of ['return', 'throw'] as const)
  for (const started of [false, true])
    it(`revokes private field/segment copies on ${method}, started=${started}`, () => {
      const original = node(wide)
      for (const work of [
        replaceChildSteps(original, 'field-4096', replacement, () => {}),
        spliceSteps(segmented, 2048, 1, inserted, false, () => {}),
      ]) {
        if (started) for (let i = 0; i < 5; i++) expect(work.next().done).toBe(false)
        if (method === 'return') work.return()
        else expect(() => work.throw(new Error('cancel copy'))).toThrow('cancel copy')
        expect(work.next()).toEqual({ done: true, value: undefined })
      }
      expect(materialize(original)).toEqual(wide)
      expect(new PackedView(segmented).length()).toBe(4097)
    })

it('rejects admission before copying output and keeps immutable inputs usable', () => {
  const original = node(wide)
  for (const work of [
    replaceChildSteps(original, 'field-4096', replacement, () => {
      throw new Error('admission')
    }),
    spliceSteps(segmented, 2048, 1, inserted, false, () => {
      throw new Error('admission')
    }),
  ]) {
    expect(() => finish(work)).toThrow('admission')
    expect(work.next().done).toBe(true)
  }
  expect(materialize(original)).toEqual(wide)
  expect(materialize(segmented)).toEqual(Array.from({ length: 4097 }, (_, i) => i))
})
