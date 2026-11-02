import { parserVersion, semanticLimits, sourceHash } from '@manuslip/core'
import { rendererVersion } from '@manuslip/renderer'
import { expect, it, vi } from 'vitest'
import { isPackedSource } from '../../../../../../../packages/core/src/packing-source'
import { newPackedToken } from '../../../../../../../packages/core/src/packing-token'
import { packedWireVersion } from '../../../../../../../packages/core/src/packing-wire'
import { finishPackedSteps } from '../../../../../../../packages/core/src/packing-work'
import {
  isPreparedProducerSource,
  producerSourceSteps,
} from '../../../../../src/renderer/src/semantics/packed-producer-source'

function request(text: string) {
  const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
  const input = {
    kind: 'parse',
    sequence: 1,
    generation: 2,
    documentId: 'source',
    revision: 3,
    source: text,
    options,
    sentAt: 0,
  }
  const exchange = {
    protocol: packedWireVersion,
    kind: 'request',
    sequence: 1,
    requestToken: newPackedToken(),
    base: null,
    identity: {
      generation: 2,
      documentId: 'source',
      revision: 3,
      sourceHash: sourceHash(text),
      parserVersion: `${parserVersion}/manuslip`,
      rendererVersion,
      options: JSON.stringify(options),
    },
  }
  return { input, exchange }
}

it.each([0, 4095, 4096, 4097, 8193])(
  'independently prepares %i source units in bounded reads',
  (length) => {
    const text = 'a'.repeat(length),
      pair = request(text),
      original = String.prototype.charCodeAt
    let reads = 0
    const spy = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (
      this: string,
      index,
    ) {
      if (this === text) reads++
      return original.call(this, index)
    })
    try {
      const work = producerSourceSteps(pair.input, pair.exchange)
      expect(reads).toBe(0)
      let pauses = 0
      while (true) {
        const before = reads,
          next = work.next()
        expect(reads - before).toBeLessThanOrEqual(4096)
        if (next.done) {
          const result = next.value
          expect(result).toBeDefined()
          if (!result) throw new Error('Missing prepared source')
          expect(isPreparedProducerSource(result)).toBe(true)
          expect(isPackedSource(result.source)).toBe(true)
          expect(result.source.text).toBe(text)
          expect(result.source.identity).toEqual(pair.exchange.identity)
          for (const value of [
            result,
            result.request,
            result.request.options,
            result.checked,
            result.checked.value,
          ])
            expect(Object.isFrozen(value)).toBe(true)
          expect(work.retainedBytes).toBeGreaterThan(
            result.source.retainedBytes + result.checked.retainedBytes,
          )
          expect(isPreparedProducerSource({ ...result })).toBe(false)
          expect(isPreparedProducerSource(new Proxy(result, {}))).toBe(false)
          expect(isPreparedProducerSource(structuredClone(result))).toBe(false)
          break
        }
        pauses++
      }
      expect(pauses).toBe(Math.floor(length / 4096))
      expect(reads).toBe(length)
      expect(work.next()).toEqual({ done: true, value: undefined })
    } finally {
      spy.mockRestore()
    }
  },
)

it('snapshots request, options, exchange identity and base before yielding', () => {
  const pair = request('a'.repeat(5000)),
    exchange = {
      ...pair.exchange,
      base: {
        identity: { ...pair.exchange.identity, revision: 2 },
        token: newPackedToken(),
      },
    },
    expected = structuredClone({ input: pair.input, exchange })
  const work = producerSourceSteps(pair.input, exchange)
  work.next()
  pair.input.source = 'changed'
  pair.input.options.rawHtml = true
  exchange.identity.sourceHash = 'wrong'
  exchange.sequence = 99
  exchange.base.identity.revision = 99
  const result = finishPackedSteps(work)
  expect(result?.request).toEqual(expected.input)
  expect(result?.checked.value).toEqual(expected.exchange)
})

it.each(['before', 'suspended', 'throw'] as const)(
  'closes a held source preparation handle %s work',
  (phase) => {
    const pair = request('a'.repeat(9000)),
      work = producerSourceSteps(pair.input, pair.exchange)
    if (phase !== 'before') work.next()
    if (phase === 'throw') expect(() => work.throw(new Error('stop'))).toThrow('stop')
    else work.return()
    expect(work.next()).toEqual({ done: true, value: undefined })
    expect(Object.isFrozen(work)).toBe(true)
  },
)

it('rejects a claimed digest only after independently scanning the complete source', () => {
  const pair = request('x'.repeat(9000))
  pair.exchange.identity.sourceHash = 'claimed:wrong'
  const work = producerSourceSteps(pair.input, pair.exchange)
  expect(work.next().done).toBe(false)
  expect(() => finishPackedSteps(work)).toThrow('source mismatch')
  expect(work.next()).toEqual({ done: true, value: undefined })
})

it('enforces the Worker byte cap even when its claimed digest matches', () => {
  const pair = request('界'.repeat(Math.floor(semanticLimits.previewBytes / 3) + 1))
  const work = producerSourceSteps(pair.input, pair.exchange)
  expect(work.next().done).toBe(false)
  expect(() => finishPackedSteps(work)).toThrow('Invalid packed revision identity')
  expect(work.next()).toEqual({ done: true, value: undefined })
})

it.each([
  'sequence',
  'generation',
  'revision',
  'documentId',
  'parserVersion',
  'rendererVersion',
  'options',
] as const)('rejects mismatched %s metadata immediately', (key) => {
  const pair = request('x')
  if (key === 'sequence') pair.exchange.sequence++
  else if (key === 'generation' || key === 'revision') pair.exchange.identity[key]++
  else pair.exchange.identity[key] += 'changed'
  expect(() => producerSourceSteps(pair.input, pair.exchange)).toThrow(/mismatch/)
})

it.each(['request', 'options'] as const)(
  'rejects accessor %s fields without calling them',
  (target) => {
    const pair = request('x'),
      getter = vi.fn(() => 'x')
    if (target === 'request')
      Object.defineProperty(pair.input, 'source', { get: getter, enumerable: true })
    else
      Object.defineProperty(pair.input.options, 'footnotesLabel', { get: getter, enumerable: true })
    expect(() => producerSourceSteps(pair.input, pair.exchange)).toThrow('data property')
    expect(getter).not.toHaveBeenCalled()
  },
)

it('captures known data values without invoking proxy reads or accepting unknown fields', () => {
  const pair = request('x'),
    get = vi.fn(() => {
      throw new Error('read trap')
    })
  const result = finishPackedSteps(
    producerSourceSteps(new Proxy(pair.input, { get }), pair.exchange),
  )
  expect(result?.request.source).toBe('x')
  expect(get).not.toHaveBeenCalled()
  expect(() => producerSourceSteps({ ...pair.input, extra: 'ignored?' }, pair.exchange)).toThrow(
    'wire fields',
  )
})

it('keeps the exact JSON request byte cap in the independently scheduled source scan', () => {
  const pair = request('\0'.repeat(semanticLimits.previewBytes))
  const work = producerSourceSteps(pair.input, pair.exchange)
  expect(() => finishPackedSteps(work)).toThrow('JSON limit')
  expect(work.next()).toEqual({ done: true, value: undefined })
})
