import { describe, expect, it } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { createPackedSequenceEncoding, packValue, unpackValue } from '../../src/packing'
import { PackedArrayInput } from '../../src/packing-input-array'
import { PackedCaptureInput } from '../../src/packing-input-capture'
import type { PackedSequence } from '../../src/packing-sequence'
import { PackedSession } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'
import { finishPackedSteps } from '../../src/packing-work'

const MiB = 1024 * 1024
const encoding = { working: 32 * MiB, nodes: 800000, depth: 512 }
const byteLimit = 8 * MiB
const decode = (packet: ArrayBuffer) =>
  unpackValue(packet, { bytes: byteLimit, retained: 32 * MiB, staging: 8 * MiB }).value
const until = (sequence: PackedSequence, boundary: number) => {
  for (let i = 0; i < 1000000; i++) {
    const step = sequence.work.next()
    if (step.done) throw new Error('Unexpected sequence completion')
    if (sequence.boundary === boundary) return
  }
  throw new Error('Sequence did not reach boundary')
}
function encode(values: unknown[], budget = encoding) {
  const keys = values.map((_, index) => `part${index}`)
  const sequence = createPackedSequenceEncoding(keys, byteLimit, budget)
  try {
    for (let index = 0; index < values.length; index++) {
      sequence.supply(values[index])
      if (index + 1 < values.length) until(sequence, index)
    }
    return finishPackedSteps(sequence.work)
  } finally {
    sequence.close()
  }
}
function fixture(value: unknown) {
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'sequence',
      revision: 0,
      sourceHash: sourceHash(''),
      parserVersion: 'test',
      rendererVersion: 'test',
      options: 'test',
    },
    '',
  )
  const owner = new PackedSession({
    bytes: byteLimit,
    retained: 16 * MiB,
    staging: 8 * MiB,
    readers: 64,
    captures: 8,
  })
  const capture = finishPackedSteps(
    owner.stageFullSteps(owner.beginPrepared(source), packValue(value, byteLimit)),
  )
  if (!capture) throw new Error('Missing capture')
  return { owner, capture }
}

describe('resumable canonical sibling encoding', () => {
  it.each(
    [
      ['second', '0'],
      ['2', '1'],
      ['01', '1'],
      ['4294967295', '4294967294'],
      new Array<string>(1),
    ].map((keys) => ({ keys })),
  )('rejects keys that cannot be consumed in declared order: $keys', ({ keys }) => {
    expect(() => createPackedSequenceEncoding(keys, byteLimit, encoding)).toThrow(
      'Invalid packed sequence keys',
    )
  })

  it.each(
    [
      ['0', '2', '10', '4294967294', 'part'],
      ['00', '01', '1e0', '-0', '4294967295', '__proto__', 'constructor'],
      ['2', '4', '__proto__', 'toString', 'constructor', ''],
    ].map((keys) => ({ keys })),
  )('preserves canonical numeric and own property keys: $keys', ({ keys }) => {
    const values = keys.map((_, index) => ({ value: index }))
    const sequence = createPackedSequenceEncoding(keys, byteLimit, encoding)
    try {
      for (let index = 0; index < values.length; index++) {
        sequence.supply(values[index])
        until(sequence, index)
        expect(decode(finishPackedSteps(sequence.copy()) as ArrayBuffer)).toEqual(values[index])
      }
      const expected = Object.fromEntries(keys.map((key, index) => [key, values[index]]))
      const packet = finishPackedSteps(sequence.work)
      expect(packet).toEqual(packValue(expected, byteLimit, encoding))
      expect(decode(packet as ArrayBuffer)).toEqual(expected)
    } finally {
      sequence.close()
    }
  })

  it('retains all bytes, positions, scalar aliases and every individual UTF-16 unit', () => {
    const position = {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 8, column: 4, offset: 73 },
    }
    const units = Array.from({ length: 65536 }, (_, index) => String.fromCharCode(index))
    const document = {
      units,
      position,
      values: [null, false, true, -0, 0, -2, 0.5, 0xffffffff, 0x100000000],
    }
    const projection = { units, position, html: '\ud800😀\udfff'.repeat(2000) }
    const values = [document, projection, { position }]
    expect(encode(values)).toEqual(
      packValue({ part0: document, part1: projection, part2: values[2] }, byteLimit, encoding),
    )
  })

  it('copies independent complete checkpoints and resumes after shape tag width changes', () => {
    const first = Array.from({ length: 150 }, (_, index) => ({ [`shape-${index}`]: index }))
    const second = Array.from({ length: 4300 }, (_, value) => ({ value }))
    const sequence = createPackedSequenceEncoding(['first', 'second', 'third'], byteLimit, encoding)
    sequence.supply(first)
    until(sequence, 0)
    const checkpoint = finishPackedSteps(sequence.copy())
    expect(decode(checkpoint as ArrayBuffer)).toEqual(first)
    const saved = new Uint8Array(checkpoint as ArrayBuffer).slice()
    expect(() => sequence.copy()).toThrow('checkpoint unavailable')
    sequence.supply(second)
    until(sequence, 1)
    expect(decode(finishPackedSteps(sequence.copy()) as ArrayBuffer)).toEqual(second)
    sequence.supply(first)
    expect(finishPackedSteps(sequence.work)).toEqual(
      packValue({ first, second, third: first }, byteLimit, encoding),
    )
    expect(new Uint8Array(checkpoint as ArrayBuffer)).toEqual(saved)
    expect(() => sequence.copy()).toThrow('closed')
  })

  it('transfers streamed inputs once at each boundary', () => {
    let pulls = 0
    const stream = new PackedArrayInput(
      (function* () {
        pulls++
        yield 1
        yield { a: 'text' }
      })(),
    )
    const sequence = createPackedSequenceEncoding(['one', 'two'], byteLimit, encoding)
    sequence.supply({ items: stream }, [stream])
    until(sequence, 0)
    sequence.supply({ items: stream })
    expect(finishPackedSteps(sequence.work)).toEqual(
      packValue(
        { one: { items: [1, { a: 'text' }] }, two: { items: [1, { a: 'text' }] } },
        byteLimit,
        encoding,
      ),
    )
    expect(pulls).toBe(1)
  })

  it('shares emitted native strings with captured strings and subsequent native aliases', () => {
    const text = 'escaped "\\\u0000\ud800😀\udfff'.repeat(1000)
    const fresh = 'new 😀'.repeat(1000)
    const { owner, capture } = fixture({ text, fresh })
    const input = new PackedCaptureInput(capture, true)
    const sequence = createPackedSequenceEncoding(
      ['native', 'captured', 'later'],
      byteLimit,
      encoding,
    )
    try {
      sequence.supply({ text })
      until(sequence, 0)
      sequence.supply(input.at(), [], [input])
      until(sequence, 1)
      sequence.supply({ fresh, text })
      expect(finishPackedSteps(sequence.work)).toEqual(
        packValue(
          { native: { text }, captured: { text, fresh }, later: { fresh, text } },
          byteLimit,
          encoding,
        ),
      )
    } finally {
      sequence.close()
      input.return()
      capture.release()
      owner.dispose()
    }
    expect(owner.stats.retainedBytes).toBe(0)
  })

  it.each(['queued', 'native', 'boundary', 'copy', 'admission'] as const)(
    'revokes a held %s transaction and unopened inputs',
    (phase) => {
      let closed = false
      const stream = new PackedArrayInput(
        (function* () {
          try {
            yield 'x'.repeat(20000)
            while (true) yield 1
          } finally {
            closed = true
          }
        })(),
      )
      const sequence = createPackedSequenceEncoding(['first', 'second'], byteLimit, encoding)
      sequence.supply(phase === 'queued' || phase === 'native' ? stream : ['x'.repeat(20000)], [
        stream,
      ])
      let copy: ReturnType<PackedSequence['copy']> | undefined
      if (phase === 'native') for (let i = 0; i < 10; i++) sequence.work.next()
      else if (phase !== 'queued') {
        until(sequence, 0)
        if (phase === 'copy' || phase === 'admission') {
          copy = sequence.copy(phase === 'admission' ? () => sequence.close() : undefined)
          if (phase === 'copy') copy.next()
          else expect(finishPackedSteps(copy)).toBeUndefined()
        }
      }
      sequence.close()
      expect(sequence.work.next()).toEqual({ done: true, value: undefined })
      expect(copy?.next().value).toBeUndefined()
      expect(() => sequence.supply(null)).toThrow('closed')
      if (phase === 'native') expect(closed).toBe(true)
    },
  )

  it.each(['source', 'owner'] as const)(
    'checks captured %s revocation before the next advance',
    (kind) => {
      const { owner, capture } = fixture({ text: 'x'.repeat(20000) })
      const input = new PackedCaptureInput(capture, true)
      const sequence = createPackedSequenceEncoding(['native', 'captured'], byteLimit, encoding)
      sequence.supply('x')
      until(sequence, 0)
      sequence.supply(input.at(), [], [input])
      sequence.work.next()
      if (kind === 'source') input.return()
      else owner.dispose()
      expect(() => sequence.work.next()).toThrow(/released|cancelled|disposed/)
      expect(sequence.work.next().value).toBeUndefined()
      input.return()
      capture.release()
      owner.dispose()
    },
  )

  it('preserves an unknown checkpoint admission failure', () => {
    const failure = Object.freeze({ unknown: 'admission' })
    const sequence = createPackedSequenceEncoding(['one', 'two'], byteLimit, encoding)
    sequence.supply('x'.repeat(20000))
    until(sequence, 0)
    expect(() =>
      finishPackedSteps(
        sequence.copy(() => {
          throw failure
        }),
      ),
    ).toThrow(failure)
    sequence.close()
  })

  it.each(['nodes', 'depth', 'working'] as const)(
    'applies the aggregate %s limit across sibling boundaries',
    (kind) => {
      const limits = {
        ...encoding,
        ...(kind === 'nodes'
          ? { nodes: 9 }
          : kind === 'depth'
            ? { depth: 2 }
            : { working: 400000 }),
      }
      const value = kind === 'working' ? ['x'.repeat(100000)] : [{ value: 1 }, { value: 2 }]
      expect(() => encode([value, structuredClone(value)], limits)).toThrow(
        /node\/depth|working limit/,
      )
    },
  )

  it('rejects a premature advance and clears all later input capability', () => {
    const sequence = createPackedSequenceEncoding(['one', 'two'], byteLimit, encoding)
    sequence.supply(1)
    expect(() => sequence.supply(2)).toThrow('not waiting')
    until(sequence, 0)
    expect(() => sequence.work.next()).toThrow('without input')
    expect(() => sequence.supply(2)).toThrow('closed')
  })
})
