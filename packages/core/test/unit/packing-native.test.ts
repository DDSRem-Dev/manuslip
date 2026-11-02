import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedReadScope } from '../../src/packing-capture'
import { readPackedNative } from '../../src/packing-native'
import { PackedSession } from '../../src/packing-session'

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 64 }
function fixture(value: unknown) {
  const owner = new PackedSession({ ...limits, bytes: 8 * MiB, captures: 4, readers: 64 })
  const identity = {
    generation: 1,
    documentId: 'native-copy',
    revision: 0,
    sourceHash: sourceHash('source'),
    parserVersion: 'test',
    rendererVersion: 'test',
    options: 'test',
  }
  owner.commit(
    owner.prepareFull(owner.begin(identity, 'source'), identity, packValue(value, 8 * MiB)),
  )
  const capture = owner.capture()
  return { owner, capture }
}
const position = {
  start: { line: 2, column: 3, offset: 10 },
  end: { line: 2, column: 6, offset: 13 },
}

describe('bounded native copies of selected packed subtrees', () => {
  it('preserves every value, hostile property names and deep immutability after owner disposal', () => {
    const value = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":"text","values":[null,true,false,0,-2.5,"中文😀"]}',
    )
    value.position = position
    const { owner, capture } = fixture({ selected: value, untouched: 'large'.repeat(10000) })
    const copied = readPackedNative(capture.reader, ['selected'], limits)
    expect(copied.value).toEqual(value)
    expect(Object.getPrototypeOf(copied.value)).toBe(Object.prototype)
    expect(Object.hasOwn(copied.value as object, '__proto__')).toBe(true)
    const immutable = (value: unknown) => {
      if (value === null || typeof value !== 'object') return
      expect(Object.isFrozen(value)).toBe(true)
      for (const child of Object.values(value)) immutable(child)
    }
    immutable(copied.value)
    expect(owner.stats.readers).toBe(0)
    owner.dispose()
    expect(copied.value).toEqual(value)
    expect(() => readPackedNative(capture.reader, [], limits)).toThrow('released')
  })
  it('admits exact budgets and closes nested readers after retained/staging/node/depth failures', () => {
    const { owner, capture } = fixture([['first', { nested: ['second', position] }], 'last'])
    try {
      const copied = readPackedNative(capture.reader, [], limits)
      expect(
        readPackedNative(capture.reader, [], {
          retained: copied.retainedBytes,
          staging: copied.stagingBytes,
          nodes: copied.nodes,
          depth: 5,
        }).value,
      ).toEqual(copied.value)
      const before = owner.stats
      for (const changed of [
        { retained: copied.retainedBytes - 1 },
        { staging: copied.stagingBytes - 1 },
        { nodes: copied.nodes - 1 },
        { depth: 2 },
      ]) {
        expect(() => readPackedNative(capture.reader, [], { ...limits, ...changed })).toThrow(
          'limit',
        )
        expect(owner.stats).toEqual(before)
      }
      expect(readPackedNative(capture.reader, [], limits).value).toEqual(copied.value)
    } finally {
      owner.dispose()
    }
  })
  it('rejects a large scalar before decoding when retained or scratch admission fails', () => {
    const { owner, capture } = fixture('文'.repeat(300000))
    const decode = vi.spyOn(PackedReadScope.prototype, 'scalar')
    try {
      expect(() => readPackedNative(capture.reader, [], { ...limits, retained: 100 })).toThrow(
        'retained',
      )
      expect(() => readPackedNative(capture.reader, [], { ...limits, staging: 1024 })).toThrow(
        'staging',
      )
      expect(decode).not.toHaveBeenCalled()
      expect(owner.stats.readers).toBe(0)
    } finally {
      decode.mockRestore()
      owner.dispose()
    }
  })
  it.each([10, -10])(
    'shifts only position offsets by %i, retaining original line/column and old data',
    (shift) => {
      const value = { from: 10, to: 13, position, nested: [{ position }] }
      const { owner, capture } = fixture(value)
      try {
        const moved = {
          start: { ...position.start, offset: 10 + shift },
          end: { ...position.end, offset: 13 + shift },
        }
        expect(readPackedNative(capture.reader, [], limits, shift).value).toEqual({
          ...value,
          position: moved,
          nested: [{ position: moved }],
        })
        expect(readPackedNative(capture.reader, [], limits).value).toEqual(value)
      } finally {
        owner.dispose()
      }
    },
  )
  it.each([-11, 0xffffffff - 12])(
    'rejects out-of-range shifted positions and closes readers: %i',
    (shift) => {
      const { owner, capture } = fixture([['first', { position }]])
      try {
        const before = owner.stats
        expect(() => readPackedNative(capture.reader, [], limits, shift)).toThrow('position range')
        expect(owner.stats).toEqual(before)
      } finally {
        owner.dispose()
      }
    },
  )
  it('rejects every invalid or missing budget and invalid position shift', () => {
    const { owner, capture } = fixture(null)
    try {
      for (const key of ['retained', 'staging', 'nodes', 'depth'] as const)
        for (const value of [-1, NaN, Infinity, 0.5, undefined])
          expect(() =>
            readPackedNative(capture.reader, [], { ...limits, [key]: value } as typeof limits),
          ).toThrow('limits')
      expect(() => readPackedNative(capture.reader, [], { ...limits, depth: 257 })).toThrow(
        'limits',
      )
      for (const shift of [NaN, Infinity, 0.5, 0x100000000, -0x100000000])
        expect(() => readPackedNative(capture.reader, [], limits, shift)).toThrow('shift')
      expect(owner.stats.readers).toBe(0)
    } finally {
      owner.dispose()
    }
  })
})
