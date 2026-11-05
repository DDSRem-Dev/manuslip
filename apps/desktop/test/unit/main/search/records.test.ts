import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { matchEntries, type StoredEntry } from '../../../../src/main/search/records'

const root = resolve('workspace')
function record(line: string, submatches: unknown[], base64 = false): Buffer {
  return Buffer.from(
    JSON.stringify({
      type: 'match',
      data: {
        path: { text: 'notes.md' },
        lines: base64 ? { bytes: Buffer.from(line).toString('base64') } : { text: line },
        line_number: 2,
        submatches,
      },
    }),
  )
}

it.each([false, true])('preserves Unicode and BOM offsets with base64=%s', (base64) => {
  const line = '\uFEFF😀 界e\u0301\uFEFFneedle\uFEFF needle😀'
  const expected = [...line.matchAll(/needle|😀|\uFEFF/g)].map((match) => ({
    from: match.index,
    to: match.index + match[0].length,
  }))
  const matches = expected.map(({ from, to }) => ({
    start: Buffer.byteLength(line.slice(0, from)),
    end: Buffer.byteLength(line.slice(0, to)),
  }))
  const entries: StoredEntry[] = []
  expect(
    matchEntries(root, record(`${line}\r\n`, matches, base64), (entry) => {
      entries.push(entry)
      return true
    }),
  ).toEqual({ keep: true, skipped: 0 })
  expect(entries.map((entry) => entry.anchor)).toEqual(
    expected.map((range) => ({ ...range, line: 2, text: line })),
  )
})

it('converts ordered matches with work bounded by the record and line size', () => {
  const prefix = '界😀a'.repeat(9000)
  const line = `${prefix}${'needle '.repeat(500)}`
  const start = Buffer.byteLength(prefix)
  const input = record(
    line,
    Array.from({ length: 500 }, (_, index) => ({
      start: start + index * 7,
      end: start + index * 7 + 6,
    })),
  )
  const decode = vi.spyOn(TextDecoder.prototype, 'decode')
  const accept = vi.fn(() => true)
  try {
    expect(matchEntries(root, input, accept)).toEqual({ keep: true, skipped: 0 })
    expect(accept).toHaveBeenCalledTimes(500)
    const decodedBytes = decode.mock.calls.reduce(
      (sum, [bytes]) => sum + (bytes?.byteLength ?? 0),
      0,
    )
    expect(decodedBytes).toBeLessThanOrEqual(input.length + Buffer.byteLength(line))
  } finally {
    decode.mockRestore()
  }
})

it.each([
  [
    { start: 0, end: 1 },
    { start: 2, end: 100 },
  ],
  [
    { start: 0, end: 1 },
    { start: 3, end: 4 },
  ],
  [
    { start: 0, end: 1 },
    { start: 2, end: 3 },
  ],
  [{ start: 0, end: 1 }, null],
  [
    { start: 0, end: 1 },
    { start: 2, end: '6' },
  ],
  [
    { start: 0, end: 1 },
    { start: 2.5, end: 6 },
  ],
  [
    { start: 2, end: 6 },
    { start: 0, end: 1 },
  ],
  [
    { start: 0, end: 1 },
    { start: 0, end: 1 },
  ],
])('rejects a malformed record before publishing any of its matches %#', (...matches) => {
  const accept = vi.fn(() => true)
  expect(matchEntries(root, record('a 😀 needle', matches), accept)).toEqual({
    keep: true,
    skipped: 1,
  })
  expect(accept).not.toHaveBeenCalled()
})

it('honors backpressure without publishing later matches', () => {
  const accept = vi.fn(() => false)
  expect(
    matchEntries(
      root,
      record('one two', [
        { start: 0, end: 3 },
        { start: 4, end: 7 },
      ]),
      accept,
    ),
  ).toEqual({ keep: false, skipped: 0 })
  expect(accept).toHaveBeenCalledOnce()
})

it.each(['null', '[]', '{"type":"match","data":null}', '{"type":"match"}', 'not JSON'])(
  'skips malformed native records without throwing: %s',
  (input) => {
    const accept = vi.fn(() => true)
    expect(matchEntries(root, Buffer.from(input), accept)).toEqual({ keep: true, skipped: 1 })
    expect(accept).not.toHaveBeenCalled()
  },
)
