import { expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import {
  isPackedSource,
  PackedSourceJsonLimitError,
  packedSourceSteps,
} from '../../src/packing-source'
import { finishPackedSteps } from '../../src/packing-work'

const identity = {
  generation: 1,
  documentId: 'json-source',
  revision: 0,
  parserVersion: 'parser',
  rendererVersion: 'renderer',
  options: '{}',
}
const jsonBytes = (text: string) => new TextEncoder().encode(JSON.stringify(text)).byteLength

it.each([
  '',
  'plain ASCII',
  '"\\/\b\t\n\f\r',
  Array.from({ length: 32 }, (_, unit) => String.fromCharCode(unit)).join(''),
  '界é\u007f\u0080\u07ff\u0800\uffff\u2028\u2029',
  '😀',
  '\ud800',
  '\udfff',
  '\ud800\ud800\udfff\udfff',
  `${'x'.repeat(4094)}😀x`,
  `${'x'.repeat(4095)}😀`,
  `${'x'.repeat(4095)}\ud800`,
  `${'x'.repeat(4095)}\ud800x`,
  `${'x'.repeat(8191)}\ud800\ud800\udfff`,
])('matches native JSON spelling exactly, including checkpoint carry, in case %#', (text) => {
  const limit = jsonBytes(text)
  const value = finishPackedSteps(packedSourceSteps(identity, text, limit))
  expect(value?.text).toBe(text)
  expect(value?.identity.sourceHash).toBe(sourceHash(text))
  expect(isPackedSource(value)).toBe(true)
  if (limit > 2) {
    const work = packedSourceSteps(identity, text, limit - 1)
    expect(() => finishPackedSteps(work)).toThrow(PackedSourceJsonLimitError)
    expect(work.next()).toEqual({ done: true, value: undefined })
  }
})

it('checks every UTF-16 unit against the independent native JSON oracle', () => {
  const text = Array.from({ length: 65536 }, (_, unit) => String.fromCharCode(unit)).join('x')
  const bytes = jsonBytes(text)
  expect(finishPackedSteps(packedSourceSteps(identity, text, bytes))?.text).toBe(text)
  expect(() => finishPackedSteps(packedSourceSteps(identity, text, bytes - 1))).toThrow(
    PackedSourceJsonLimitError,
  )
})

it('shares each bounded source read with UTF-8, digest and JSON sizing', () => {
  const text = `${'x'.repeat(4095)}😀${'\0界\ud800x'.repeat(1500)}`
  const bytes = jsonBytes(text),
    original = String.prototype.charCodeAt,
    work = packedSourceSteps(identity, text, bytes)
  let reads = 0
  const spy = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (
    this: string,
    index,
  ) {
    if (this === text) reads++
    return original.call(this, index)
  })
  try {
    expect(reads).toBe(0)
    while (true) {
      const before = reads,
        next = work.next()
      expect(reads - before).toBeLessThanOrEqual(4096)
      if (next.done) break
    }
    expect(reads).toBe(text.length)
  } finally {
    work.return()
    spy.mockRestore()
  }
})

it('does not reject a pending high surrogate before reading its following low surrogate', () => {
  const text = `${'x'.repeat(4095)}😀`
  const work = packedSourceSteps(identity, text, jsonBytes(text))
  expect(work.next()).toEqual({ done: false, value: undefined })
  expect(work.next().value?.text).toBe(text)
})

it.each([Number.NaN, -1, 1, 2.5, Number.NEGATIVE_INFINITY])(
  'rejects an invalid JSON budget %s before creating source work',
  (limit) => expect(() => packedSourceSteps(identity, 'x', limit)).toThrow('JSON limit'),
)
