import { expect, it, vi } from 'vitest'
import { packValue, packValueSteps, unpackValue } from '../../src/packing'
import { PackedWriter } from '../../src/packing-bytes'
import { PackedEncodingBudget } from '../../src/packing-encode-budget'
import { PackedRecordIndex } from '../../src/packing-record-index'
import { finishPackedSteps, PackedWork } from '../../src/packing-work'
import { parseMarkdown } from '../../src/parse'
import examples from '../fixtures/commonmark-0.31.2/spec.json'

const MiB = 1024 * 1024
const limits = { working: 32 * MiB, nodes: 800000, depth: 512 }

it('preserves exact independent wire and sharing when an identity memo entry is evicted', () => {
  const count = 4200
  const shared = Object.freeze({ value: 'kept' })
  const input = Object.freeze([
    shared,
    ...Array.from({ length: count }, (_, value) => Object.freeze({ value })),
    shared,
  ])
  const oracle = new PackedWriter(MiB)
  for (const byte of [77, 83, 80, 50]) oracle.byte(byte)
  oracle.uint(1)
  oracle.uint(1)
  oracle.string('value')
  oracle.uint(0)
  oracle.uint(count * 2 + 3)
  oracle.uint(5)
  oracle.string('kept')
  oracle.uint(8)
  oracle.uint(0)
  for (let value = 0; value < count; value++) {
    oracle.uint(3)
    oracle.uint(value)
    oracle.uint(8)
    oracle.uint(2 + value * 2)
  }
  oracle.uint(6)
  oracle.uint(input.length)
  oracle.uint(1)
  for (let value = 0; value < count; value++) oracle.uint(3 + value * 2)
  oracle.uint(1)
  oracle.uint(count * 2 + 2)
  const expected = oracle.finish()
  // Eviction adds one actual scalar visit on the second occurrence. It creates
  // neither a new wire record nor an exemption from the normal node limit.
  const bounded = { ...limits, nodes: count * 2 + 5 }
  const payload = packValue(input, MiB, bounded)
  expect(payload).toEqual(expected)
  expect(packValue(input, MiB)).toEqual(expected)
  expect(() => packValue(input, MiB, { ...bounded, nodes: bounded.nodes - 1 })).toThrow(
    'node/depth',
  )
  const decoded = unpackValue(payload, { bytes: MiB, retained: MiB, staging: MiB })
    .value as unknown[]
  expect(decoded).toEqual(input)
  expect(decoded.at(-1)).toBe(decoded[0])
})

it('keeps cycle detection active after identity memo eviction and permits cancellation', () => {
  const original = PackedEncodingBudget.prototype.release
  let rotations = 0
  const release = vi.spyOn(PackedEncodingBudget.prototype, 'release').mockImplementation(function (
    this: PackedEncodingBudget,
    bytes,
  ) {
    original.call(this, bytes)
    if (bytes === 4096 * 96) rotations++
  })
  const values: unknown[] = Array.from({ length: 5000 }, (_, value) => ({ value }))
  const work = packValueSteps(values, MiB, limits)
  try {
    while (rotations === 0) expect(work.next().done).toBe(false)
    expect(work.return()).toEqual({ done: true, value: undefined })
    expect(finishPackedSteps(work)).toBeUndefined()
    values.push(values)
    const cyclic = packValueSteps(values, MiB, limits)
    expect(() => finishPackedSteps(cyclic)).toThrow('Cyclic')
    expect(cyclic.next()).toEqual({ done: true, value: undefined })
    expect(rotations).toBeGreaterThan(1)
  } finally {
    work.return()
    release.mockRestore()
  }
})

it('preserves independently written record IDs across high/low halves, order, length and shapes', () => {
  const count = 65538
  const seeds = Array.from({ length: count }, (_, index) => index)
  const pairs = [
    [0, 0],
    [65536, 0],
    [0, 65536],
    [65536, 65536],
  ]
  const input = [seeds, ...pairs, [65536, 0], [], {}, {}, { field: 0 }, { field: 0 }]
  const oracle = new PackedWriter(2 * MiB)
  for (const byte of [77, 83, 80, 50]) oracle.byte(byte)
  oracle.uint(2)
  oracle.uint(0)
  oracle.uint(1)
  oracle.string('field')
  oracle.uint(0)
  oracle.uint(count + 9)
  for (let index = 0; index < count; index++) {
    oracle.uint(3)
    oracle.uint(index)
  }
  oracle.uint(6)
  oracle.uint(count)
  for (let index = 0; index < count; index++) oracle.uint(index)
  for (const pair of pairs) {
    oracle.uint(6)
    oracle.uint(2)
    for (const reference of pair) oracle.uint(reference)
  }
  oracle.uint(6)
  oracle.uint(0)
  oracle.uint(8)
  oracle.uint(9)
  oracle.uint(0)
  oracle.uint(6)
  oracle.uint(input.length)
  for (const reference of [0, 1, 2, 3, 4, 2, 5, 6, 6, 7, 7]) oracle.uint(count + reference)
  oracle.uint(count + 8)
  const payload = packValue(input, 2 * MiB, limits)
  expect(new Uint8Array(payload)).toEqual(new Uint8Array(oracle.finish()))
  const decoded = unpackValue(payload, { bytes: 2 * MiB, retained: 16 * MiB, staging: 8 * MiB })
    .value as unknown[]
  expect(decoded).toEqual(input)
  expect(decoded[5]).toBe(decoded[2])
  expect(decoded[7]).toBe(decoded[8])
  expect(decoded[9]).toBe(decoded[10])
  expect(decoded[6]).not.toBe(decoded[7])
  expect(new Set(decoded.slice(1, 5)).size).toBe(4)
})

it('can cancel while hashing a wide record without publishing a buffer', () => {
  const original = PackedRecordIndex.prototype.lookupSteps
  let constructing = false
  const record = vi.spyOn(PackedRecordIndex.prototype, 'lookupSteps').mockImplementation(function* (
    this: PackedRecordIndex,
    tag,
    references,
  ) {
    if (references.length === 10000) constructing = true
    return yield* original.call(this, tag, references)
  })
  const work = packValueSteps(new Array(10000).fill(null), MiB, limits)
  try {
    while (!constructing) expect(work.next().done).toBe(false)
    // The wide record is being hashed, with further bounded batches still pending.
    expect(work.next().done).toBe(false)
    expect(work.return()).toEqual({ done: true, value: undefined })
    expect(finishPackedSteps(work)).toBeUndefined()
  } finally {
    work.return()
    record.mockRestore()
  }
})

it('interns full-width position coordinates exactly and preserves the independently written wire', () => {
  const initial = [0, 32767, 65535, 65536, 0x80000000, 0xffffffff]
  const coordinates = [
    initial,
    ...Array.from({ length: 6 }, (_, index) =>
      Array.from({ length: 6 }, (_, coordinate) => (coordinate === index ? 0xd800dc00 : 0)),
    ),
    [0x0070003a, 0x003a0070, 0xffff0000, 0x0000ffff, 0x10000, 0],
  ]
  const position = (values: number[]) => ({
    start: { line: values[0], column: values[1], offset: values[2] },
    end: { line: values[3], column: values[4], offset: values[5] },
  })
  const input = [...coordinates.map(position), position(initial)]
  // Independent MSP2 spelling: each unique position precedes the final array, and
  // its duplicate must point at the first record. No encoder key helper is reused.
  const oracle = new PackedWriter(MiB)
  for (const byte of [77, 83, 80, 50]) oracle.byte(byte)
  oracle.uint(0)
  oracle.uint(coordinates.length)
  oracle.uint(coordinates.length + 1)
  for (const values of coordinates) {
    oracle.uint(7)
    for (const value of values) oracle.uint(value)
  }
  oracle.uint(6)
  oracle.uint(input.length)
  for (let index = 0; index < coordinates.length; index++) oracle.uint(index)
  oracle.uint(0)
  oracle.uint(coordinates.length)
  const payload = packValue(input, MiB, limits)
  expect(new Uint8Array(payload)).toEqual(new Uint8Array(oracle.finish()))
  const decoded = unpackValue(payload, { bytes: MiB, retained: MiB, staging: MiB })
    .value as unknown[]
  expect(decoded).toEqual(input)
  expect(decoded.at(-1)).toBe(decoded[0])
  expect(new Set(decoded.slice(0, -1)).size).toBe(coordinates.length)
  expect(packValue(decoded, MiB, limits)).toEqual(payload)
})

it.each(['commonmark', 'manuslip'] as const)(
  'preserves exact legacy bytes and complete parser roots for every CommonMark example in %s',
  (syntax) => {
    for (const example of examples) {
      const document = parseMarkdown(example.markdown, syntax)
      const input = { root: document.root, counts: document.counts }
      const encoded = packValue(input, 8 * MiB, limits)
      expect(new Uint8Array(encoded)).toEqual(new Uint8Array(packValue(input, 8 * MiB)))
      expect(
        unpackValue(encoded, { bytes: 8 * MiB, retained: 32 * MiB, staging: 8 * MiB }).value,
      ).toEqual(input)
    }
  },
)

it('preserves Unicode, hostile own fields, shared references and compact positions', () => {
  const text = Array.from({ length: 65536 }, (_, unit) => String.fromCharCode(unit)).join('')
  const shared = JSON.parse('{"__proto__":null,"constructor":false}')
  const input = {
    text,
    [text.slice(0, 12000)]: text,
    values: [shared, shared, -0, 0, null, false],
    position: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 2, offset: 1 } },
  }
  const native = packValue(input, 8 * MiB)
  const compact = unpackValue(native, {
    bytes: 8 * MiB,
    retained: 32 * MiB,
    staging: 8 * MiB,
  }).value
  for (const value of [input, compact]) {
    const encoded = packValue(value, 8 * MiB, limits)
    expect(new Uint8Array(encoded)).toEqual(new Uint8Array(native))
  }
})

it('charges repeated identity visits and logical depth even when their records share storage', () => {
  const shared = { number: 1 }
  const input = [shared, shared, shared]
  const encode = (nodes: number, depth: number) =>
    packValue(input, MiB, { ...limits, nodes, depth })
  expect(encode(5, 3)).toEqual(packValue(input, MiB))
  expect(() => encode(4, 3)).toThrow('node/depth')
  expect(() => encode(5, 2)).toThrow('node/depth')
})

it('rejects key construction admission before invoking a wide object value getter', () => {
  let reads = 0
  const input = Object.defineProperty({}, 'key'.repeat(20000), {
    enumerable: true,
    get() {
      reads++
      return 'value'
    },
  })
  expect(() => packValue(input, MiB, { ...limits, working: 512 * 1024 })).toThrow('working')
  expect(reads).toBe(0)
})

it('keeps the complete object-key allowance live while its value getters run', () => {
  const originalCharge = PackedEncodingBudget.prototype.charge
  const originalRelease = PackedEncodingBudget.prototype.release
  const originalKeys = PackedEncodingBudget.prototype.keys
  let live = 0,
    admitted = 0
  const reads: number[] = []
  const charge = vi.spyOn(PackedEncodingBudget.prototype, 'charge').mockImplementation(function (
    this: PackedEncodingBudget,
    bytes,
  ) {
    originalCharge.call(this, bytes)
    live += bytes
  })
  const release = vi.spyOn(PackedEncodingBudget.prototype, 'release').mockImplementation(function (
    this: PackedEncodingBudget,
    bytes,
  ) {
    originalRelease.call(this, bytes)
    live -= bytes
    expect(live).toBeGreaterThanOrEqual(0)
  })
  const keys = vi.spyOn(PackedEncodingBudget.prototype, 'keys').mockImplementation(function (
    this: PackedEncodingBudget,
    fields,
  ) {
    const bytes = originalKeys.call(this, fields)
    if (!admitted) admitted = live
    return bytes
  })
  try {
    const input = {
      get value() {
        reads.push(live)
        return 'kept'
      },
    }
    const payload = packValue(input, MiB, limits)
    expect(unpackValue(payload, { bytes: MiB, retained: MiB, staging: MiB }).value).toEqual({
      value: 'kept',
    })
    expect(admitted).toBeGreaterThan(0)
    expect(reads.length).toBeGreaterThanOrEqual(2)
    // Container traversal adds its existing 64-byte reservation to the admitted keys.
    expect(Math.min(...reads)).toBeGreaterThanOrEqual(admitted + 64)
  } finally {
    keys.mockRestore()
    release.mockRestore()
    charge.mockRestore()
  }
})

it('rechecks own fields after a malformed position probe invokes a getter', () => {
  const input: Record<string, unknown> = {}
  Object.defineProperty(input, 'start', {
    enumerable: true,
    get() {
      input.extra = 'kept'
      return null
    },
  })
  input.end = { line: 1, column: 1, offset: 0 }
  const expected = { start: null, end: input.end, extra: 'kept' }
  const payload = packValue(input, MiB, limits)
  expect(payload).toEqual(packValue(expected, MiB))
  expect(unpackValue(payload, { bytes: MiB, retained: MiB, staging: MiB }).value).toEqual(expected)
})

it('bounds traversal tables for a small encoded graph with many repeated values', () => {
  const input = new Array(10000).fill(null)
  expect(packValue(input, MiB).byteLength).toBeLessThan(11000)
  const work = packValueSteps(input, MiB, { ...limits, working: 512 * 1024 })
  expect(() => finishPackedSteps(work)).toThrow('working')
  expect(work.next()).toEqual({ done: true, value: undefined })
})

it('accepts the exact working budget and rejects one byte less without partial publication', () => {
  const input = { values: [null, 1, 'text'], nested: { yes: true } }
  let low = 0,
    high = 2 * MiB
  while (low < high) {
    const working = Math.floor((low + high) / 2)
    try {
      packValue(input, MiB, { ...limits, working })
      high = working
    } catch (error) {
      expect(String(error)).toContain('working')
      low = working + 1
    }
  }
  expect(packValue(input, MiB, { ...limits, working: low })).toEqual(packValue(input, MiB))
  const work = packValueSteps(input, MiB, { ...limits, working: low - 1 })
  expect(() => finishPackedSteps(work)).toThrow('working')
  expect(work.next()).toEqual({ done: true, value: undefined })
})

it.each(['working', 'nodes', 'depth'] as const)(
  'copies and validates the %s limit before suspension',
  (key) => {
    for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => packValueSteps(null, MiB, { ...limits, [key]: invalid })).toThrow('limits')
    const mutable = { ...limits }
    const work = packValueSteps([[[null]]], MiB, mutable)
    mutable[key] = 0
    expect(finishPackedSteps(work)).toEqual(packValue([[[null]]], MiB))
  },
)

it.each([0, 2, 80])(
  'cancels admitted encoding at advance %s without publishing output',
  (advances) => {
    const work = packValueSteps(
      { text: '界😀\n'.repeat(10000), values: new Array(4000).fill('same') },
      MiB,
      limits,
    )
    for (let index = 0; index < advances; index++) expect(work.next().done).toBe(false)
    expect(work.return()).toEqual({ done: true, value: undefined })
    expect(finishPackedSteps(work)).toBeUndefined()
  },
)

it('admits writer chunks and final output before allocating either backing buffer', () => {
  const admitted: number[] = []
  const writer = new PackedWriter(MiB, (bytes) => {
    admitted.push(bytes)
    if (admitted.length === 1) throw new Error('chunk denied')
  })
  expect(() => writer.byte(42)).toThrow('chunk denied')
  // A failed chunk admission must not advance the byte cursor or retain a chunk.
  writer.byte(7)
  expect(new Uint8Array(writer.finish())).toEqual(new Uint8Array([7]))
  expect(admitted).toEqual([65536 + 64, 65536 + 64, 1 + 64])
  for (const cooperative of [false, true]) {
    const final = new PackedWriter(MiB, (bytes) => {
      if (bytes === 65) throw new Error('output denied')
    })
    final.byte(1)
    expect(() => (cooperative ? finishPackedSteps(final.finishSteps()) : final.finish())).toThrow(
      'output denied',
    )
  }
})

it('joins header and body chunks under one exact byte cap and output admission', () => {
  const prefix = new PackedWriter(70001)
  const admitted: number[] = []
  const body = new PackedWriter(140003, (bytes) => admitted.push(bytes))
  for (let index = 0; index < 70001; index++) prefix.byte(index % 256)
  for (let index = 0; index < 70002; index++) body.byte((255 - index) & 255)
  expect(prefix.length).toBe(70001)
  expect(body.length).toBe(70002)
  const steps = body.finishSteps(prefix)
  expect(steps.next().done).toBe(false)
  expect(admitted.at(-1)).toBe(140003 + 64)
  const payload = finishPackedSteps(steps)
  const expected = Uint8Array.from({ length: 140003 }, (_, index) =>
    index < 70001 ? index % 256 : (255 - (index - 70001)) & 255,
  )
  expect(new Uint8Array(payload)).toEqual(expected)
  // The two source writers retain their own contents and lengths.
  expect(new Uint8Array(prefix.finish())).toEqual(expected.slice(0, 70001))
  expect(new Uint8Array(body.finish())).toEqual(expected.slice(70001))
  const tooSmall = new PackedWriter(140002, (bytes) => {
    if (bytes !== 65536 + 64) throw new Error('must reject before output admission')
  })
  for (let index = 0; index < 70002; index++) tooSmall.byte(0)
  expect(() => finishPackedSteps(tooSmall.finishSteps(prefix))).toThrow('byte limit')
  const denied = new PackedWriter(140003, (bytes) => {
    if (bytes === 140003 + 64) throw new Error('combined output denied')
  })
  for (let index = 0; index < 70002; index++) denied.byte(0)
  expect(() => finishPackedSteps(denied.finishSteps(prefix))).toThrow('combined output denied')
  const cancelled = new PackedWork(body.finishSteps(prefix), () => {})
  expect(cancelled.next().done).toBe(false)
  expect(cancelled.return()).toEqual({ done: true, value: undefined })
  expect(cancelled.next()).toEqual({ done: true, value: undefined })
})

it.each([null, -0, '界😀\\\n'.repeat(20000), { long: '界'.repeat(20000), empty: [] }])(
  'enforces the combined header, record body and root-footer byte cap',
  (input) => {
    const payload = packValue(input, 2 * MiB, limits)
    expect(packValue(input, payload.byteLength, limits)).toEqual(payload)
    const work = packValueSteps(input, payload.byteLength - 1, limits)
    expect(() => finishPackedSteps(work)).toThrow('byte limit')
    expect(work.next()).toEqual({ done: true, value: undefined })
  },
)
