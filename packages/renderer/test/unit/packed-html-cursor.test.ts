import { describe, expect, it } from 'vitest'
import { PackedTextSteps } from '../../../core/src/packing-capture'
import { PackedHtmlCursor } from '../../src/packed-html-cursor'

function cursor(chunks: readonly (string | undefined)[]) {
  const events: string[] = []
  const stream = new PackedTextSteps(
    (function* () {
      try {
        for (const chunk of chunks) {
          events.push('read')
          yield chunk
        }
      } finally {
        events.push('finally')
      }
    })(),
    () => events.push('close'),
  )
  return { value: new PackedHtmlCursor(stream), events }
}

function finish(work: Generator<void>): number {
  let yields = 0
  while (!work.next().done) yields++
  return yields
}

describe('exact forward HTML comparisons', () => {
  const text = '<p>中文 עברית e\u0301 😀\ud800\udfff &amp;</p>'
  const long = `${'x'.repeat(4097)}😀${'y'.repeat(4097)}`

  it.each([1, 2, 7, 4098])('compares native text across %i-unit stream boundaries', (size) => {
    const chunks = Array.from({ length: Math.ceil(text.length / size) }, (_, index) =>
      text.slice(index * size, (index + 1) * size),
    )
    const { value, events } = cursor([undefined, '', ...chunks])
    expect(finish(value.equal(text))).toBe(2 + chunks.length * 2)
    expect(value.position).toBe(text.length)
    finish(value.finish(text.length))
    expect(events.slice(-2)).toEqual(['finally', 'close'])
    value.close()
    expect(events.filter((event) => event === 'close')).toHaveLength(1)
  })

  it.each([false, true])('compares two streams after different prefixes (native: %s)', (native) => {
    const left = cursor(['xx', undefined, text.slice(0, 13), text.slice(13), 'tail'])
    const right = cursor(['y', text.slice(0, 3), '', text.slice(3, 19), text.slice(19), 'tail'])
    finish(left.value.skip(2))
    finish(right.value.skip(1))
    if (native) finish(left.value.equal(text))
    else finish(left.value.equalCursor(right.value, text.length))
    expect(left.value.position).toBe(2 + text.length)
    if (!native) expect(right.value.position).toBe(1 + text.length)
    finish(left.value.equal('tail'))
    finish(left.value.finish(6 + text.length))
    left.value.close()
    right.value.close()
    expect(left.events.filter((event) => event === 'close')).toHaveLength(1)
    expect(right.events.filter((event) => event === 'close')).toHaveLength(1)
  })

  it.each([false, true])('rejects an exact code-unit mismatch (native: %s)', (native) => {
    const left = cursor(['prefix', '😀 e\u0301\ud800'])
    const right = cursor(['😀 e\u0301\ud801'])
    finish(left.value.skip(6))
    expect(() =>
      finish(
        native ? left.value.equal('😀 e\u0301\ud801') : left.value.equalCursor(right.value, 6),
      ),
    ).toThrow('Invalid packed')
    // The failing span never advances either cursor or reads any following chunk.
    expect(left.value.position).toBe(6)
    expect(right.value.position).toBe(0)
    left.value.close()
    right.value.close()
  })

  it.each([false, true])(
    'compares full decoder chunks with a split surrogate (native: %s)',
    (native) => {
      const left = cursor([long.slice(0, 4098), undefined, long.slice(4098)])
      const right = cursor([long.slice(0, 1), long.slice(1, 4099), long.slice(4099)])
      finish(native ? left.value.equal(long) : left.value.equalCursor(right.value, long.length))
      expect(left.value.position).toBe(long.length)
      finish(left.value.finish(long.length))
      if (!native) {
        expect(right.value.position).toBe(long.length)
        finish(right.value.finish(long.length))
      }
      left.value.close()
      right.value.close()
    },
  )

  it.each([false, true])(
    'rejects corruption at the end of a full decoder chunk (native: %s)',
    (native) => {
      const changed = `${long.slice(0, -1)}z`
      const left = cursor([long.slice(0, 4098), long.slice(4098)])
      const right = cursor([changed.slice(0, 4098), changed.slice(4098)])
      expect(() =>
        finish(
          native ? left.value.equal(changed) : left.value.equalCursor(right.value, long.length),
        ),
      ).toThrow('Invalid packed')
      expect(left.value.position).toBe(4098)
      expect(right.value.position).toBe(native ? 0 : 4098)
      left.value.close()
      right.value.close()
    },
  )

  it('compares only the requested prefix before different trailing content', () => {
    const left = cursor(['same-left'])
    const right = cursor(['same-right'])
    finish(left.value.equalCursor(right.value, 4))
    expect(left.value.position).toBe(4)
    expect(right.value.position).toBe(4)
    expect(() => finish(left.value.equalCursor(right.value, 5))).toThrow('Invalid packed')
    expect(left.value.position).toBe(4)
    expect(right.value.position).toBe(4)
    left.value.close()
    right.value.close()
  })
})
