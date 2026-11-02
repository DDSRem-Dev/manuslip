import { expect, it } from 'vitest'
import { PackedWriter } from '../../src/packing-bytes'
import { PackedEncodingBudget } from '../../src/packing-encode-budget'
import { PackedRecordIndex } from '../../src/packing-record-index'
import { finishPackedSteps } from '../../src/packing-work'

function emitted(body: PackedWriter, tag: number, values: readonly number[]): number {
  const offset = body.length
  body.uint(tag)
  if (tag === 6) body.uint(values.length)
  for (const value of values) body.uint(value)
  return offset
}

function insert(
  index: PackedRecordIndex,
  id: number,
  tag: number,
  values: readonly number[],
): void {
  const found = index.lookupSmall(tag, values) ?? finishPackedSteps(index.lookupSteps(tag, values))
  expect(found.id).toBeUndefined()
  const offset = emitted(index.body, tag, values)
  if (!index.insertSmall(found.hash, id, offset))
    finishPackedSteps(index.insertSteps(found.hash, id, offset))
}

// An independent inverse of the FNV prime constructs distinct records with one full
// hash. Equality must inspect the complete record, even on the synchronous path.
function collision(serial: number, tag = 7): number[] {
  let hash = Math.imul(Math.imul(2166136261 ^ tag, 16777619) ^ 6, 16777619)
  const prefix = [serial, 0, 0, 0, 0]
  for (const value of prefix) hash = Math.imul(hash ^ value, 16777619)
  return [...prefix, (hash ^ Math.imul(0xdeadbeef, 899433627)) >>> 0]
}

it.each(Array.from({ length: 17 }, (_, length) => length))(
  'interns length %i with exactly the cooperative hash, IDs and emitted bytes',
  (length) => {
    const fast = new PackedRecordIndex(new PackedWriter(1024 * 1024))
    const reference = new PackedRecordIndex(new PackedWriter(1024 * 1024))
    let state = 0xfedcba98
    const rows = Array.from({ length: length ? 40 : 1 }, () =>
      Array.from({ length }, () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state
      }),
    )
    for (const [id, values] of rows.entries()) {
      expect(fast.lookupSmall(6, values)).toEqual(
        finishPackedSteps(reference.lookupSteps(6, values)),
      )
      insert(fast, id, 6, values)
      const found = finishPackedSteps(reference.lookupSteps(6, values))
      finishPackedSteps(reference.insertSteps(found.hash, id, emitted(reference.body, 6, values)))
    }
    for (const [id, values] of rows.entries()) {
      expect(fast.lookupSmall(6, values)).toEqual(
        finishPackedSteps(reference.lookupSteps(6, values)),
      )
      expect(fast.lookupSmall(6, values)?.id).toBe(id)
    }
    expect(new Uint8Array(fast.body.finish())).toEqual(new Uint8Array(reference.body.finish()))
    fast.clear()
    reference.clear()
  },
)

it('compares all coordinates, uint32 halves, tags, array lengths and reference order', () => {
  const index = new PackedRecordIndex(new PackedWriter(1024 * 1024))
  const position = [0, 0x7fffffff, 0x80000000, 0xffffffff, 128, 16384]
  insert(index, 0, 7, position)
  insert(index, 1, 6, position)
  insert(index, 2, 8, position)
  for (const [tag, id] of [
    [6, 1],
    [7, 0],
    [8, 2],
  ] as const)
    expect(index.lookupSmall(tag, position)?.id).toBe(id)
  for (let at = 0; at < position.length; at++) {
    const changed = [...position]
    changed[at] = ((changed[at] ?? 0) ^ 0x80000000) >>> 0
    expect(index.lookupSmall(7, changed)?.id).toBeUndefined()
  }
  expect(index.lookupSmall(6, position.slice(0, -1))?.id).toBeUndefined()
  expect(index.lookupSmall(6, [...position, 0])?.id).toBeUndefined()
  expect(index.lookupSmall(7, [...position].reverse())?.id).toBeUndefined()
  index.clear()
})

it('falls back after sixteen full-hash collisions without publishing a failed insertion', () => {
  const index = new PackedRecordIndex(new PackedWriter(1024 * 1024))
  for (let id = 0; id < 16; id++) insert(index, id, 7, collision(id))
  for (let id = 0; id < 16; id++)
    expect(index.lookupSmall(7, collision(id))).toEqual({ hash: 0xdeadbeef, id })
  expect(index.lookupSmall(7, collision(16))).toBeUndefined()
  const offset = emitted(index.body, 7, collision(16))
  expect(index.insertSmall(0xdeadbeef, 16, offset)).toBe(false)
  expect(finishPackedSteps(index.lookupSteps(7, collision(16))).id).toBeUndefined()
  finishPackedSteps(index.insertSteps(0xdeadbeef, 16, offset))
  expect(index.lookupSmall(7, collision(16))).toBeUndefined()
  expect(finishPackedSteps(index.lookupSteps(7, collision(16))).id).toBe(16)
  // A tag mismatch with the same full hash must not match the first record.
  expect(index.lookupSmall(6, collision(0, 6))).toBeUndefined()
  expect(finishPackedSteps(index.lookupSteps(6, collision(0, 6))).id).toBeUndefined()
  index.clear()
})

it('does not read long rows before the caller can yield to the cooperative path', () => {
  const values = Array.from({ length: 17 }, (_, at) => at)
  Object.defineProperty(values, 0, {
    get: () => {
      throw new Error('read long row')
    },
  })
  const index = new PackedRecordIndex(new PackedWriter(1024))
  expect(index.lookupSmall(6, values)).toBeUndefined()
  const work = index.lookupSteps(6, values)
  expect(() => work.next()).toThrow('read long row')
})

it.each(['denied', 'cancelled', 'completed'] as const)(
  'leaves growth admission and rollback intact when the fallback is %s',
  (outcome) => {
    const previous = 1024 * 12 + 64
    const next = 2048 * 12 + 64
    let held = 0
    class Budget extends PackedEncodingBudget {
      override charge(bytes: number): void {
        super.charge(bytes)
        held += bytes
      }
      override release(bytes: number): void {
        super.release(bytes)
        held -= bytes
      }
    }
    const budget = new Budget({
      working: outcome === 'denied' ? previous + next - 1 : 1024 * 1024,
      nodes: 1000000,
      depth: 512,
    })
    const index = new PackedRecordIndex(new PackedWriter(1024 * 1024), budget)
    for (let id = 0; id < 512; id++) insert(index, id, 8, [id, 0xffffffff])
    expect(held).toBe(previous)
    const values = [512, 0xffffffff]
    const found = index.lookupSmall(8, values) ?? finishPackedSteps(index.lookupSteps(8, values))
    const offset = emitted(index.body, 8, values)
    expect(index.insertSmall(found.hash, 512, offset)).toBe(false)
    expect(held).toBe(previous)
    expect(finishPackedSteps(index.lookupSteps(8, values)).id).toBeUndefined()
    const work = index.insertSteps(found.hash, 512, offset)
    if (outcome === 'denied') expect(() => work.next()).toThrow('working limit')
    else if (outcome === 'cancelled') {
      expect(work.next().done).toBe(false)
      expect(held).toBe(previous + next)
      work.return()
    } else finishPackedSteps(work)
    expect(held).toBe(outcome === 'completed' ? next : previous)
    expect(finishPackedSteps(index.lookupSteps(8, values)).id).toBe(
      outcome === 'completed' ? 512 : undefined,
    )
    for (let id = 0; id < 512; id++)
      expect(finishPackedSteps(index.lookupSteps(8, [id, 0xffffffff])).id).toBe(id)
    index.clear()
    index.clear()
    expect(held).toBe(0)
  },
)

it.each([-1, 0.5, NaN, Infinity, 0x100000000, undefined])(
  'rejects invalid short references (%s) with the cooperative error',
  (value) => {
    const index = new PackedRecordIndex(new PackedWriter(1024))
    const values = [value] as number[]
    expect(() => index.lookupSmall(6, values)).toThrow('Invalid packed record reference')
    expect(() => finishPackedSteps(index.lookupSteps(6, values))).toThrow(
      'Invalid packed record reference',
    )
  },
)

it.each([
  [-1, 0, 0],
  [0x100000000, 0, 0],
  [NaN, 0, 0],
  [0, -1, 0],
  [0, 0xffffffff, 0],
  [0, 0.5, 0],
  [0, 0, -1],
  [0, 0, 1],
  [0, 0, NaN],
])('rejects invalid entries (%s, %s, %s) before requesting growth', (hash, id, offset) => {
  const body = new PackedWriter(1024)
  body.byte(6)
  const index = new PackedRecordIndex(body)
  expect(() => index.insertSmall(hash, id, offset)).toThrow('Invalid packed record index entry')
  expect(() => finishPackedSteps(index.insertSteps(hash, id, offset))).toThrow(
    'Invalid packed record index entry',
  )
})
