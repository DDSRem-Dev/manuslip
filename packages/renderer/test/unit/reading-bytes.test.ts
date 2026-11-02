import { expect, it } from 'vitest'
import { readingJsonBytes } from '../../src/reading-bytes'

const native = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length
it('matches native UTF-8 JSON sizing across all UTF-16 units, escapes and scalar forms', () => {
  for (let start = 0; start < 65536; start += 256) {
    const text = String.fromCharCode(...Array.from({ length: 256 }, (_, at) => start + at))
    const value = {
      [text]: [
        text,
        `界😀${text}\ud800\udfff`,
        null,
        true,
        false,
        1e30,
        -0,
        NaN,
        Infinity,
        undefined,
      ],
    }
    expect(readingJsonBytes(value)).toBe(native(value))
  }
  expect(
    readingJsonBytes({ absent: undefined, holes: Array(3), repeat: [{ x: 1 }, { x: 1 }] }),
  ).toBe(native({ absent: undefined, holes: Array(3), repeat: [{ x: 1 }, { x: 1 }] }))
})
it('counts large reading output without flattening it into JSON/encoded copies', () => {
  const value = {
    html: '<div title="界">😀 & text</div>'.repeat(50000),
    slots: [],
    layout: 'replace',
  }
  expect(readingJsonBytes(value)).toBe(native(value))
})
it('rejects cycles and records outside the reading projection contract', () => {
  const cycle: unknown[] = []
  cycle.push(cycle)
  for (const value of [cycle, new Date(), BigInt(1), undefined])
    expect(() => readingJsonBytes(value)).toThrow('Invalid reading JSON')
})
