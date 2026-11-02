import { messageSize, semanticLimits } from '@manuslip/core'
import { expect, it, vi } from 'vitest'
import {
  PackedSourceJsonLimitError,
  packedSourceSteps,
} from '../../../../../../../packages/core/src/packing-source'
import { finishPackedSteps } from '../../../../../../../packages/core/src/packing-work'
import { capturePackedRequest } from '../../../../../src/renderer/src/semantics/packed-request-source'
import { type ParseRequest, parseRequest } from '../../../../../src/renderer/src/semantics/protocol'

const input = (source: string): ParseRequest => ({
  kind: 'parse',
  sequence: 1,
  generation: 1,
  documentId: 'json\0"界\ud800',
  revision: 2,
  source,
  options: {
    rawHtml: false,
    footnotesLabel: '"\0界\ud800'.repeat(30),
    footnoteBackLabel: '\\😀\t'.repeat(30),
  },
  sentAt: 0.25,
})
const identity = {
  generation: 1,
  documentId: 'json',
  revision: 2,
  parserVersion: 'parser',
  rendererVersion: 'renderer',
  options: '{}',
}

it('sizes only bounded metadata before the source scan starts', () => {
  const text = '\0'.repeat(semanticLimits.previewBytes),
    request = input(text),
    stringify = JSON.stringify
  const spy = vi.spyOn(JSON, 'stringify').mockImplementation((value) => {
    if (value && typeof value === 'object' && 'source' in value && value.source === text)
      throw new Error('whole source was stringified')
    return stringify(value)
  })
  try {
    const capture = capturePackedRequest(request)
    expect(capture.request.source).toBe(text)
    expect(Object.isFrozen(capture.request)).toBe(true)
    expect(Object.isFrozen(capture.request.options)).toBe(true)
    const work = packedSourceSteps(identity, text, capture.jsonByteLimit)
    expect(() => finishPackedSteps(work)).toThrow(PackedSourceJsonLimitError)
  } finally {
    spy.mockRestore()
  }
})

it.each(['x', '界😀\ud800\udfff\0"\\', `${'x'.repeat(4095)}😀`])(
  'includes escaped labels, IDs, envelope numbers and source quotes in case %#',
  (text) => {
    const request = input(text),
      capture = capturePackedRequest(request)
    const sourceBytes = new TextEncoder().encode(JSON.stringify(text)).byteLength
    expect(semanticLimits.messageBytes - capture.jsonByteLimit + sourceBytes).toBe(
      messageSize(request),
    )
    expect(finishPackedSteps(packedSourceSteps(identity, text, capture.jsonByteLimit))?.text).toBe(
      text,
    )
  },
)

it('accepts exactly eight MiB of request JSON and rejects the next byte during scanning', () => {
  const request = input(''),
    capture = capturePackedRequest(request),
    content = capture.jsonByteLimit - 2
  request.source = `${'\0'.repeat(Math.floor(content / 6))}${'x'.repeat(content % 6)}`
  expect(messageSize(request)).toBe(semanticLimits.messageBytes)
  expect(new TextEncoder().encode(request.source).byteLength).toBeLessThan(
    semanticLimits.previewBytes,
  )
  const exact = capturePackedRequest(request)
  expect(
    finishPackedSteps(packedSourceSteps(identity, exact.request.source, exact.jsonByteLimit))?.text,
  ).toBe(request.source)
  request.source += 'x'
  expect(messageSize(request)).toBe(semanticLimits.messageBytes + 1)
  expect(() => parseRequest(request)).toThrow('Invalid semantic request')
  const over = capturePackedRequest(request),
    work = packedSourceSteps(identity, over.request.source, over.jsonByteLimit)
  expect(() => finishPackedSteps(work)).toThrow(PackedSourceJsonLimitError)
  expect(work.next()).toEqual({ done: true, value: undefined })
})

it('preserves legacy unknown-property sizing while the internal channel requires exact fields', () => {
  const small = { ...input('x'), extra: 'legacy field' }
  expect(parseRequest(small)).toBe(small)
  expect(() => capturePackedRequest(small)).toThrow('wire fields')
  const large = { ...small, extra: 'x'.repeat(semanticLimits.messageBytes) }
  expect(() => parseRequest(large)).toThrow('Invalid semantic request')
})

it('validates metadata before JSON sizing and captures the same immutable option values', () => {
  const request = input('text'),
    capture = capturePackedRequest(request)
  request.options.footnotesLabel = 'mutated'
  request.source = 'mutated'
  expect(capture.request.source).toBe('text')
  expect(capture.request.options.footnotesLabel).not.toBe('mutated')
  expect(() => capturePackedRequest({ ...request, sentAt: Number.NaN })).toThrow(
    'Invalid semantic request',
  )
  expect(() => capturePackedRequest({ ...request, source: 1 })).toThrow('Invalid semantic request')
})
