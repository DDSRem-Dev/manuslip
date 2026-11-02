import { describe, expect, it, vi } from 'vitest'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { PackedReader } from '../../src/packing-bytes'
import type { PackedWork } from '../../src/packing-work'
import { parseMarkdown } from '../../src/parse'
import examples from '../fixtures/commonmark-0.31.2/spec.json'

const limits = { bytes: 8 * 1024 * 1024, retained: 16 * 1024 * 1024, staging: 8 * 1024 * 1024 }

function finish(work: PackedWork<PackedArena>): PackedArena {
  while (true) {
    const step = work.next()
    if (step.done) {
      if (!step.value) throw new Error('Cancelled arena')
      return step.value
    }
    expect(step.value).toBeUndefined()
  }
}

function equal(
  actual: PackedArena,
  expected: PackedArena,
  id = actual.root,
  other = expected.root,
) {
  const kind = actual.kind(id)
  expect(kind).toBe(expected.kind(other))
  if (kind === 'scalar') expect(actual.scalar(id)).toBe(expected.scalar(other))
  else if (kind === 'position') expect(actual.position(id)).toEqual(expected.position(other))
  else if (kind === 'array') {
    const ids = [...actual.elements(id)]
    const others = [...expected.elements(other)]
    expect(ids.length).toBe(others.length)
    ids.forEach((child, index) => {
      equal(actual, expected, child, others[index])
    })
  } else {
    expect(actual.keys(id)).toEqual(expected.keys(other))
    for (const key of actual.keys(id)) {
      const child = actual.field(id, key)
      const otherChild = expected.field(other, key)
      if (child === undefined || otherChild === undefined) throw new Error('Missing child')
      equal(actual, expected, child, otherChild)
    }
  }
}

describe('revocable cooperative packed arena indexing', () => {
  it('matches every CommonMark document and preserves exact storage weights for ordinary keys', () => {
    for (const example of examples) {
      const payload = packValue(parseMarkdown(example.markdown), limits.bytes)
      const expected = PackedArena.open(payload.slice(0), limits)
      const actual = finish(PackedArena.openSteps(payload, limits))
      equal(actual, expected)
      expect(actual.retainedBytes).toBe(expected.retainedBytes)
      expect(actual.stagingBytes).toBe(expected.stagingBytes)
      expect(Object.isFrozen(actual)).toBe(true)
    }
  })

  it('seals queued ownership and copies limits before any advance', () => {
    const payload = packValue({ text: 'sealed' }, limits.bytes)
    const view = new Uint8Array(payload)
    const mutable = { ...limits }
    const work = PackedArena.openSteps(payload, mutable)
    expect(payload.byteLength).toBe(0)
    expect(view.byteLength).toBe(0)
    mutable.retained = 0
    mutable.staging = 0
    const actual = finish(work)
    const text = actual.field(actual.root, 'text')
    if (text === undefined) throw new Error('Missing text')
    expect(actual.scalar(text)).toBe('sealed')
    expect(work.next()).toEqual({ done: true, value: undefined })
  })

  it('admits index/output/workspace growth before decoding and closes on admission rejection', () => {
    const observations: { retained: number; staging: number }[] = []
    const work = PackedArena.openSteps(
      packValue('x'.repeat(100000), limits.bytes),
      limits,
      (retained, staging) => {
        const previous = observations.at(-1)
        expect(retained).toBeGreaterThanOrEqual(previous?.retained ?? 0)
        expect(staging).toBeGreaterThanOrEqual(previous?.staging ?? 0)
        observations.push({ retained, staging })
      },
    )
    expect(work.next().done).toBe(false)
    expect(observations.at(-1)?.staging).toBe(33280)
    const arena = finish(work)
    expect(observations.at(-1)).toEqual({
      retained: arena.retainedBytes,
      staging: arena.stagingBytes,
    })

    const rejected = PackedArena.openSteps(
      packValue('x'.repeat(100000), limits.bytes),
      limits,
      (_retained, staging) => {
        if (staging) throw new Error('admission rejected')
      },
    )
    const decode = vi.spyOn(TextDecoder.prototype, 'decode')
    try {
      expect(() => rejected.next()).toThrow('admission rejected')
      expect(decode).not.toHaveBeenCalled()
      expect(rejected.next()).toEqual({ done: true, value: undefined })
    } finally {
      decode.mockRestore()
    }
  })

  it('splits large reference lists and numeric record runs within the work budget', () => {
    const payload = packValue(
      Array.from({ length: 30000 }, (_, i) => i),
      limits.bytes,
    )
    const work = PackedArena.openSteps(payload, limits)
    const uint = vi.spyOn(PackedReader.prototype, 'uint')
    let steps = 0
    let arena: PackedArena | undefined
    try {
      while (true) {
        uint.mockClear()
        const step = work.next()
        // 256 records * (tag + integer) or 256 references, plus a small header/tail.
        expect(uint.mock.calls.length).toBeLessThan(530)
        if (step.done) {
          arena = step.value
          break
        }
        steps++
      }
    } finally {
      uint.mockRestore()
      work.return()
    }
    expect(steps).toBeGreaterThan(200)
    expect(arena?.length(arena.root)).toBe(30000)
    expect(arena?.scalar(arena.element(arena.root, 29999))).toBe(29999)
  })

  it('limits each advance to one string lexical batch, including many short strings', () => {
    const value = [
      ...Array.from({ length: 300 }, (_, i) => `${i}:${'x'.repeat(4000)}`),
      Array.from({ length: 65536 }, (_, unit) => String.fromCharCode(unit)).join(''),
    ]
    const payload = packValue(value, limits.bytes)
    const expected = PackedArena.open(payload.slice(0), limits)
    const work = PackedArena.openSteps(payload, limits)
    const decode = vi.spyOn(TextDecoder.prototype, 'decode')
    let actual: PackedArena | undefined
    try {
      while (true) {
        decode.mockClear()
        const step = work.next()
        const bytes = decode.mock.calls.reduce((sum, [input]) => sum + (input?.byteLength ?? 0), 0)
        expect(bytes).toBeLessThanOrEqual(4096)
        if (step.done) {
          actual = step.value
          break
        }
      }
    } finally {
      decode.mockRestore()
      work.return()
    }
    if (!actual) throw new Error('Missing arena')
    equal(actual, expected)
  })

  it('streams large native shape keys with separately admitted assembly workspace', () => {
    const key = `${'界😀'.repeat(5000)}\ud800`
    const payload = packValue({ [key]: 'value' }, limits.bytes)
    const work = PackedArena.openSteps(payload, limits)
    let steps = 0
    let actual: PackedArena | undefined
    while (true) {
      const step = work.next()
      if (step.done) {
        actual = step.value
        break
      }
      steps++
    }
    expect(steps).toBeGreaterThan(8)
    if (!actual) throw new Error('Missing arena')
    expect(actual.keys(actual.root)).toEqual([key])
    const id = actual.field(actual.root, key)
    if (id === undefined) throw new Error('Missing key')
    expect(actual.scalar(id)).toBe('value')
    const input = packValue({ [key]: 'value' }, limits.bytes)
    expect(() =>
      finish(PackedArena.openSteps(input, { ...limits, staging: actual.stagingBytes - 1 })),
    ).toThrow('staging')
  })

  it.each(['unstarted', 'started', 'throw'] as const)(
    'revokes %s work without scanning the remaining input',
    (phase) => {
      const payload = packValue('x'.repeat(1000000), limits.bytes)
      const work = PackedArena.openSteps(payload, limits)
      const decode = vi.spyOn(TextDecoder.prototype, 'decode')
      try {
        if (phase !== 'unstarted') expect(work.next().done).toBe(false)
        const calls = decode.mock.calls.length
        if (phase === 'throw') expect(() => work.throw(new Error('stop'))).toThrow('stop')
        else expect(work.return()).toEqual({ done: true, value: undefined })
        expect(work.next()).toEqual({ done: true, value: undefined })
        expect(work.return()).toEqual({ done: true, value: undefined })
        expect(decode.mock.calls.length).toBe(calls)
        expect(calls).toBeLessThanOrEqual(1)
      } finally {
        decode.mockRestore()
        work.return()
      }
    },
  )

  it('never publishes a partial arena for late malformed strings, references or trailing bytes', () => {
    const text = new Uint8Array(packValue('x'.repeat(100000), limits.bytes))
    text[text.length - 2] = 120
    const references = new Uint8Array([77, 83, 80, 50, 0, 0, 2, 0, 6, 2, 0, 1, 1])
    const encoded = new Uint8Array(packValue(['valid'], limits.bytes))
    const trailing = new Uint8Array(encoded.length + 1)
    trailing.set(encoded)
    for (const input of [text.buffer, references.buffer, trailing.buffer]) {
      const work = PackedArena.openSteps(input, limits)
      expect(input.byteLength).toBe(0)
      expect(() => finish(work)).toThrow()
      expect(work.next()).toEqual({ done: true, value: undefined })
    }
  })

  it('rejects every truncation and invalid limit; limit rejection precedes ownership transfer', () => {
    const encoded = packValue({ a: [1, '世界'] }, limits.bytes)
    for (let length = 0; length < encoded.byteLength; length++) {
      const payload = encoded.slice(0, length)
      expect(() => finish(PackedArena.openSteps(payload, limits))).toThrow()
    }
    for (const key of ['bytes', 'retained', 'staging'] as const) {
      const payload = encoded.slice(0)
      expect(() => PackedArena.openSteps(payload, { ...limits, [key]: -1 })).toThrow('limits')
      expect(payload.byteLength).toBe(encoded.byteLength)
    }
    const expected = PackedArena.open(encoded.slice(0), limits)
    for (const key of ['retained', 'staging'] as const) {
      const payload = encoded.slice(0)
      const value = key === 'retained' ? expected.retainedBytes : expected.stagingBytes
      expect(() => finish(PackedArena.openSteps(payload, { ...limits, [key]: value - 1 }))).toThrow(
        'limit',
      )
    }
    const actual = finish(
      PackedArena.openSteps(encoded, {
        bytes: encoded.byteLength,
        retained: expected.retainedBytes,
        staging: expected.stagingBytes,
      }),
    )
    equal(actual, expected)
  })
})
