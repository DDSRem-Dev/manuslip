import { describe, expect, it, vi } from 'vitest'
import { semanticLimits, sourceHash, utf8Bytes } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { type PackedIdentity, PackedSource } from '../../src/packing-source'
import { newPackedToken } from '../../src/packing-token'
import { packedEnvelopeBytes, packedWireVersion, readPackedWire } from '../../src/packing-wire'

const MiB = 1024 * 1024
const identity = (source = 'source', revision = 1): PackedIdentity => ({
  generation: 2,
  documentId: 'wire-tests',
  revision,
  sourceHash: sourceHash(source),
  parserVersion: 'parser',
  rendererVersion: 'renderer',
  options: 'options',
})
function fixture(kind: 'full' | 'delta' | 'resync' = 'full') {
  const result = identity()
  const requestToken = newPackedToken()
  const header = { protocol: packedWireVersion, sequence: 4, result, sentAt: 12, requestToken }
  const metadata = { cached: false, transportInMs: 0, serializeMs: 0.25 }
  const message =
    kind === 'resync'
      ? { ...header, kind, reason: 'unsupported' }
      : kind === 'full'
        ? {
            ...header,
            kind,
            payload: packValue({ text: 'exact 中文😀\ud800' }, MiB),
            metadata,
            resultToken: newPackedToken(),
          }
        : {
            ...header,
            kind,
            payload: packValue(2, MiB),
            metadata,
            base: identity('before', 0),
            baseToken: newPackedToken(),
            resultToken: newPackedToken(),
            operations: [{ kind: 'replace', path: ['value'], record: 0 }],
          }
  return {
    message,
    expected: { sequence: 4, result, requestToken },
    read(value: unknown = message) {
      return readPackedWire(value, { sequence: 4, result, requestToken })
    },
  }
}

describe('bounded packed response envelopes', () => {
  it('requires canonical independent request, result and delta base tokens', () => {
    const context = fixture('delta')
    for (const requestToken of [undefined, '', newPackedToken(), 'x'.repeat(100000)])
      expect(() => context.read({ ...context.message, requestToken })).toThrow()
    for (const resultToken of [undefined, context.expected.requestToken, '0'.repeat(36)])
      expect(() => context.read({ ...context.message, resultToken })).toThrow()
    if (!('resultToken' in context.message)) throw new Error('fixture')
    const resultToken = context.message.resultToken
    expect(() => context.read({ ...context.message, baseToken: resultToken })).toThrow('advance')
  })
  it.each(['full', 'delta', 'resync'] as const)(
    'accepts and freezes a request-bound %s envelope through real transfer',
    (kind) => {
      const context = fixture(kind)
      const original = context.message
      const transferred =
        'payload' in original
          ? structuredClone(original, { transfer: [original.payload] })
          : structuredClone(original)
      const checked = context.read(transferred)
      expect(checked.message).toEqual(transferred)
      if ('payload' in original) expect(original.payload.byteLength).toBe(0)
      const immutable = (value: unknown) => {
        if (!value || typeof value !== 'object' || value instanceof ArrayBuffer) return
        expect(Object.isFrozen(value)).toBe(true)
        for (const item of Object.values(value)) immutable(item)
      }
      immutable(checked.message)
      expect(checked.stagingBytes).toBeLessThanOrEqual(semanticLimits.messageBytes)
      expect(checked.envelopeBytes).toBe(
        utf8Bytes(JSON.stringify({ ...checked.message, payload: undefined })),
      )
      expect(checked.bytes).toBe(
        checked.envelopeBytes +
          1024 +
          ('payload' in checked.message ? checked.message.payload.byteLength : 0),
      )
    },
  )
  it('copies metadata and operation paths so mutations to the received object cannot alter normalized data', () => {
    const context = fixture('delta')
    const checked = context.read()
    const message = context.message
    if (!('operations' in message) || checked.message.kind !== 'delta') throw new Error('fixture')
    message.result.documentId = 'changed'
    message.metadata.cached = true
    message.operations[0]?.path.push('changed')
    expect(checked.message.result.documentId).toBe('wire-tests')
    expect(checked.message.metadata.cached).toBe(false)
    expect(checked.message.operations[0]?.path).toEqual(['value'])
  })
  it('rejects every request identity mismatch before decoding or consuming the binary payload', () => {
    const context = fixture()
    const decode = vi.spyOn(PackedArena, 'open')
    try {
      for (const key of Object.keys(context.expected.result) as (keyof PackedIdentity)[]) {
        const result = {
          ...context.expected.result,
          [key]: typeof context.expected.result[key] === 'number' ? 9 : 'wrong',
        }
        expect(() => context.read({ ...context.message, result })).toThrow('mismatch')
      }
      expect(() => context.read({ ...context.message, sequence: 5 })).toThrow('mismatch')
      expect(decode).not.toHaveBeenCalled()
      if ('payload' in context.message)
        expect(context.message.payload.byteLength).toBeGreaterThan(0)
    } finally {
      decode.mockRestore()
    }
  })
  it('enforces exact actual buffer plus canonical envelope/reserve limits', () => {
    const context = fixture()
    if (!('payload' in context.message)) throw new Error('fixture')
    const fixed = context.read().envelopeBytes + 1024
    const exact = new ArrayBuffer(semanticLimits.messageBytes - fixed)
    expect(context.read({ ...context.message, payload: exact }).bytes).toBe(
      semanticLimits.messageBytes,
    )
    expect(() =>
      context.read({ ...context.message, payload: new ArrayBuffer(exact.byteLength + 1) }),
    ).toThrow('limit')
    for (const payload of [
      new ArrayBuffer(0),
      new ArrayBuffer(3),
      new Uint8Array(10),
      new SharedArrayBuffer(10),
      null,
    ])
      expect(() => context.read({ ...context.message, payload })).toThrow('payload')
    expect(exact.byteLength).toBe(semanticLimits.messageBytes - fixed)
  })
  it('rejects extra, missing, non-data and prototype fields without invoking getters', () => {
    const context = fixture()
    const getter = vi.fn(() => 'full')
    const accessor = { ...context.message }
    Object.defineProperty(accessor, 'kind', { get: getter, enumerable: true })
    for (const value of [
      accessor,
      { ...context.message, extra: 'ignored' },
      Object.assign(Object.create({ custom: true }), context.message),
      { ...context.message, [Symbol('extra')]: 1 },
      { ...context.message, protocol: 'future' },
      { ...context.message, kind: 'other' },
      {
        ...context.message,
        metadata: { cached: false, transportInMs: 0, serializeMs: 0, extra: 0 },
      },
    ])
      expect(() => context.read(value)).toThrow()
    for (const key of Object.keys(context.message)) {
      const missing = { ...context.message } as Record<string, unknown>
      delete missing[key]
      expect(() => context.read(missing)).toThrow()
    }
    expect(getter).not.toHaveBeenCalled()
  })
  it('validates finite nonnegative times and integer sequence/identity values', () => {
    const context = fixture()
    for (const value of [-1, NaN, Infinity, '0', null]) {
      expect(() => context.read({ ...context.message, sentAt: value })).toThrow()
      expect(() => context.read({ ...context.message, sequence: value })).toThrow()
      for (const field of ['transportInMs', 'serializeMs'])
        expect(() =>
          context.read({
            ...context.message,
            metadata: { cached: true, transportInMs: 0, serializeMs: 0, [field]: value },
          }),
        ).toThrow()
    }
    expect(() => context.read({ ...context.message, sentAt: 0.5, sequence: 0.5 })).toThrow()
  })
  it('rejects malformed operations, sparse/accessor arrays and oversized normalization before publishing', () => {
    const context = fixture('delta')
    for (const operation of [
      { kind: 'unknown', path: [], record: 0 },
      { kind: 'replace', path: [], record: -1 },
      { kind: 'replace', path: Array(129).fill(0), record: 0 },
      { kind: 'replace', path: ['x'.repeat(1025)], record: 0 },
      { kind: 'replace', path: [null], record: 0 },
      { kind: 'replace', path: [0.5], record: 0 },
      { kind: 'replace', path: [], record: 0x100000000 },
      { kind: 'offset', path: [], start: 0, offset: NaN },
      { kind: 'range', path: [], start: 0, offset: 0x100000000 },
      { kind: 'splice', path: [], start: -1, remove: 0, record: 0 },
      { kind: 'text', path: [], start: 0, remove: 0.5, record: 0 },
      { kind: 'replace', path: [], record: 0, extra: 1 },
    ])
      expect(() => context.read({ ...context.message, operations: [operation] })).toThrow()
    const getter = vi.fn(() => 'path')
    const path = ['value']
    Object.defineProperty(path, 0, { get: getter, enumerable: true })
    for (const operations of [
      Array(1025).fill({ kind: 'replace', path: [], record: 0 }),
      Array(1),
      [{ kind: 'replace', path, record: 0 }],
      [{ kind: 'replace', path: Array(1), record: 0 }],
      Array(64).fill({ kind: 'replace', path: ['x'.repeat(1024)], record: 0 }),
      Array(1024).fill({ kind: 'replace', path: Array(128).fill(0), record: 0 }),
    ])
      expect(() => context.read({ ...context.message, operations })).toThrow()
    expect(getter).not.toHaveBeenCalled()
  })
  it('supports every operation and rejects delta revision or ownership changes', () => {
    const context = fixture('delta')
    const operations = [
      { kind: 'replace', path: ['__proto__', 0, ''], record: 0 },
      { kind: 'splice', path: [], start: 0, remove: 1, record: 2 },
      { kind: 'text', path: [], start: 1, remove: 2, record: 3 },
      { kind: 'offset', path: [], start: 0, offset: -3 },
      { kind: 'range', path: [], start: 1, offset: 4 },
    ]
    const checked = context.read({ ...context.message, operations })
    expect(checked.message.kind === 'delta' && checked.message.operations).toEqual(operations)
    for (const base of [
      identity('before', 1),
      { ...identity('before', 0), options: 'changed' },
      { ...identity('before', 0), generation: 3 },
    ])
      expect(() => context.read({ ...context.message, base })).toThrow('ownership')
    const resync = fixture('resync')
    expect(() => resync.read({ ...resync.message, reason: 'arbitrary' })).toThrow('reason')
  })
  it('bounds large Unicode/escape envelopes and preserves the full production options domain', () => {
    const options = JSON.stringify({
      rawHtml: false,
      footnotesLabel: '\u0000'.repeat(200),
      footnoteBackLabel: '\ud800'.repeat(200),
    })
    const source = new PackedSource({ ...identity(), options }, 'source')
    const context = fixture()
    const value = { ...context.message, result: source.identity }
    expect(
      readPackedWire(value, { ...context.expected, result: source.identity }).envelopeBytes,
    ).toBeLessThan(packedEnvelopeBytes)
    expect(() => new PackedSource({ ...identity(), options: 'x'.repeat(4097) }, 'source')).toThrow(
      'identity',
    )
    const delta = fixture('delta')
    expect(() =>
      delta.read({
        ...delta.message,
        operations: Array(20).fill({ kind: 'replace', path: ['\u0000'.repeat(1024)], record: 0 }),
      }),
    ).toThrow('limit')
  })
})
