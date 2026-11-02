import { describe, expect, it } from 'vitest'
import { PackedReader, PackedWriter } from '../../src/packing-bytes'
import {
  PackedStringScanner,
  packedStringChunkUnits,
  packedStringWorkspace,
} from '../../src/packing-string'

function encodedString(text: string | Uint8Array): ArrayBuffer {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text
  const writer = new PackedWriter(bytes.length + 8)
  writer.uint(bytes.length)
  for (const byte of bytes) writer.byte(byte)
  return writer.finish()
}

describe('bounded packed byte batches', () => {
  it.each([0, 1, 65535, 65536, 65537])(
    'copies independent input across chunk boundaries after %s prefix bytes',
    (prefix) => {
      const allocations: number[][] = [[], []]
      const actual = new PackedWriter(1024 * 1024, (bytes) => allocations[0]?.push(bytes))
      const oracle = new PackedWriter(1024 * 1024, (bytes) => allocations[1]?.push(bytes))
      for (let at = 0; at < prefix; at++) {
        actual.byte(at)
        oracle.byte(at)
      }
      const storage = Uint8Array.from({ length: 131097 }, (_, at) => (at * 71) % 256)
      const input = storage.subarray(11, storage.length - 9)
      for (const byte of input) oracle.byte(byte)
      actual.writeBytes(input)
      expect(actual.length).toBe(oracle.length)
      expect(allocations[0]).toEqual(allocations[1])
      input.fill(0)
      expect(actual.finish()).toEqual(oracle.finish())
      expect(allocations[0]).toEqual(allocations[1])
    },
  )

  it.each([0, 1, 65535, 65536, 65537, 131072])(
    'preserves byte admission and the accepted prefix at a %s-byte limit',
    (limit) => {
      const allocations: number[][] = [[], []]
      const actual = new PackedWriter(limit, (bytes) => allocations[0]?.push(bytes))
      const oracle = new PackedWriter(limit, (bytes) => allocations[1]?.push(bytes))
      const input = Uint8Array.from({ length: limit + 17 }, (_, at) => at % 256)
      expect(() => actual.writeBytes(input)).toThrow('byte limit')
      expect(() => {
        for (const byte of input) oracle.byte(byte)
      }).toThrow('byte limit')
      expect(actual.length).toBe(limit)
      expect(allocations[0]).toEqual(allocations[1])
      expect(actual.finish()).toEqual(oracle.finish())
    },
  )

  it('admits each new chunk before copying into it and leaves denied storage unallocated', () => {
    const allocations: number[][] = [[], []]
    const writers = allocations.map(
      (admitted) =>
        new PackedWriter(1024 * 1024, (bytes) => {
          admitted.push(bytes)
          if (admitted.length === 2) throw new Error('denied next chunk')
        }),
    )
    const actual = writers[0]
    const oracle = writers[1]
    if (!actual || !oracle) throw new Error('Missing byte writers')
    const input = Uint8Array.from({ length: 131073 }, (_, at) => at % 256)
    expect(() => actual.writeBytes(input)).toThrow('denied next chunk')
    expect(() => {
      for (const byte of input) oracle.byte(byte)
    }).toThrow('denied next chunk')
    expect(actual.length).toBe(65536)
    expect(allocations[0]).toEqual(allocations[1])
    expect(actual.finish()).toEqual(oracle.finish())
  })

  it('compares exact emitted ranges across chunks without changing the writer', () => {
    const writer = new PackedWriter(1024 * 1024)
    const input = Uint8Array.from({ length: 196619 }, (_, at) => (at * 17) % 256)
    for (const byte of input) writer.byte(byte)
    for (const from of [0, 1, 65535, 65536, 65537]) {
      const bytes = input.slice(from, from + 131073)
      expect(writer.matchesBytes(from, bytes)).toBe(true)
      for (const at of [0, 65535, bytes.length - 1]) {
        bytes[at] = (bytes[at] ?? 0) ^ 1
        expect(writer.matchesBytes(from, bytes)).toBe(false)
        bytes[at] = (bytes[at] ?? 0) ^ 1
      }
    }
    expect(writer.matchesBytes(writer.length, new Uint8Array())).toBe(true)
    for (const offset of [-1, 0.5, NaN, Infinity, writer.length + 1])
      expect(() => writer.matchesBytes(offset, new Uint8Array())).toThrow('writer offset')
    expect(() => writer.matchesBytes(writer.length, new Uint8Array([0]))).toThrow('writer offset')
    expect(writer.finish()).toEqual(input.buffer)
  })
})

describe('reusable packed reader cursors', () => {
  it('validates seeks without changing a failed cursor or an independent fork', () => {
    const writer = new PackedWriter(64)
    writer.uint(0xffffffff)
    const second = 5 // The full uint32 boundary occupies five wire bytes.
    writer.uint(128)
    const payload = writer.finish()
    const reader = new PackedReader(payload)
    const fork = new PackedReader(reader, second)
    expect(reader.uint()).toBe(0xffffffff)
    for (const offset of [
      -1,
      NaN,
      Infinity,
      0.5,
      Number.MAX_SAFE_INTEGER,
      payload.byteLength + 1,
    ]) {
      expect(() => reader.seek(offset)).toThrow('Invalid packed offset')
      expect(reader.position).toBe(second)
    }
    reader.seek(0)
    expect(fork.uint()).toBe(128)
    expect(reader.uint()).toBe(0xffffffff)
    reader.seek(payload.byteLength)
    expect(reader.remaining).toBe(0)
    reader.seek(second)
    expect(reader.uint()).toBe(128)
    reader.seek(0)
    expect(reader.uint()).toBe(0xffffffff)
  })
})

describe('chunked validation of large packed JSON strings', () => {
  it('matches native JSON for every small batch size, including split escapes and padding', () => {
    const inputs = [
      '  ""\t\r\n',
      '"\\u005c\\u0022\\u0000\\uD800\\uDC00\\uDfff\\/\\b\\f\\n\\r\\t"',
      JSON.stringify('界😀\u2028\u2029"\\\n followed by literal text'),
      `\t${JSON.stringify('"\\'.repeat(100))}\r\n`,
    ]
    for (const input of inputs) {
      const expected: string = JSON.parse(input)
      for (let size = 1; size <= 16; size++) {
        const scanner = new PackedStringScanner()
        const countOnly = new PackedStringScanner()
        let actual = ''
        for (let at = 0; at < input.length; at += size) {
          const batch = input.slice(at, at + size)
          actual += scanner.consume(batch, true) ?? ''
          expect(countOnly.consume(batch)).toBeUndefined()
          // Empty decoder progress must preserve a partially read escape.
          expect(scanner.consume('', true)).toBeUndefined()
          countOnly.consume('')
        }
        scanner.complete()
        countOnly.complete()
        expect(actual).toBe(expected)
        expect(scanner.length).toBe(expected.length)
        expect(countOnly.length).toBe(expected.length)
      }
    }
  })

  it('rejects all literal JSON control units and invalid Unicode digits at batch boundaries', () => {
    const invalid = [
      ...Array.from({ length: 32 }, (_, unit) => `"prefix${String.fromCharCode(unit)}suffix"`),
      ...['g', 'G', '/', ':', '@', '`', '界'].map((digit) => `"\\u12${digit}4"`),
      '"\\x00"',
      '"\\u123"',
      '"\\u1234" false',
      '\u00a0"text"',
      '"text"\u2028',
    ]
    for (const input of invalid) {
      expect(() => JSON.parse(input)).toThrow()
      for (const size of [1, 2, 3, 5, 8])
        for (const materialize of [false, true])
          expect(() => {
            const scanner = new PackedStringScanner()
            for (let at = 0; at < input.length; at += size)
              scanner.consume(input.slice(at, at + size), materialize)
            scanner.complete()
          }).toThrow()
    }
  })

  it('yields progress for every bounded lexical batch, including long JSON padding', () => {
    const input = `${' '.repeat(100000)}"value"${' '.repeat(100000)}`
    const reader = new PackedReader(encodedString(input))
    const steps = reader.stringSteps(packedStringWorkspace)
    let emitted = ''
    let count = 0
    while (true) {
      const before = reader.position
      const step = steps.next()
      expect(reader.position - before).toBeLessThanOrEqual(4101)
      if (step.done) break
      if (step.value !== undefined) emitted += step.value
      count++
    }
    expect(emitted).toBe('value')
    expect(count).toBe(Math.ceil(new TextEncoder().encode(input).byteLength / 4096))
    expect(reader.remaining).toBe(0)
    const cancelled = new PackedReader(encodedString(input))
    const work = cancelled.stringSteps(packedStringWorkspace)
    expect(work.next()).toEqual({ done: false, value: undefined })
    const position = cancelled.position
    work.return(undefined)
    expect(cancelled.position).toBe(position)
    expect(position).toBeLessThan(4102)
  })
  it('retains every UTF-16 code unit through JSON escaping and bounded output chunks', () => {
    const value = Array.from({ length: 65536 }, (_, unit) => String.fromCharCode(unit)).join('')
    const payload = encodedString(JSON.stringify(value))
    expect(new PackedReader(payload).indexedString(65536).length).toBe(value.length)
    const chunks = [...new PackedReader(payload).stringChunks(packedStringWorkspace)]
    expect(chunks.join('')).toBe(value)
    expect(chunks.every((chunk) => chunk.length <= packedStringChunkUnits)).toBe(true)
  })

  it.each(Array.from({ length: 14 }, (_, index) => 4088 + index))(
    'preserves UTF-8, UTF-16 and JSON escape state around chunk boundary %s',
    (prefix) => {
      const value = `${'a'.repeat(prefix)}😀界\ud800\udfff\n"\\\t/\b\f\r${'z'.repeat(4100)}`
      const payload = encodedString(JSON.stringify(value))
      const reader = new PackedReader(payload)
      const indexed = reader.indexedString(65536)
      expect(indexed.value).toBeUndefined()
      expect(indexed.length).toBe(value.length)
      expect(indexed.encodedBytes).toBe(payload.byteLength - 2)
      expect(indexed.workspace).toBeLessThanOrEqual(65536)
      expect(reader.remaining).toBe(0)
      expect(new PackedReader(payload).string()).toBe(value)
      const chunks = [...new PackedReader(payload).stringChunks(packedStringWorkspace)]
      expect(chunks.every((chunk) => chunk.length <= packedStringChunkUnits)).toBe(true)
      expect(chunks.join('')).toBe(value)
    },
  )

  it('validates long padding, empty strings and escaped slash/Unicode without retaining text', () => {
    for (const text of [
      `${' '.repeat(5000)}""\t\r\n`,
      `"${'a'.repeat(4093)}\\uD800\\uDC00\\/end"`,
      `"${'界'.repeat(4093)}😀"`,
    ]) {
      const expected: string = JSON.parse(text)
      const result = new PackedReader(encodedString(text)).indexedString(65536)
      expect(result.value).toBeUndefined()
      expect(result.length).toBe(expected.length)
      expect(
        [...new PackedReader(encodedString(text)).stringChunks(packedStringWorkspace)].join(''),
      ).toBe(expected)
    }
    expect(new PackedReader(encodedString('""')).indexedString(65536).value).toBe('')
  })

  it.each([
    `"${'a'.repeat(5000)}`,
    `"${'a'.repeat(5000)}"x`,
    `"${'a'.repeat(4094)}\\vrest"`,
    `"${'a'.repeat(4094)}\\u12"`,
    `"${'a'.repeat(4094)}\\u12X4rest"`,
    `"${'a'.repeat(4094)}\nrest"`,
    `"${'a'.repeat(4094)}\\`,
  ])('rejects malformed JSON strings across chunks %#', (text) => {
    expect(() => JSON.parse(text)).toThrow()
    expect(() => new PackedReader(encodedString(text)).indexedString(65536)).toThrow()
    expect(() => [
      ...new PackedReader(encodedString(text)).stringChunks(packedStringWorkspace),
    ]).toThrow()
  })

  it('rejects valid JSON that is not a string', () => {
    const text = `${' '.repeat(5000)}null`
    expect(JSON.parse(text)).toBeNull()
    expect(() => new PackedReader(encodedString(text)).indexedString(65536)).toThrow('string')
    expect(() => [
      ...new PackedReader(encodedString(text)).stringChunks(packedStringWorkspace),
    ]).toThrow('string')
  })

  it.each([[255], [0xc0, 0x80], [0xed, 0xa0, 0x80], [0xf0, 0x9f, 0x98]])(
    'rejects invalid or truncated UTF-8 after valid preceding chunks: %s',
    (...invalid) => {
      const prefix = new TextEncoder().encode(`"${'a'.repeat(5000)}`)
      const bytes = new Uint8Array(prefix.length + invalid.length + 1)
      bytes.set(prefix)
      bytes.set(invalid, prefix.length)
      bytes[bytes.length - 1] = 34
      expect(() => new PackedReader(encodedString(bytes)).indexedString(65536)).toThrow()
      expect(() => [
        ...new PackedReader(encodedString(bytes)).stringChunks(packedStringWorkspace),
      ]).toThrow()
    },
  )

  it('checks workspace before decoding and rejects truncated declared strings', () => {
    const payload = encodedString(`"${'a'.repeat(10000)}"`)
    expect(() => new PackedReader(payload).indexedString(32768)).toThrow('workspace')
    expect(() => new PackedReader(payload).string(32768)).toThrow('workspace')
    expect(() => new PackedReader(payload.slice(0, -1)).indexedString(65536)).toThrow('Truncated')
    const reader = new PackedReader(payload)
    expect(new PackedReader(reader).indexedString(65536).length).toBe(10000)
    expect(reader.position).toBe(0)
  })

  it('preflights chunk workspace, handles supplementary carry, and completes an independent reader', () => {
    const value = `${'x'.repeat(4092)}😀${'a'.repeat(10000)}`
    const payload = encodedString(JSON.stringify(value))
    expect(() => [...new PackedReader(payload).stringChunks(packedStringWorkspace - 1)]).toThrow(
      'workspace',
    )
    for (const invalid of [-1, NaN, Infinity, 0.5])
      expect(() => [...new PackedReader(payload).stringChunks(invalid)]).toThrow('workspace')
    expect(() => [
      ...new PackedReader(payload.slice(0, -1)).stringChunks(packedStringWorkspace),
    ]).toThrow('Truncated')
    const parent = new PackedReader(payload)
    const reader = new PackedReader(parent)
    const chunks = [...reader.stringChunks(packedStringWorkspace)]
    expect(chunks.join('')).toBe(value)
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBe(4097)
    expect(reader.remaining).toBe(0)
    expect(parent.position).toBe(0)
  })
})
