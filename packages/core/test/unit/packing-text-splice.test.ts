import { expect, it } from 'vitest'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { spliceTextSteps } from '../../src/packing-copy-steps'
import { PackedText } from '../../src/packing-text'
import {
  offsetNode,
  type PackedNode,
  PackedView,
  rangeNode,
  spliceText,
} from '../../src/packing-view'
import type { PackedWork } from '../../src/packing-work'

const limits = { bytes: 8 * 1024 * 1024, retained: 16 * 1024 * 1024, staging: 8 * 1024 * 1024 }
const open = (value: unknown) => PackedArena.open(packValue(value, limits.bytes), limits)
function text(value: string) {
  const arena = open(value)
  return PackedText.from(arena, arena.root)
}
function finish<T>(work: PackedWork<T>): { value: T; pauses: number } {
  let pauses = 0
  while (true) {
    const step = work.next()
    if (step.done) {
      if (step.value === undefined) throw new Error('Cancelled text copy')
      return { value: step.value, pauses }
    }
    pauses++
  }
}
const spellings = ['甲', '😀', '\r\n', '\\', '\u2028', 'e\u0301']
const arena = open(spellings)
const records = spellings.map((_, index) => arena.element(arena.root, index))
let fragmented = text('A😀Z"\r\n\\\ud800\udfff')
let original = fragmented.scalar()
for (let index = 0; index < 1024; index++) {
  const choice = index % spellings.length
  fragmented = fragmented.splice(fragmented.length, 0, arena, records[choice] as number, () => {})
  original += spellings[choice]
}

for (const [start, remove] of [
  [0, 0],
  [2, 0],
  [Math.floor(original.length / 2), 3],
  [original.length, 0],
  [0, original.length],
] as const)
  it.each(['', '界😀', '\udfff\ud800\r\n"\\'])(
    `preserves fragmented UTF-16 text and exact admission at ${start}/${remove}: %j`,
    (inserted) => {
      const insert = open(inserted),
        oldCharges: number[] = [],
        newCharges: number[] = []
      const expected = fragmented.splice(start, remove, insert, insert.root, (bytes) =>
        oldCharges.push(bytes),
      )
      const actual = finish(
        fragmented.spliceSteps(start, remove, insert, insert.root, (bytes) =>
          newCharges.push(bytes),
        ),
      )
      const value = original.slice(0, start) + inserted + original.slice(start + remove)
      expect(actual.value.scalar()).toBe(value)
      expect(actual.value.scalar()).toBe(expected.scalar())
      expect([...actual.value.steps()].filter((chunk) => chunk !== undefined).join('')).toBe(value)
      expect(actual.value.length).toBe(value.length)
      expect(actual.value.scalarCost()).toEqual(expected.scalarCost())
      expect(actual.pauses).toBeGreaterThan(2)
      expect(newCharges).toEqual(oldCharges)
      expect(Object.isFrozen(actual.value)).toBe(true)
      expect(fragmented.scalar()).toBe(original)
    },
  )

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
] as const)('preserves empty and single-record edits: %j', (before, start, remove, inserted) => {
  const base = text(before),
    replacement = open(inserted)
  const actual = finish(base.spliceSteps(start, remove, replacement, replacement.root, () => {}))
  expect(actual.value.scalar()).toBe(
    before.slice(0, start) + inserted + before.slice(start + remove),
  )
  expect(base.scalar()).toBe(before)
})

it.each([
  [-1, 0],
  [0, -1],
  [original.length + 1, 0],
  [original.length, 1],
  [0, 0.5],
  [NaN, 0],
  [0, Infinity],
])('rejects invalid range %s/%s before charging', (start, remove) => {
  const insert = open('new')
  let charges = 0
  expect(() =>
    finish(fragmented.spliceSteps(start, remove, insert, insert.root, () => charges++)),
  ).toThrow('Invalid packed text splice range')
  expect(charges).toBe(0)
  expect(fragmented.scalar()).toBe(original)
})

for (const action of ['return', 'throw'] as const)
  for (const started of [false, true])
    it(`revokes scalar and node text copies on ${action}, started=${started}`, () => {
      const insert = open('new')
      const copies = [
        fragmented.spliceSteps(1500, 2, insert, insert.root, () => {}),
        spliceTextSteps({ text: fragmented }, 1500, 2, insert, insert.root, () => {}),
      ]
      for (const work of copies) {
        if (started) expect(work.next().done).toBe(false)
        if (action === 'return') work.return()
        else expect(() => work.throw(new Error('cancel text'))).toThrow('cancel text')
        expect(work.next()).toEqual({ done: true, value: undefined })
      }
      expect(fragmented.scalar()).toBe(original)
    })

it('rejects admission before copying and leaves both inputs usable', () => {
  const insert = open('new')
  const work = fragmented.spliceSteps(1500, 2, insert, insert.root, () => {
    throw new Error('admission')
  })
  expect(() => finish(work)).toThrow('admission')
  expect(work.next().done).toBe(true)
  expect(fragmented.scalar()).toBe(original)
  expect(insert.scalar(insert.root)).toBe('new')
})

it.each([false, true])('preserves scalar node replacement, shifted=%s', (shifted) => {
  const base: PackedNode = { text: fragmented },
    node = shifted ? offsetNode(base, 31) : base,
    insert = open('界😀')
  const oldCharges: number[] = [],
    newCharges: number[] = []
  const expected = spliceText(node, 2, 1, insert, insert.root, (bytes) => oldCharges.push(bytes))
  const actual = finish(
    spliceTextSteps(node, 2, 1, insert, insert.root, (bytes) => newCharges.push(bytes)),
  ).value
  expect(new PackedView(actual).scalar()).toBe(new PackedView(expected).scalar())
  expect(newCharges).toEqual(oldCharges)
})

it.each([{ number: 1 }, rangeNode({ text: fragmented }, 7), { fields: [] }] as PackedNode[])(
  'preserves invalid scalar-node errors',
  (node) => {
    const insert = open('new')
    expect(() => spliceText(node, 0, 0, insert, insert.root, () => {})).toThrow(
      'Packed value is not a string',
    )
    expect(() => finish(spliceTextSteps(node, 0, 0, insert, insert.root, () => {}))).toThrow(
      'Packed value is not a string',
    )
  },
)

it('matches native strings through independent seeded cooperative edit sequences', () => {
  let expected = 'Start 😀 界\n"\\\ud800 end',
    value = text(expected),
    seed = 20261029
  const old = value
  const insertions = ['', 'x', '😀', '\ud800', '\udfff', '\n"\\', '界']
  for (let index = 0; index < 150; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const start = seed % (expected.length + 1),
      remove = Math.min(index % 4, expected.length - start),
      inserted = insertions[index % insertions.length] ?? '',
      replacement = open(inserted)
    value = finish(value.spliceSteps(start, remove, replacement, replacement.root, () => {})).value
    expected = expected.slice(0, start) + inserted + expected.slice(start + remove)
    expect(value.scalar()).toBe(expected)
  }
  expect(old.scalar()).toBe('Start 😀 界\n"\\\ud800 end')
})
