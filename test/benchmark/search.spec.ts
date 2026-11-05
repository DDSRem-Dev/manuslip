import { cpus, platform } from 'node:os'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { matchEntries } from '../../apps/desktop/src/main/search/records'
import { SearchRecordStream } from '../../apps/desktop/src/main/search/stream'
import { report, summary } from './helpers'

test('dense Unicode search results stay within the main-process latency budget', async () => {
  const root = resolve('workspace')
  const prefix = '界😀a'.repeat(9000)
  const line = `${prefix}${'needle '.repeat(500)}`
  const start = Buffer.byteLength(prefix)
  const record = Buffer.from(
    JSON.stringify({
      type: 'match',
      data: {
        path: { text: 'notes.md' },
        lines: { text: `${line}\r\n` },
        line_number: 1,
        submatches: Array.from({ length: 500 }, (_, index) => ({
          start: start + index * 7,
          end: start + index * 7 + 6,
        })),
      },
    }),
  )
  const samples: number[] = []
  for (let iteration = 0; iteration < 35; iteration++) {
    let count = 0
    const begin = performance.now()
    const result = matchEntries(root, record, (entry) => {
      if (entry.anchor?.from !== prefix.length + count * 7) throw new Error('Invalid search anchor')
      count++
      return true
    })
    const elapsed = performance.now() - begin
    expect(result).toEqual({ keep: true, skipped: 0 })
    expect(count).toBe(500)
    if (iteration >= 5) samples.push(elapsed)
  }
  const latency = summary(samples)
  await report(test.info(), 'search-results', {
    runtime: process.versions,
    platform: platform(),
    cpu: cpus()[0]?.model,
    recordBytes: record.length,
    matches: 500,
    latency,
  })
  expect(latency.p95).toBeLessThan(16)
})

test('fragmented search output stays within the framing latency budget', async () => {
  const size = 512 * 1024
  const chunk = Buffer.alloc(256, 65)
  const samples: number[] = []
  for (let iteration = 0; iteration < 25; iteration++) {
    const stream = new SearchRecordStream(10)
    let accepted = 0
    const accept = (record: Buffer) => {
      if (record.length !== size || record[0] !== 65 || record.at(-1) !== 65)
        throw new Error('Corrupted record')
      accepted++
      return true
    }
    const begin = performance.now()
    for (let offset = 0; offset < size; offset += chunk.length) {
      if (!stream.push(chunk, accept)) throw new Error('Unexpected truncation')
    }
    if (!stream.finish(accept)) throw new Error('Unexpected truncation')
    const elapsed = performance.now() - begin
    expect(accepted).toBe(1)
    if (iteration >= 5) samples.push(elapsed)
  }
  const latency = summary(samples)
  await report(test.info(), 'search-stream', {
    runtime: process.versions,
    platform: platform(),
    cpu: cpus()[0]?.model,
    recordBytes: size,
    chunkBytes: chunk.length,
    latency,
  })
  expect(latency.p95).toBeLessThan(16)
})
