import { describe, expect, it } from 'vitest'
import { bufferProjectionChunks } from '../../src/projection-chunk-buffer'

function* parts(values: readonly (string | undefined)[]) {
  yield* values
}
function output(values: readonly (string | undefined)[]): string[] {
  return [...bufferProjectionChunks(parts(values))].filter((value) => value !== undefined)
}
function expectComplete(values: readonly (string | undefined)[]) {
  const chunks = output(values)
  expect(chunks.join('')).toBe(values.join(''))
  for (const [index, chunk] of chunks.entries()) {
    expect(chunk.length).toBeGreaterThan(0)
    expect(chunk.length).toBeLessThanOrEqual(4097)
    const left = chunk.charCodeAt(chunk.length - 1)
    const right = chunks[index + 1]?.charCodeAt(0) ?? 0
    expect(left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff).toBe(false)
  }
}

describe('bounded projection chunk collection', () => {
  it('preserves exact UTF-16, empty values and upstream progress without publishing partial buffers', () => {
    let crossed = false
    const stream = bufferProjectionChunks(
      (function* () {
        yield '<p>'
        yield
        crossed = true
        yield '界😀&amp;\ud800'
        yield '</p>'
      })(),
    )
    expect(stream.next()).toEqual({ done: false, value: undefined })
    expect(crossed).toBe(false)
    expect(stream.next()).toEqual({ done: false, value: undefined })
    expect(crossed).toBe(false)
    expect([...stream].filter((value) => value !== undefined)).toEqual(['<p>界😀&amp;\ud800</p>'])
    expect(stream.next().done).toBe(true)
    expectComplete(['', undefined, 'a', '', '\ud800', undefined, '\udc00', '\udc00'])
  })
  it.each([
    [`${'x'.repeat(4095)}\ud800`, '\udc00tail', 'last'],
    [`${'x'.repeat(4095)}\ud800`, undefined, `\udc00${'y'.repeat(4095)}`],
    ['x'.repeat(4096), 'y'.repeat(4096)],
    [...Array<string>(255).fill('a'), '\ud800', undefined, '\udc00', 'tail'],
    ['\ud800', 'x'.repeat(4096), '\udc00'],
  ])('preserves surrogate boundaries and piece limits for %#', (...values) => {
    expectComplete(values)
  })
  it('bounds input advances even when every piece is empty or only closes an ancestor', () => {
    for (const value of ['', '</blockquote>']) {
      let reads = 0
      const stream = bufferProjectionChunks(
        (function* () {
          for (let index = 0; index < 1000; index++) {
            reads++
            yield value
          }
        })(),
      )
      while (true) {
        const before = reads
        const next = stream.next()
        expect(reads - before).toBeLessThanOrEqual(1)
        if (next.done) break
      }
      expect(reads).toBe(1000)
    }
  })
  it('preserves the lexical batch boundary when adjacent input pieces fill a chunk', () => {
    let units = 0
    const chunks: string[] = []
    const stream = bufferProjectionChunks(
      (function* () {
        for (let index = 0; index < 8; index++) {
          units += 4096
          yield 'x'.repeat(4096)
        }
      })(),
    )
    while (true) {
      const before = units
      const next = stream.next()
      expect(units - before).toBeLessThanOrEqual(4096)
      if (next.done) break
      if (next.value !== undefined) chunks.push(next.value)
    }
    expect(chunks.join('')).toBe('x'.repeat(8 * 4096))
  })
  it.each(['return', 'throw', 'oversize'] as const)(
    'closes its input on %s with text pending',
    (action) => {
      let closed = false
      const stream = bufferProjectionChunks(
        (function* () {
          try {
            yield 'private partial HTML'
            yield
            if (action === 'throw') throw new Error('upstream failure')
            yield 'x'.repeat(4097)
          } finally {
            closed = true
          }
        })(),
      )
      expect(stream.next()).toEqual({ done: false, value: undefined })
      expect(stream.next()).toEqual({ done: false, value: undefined })
      if (action === 'return') stream.return(undefined)
      else
        expect(() => stream.next()).toThrow(action === 'throw' ? 'upstream failure' : 'chunk limit')
      expect(closed).toBe(true)
      expect(stream.next().done).toBe(true)
    },
  )
})
