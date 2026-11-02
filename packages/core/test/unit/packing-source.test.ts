import { expect, it, vi } from 'vitest'
import { semanticLimits, sourceHash } from '../../src/contracts'
import { PackedSession } from '../../src/packing-session'
import {
  isPackedSource,
  PackedSource,
  packedSourceCharacters,
  packedSourceSteps,
} from '../../src/packing-source'
import { finishPackedSteps } from '../../src/packing-work'

const metadata = {
  generation: 1,
  documentId: 'source',
  revision: 2,
  parserVersion: 'parser',
  rendererVersion: 'renderer',
  options: '{}',
}

it.each([0, 4095, 4096, 4097, 8192, 8193, 16385])(
  'captures an authentic exact source in bounded advances for %i units',
  (length) => {
    const text = length
      ? `${'x'.repeat(length - Math.min(5, length))}${'😀\ud800x\udfff'.slice(-Math.min(5, length))}`
      : ''
    const expected = new PackedSource({ ...metadata, sourceHash: sourceHash(text) }, text)
    const work = packedSourceSteps(metadata, text)
    expect(work.retainedBytes).toBeGreaterThan(expected.retainedBytes)
    expect(Object.isFrozen(work)).toBe(true)
    const original = String.prototype.charCodeAt
    const indices: number[] = []
    const observed = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (
      this: string,
      index: number,
    ) {
      if (this === text) indices.push(index)
      return original.call(this, index)
    })
    let pauses = 0
    try {
      while (true) {
        const before = indices.length
        const next = work.next()
        expect(indices.length - before).toBeLessThanOrEqual(4096)
        if (next.done) {
          expect(next.value).toEqual(expected)
          expect(isPackedSource(next.value)).toBe(true)
          expect(next.value).toBeInstanceOf(PackedSource)
          expect(Object.isFrozen(next.value)).toBe(true)
          expect(Object.isFrozen(next.value?.identity)).toBe(true)
          expect(packedSourceCharacters(next.value as PackedSource)).toBe(Array.from(text).length)
          break
        }
        expect(indices.length - before).toBe(4096)
        pauses++
      }
      expect(indices).toEqual(Array.from({ length }, (_, index) => index))
      expect(pauses).toBe(Math.floor(length / 4096))
    } finally {
      work.return()
      observed.mockRestore()
    }
  },
)

it.each([
  '',
  'plain ASCII',
  'e\u0301 👩‍👩‍👧‍👧 🇸🇬 中文 العربية',
  '\ud800\ud800\udfff\udfff\ud800x\udfff',
  `${'x'.repeat(4095)}😀\ud800x\udfff`,
  `${'x'.repeat(4096)}\ud800\udfff\ud800`,
  `${'x'.repeat(8191)}😀\udfff`,
])('reuses the exact local code-point count without rereading source in case %#', (text) => {
  const expected = Array.from(text).length
  const synchronous = new PackedSource({ ...metadata, sourceHash: sourceHash(text) }, text)
  const cooperative = finishPackedSteps(packedSourceSteps(metadata, text))
  if (!cooperative) throw new Error('Missing prepared source')
  const original = String.prototype.charCodeAt
  let reads = 0
  const observed = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (
    this: string,
    index: number,
  ) {
    if (this === text) reads++
    return original.call(this, index)
  })
  try {
    for (const source of [synchronous, cooperative]) {
      expect(packedSourceCharacters(source)).toBe(expected)
      expect(packedSourceCharacters(source)).toBe(expected)
      expect(Object.keys(source)).not.toContain('characters')
    }
    expect(reads).toBe(0)
  } finally {
    observed.mockRestore()
  }
})

it.each([
  'x'.repeat(semanticLimits.previewBytes),
  `${'界'.repeat(Math.floor(semanticLimits.previewBytes / 3))}xx`,
  '😀'.repeat(semanticLimits.previewBytes / 4),
  `${'x'.repeat(4095)}😀${'\ud800x\udfff'.repeat(1000)}`,
])('keeps TextEncoder byte spelling and the existing exact cap in case %#', (text) => {
  expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(semanticLimits.previewBytes)
  const source = finishPackedSteps(packedSourceSteps(metadata, text))
  expect(source?.identity.sourceHash).toBe(sourceHash(text))
  expect(source?.text).toBe(text)
})

it.each([
  `${'界'.repeat(Math.floor(semanticLimits.previewBytes / 3))}xxx`,
  `${'😀'.repeat(semanticLimits.previewBytes / 4)}\ud800`,
])('rejects the first UTF-8 unit above the cap without publishing a source', (text) => {
  expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(semanticLimits.previewBytes)
  const work = packedSourceSteps(metadata, text)
  expect(() => finishPackedSteps(work)).toThrow('Invalid packed revision identity')
  expect(work.next()).toEqual({ done: true, value: undefined })
  expect(() => new PackedSource({ ...metadata, sourceHash: sourceHash(text) }, text)).toThrow(
    'identity',
  )
})

it('captures mutable metadata and reads each getter only once before yielding', () => {
  const values = { ...metadata }
  let reads = 0
  const input = Object.fromEntries(
    Object.keys(values).map((key) => [key, undefined]),
  ) as unknown as typeof metadata
  for (const key of Object.keys(values) as (keyof typeof values)[])
    Object.defineProperty(input, key, {
      get() {
        reads++
        return values[key]
      },
    })
  const work = packedSourceSteps(input, 'source')
  expect(reads).toBe(6)
  values.documentId = 'mutated'
  values.options = 'mutated'
  const result = finishPackedSteps(work)
  expect(reads).toBe(6)
  expect(result?.identity).toEqual({ ...metadata, sourceHash: sourceHash('source') })
})

it('brands the exact immutable identity that the synchronous constructor validated', () => {
  let reads = 0
  const hash = sourceHash('source')
  const result = new PackedSource(
    {
      ...metadata,
      get sourceHash() {
        return ++reads === 1 ? hash : 'foreign'
      },
    },
    'source',
  )
  expect(reads).toBe(1)
  expect(result.identity.sourceHash).toBe(hash)
  expect(isPackedSource(result)).toBe(true)
})

it.each(['before', 'suspended', 'throw'] as const)('revokes source scans cancelled %s', (phase) => {
  const text = 'x'.repeat(8193)
  const work = packedSourceSteps(metadata, text)
  if (phase !== 'before') expect(work.next()).toEqual({ done: false, value: undefined })
  if (phase === 'throw') {
    const failure = new Error('cancel source preparation')
    expect(() => work.throw(failure)).toThrow(failure)
  } else work.return()
  expect(work.next()).toEqual({ done: true, value: undefined })
})

it('closes after a read fails between scan batches', () => {
  const text = 'x'.repeat(8193)
  const work = packedSourceSteps(metadata, text)
  const original = String.prototype.charCodeAt
  const failure = new Error('source preparation read failed')
  const observed = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (
    this: string,
    index: number,
  ) {
    if (this === text && index === 4096) throw failure
    return original.call(this, index)
  })
  try {
    expect(work.next()).toEqual({ done: false, value: undefined })
    expect(() => work.next()).toThrow(failure)
    expect(work.next()).toEqual({ done: true, value: undefined })
  } finally {
    work.return()
    observed.mockRestore()
  }
})

it.each([
  { ...metadata, generation: -1 },
  { ...metadata, revision: Number.NaN },
  { ...metadata, documentId: '' },
  { ...metadata, parserVersion: 'x'.repeat(257) },
  { ...metadata, rendererVersion: '' },
  { ...metadata, options: 'x'.repeat(4097) },
])('rejects invalid metadata before queuing source work', (identity) => {
  expect(() => packedSourceSteps(identity, 'source')).toThrow('identity')
})

it('keeps the immediate source length guard and rejects forged, cloned and proxy capabilities', () => {
  expect(() => packedSourceSteps(metadata, 'x'.repeat(semanticLimits.previewBytes + 1))).toThrow(
    'identity',
  )
  const source = new PackedSource({ ...metadata, sourceHash: sourceHash('source') }, 'source')
  const forged = Object.assign(Object.create(PackedSource.prototype), source) as PackedSource
  expect(forged).toBeInstanceOf(PackedSource)
  for (const value of [forged, structuredClone(source), new Proxy(source, {})]) {
    expect(isPackedSource(value)).toBe(false)
    expect(() => packedSourceCharacters(value)).toThrow('Invalid prepared packed source')
  }
  const session = new PackedSession({
    bytes: 8 * 1024 * 1024,
    retained: 16 * 1024 * 1024,
    staging: 8 * 1024 * 1024,
    captures: 8,
    readers: 64,
  })
  try {
    session.beginPrepared(source)
    expect(() => session.beginPrepared(forged)).toThrow('Invalid prepared packed source')
    expect(session.stats.requested).toEqual(source.identity)
  } finally {
    session.dispose()
  }
})
