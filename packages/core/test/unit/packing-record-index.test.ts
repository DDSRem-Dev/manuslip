import { expect, it } from 'vitest'
import { PackedWriter } from '../../src/packing-bytes'
import { PackedEncodingBudget } from '../../src/packing-encode-budget'
import { PackedRecordIndex } from '../../src/packing-record-index'
import { finishPackedSteps } from '../../src/packing-work'

class MeasuredBudget extends PackedEncodingBudget {
  current = 0
  peak = 0
  constructor(working = 1024 * 1024) {
    super({ working, nodes: 1000000, depth: 512 })
  }
  override charge(bytes: number): void {
    super.charge(bytes)
    this.current += bytes
    this.peak = Math.max(this.peak, this.current)
  }
  override release(bytes: number): void {
    super.release(bytes)
    this.current -= bytes
  }
}

function emitted(body: PackedWriter, tag: number, values: readonly number[]): number {
  const offset = body.length
  body.uint(tag)
  if (tag === 6) body.uint(values.length)
  for (const value of values) body.uint(value)
  return offset
}

function add(index: PackedRecordIndex, id: number, tag: number, values: readonly number[]): void {
  const found = finishPackedSteps(index.lookupSteps(tag, values))
  expect(found.id).toBeUndefined()
  finishPackedSteps(index.insertSteps(found.hash, id, emitted(index.body, tag, values)))
}

// Solve the last coordinate independently using the multiplicative inverse of the FNV
// prime modulo 2^32. Every distinct six-coordinate record has the SAME full hash.
function collision(serial: number, tag = 7): number[] {
  let hash = Math.imul(2166136261 ^ tag, 16777619)
  hash = Math.imul(hash ^ 6, 16777619)
  const prefix = [serial, 0, 0, 0, 0]
  for (const value of prefix) hash = Math.imul(hash ^ value, 16777619)
  return [...prefix, (hash ^ Math.imul(0xdeadbeef, 899433627)) >>> 0]
}

it('compares complete emitted records after full hash collisions, including tags and uint32 halves', () => {
  expect(Math.imul(16777619, 899433627) >>> 0).toBe(1)
  const index = new PackedRecordIndex(new PackedWriter(1024 * 1024), new MeasuredBudget())
  for (let id = 0; id < 64; id++) {
    const values = collision(id === 63 ? 0xffffffff : id)
    expect(finishPackedSteps(index.lookupSteps(7, values)).hash).toBe(0xdeadbeef)
    add(index, id, 7, values)
  }
  // A different tag lands in the very same probe chain and must remain distinct.
  const array = collision(0, 6)
  expect(finishPackedSteps(index.lookupSteps(6, array)).hash).toBe(0xdeadbeef)
  add(index, 64, 6, array)
  for (let id = 0; id < 64; id++)
    expect(finishPackedSteps(index.lookupSteps(7, collision(id === 63 ? 0xffffffff : id))).id).toBe(
      id,
    )
  expect(finishPackedSteps(index.lookupSteps(6, array)).id).toBe(64)
  expect(finishPackedSteps(index.lookupSteps(6, array.slice(0, 5))).id).toBeUndefined()
  expect(finishPackedSteps(index.lookupSteps(7, [...collision(0)].reverse())).id).toBeUndefined()
  index.clear()
})

it('bounds collision probes without losing the last admitted record or publishing an extra entry', () => {
  const budget = new MeasuredBudget()
  const index = new PackedRecordIndex(new PackedWriter(1024 * 1024), budget)
  for (let id = 0; id < 256; id++) add(index, id, 7, collision(id))
  const bytes = budget.current
  expect(finishPackedSteps(index.lookupSteps(7, collision(255))).id).toBe(255)
  expect(() => finishPackedSteps(index.lookupSteps(7, collision(256)))).toThrow('collision limit')
  const offset = emitted(index.body, 7, collision(256))
  expect(() => finishPackedSteps(index.insertSteps(0xdeadbeef, 256, offset))).toThrow(
    'collision limit',
  )
  expect(budget.current).toBe(bytes)
  expect(finishPackedSteps(index.lookupSteps(7, collision(0))).id).toBe(0)
  index.clear()
  expect(budget.current).toBe(0)
})

it('keeps the byte-only codec unbounded by the optional collision allowance and yields during probing', () => {
  const index = new PackedRecordIndex(new PackedWriter(1024 * 1024))
  for (let id = 0; id < 257; id++) add(index, id, 7, collision(id))
  const work = index.lookupSteps(7, collision(256))
  expect(work.next().done).toBe(false)
  expect(finishPackedSteps(work).id).toBe(256)
  index.clear()
})

it.each(['denied', 'cancelled', 'completed'] as const)(
  'admits overlapping table growth and preserves exact lookups when growth is %s',
  (outcome) => {
    const previousBytes = 1024 * 12 + 64
    const nextBytes = 2048 * 12 + 64
    const budget = new MeasuredBudget(
      outcome === 'denied' ? previousBytes + nextBytes - 1 : 1024 * 1024,
    )
    const index = new PackedRecordIndex(new PackedWriter(1024 * 1024), budget)
    for (let id = 0; id < 512; id++) add(index, id, 8, [id, 0xffffffff])
    expect(budget.current).toBe(previousBytes)
    const found = finishPackedSteps(index.lookupSteps(8, [512, 0xffffffff]))
    const work = index.insertSteps(found.hash, 512, emitted(index.body, 8, [512, 0xffffffff]))
    if (outcome === 'denied') {
      expect(() => work.next()).toThrow('working limit')
      expect(budget.peak).toBe(previousBytes)
    } else if (outcome === 'cancelled') {
      expect(work.next().done).toBe(false)
      expect(budget.current).toBe(previousBytes + nextBytes)
      work.return()
    } else {
      finishPackedSteps(work)
      expect(budget.peak).toBe(previousBytes + nextBytes)
    }
    expect(budget.current).toBe(outcome === 'completed' ? nextBytes : previousBytes)
    expect(finishPackedSteps(index.lookupSteps(8, [512, 0xffffffff])).id).toBe(
      outcome === 'completed' ? 512 : undefined,
    )
    for (let id = 0; id < 512; id++)
      expect(finishPackedSteps(index.lookupSteps(8, [id, 0xffffffff])).id).toBe(id)
    index.clear()
    index.clear()
    expect(budget.current).toBe(0)
  },
)

it('yields during long exact comparisons and can cancel without changing the index', () => {
  const budget = new MeasuredBudget()
  const index = new PackedRecordIndex(new PackedWriter(1024 * 1024), budget)
  const values = Array.from({ length: 1024 }, (_, at) => at * 65537)
  add(index, 0, 6, values)
  const before = budget.current
  const work = index.lookupSteps(6, values)
  // Four hashing batches, then the first exact comparison batch.
  for (let step = 0; step < 5; step++) expect(work.next().done).toBe(false)
  work.return({ hash: 0, id: undefined })
  expect(budget.current).toBe(before)
  expect(finishPackedSteps(index.lookupSteps(6, values)).id).toBe(0)
  index.clear()
  expect(budget.current).toBe(0)
})

it('reads only emitted writer bytes across chunk boundaries without exposing backing buffers', () => {
  const writer = new PackedWriter(65538)
  for (let at = 0; at < 65538; at++) writer.byte(at % 251)
  for (const at of [0, 65535, 65536, 65537]) expect(writer.byteAt(at)).toBe(at % 251)
  for (const at of [-1, 0.5, NaN, Infinity, 65538, Number.MAX_SAFE_INTEGER])
    expect(() => writer.byteAt(at)).toThrow('Invalid packed writer offset')
})
