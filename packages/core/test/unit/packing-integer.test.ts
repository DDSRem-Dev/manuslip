import { describe, expect, it } from 'vitest'
import { PackedReader, PackedWriter } from '../../src/packing-bytes'

// Independent arithmetic spelling/decoder. It deliberately uses neither bitwise
// accumulation nor the production writer when constructing the primary test input.
function encode(value: number): number[] {
  const bytes: number[] = []
  do {
    const rest = Math.floor(value / 128)
    bytes.push((value % 128) + (rest ? 128 : 0))
    value = rest
  } while (value)
  return bytes
}
function reference(bytes: number[]) {
  let offset = 0,
    value = 0
  try {
    for (let shift = 0; shift < 35; shift += 7) {
      const byte = bytes[offset++]
      if (byte === undefined) throw new Error('Truncated packed value')
      if (shift === 28 && byte > 15) throw new Error('Invalid packed integer')
      value += (byte % 128) * 2 ** shift
      if (byte < 128) {
        if (shift && byte === 0) throw new Error('Noncanonical packed integer')
        return { value, offset }
      }
    }
    throw new Error('Invalid packed integer')
  } catch (error) {
    return { error: (error as Error).message, offset }
  }
}
function actual(bytes: number[]) {
  const reader = new PackedReader(new Uint8Array(bytes).buffer)
  try {
    return { value: reader.uint(), offset: reader.position }
  } catch (error) {
    return { error: (error as Error).message, offset: reader.position }
  }
}

describe('canonical unsigned packed integers', () => {
  it('round-trips every one/two-byte integer and every unsigned width/sign boundary', () => {
    const values = new Set(Array.from({ length: 16384 }, (_, value) => value))
    for (let bit = 0; bit <= 32; bit++)
      for (let delta = -2; delta <= 2; delta++) {
        const value = 2 ** bit + delta
        if (value >= 0 && value <= 0xffffffff) values.add(value)
      }
    for (const value of values) {
      const bytes = encode(value)
      const reader = new PackedReader(new Uint8Array([...bytes, 0x5a]).buffer)
      expect(reader.uint()).toBe(value)
      expect(reader.position).toBe(bytes.length)
      expect(reader.byte()).toBe(0x5a)
      const writer = new PackedWriter(5)
      writer.uint(value)
      expect([...new Uint8Array(writer.finish())]).toEqual(bytes)
    }
  })
  it('rejects every truncation and overlong-zero ending without consuming a following value', () => {
    for (const value of [
      0, 127, 128, 16383, 16384, 2097151, 2097152, 268435455, 268435456, 2147483647, 2147483648,
      4294967295,
    ]) {
      const bytes = encode(value)
      for (let end = 0; end < bytes.length; end++)
        expect(actual(bytes.slice(0, end))).toEqual(reference(bytes.slice(0, end)))
    }
    for (let length = 2; length <= 5; length++)
      for (const head of [0x80, 0x81, 0xff]) {
        const bytes = [head, ...Array.from({ length: length - 2 }, () => 0xff), 0, 0x5a]
        expect(actual(bytes)).toEqual({ error: 'Noncanonical packed integer', offset: length })
      }
  })
  it('rejects every overflowing fifth byte and preserves canonical fifth-byte values', () => {
    for (let last = 0; last < 256; last++) {
      const bytes = [0xff, 0xff, 0xff, 0xff, last, 0x5a]
      expect(actual(bytes)).toEqual(reference(bytes))
      const result = actual(bytes)
      if (last === 0) expect(result.error).toBe('Noncanonical packed integer')
      else if (last > 15) expect(result.error).toBe('Invalid packed integer')
      else expect(result.value).toBe(268435455 + last * 268435456)
      expect(result.offset).toBe(5)
    }
  })
  it('matches the arithmetic oracle for all two-byte prefixes and seeded arbitrary encodings', () => {
    for (let prefix = 0; prefix <= 0xffff; prefix++) {
      const bytes = [prefix % 256, Math.floor(prefix / 256), 0x81, 0x80, 0x0f, 0x5a]
      expect(actual(bytes)).toEqual(reference(bytes))
    }
    let seed = 0x6d736c70
    for (let trial = 0; trial < 20000; trial++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      expect(actual(encode(seed))).toEqual({ value: seed, offset: encode(seed).length })
      const bytes = []
      for (let index = 0; index < trial % 8; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        bytes.push(seed >>> 24)
      }
      expect(actual(bytes)).toEqual(reference(bytes))
    }
  })
  it('reads a mixed-width sequence and forked cursors at an offset independently', () => {
    const values = [0, 128, 2147483648, 4294967295, 127, 16384, 268435456]
    const bytes = [0x5a, ...values.flatMap(encode)]
    const reader = new PackedReader(new Uint8Array(bytes).buffer, 1)
    const fork = new PackedReader(reader, 1)
    for (const value of values) expect(reader.uint()).toBe(value)
    expect(reader.remaining).toBe(0)
    expect(fork.position).toBe(1)
    for (const value of values) expect(fork.uint()).toBe(value)
    expect(fork.remaining).toBe(0)
    expect(() => fork.uint()).toThrow('Truncated')
  })
})
