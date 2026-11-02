import { describe, expect, it } from 'vitest'
import { messageSize, semanticLimits } from '../../src/contracts'
import { countCodePoints, utf8Bytes } from '../../src/text-count'

describe('source code-point counting', () => {
  it('matches the string iterator at every UTF-16 surrogate boundary in short sequences', () => {
    // Ordinary units, the units bordering each surrogate range, and both range endpoints.
    const units = [0, 13, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xffff]
    let samples = ['']
    for (let length = 0; length <= 4; length++) {
      for (const source of samples) expect(countCodePoints(source)).toBe(Array.from(source).length)
      if (length < 4)
        samples = samples.flatMap((source) =>
          units.map((unit) => source + String.fromCharCode(unit)),
        )
    }
  })
  it.each([
    '\ufeff# 中文 עברית ภาษาไทย\r\n\r\n😀 👨‍👩‍👧‍👦 🇸🇬 e\u0301\n',
    `leading\ud800${'x'.repeat(4094)}\udbff\udfff trailing\udc00`,
    'x'.repeat(semanticLimits.previewBytes),
    '𐐀'.repeat(semanticLimits.previewBytes / 4),
    '\udbff'.repeat(4096) + '\udc00'.repeat(4096),
  ])('preserves complete counts for Unicode and source-boundary inputs (%#)', (source) => {
    expect(countCodePoints(source)).toBe(Array.from(source).length)
  })
})

describe('UTF-8 byte counting without an encoded copy', () => {
  const encoder = new TextEncoder()
  it('matches every UTF-16 code unit and all short combinations at encoding boundaries', () => {
    for (let unit = 0; unit <= 0xffff; unit++) {
      const source = String.fromCharCode(unit)
      expect(utf8Bytes(source)).toBe(encoder.encode(source).byteLength)
    }
    const units = [0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000]
    let samples = ['']
    for (let length = 0; length <= 4; length++) {
      for (const source of samples)
        expect(utf8Bytes(source)).toBe(encoder.encode(source).byteLength)
      if (length < 4)
        samples = samples.flatMap((source) =>
          units.map((unit) => source + String.fromCharCode(unit)),
        )
    }
  })
  it.each([
    '\ufeff# 中文 עברית ภาษาไทย\r\n😀 👨‍👩‍👧‍👦 🇸🇬 e\u0301\u0000',
    'x'.repeat(semanticLimits.previewBytes),
    '𐐀'.repeat(semanticLimits.previewBytes / 4),
    '\ud800'.repeat(4096) + '\udfff'.repeat(4096),
  ])('matches complete Unicode and source-boundary strings (%#)', (source) => {
    expect(utf8Bytes(source)).toBe(encoder.encode(source).byteLength)
  })
  it('preserves the existing TextEncoder default and coercion behavior for untyped callers', () => {
    for (const value of [
      undefined,
      null,
      true,
      123,
      42n,
      new String('😀'),
      { toString: () => '界\ud800' },
    ])
      expect(utf8Bytes(value as string)).toBe(encoder.encode(value as string).byteLength)
    expect(() => utf8Bytes(Symbol('value') as unknown as string)).toThrow(TypeError)
    expect(() => encoder.encode(Symbol('value') as unknown as string)).toThrow(TypeError)
  })
  it('keeps JSON spelling, omitted values and stringify failures unchanged', () => {
    for (const value of [
      undefined,
      () => {},
      Symbol(),
      null,
      { value: '😀\ud800\n\u0000' },
      [undefined, '界'],
    ])
      expect(messageSize(value)).toBe(encoder.encode(JSON.stringify(value)).byteLength)
    expect(() => messageSize(1n)).toThrow(TypeError)
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(() => messageSize(cyclic)).toThrow(TypeError)
  })
})
