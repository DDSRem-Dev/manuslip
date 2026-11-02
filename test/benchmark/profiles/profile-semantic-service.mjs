import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { arch, platform, release } from 'node:os'
import { resolve, sep } from 'node:path'
import { _electron as electron } from '@playwright/test'
import { build, createServer, preview } from 'vite'
import { semanticCorpus } from '../fixtures/semantic-corpus.mjs'
import { createSemanticServiceEvidence } from '../helpers/semantic-service-evidence.mjs'
import { startSemanticServiceMemory } from '../helpers/semantic-service-memory.mjs'
import { attachSemanticServiceWorkerCpu } from '../helpers/semantic-service-worker-cpu.mjs'

const selected = process.argv.includes('--case')
  ? process.argv[process.argv.indexOf('--case') + 1]
  : undefined
const cases = selected ? semanticCorpus.filter(([name]) => name === selected) : semanticCorpus
const admission = process.argv.includes('--admission')
const rendererCpu = process.argv.includes('--renderer-cpu')
const workerCpu = process.argv.includes('--worker-cpu')
const processMemory = process.argv.includes('--process-memory')
assert.ok(
  !workerCpu || (!admission && !rendererCpu && !processMemory),
  '--worker-cpu must run separately from admission tracing, renderer CPU and process memory',
)
assert.ok(
  !processMemory || (!admission && !rendererCpu),
  '--process-memory must run separately from admission tracing and CPU profiling',
)
const editArgument = process.argv.indexOf('--edits')
const edits = editArgument < 0 ? 2 : Number(process.argv[editArgument + 1])
assert.ok(Number.isSafeInteger(edits) && edits >= 1 && edits <= 20, '--edits must be 1–20')
assert.ok(cases.length, 'Unknown complete semantic corpus case')
await mkdir('test/artifacts/logs', { recursive: true })
const artifacts = workerCpu
  ? await mkdtemp(resolve('test/artifacts/logs/semantic-service-worker-cpu-'))
  : undefined
const evidence = artifacts ? await createSemanticServiceEvidence(artifacts) : undefined
const reportPath = artifacts
  ? resolve(artifacts, 'report.json')
  : `test/artifacts/logs/semantic-service${selected ? `-${selected}` : ''}${admission ? '-admission' : ''}${rendererCpu ? '-renderer-cpu' : ''}${processMemory ? '-process-memory' : ''}${editArgument < 0 ? '' : `-edits${edits}`}-profile.json`
const config = {
  configFile: false,
  root: resolve('test/e2e/fixtures/semantic-service'),
  clearScreen: false,
  logLevel: 'silent',
  base: './',
  resolve: { conditions: ['worker', 'module', 'browser', 'production'] },
  build: {
    outDir: artifacts
      ? resolve(artifacts, 'build')
      : resolve('test/artifacts/logs/semantic-service-build'),
    emptyOutDir: false,
    minify: admission || rendererCpu || workerCpu ? false : undefined,
  },
  worker: {
    format: 'es',
    ...(evidence ? { plugins: () => [evidence.plugin('worker')] } : {}),
  },
  plugins: admission
    ? [
        {
          name: 'semantic-admission-trace',
          enforce: 'pre',
          transform(code, id) {
            const path = id.replaceAll('\\', '/')
            const emit = (report) =>
              `globalThis[Symbol.for('manuslip-semantic-admission')]?.(${report})`
            if (path.endsWith('/core/src/packing-resources.ts')) {
              const marker =
                "if (added > available) throw new Error('Packed session exceeds retained limit')"
              assert.ok(code.includes(marker))
              const weights =
                'pin(resources: () => Iterable<PackedResource>, available: number): void {'
              assert.ok(code.includes(weights))
              code = code.replace(
                weights,
                `get diagnosticWeights() {
                return [...this.#entries].map(([key, entry]) => ({type:key.constructor.name, ...entry}))
              }\n${weights}`,
              )
              code = code.replace(
                marker,
                `if (added > available) {
          ${emit("{kind:'resources',required:added,available,held:[...this.#entries.values()].map(e=>({bytes:e.bytes,references:e.references})),incoming:[...resources()].map(e=>e.bytes)}")};
          throw new Error('Packed session exceeds retained limit')
        }`,
              )
            } else if (path.endsWith('/core/src/packing-session.ts')) {
              for (const message of [
                'Packed session exceeds retained limit',
                'Packed reader scope limit',
              ]) {
                const marker = `throw new Error('${message}')`
                assert.ok(code.includes(marker))
                code = code.replaceAll(
                  marker,
                  `{
            ${emit(`{kind:${JSON.stringify(message)},required:typeof bytes==='number'?bytes:typeof growth==='number'?growth:undefined,available:this.#remaining(),weights:this.#resources.diagnosticWeights,stats:this.stats,stack:new Error('admission trace').stack}`)};
            ${marker}
          }`,
                )
              }
            } else return
            return { code, map: null }
          },
        },
      ]
    : [],
}
if (evidence) config.plugins.push(evidence.plugin('renderer'))
const profile = await mkdtemp(resolve('test/artifacts/logs/semantic-service-profile-'))
const oracle = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  resolve: { conditions: ['node', 'module', 'production'] },
  ssr: {
    resolve: {
      conditions: ['node', 'module', 'production'],
      externalConditions: ['node', 'production'],
    },
  },
  server: { middlewareMode: true, watch: null },
  ...(evidence ? { plugins: [evidence.plugin('oracle')] } : {}),
})
let server, application, workerProfiling, failure
const cleanupErrors = []
const reports = []
try {
  const { parseMarkdownNative: parseMarkdown } = await oracle.ssrLoadModule(
    '/packages/core/src/parse.ts',
  )
  const { renderProjectionLayout } = await oracle.ssrLoadModule(
    '/packages/renderer/src/projection-layout.ts',
  )
  await build(config)
  await evidence?.bindBuild(config.build.outDir)
  server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0, strictPort: false } })
  application = await electron.launch({
    args: [resolve('test/benchmark/fixtures/packed-memory/main.cjs')],
    env: {
      ...process.env,
      MANUSLIP_PACKED_MEMORY_PROFILE: profile,
      MANUSLIP_PACKED_MEMORY_URL: server.resolvedUrls.local[0],
    },
  })
  const page = await application.firstWindow()
  page.setDefaultTimeout(120000)
  await page.waitForFunction(() => typeof window.runSemanticServiceProbe === 'function')
  const cpu = rendererCpu ? await page.context().newCDPSession(page) : undefined
  let cpuCase, cpuRevision
  if (workerCpu)
    workerProfiling = await attachSemanticServiceWorkerCpu(
      application,
      page,
      (revision, targetInfo, profile) =>
        evidence.recordProfile(
          cpuCase,
          revision,
          targetInfo,
          profile,
          new URL(server.resolvedUrls.local[0]).origin,
        ),
    )
  let memory
  if (processMemory)
    await page.exposeFunction('semanticServiceMemoryCheckpoint', (...args) =>
      memory.checkpoint(...args),
    )
  if (cpu) {
    await cpu.send('Profiler.enable')
    await cpu.send('Profiler.setSamplingInterval', { interval: 500 })
    await page.exposeFunction('semanticServiceProbePhase', async (phase, revision) => {
      if (phase === 'start') {
        assert.equal(cpuRevision, undefined)
        cpuRevision = revision
        await cpu.send('Profiler.start')
      } else if (cpuRevision !== undefined) {
        assert.equal(cpuRevision, revision)
        const { profile } = await cpu.send('Profiler.stop')
        await writeFile(
          `test/artifacts/logs/service-renderer-cpu-${cpuCase}-${revision}.cpuprofile`,
          JSON.stringify(profile),
        )
        cpuRevision = undefined
      }
    })
  }
  for (const [name, body] of cases) {
    cpuCase = name
    const source = `# ${name}\n\n${body}`
    const texts = [
      source,
      ...Array.from({ length: edits }, (_, index) =>
        source.replace(
          name,
          index === 0
            ? `${name} extended`
            : index === 1
              ? `${name} extended again`
              : `${name} extended ${index + 1}`,
        ),
      ),
    ]
    memory = processMemory ? await startSemanticServiceMemory(application, page) : undefined
    let result, processMemoryReport
    try {
      result = await page
        .evaluate((texts) => window.runSemanticServiceProbe(texts), texts)
        .catch((error) => ({ kind: 'rejected', error: String(error) }))
    } finally {
      processMemoryReport = await memory?.finish()
      memory = undefined
    }
    await workerProfiling?.completeCase()
    const report = {
      name,
      sourceBytes: Buffer.byteLength(source),
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      ...result,
      ...(processMemoryReport ? { processMemory: processMemoryReport } : {}),
    }
    reports.push(report)
    if (result.kind === 'accepted') {
      assert.equal(result.workers, 1)
      assert.equal(result.rounds.length, texts.length)
      for (const [revision, round] of result.rounds.entries()) {
        const document = parseMarkdown(texts[revision])
        const { projection, layout } = renderProjectionLayout(
          document.root,
          result.options,
          64 * 1024 * 1024,
        )
        const normalized = JSON.stringify({
          document: { ...document, timings: null },
          projection: { ...projection, renderMs: null },
          layout,
        })
        assert.equal(
          round.semanticSha256,
          createHash('sha256').update(normalized).digest('hex'),
          `${name} complete semantic output`,
        )
        assert.equal(round.words, document.counts.words)
        assert.equal(round.characters, document.counts.characters)
        assert.deepEqual(round.outline, document.outline)
        assert.equal(round.revision, revision)
        assert.ok(round.receiver.retainedBytes <= 64 * 1024 * 1024)
      }
      report.incrementalGate = result.rounds.every(
        (round, revision) =>
          round.messages.length === 1 && round.messages[0].kind === (revision ? 'delta' : 'full'),
      )
    }
    console.log(
      JSON.stringify(
        processMemoryReport
          ? {
              ...report,
              processMemory: {
                summary: processMemoryReport.summary,
                coldThroughReady: processMemoryReport.coldThroughReady,
                intervals: processMemoryReport.intervals,
              },
            }
          : report,
      ),
    )
  }
} catch (error) {
  failure = error
} finally {
  const clean = async (action) => {
    try {
      await action()
    } catch (error) {
      cleanupErrors.push(String(error))
    }
  }
  await clean(() => workerProfiling?.dispose())
  await clean(() => application?.close())
  await clean(() => server?.httpServer.close())
  await clean(() => oracle.close())
  await clean(async () => {
    assert.ok(profile.startsWith(`${resolve('test/artifacts/logs')}${sep}`))
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })
  let bindings
  await clean(async () => {
    bindings = await evidence?.finish()
  })
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        admissionTracing: admission,
        rendererCpu,
        workerCpu,
        processMemory,
        ...(workerCpu
          ? {
              artifacts,
              workerCpuMethod:
                'Electron main debugger auto-attaches to each actual dedicated application Worker before its first script and samples at 500 microseconds. Each profile spans one original application request through timer-observed renderer readiness, before complete diagnostic hash materialization. One persistent Worker handles full/delta revisions per corpus; its disposal is confirmed between corpora. Exact loaded build/oracle source bindings, emitted assets and profile hashes are retained separately. Unminified output, debugger attachment and sampling perturb execution. No original quota, limit, watchdog or debounce is relaxed. This is not packaged latency/p95, throughput or physical/aggregate admission acceptance.',
              evidence: bindings ? 'evidence.json' : undefined,
            }
          : {}),
        ...(failure ? { failure: String(failure) } : {}),
        cleanupErrors,
        ...(processMemory
          ? {
              environment: { platform: platform(), release: release(), arch: arch() },
              processMemoryMethod:
                'Minified mounted application diagnostic with its actual persistent packed semantic Worker. Electron main process app.getAppMetrics samples normalize KiB to bytes and identify the renderer by PID and creation time. Raw simultaneous process rows and totals include Worker native parse/render/encoding, receiver/caches, mounted CodeMirror and independently retained old Reading capture. Complete hash materialization is diagnostic-only and separately labeled; it expands native output outside application ledgers. coldThroughReady excludes hashing for this fixture; later revisions can include commitment left by diagnostic hashing. Multiple fixtures run sequentially in the same Electron process, so per-case baselines include prior process reservation. Checkpoints annotate transitions to request, ready, cached, hashed, worker-disposed and disposed. A 20 ms pause follows completed samples; sampling can miss synchronous peaks and changes timing. Checkpoint labels and OS/Worker observations are successive, not atomic. No forced GC during work; three GCs follow confirmed Worker termination and zero receiver ownership. Baseline and post-disposal renderer isolate heap/backing/embedder observations exclude Worker isolates and are separate from OS process commitment. Working sets include shared pages, summed working sets are not unique RAM, Windows private bytes measure commitment, and OS peak working set is a lifetime high-water mark. Separate Node oracle/driver/Vite memory is excluded. The fixture omits other application tabs, mounted widgets, translation/export consumers and production main IPC. Neither observations nor local ownership weights calibrate a portable physical admission bound or establish packaged latency acceptance.',
            }
          : {}),
        edits,
        method:
          'Actual Worker endpoint, renderer port, application debounce/watchdog service, DocumentPreview and mounted CodeMirror Live model. Complete independent native hashes/status for initial full and every requested real edit. Readiness uses a timer poll: optional cache work started after publication can run before that observation and is then included. Hash materialization runs after ready timing. Remaining idle receiver certificates are awaited separately. Diagnostic readiness observations do not establish packaged input/mode/apply-slice p95 or physical/aggregate admission acceptance.',
        reports,
      },
      null,
      2,
    )}\n`,
  )
  if (workerCpu) console.log(JSON.stringify({ report: reportPath, artifacts }))
}
if (failure) throw failure
assert.deepEqual(cleanupErrors, [], 'Diagnostic cleanup or source verification failed')
assert.ok(
  reports.length === cases.length && reports.every((report) => report.kind === 'accepted'),
  'Some complete application transport cases failed',
)
assert.ok(
  reports.every((report) => report.incrementalGate),
  'Every complete application case must accept every edit as a delta without full resync',
)
