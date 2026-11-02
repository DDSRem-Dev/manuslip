import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { utf8Bytes } from '../../../packages/core/src/text-count.ts'

const child = process.argv.indexOf('--child')
if (child < 0) {
  const results = ['encoder', 'scan'].map((mode) => {
    const job = spawnSync(
      process.execPath,
      ['--expose-gc', fileURLToPath(import.meta.url), '--child', mode],
      {
        windowsHide: true,
        encoding: 'utf8',
      },
    )
    if (job.error) throw job.error
    assert.equal(job.status, 0, job.stderr || job.stdout)
    return JSON.parse(job.stdout)
  })
  assert.equal(results[0].helperSha256, results[1].helperSha256)
  assert.deepEqual(
    results[0].cases.map(({ name, units, bytes }) => ({ name, units, bytes })),
    results[1].cases.map(({ name, units, bytes }) => ({ name, units, bytes })),
  )
  const report = {
    date: new Date().toISOString(),
    method:
      'Fresh Node processes compare the original TextEncoder size-only call with the actual production UTF-8 helper. Complete strings include source, JSON envelope and 50 MiB file boundaries. Every exact byte count matches an independent native encoding. Four measured calls per case record actual encoded buffer sizes through a temporary encoder wrapper; the numeric helper must invoke no encoder. Endpoint process memory and individual CPU times are diagnostics, not physical peaks, UI latency gates or aggregate admission bounds.',
    results,
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/text-size-profile.json',
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(JSON.stringify(report, null, 2))
} else {
  assert.equal(typeof global.gc, 'function')
  const mode = process.argv[child + 1]
  assert.ok(['encoder', 'scan'].includes(mode))
  const counter =
    mode === 'encoder' ? (value) => new TextEncoder().encode(value).byteLength : utf8Bytes
  const original = TextEncoder.prototype.encode
  let measuring = false,
    calls = 0,
    encodedBytes = 0
  TextEncoder.prototype.encode = function (value) {
    const output = original.call(this, value)
    if (measuring) {
      calls++
      encodedBytes += output.byteLength
    }
    return output
  }
  const MiB = 1024 * 1024
  const cases = []
  try {
    for (let index = 0; index < 100; index++) counter('Warm 界😀\ud800 text.'.repeat(256))
    for (const [name, source] of [
      ['source-ascii-2MiB', 'x'.repeat(2 * MiB)],
      ['source-mixed-unicode', '界😀é\ud800\n'.repeat(100000)],
      [
        'json-envelope-8MiB',
        JSON.stringify({ source: '\u0000'.repeat(Math.floor((8 * MiB - 64) / 6)) }),
      ],
      ['file-ascii-50MiB', 'x'.repeat(50 * MiB)],
    ]) {
      const bytes = new TextEncoder().encode(source).byteLength
      assert.equal(counter(source), bytes)
      await immediate()
      global.gc()
      await immediate()
      const before = process.memoryUsage()
      const iterations = 4
      let total = 0
      calls = encodedBytes = 0
      measuring = true
      const started = performance.now()
      for (let iteration = 0; iteration < iterations; iteration++) total += counter(source)
      const activeMs = performance.now() - started
      measuring = false
      const after = process.memoryUsage()
      assert.equal(total, bytes * iterations)
      assert.equal(calls, mode === 'encoder' ? iterations : 0)
      assert.equal(encodedBytes, mode === 'encoder' ? bytes * iterations : 0)
      cases.push({
        name,
        units: source.length,
        bytes,
        iterations,
        activeMs,
        encoderCalls: calls,
        encodedBytes,
        before,
        after,
      })
    }
  } finally {
    TextEncoder.prototype.encode = original
  }
  console.log(
    JSON.stringify({
      mode,
      node: process.version,
      helperSha256: createHash('sha256')
        .update(
          await readFile(new URL('../../../packages/core/src/text-count.ts', import.meta.url)),
        )
        .digest('hex'),
      cases,
    }),
  )
}
