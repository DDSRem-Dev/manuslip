import { expect, it, vi } from 'vitest'
import { SearchRecordStream } from '../../../../src/main/search/stream'
import { searchLimits } from '../../../../src/shared/search-contracts'

it.each([0, 10] as const)(
  'preserves records at every chunk boundary with delimiter %s',
  (delimiter) => {
    const records = ['😀界', '', 'another\r', 'last']
    const input = Buffer.from(records.join(String.fromCharCode(delimiter)))
    for (let split = 0; split <= input.length; split++) {
      const stream = new SearchRecordStream(delimiter)
      const output: Buffer[] = []
      const accept = (record: Buffer) => {
        output.push(record)
        return true
      }
      expect(stream.push(input.subarray(0, split), accept)).toBe(true)
      expect(stream.push(input.subarray(split), accept)).toBe(true)
      expect(stream.finish(accept)).toBe(true)
      expect(output.map(String)).toEqual(records)
      expect(stream.finish(accept)).toBe(true)
      expect(output).toHaveLength(records.length)
    }
  },
)

it('keeps published records stable when later records reuse the stream', () => {
  const stream = new SearchRecordStream(10)
  const output: Buffer[] = []
  const accept = (record: Buffer) => {
    output.push(record)
    return true
  }
  for (const chunk of ['fir', 'st\nsec', 'ond\n', 'third', '\nlast'])
    expect(stream.push(Buffer.from(chunk), accept)).toBe(true)
  expect(stream.finish(accept)).toBe(true)
  expect(output.map(String)).toEqual(['first', 'second', 'third', 'last'])
})

it('bounds copying and delimiter scans by input size for fragmented records', () => {
  const size = 512 * 1024
  const chunk = Buffer.alloc(256, 65)
  const stream = new SearchRecordStream(10)
  const accept = vi.fn<(record: Buffer) => boolean>(() => true)
  const concat = vi.spyOn(Buffer, 'concat')
  const copy = vi.spyOn(Buffer.prototype, 'copy')
  const indexOf = vi.spyOn(Buffer.prototype, 'indexOf')
  let finished = false,
    copied = 0,
    scanned = 0
  try {
    for (let offset = 0; offset < size; offset += chunk.length) stream.push(chunk, accept)
    finished = stream.finish(accept)
    copied =
      concat.mock.calls.reduce(
        (sum, [parts]) => sum + parts.reduce((n, part) => n + part.length, 0),
        0,
      ) +
      copy.mock.results.reduce(
        (sum, result) => sum + (result.type === 'return' ? result.value : 0),
        0,
      )
    scanned = indexOf.mock.contexts.reduce(
      (sum, buffer, index) => sum + buffer.length - Number(indexOf.mock.calls[index]?.[1] ?? 0),
      0,
    )
  } finally {
    concat.mockRestore()
    copy.mockRestore()
    indexOf.mockRestore()
  }
  expect(finished).toBe(true)
  expect(accept).toHaveBeenCalledOnce()
  expect(accept.mock.calls[0]?.[0].equals(Buffer.alloc(size, 65))).toBe(true)
  expect(copied).toBeLessThanOrEqual(size * 4)
  expect(scanned).toBeLessThanOrEqual(size * 2)
})

it.each([false, true])('accepts exactly the record budget with a delimiter=%s', (delimited) => {
  const stream = new SearchRecordStream(10)
  const accept = vi.fn<(record: Buffer) => boolean>(() => true)
  expect(stream.push(Buffer.alloc(searchLimits.record, 65), accept)).toBe(true)
  if (delimited) expect(stream.push(Buffer.from('\n'), accept)).toBe(true)
  expect(stream.finish(accept)).toBe(true)
  expect(accept).toHaveBeenCalledOnce()
  expect(accept.mock.calls[0]?.[0].length).toBe(searchLimits.record)
})

it.each([false, true])(
  'rejects oversized records with a delimiter=%s before publishing them',
  (delimited) => {
    const stream = new SearchRecordStream(10)
    const accept = vi.fn(() => true)
    expect(stream.push(Buffer.alloc(searchLimits.record, 65), accept)).toBe(true)
    expect(stream.push(Buffer.from(delimited ? 'a\n' : 'a'), accept)).toBe(false)
    expect(accept).not.toHaveBeenCalled()
  },
)

it('honors backpressure and releases incomplete records when cleared', () => {
  const stream = new SearchRecordStream(0)
  const accept = vi.fn(() => false)
  expect(stream.push(Buffer.from('first\0second\0tail'), accept)).toBe(false)
  expect(accept).toHaveBeenCalledOnce()
  stream.clear()
  expect(stream.finish(accept)).toBe(true)
  expect(stream.push(Buffer.from('incomplete'), accept)).toBe(true)
  stream.clear()
  expect(stream.finish(accept)).toBe(true)
  expect(accept).toHaveBeenCalledOnce()
})
