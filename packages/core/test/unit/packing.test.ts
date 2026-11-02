import { describe, expect, it } from 'vitest'
import { packValue, unpackValue } from '../../src/packing'
import { parseMarkdown } from '../../src/parse'
import examples from '../fixtures/commonmark-0.31.2/spec.json'

const limits = { bytes: 8 * 1024 * 1024, retained: 32 * 1024 * 1024, staging: 8 * 1024 * 1024 }
const roundTrip = (value: unknown) => unpackValue(packValue(value, limits.bytes), limits)

describe('experimental lossless semantic value packing', () => {
  for (const example of examples)
    it(`retains the entire position-bearing CommonMark root ${example.example}`, () => {
      const root = parseMarkdown(example.markdown).root
      expect(roundTrip(root).value).toEqual(root)
    })

  it.each([
    '---\ntitle: 世界\n---\n\n# 😀\n\n- [x] Task\n\n| A | B |\n| - | - |\n| **bold** | $x$ |\n',
    'Read [link][ref] and note[^one].\n\n[ref]: https://example.invalid/\n\n[^one]: Footnote body\n',
    '> > > nested **prose** with `code`.\n\n```mermaid\ngraph TD; A-->B\n```\n\n$$\nx^2\n$$\n',
    '\ufeff# heading\r\n\r\nraw \ud800 \udfff and 😀\r\n',
    '+++\ntitle = "TOML"\n+++\n\n![alt][r]\n\n[r]: relative.png "title"\n\n<div>unsafe</div>\n',
  ])('retains all full-document descriptors and extension data: %s', (source) => {
    const document = parseMarkdown(source)
    expect(roundTrip(document).value).toEqual(document)
  })

  it('shares equal records immutably while preserving source values and special keys', () => {
    const value = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":"safe","items":[{"line":1,"column":2,"offset":1},{"line":1,"column":2,"offset":1}],"text":"\\ud800"}',
    )
    const result = roundTrip(value).value as typeof value
    expect(result).toEqual(value)
    expect(result.items[0]).toBe(result.items[1])
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.items)).toBe(true)
    expect(Object.isFrozen(result.items[0])).toBe(true)
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Reflect.get({}, 'polluted')).toBeUndefined()
    expect(() => {
      result.items[0].line = 3
    }).toThrow()
    // A native cross-realm clone remains value-equivalent and safely mutable by consumers.
    const clone = structuredClone(result)
    clone.items[0].line = 3
    expect(result.items[0].line).toBe(1)
  })

  it('handles finite JSON scalars, shared objects and deeply nested values without recursion', () => {
    expect(roundTrip([null, false, true, 0, -1, 0.5, 0xffffffff, 0x100000000, '']).value).toEqual([
      null,
      false,
      true,
      0,
      -1,
      0.5,
      0xffffffff,
      0x100000000,
      '',
    ])
    let value: unknown = 'end'
    for (let index = 0; index < 20000; index++) value = { child: value }
    let decoded = roundTrip(value).value
    for (let index = 0; index < 20000; index++) decoded = (decoded as { child: unknown }).child
    expect(decoded).toBe('end')
    expect(Object.is(roundTrip(-0).value, -0)).toBe(true)
    expect(roundTrip([0, -0]).value).toEqual([0, -0])
    const shared = { text: 'same' }
    expect(roundTrip({ a: shared, b: shared }).value).toEqual({ a: shared, b: shared })
  })

  it('rejects non-JSON values and cycles instead of dropping semantics', () => {
    for (const value of [undefined, NaN, Infinity, 1n, Symbol(), () => {}, new Date(), [undefined]])
      expect(() => packValue(value, limits.bytes)).toThrow('Non-JSON')
    const value: { self?: unknown } = {}
    value.self = value
    expect(() => packValue(value, limits.bytes)).toThrow('Cyclic')
  })

  it('enforces real bytes and decoded accounting, including tiny encodings that expand', () => {
    const value = {
      positions: Array.from({ length: 1000 }, (_, offset) => ({
        line: 1,
        column: offset + 1,
        offset,
      })),
    }
    const encoded = packValue(value, limits.bytes)
    expect(() => packValue(value, 32)).toThrow('byte limit')
    expect(() => unpackValue(encoded, { ...limits, bytes: encoded.byteLength - 1 })).toThrow()
    expect(() => unpackValue(encoded, { ...limits, retained: 64 })).toThrow('retained limit')
    expect(() => unpackValue(encoded, { ...limits, staging: 64 })).toThrow('staging limit')
    const decoded = unpackValue(encoded, limits)
    expect(decoded.retainedBytes).toBeGreaterThan(encoded.byteLength)
    expect(decoded.value).toEqual(value)
    expect(
      unpackValue(encoded, {
        bytes: encoded.byteLength,
        retained: decoded.retainedBytes,
        staging: decoded.stagingBytes,
      }).value,
    ).toEqual(value)
    expect(() => unpackValue(encoded, { ...limits, retained: decoded.retainedBytes - 1 })).toThrow(
      'retained',
    )
    expect(() => unpackValue(encoded, { ...limits, staging: decoded.stagingBytes - 1 })).toThrow(
      'staging',
    )
  })

  it('rejects truncation at every boundary and any appended data', () => {
    const encoded = new Uint8Array(packValue({ a: [true, 1.25, '世界'] }, limits.bytes))
    for (let end = 0; end < encoded.length; end++)
      expect(() => unpackValue(encoded.slice(0, end).buffer, limits)).toThrow()
    const appended = new Uint8Array(encoded.length + 1)
    appended.set(encoded)
    expect(() => unpackValue(appended.buffer, limits)).toThrow('trailing')
  })

  it('preserves enumerable lazy positions through serialization, cloning and repacking', () => {
    const original = parseMarkdown('# Heading\n\nA paragraph with **text**.\n')
    const decoded = roundTrip(original).value as typeof original
    const node = decoded.root.children[1]
    if (!node) throw new Error('Missing node')
    expect(Object.getOwnPropertyDescriptor(node, 'position')?.get).toBeTypeOf('function')
    expect(Object.keys(node)).toEqual(Object.keys(original.root.children[1] ?? {}))
    expect(node.position).toEqual(original.root.children[1]?.position)
    expect(node.position).not.toBe(node.position)
    expect(Object.isFrozen(node.position)).toBe(true)
    expect(Object.isFrozen(node.position?.start)).toBe(true)
    // Reflection cannot retrieve and mutate the shared coordinate buffer.
    expect(Reflect.ownKeys(Object.getPrototypeOf(node))).toEqual([])
    for (const symbol of Object.getOwnPropertySymbols(node))
      expect(typeof Reflect.get(node, symbol)).toBe('number')
    expect(JSON.parse(JSON.stringify(decoded))).toEqual(JSON.parse(JSON.stringify(original)))
    expect(structuredClone(decoded)).toEqual(original)
    expect(roundTrip(decoded).value).toEqual(original)
    const standalone = original.root.position
    expect(roundTrip([standalone, { other: standalone }]).value).toEqual([
      standalone,
      { other: standalone },
    ])
  })

  it('includes temporary JSON text in staging and admits the output before full decoding', () => {
    const encoded = packValue('x'.repeat(20000), limits.bytes)
    expect(() => unpackValue(encoded, { ...limits, retained: 1024 })).toThrow('retained')
    expect(() => unpackValue(encoded, { ...limits, staging: 32768 })).toThrow('workspace')
    const decoded = unpackValue(encoded, limits)
    expect(decoded.stagingBytes).toBeGreaterThan(40000)
    expect(unpackValue(encoded, { ...limits, staging: decoded.stagingBytes }).value).toBe(
      decoded.value,
    )
    expect(() => unpackValue(encoded, { ...limits, staging: decoded.stagingBytes - 1 })).toThrow(
      'staging',
    )
  })

  it.each([NaN, -1, Infinity, 0.5])('rejects invalid numeric budgets: %s', (limit) => {
    const encoded = packValue('test', limits.bytes)
    for (const key of ['bytes', 'retained', 'staging'])
      expect(() => unpackValue(encoded, { ...limits, [key]: limit })).toThrow('limits')
  })

  it.each([
    [77, 83, 80, 51], // Unknown version.
    [77, 83, 80, 50, 128, 0], // Overlong shape count.
    [77, 83, 80, 50, 255, 255, 255, 255, 31], // Overflow.
    [77, 83, 80, 50, 0, 0, 1, 6, 1, 0, 0], // Forward/self reference.
    [77, 83, 80, 50, 0, 0, 1, 8, 0], // Unknown shape.
    [77, 83, 80, 50, 0, 0, 1, 5, 1, 255, 0], // Invalid UTF-8 string.
    [77, 83, 80, 50, 1, 2, 3, 34, 97, 34, 3, 34, 97, 34], // Duplicate shape key.
    [77, 83, 80, 50, 0, 1, 7, 0, 0, 0, 0, 0, 0, 0, 0], // Missing declared position.
    [77, 83, 80, 50, 0, 0, 1, 7, 1, 1, 0, 1, 1, 0, 0], // Undeclared position.
  ])('rejects malformed tables, integers, references and text: %s', (...bytes) => {
    expect(() => unpackValue(new Uint8Array(bytes).buffer, limits)).toThrow()
  })
})
