import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { _electron as electron } from '@playwright/test'
import { build, createServer, preview } from 'vite'
import { semanticCorpus as allCases } from '../fixtures/semantic-corpus.mjs'

const MiB = 1024 * 1024
const incremental = process.argv.includes('--incremental')
const receiverCache = process.argv.includes('--receiver-cache')
const receiverCpu = process.argv.includes('--receiver-cpu')
const producerCache = process.argv.includes('--producer-cache')
if (receiverCpu && (!incremental || !receiverCache))
  throw new Error('--receiver-cpu requires --incremental --receiver-cache')
const requestedCase = process.argv.includes('--case')
  ? process.argv[process.argv.indexOf('--case') + 1]
  : undefined
const cases = requestedCase ? allCases.filter(([name]) => name === requestedCase) : allCases
if (!cases.length) throw new Error('Unknown producer fixture')
const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const options = { rawHtml: false, footnotesLabel: 'Footnotes', footnoteBackLabel: 'Back' }
const buildRoot = resolve('test/artifacts/logs/semantic-producer-build')
const config = {
  configFile: false,
  root: resolve('test/e2e/fixtures/semantic-producer'),
  clearScreen: false,
  logLevel: 'silent',
  base: './',
  resolve: { conditions: ['worker', 'module', 'browser', 'development|production'] },
  build: {
    outDir: buildRoot,
    emptyOutDir: false,
    ...(receiverCpu ? { minify: false, sourcemap: true } : {}),
  },
  worker: { format: 'es' },
}
await mkdir('test/artifacts/logs', { recursive: true })
const profile = await mkdtemp(resolve('test/artifacts/logs/semantic-producer-profile-'))
const oracle = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
})
let server, application
try {
  const { parseMarkdown } = await oracle.ssrLoadModule('/packages/core/src/parse.ts')
  const { renderProjectionLayout } = await oracle.ssrLoadModule(
    '/packages/renderer/src/projection-layout.ts',
  )
  await build(config)
  server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0, strictPort: false } })
  const url = server.resolvedUrls.local[0]
  application = await electron.launch({
    args: [resolve('test/benchmark/fixtures/packed-memory/main.cjs')],
    env: {
      ...process.env,
      MANUSLIP_PACKED_MEMORY_PROFILE: profile,
      MANUSLIP_PACKED_MEMORY_URL: url,
    },
  })
  const page = await application.firstWindow()
  page.setDefaultTimeout(120000)
  await page.waitForFunction(() => typeof window.runProducerProbe === 'function')
  const reports = []
  let cpuCase, cpuRevision
  const cpu = receiverCpu ? await page.context().newCDPSession(page) : undefined
  if (cpu) {
    await cpu.send('Profiler.enable')
    await cpu.send('Profiler.setSamplingInterval', { interval: 500 })
    await page.exposeFunction('receiverProbePhase', async (phase, revision) => {
      if (phase === 'start') {
        assert.equal(cpuRevision, undefined)
        cpuRevision = revision
        await cpu.send('Profiler.start')
      } else if (cpuRevision !== undefined) {
        assert.equal(cpuRevision, revision)
        const { profile } = await cpu.send('Profiler.stop')
        await writeFile(
          `test/artifacts/logs/receiver-cpu-${cpuCase}-${revision}.cpuprofile`,
          JSON.stringify(profile),
        )
        cpuRevision = undefined
      }
    })
  }
  for (const [name, body] of cases) {
    cpuCase = name
    const text = `# ${name}\n\n${body}`
    const edits = incremental
      ? [text.replace(name, `${name} extended`), text.replace(name, `${name} extended again`)]
      : []
    const sources = [text, ...edits, edits.at(-1) ?? text]
    const expectedHashes = sources.map((source) => {
      const document = parseMarkdown(source)
      const { projection, layout } = renderProjectionLayout(document.root, options, 64 * MiB)
      return sha256(
        JSON.stringify({
          document: { ...document, timings: null },
          projection: { ...projection, renderMs: null },
          layout,
        }),
      )
    })
    const result = await page
      .evaluate(
        ({ source, edits, receiverCache, producerCache }) =>
          window.runProducerProbe(source, edits, receiverCache, producerCache),
        {
          source: text,
          edits,
          receiverCache,
          producerCache,
        },
      )
      .catch((error) => ({ kind: 'receiver-error', error: String(error) }))
    if (result.kind === 'accepted') {
      assert.equal(result.rounds.length, sources.length)
      for (const [index, round] of result.rounds.entries()) {
        assert.equal(
          round.semanticSha256,
          expectedHashes[index],
          `${name}: complete semantic mismatch`,
        )
        assert.ok(round.worker.retainedBytes <= 16 * MiB)
        assert.ok(round.receiver.retainedBytes <= 64 * MiB)
        assert.ok(round.receiver.readerStagingBytes === 0)
      }
      if (receiverCache) {
        assert.equal(result.caches.length, 1)
        assert.deepEqual(result.caches[0].result, { document: true, projection: true, words: true })
        assert.ok(result.caches[0].peakRetainedBytes <= 64 * MiB)
        assert.ok(result.caches[0].peakStagingBytes <= 8 * MiB)
      }
      if (producerCache) {
        assert.equal(result.producerCaches.length, 1)
        assert.equal(result.producerCaches[0].worker.dependencyCache, true)
        assert.ok(result.producerCaches[0].report.peakRetainedBytes <= 16 * MiB)
        assert.ok(result.producerCaches[0].report.peakStagingBytes <= 8 * MiB)
      }
    }
    const report = {
      name,
      sourceBytes: Buffer.byteLength(text),
      sourceSha256: sha256(text),
      expectedHashes,
      ...result,
    }
    reports.push(report)
    console.log(JSON.stringify(report))
  }
  await writeFile(
    `test/artifacts/logs/semantic-producer${incremental ? '-incremental' : ''}${receiverCache ? '-receiver-cache' : ''}${producerCache ? '-producer-cache' : ''}${receiverCpu ? '-receiver-cpu' : ''}${requestedCase ? `-${requestedCase}` : ''}-profile.json`,
    `${JSON.stringify(
      {
        method: `Actual Electron Worker application producer with 16 MiB retained session, 8 MiB wire/staging and unchanged 32 MiB encoder workspace. Complete native oracle remains in Node. Receiver validates the complete packed document/projection before an exact transferable ACK. ${incremental ? 'Four rounds: initial full, two actual heading edits, then full resync of the final revision after receiver eviction. Cached serialization may evict optional dependency acceleration and, if still over capacity, the committed cache before a full native recomputation. Independent old captures stay charged. Delta results are independently serialized completely after validation for oracle hashing; this diagnostic output is excluded from receiver timing.' : 'Two rounds: fresh full result then exact cached full resync after receiver eviction.'} Timings are diagnostic and include instrumentation/scheduling; largest steps include atomic native parse/render or fragment builders. Ledger endpoints are not physical memory or aggregate admission bounds. No ordinary semantic worker or packaged activation.`,
        runtime: await application.evaluate(() => process.versions),
        receiverCache: receiverCache
          ? 'Build document, projection and whole-prose text certificates cooperatively after initial complete validation/ACK and before edits. Construction costs and peak ledger ownership are reported separately. Both edits still undergo complete validation before ACK. Eviction drops certificates before the final full resync. This is idle warm-cache evidence; cold-path and ordinary packaged activation gates remain open.'
          : false,
        receiverScheduling:
          'Two-millisecond diagnostic batches defer through the application browserRuntime (scheduler.yield with timer fallback). Earlier producer reports used setTimeout(0) directly; wall times across that change are not a like-for-like comparison.',
        receiverCpu: receiverCpu
          ? 'Main renderer CPU sampling at 500 microseconds around each complete incremental receiver validation only. Readable, source-mapped diagnostic bundles; CPU reports and wall times include profiler overhead and do not establish performance gates.'
          : false,
        producerCache: producerCache
          ? 'Warm cooperative producer dependency metadata on the exact acknowledged revision concurrently with receiver certificate construction after the first ACK. All metadata/scratch growth is admitted in the existing producer session before allocation. Construction costs are reported separately; this does not prove cold readiness or ordinary application integration.'
          : false,
        reports,
      },
      null,
      2,
    )}\n`,
  )
  assert.ok(
    reports.every((report) => report.kind === 'accepted'),
    'Some complete producer fixtures were rejected; inspect the diagnostic report',
  )
  if (incremental)
    assert.ok(
      reports.every(
        (report) => report.rounds[1].kind === 'delta' && report.rounds[2].kind === 'delta',
      ),
      'Every incremental fixture must publish both actual edits as deltas',
    )
} finally {
  try {
    await application?.close()
  } finally {
    await server?.httpServer.close()
    await oracle.close()
    assert.ok(profile.startsWith(`${resolve('test/artifacts/logs')}${sep}`))
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
