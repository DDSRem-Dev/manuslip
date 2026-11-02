import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { _electron as electron } from '@playwright/test'
import { build, createServer, preview } from 'vite'
import {
  readPackedProcessMemory,
  summarizePackedProcessMemory,
} from '../helpers/packed-process-memory.mjs'

const allocations = process.argv.includes('--allocations')
const constructionSites = process.argv.includes('--construction-sites')
const processMemory = process.argv.includes('--process-memory')
const producerMode = process.argv.includes('--producer')
assert.ok(!constructionSites || allocations, '--construction-sites requires --allocations')
assert.ok(!processMemory || !allocations, '--process-memory must run separately from --allocations')
assert.ok(!producerMode || processMemory, '--producer requires --process-memory')
const buildRoot = resolve(
  producerMode
    ? 'test/artifacts/logs/packed-producer-memory-build'
    : allocations
      ? 'test/artifacts/logs/packed-allocation-build'
      : processMemory
        ? 'test/artifacts/logs/packed-process-memory-build'
        : 'test/artifacts/logs/packed-memory-build',
)
const config = {
  configFile: false,
  root: resolve('test/e2e/fixtures/packed-memory'),
  clearScreen: false,
  logLevel: 'silent',
  base: './',
  // Match the packaged renderer: parser entity decoding must use the pure worker export.
  resolve: { conditions: ['worker', 'module', 'browser', 'development|production'] },
  build: { outDir: buildRoot, emptyOutDir: false, minify: !allocations },
  worker: { format: 'es' },
  plugins: [
    {
      name: 'observe-packed-renderer-memory',
      enforce: 'pre',
      transform(code, id) {
        const path = id.replaceAll('\\', '/')
        const inject = (marker, calls) => {
          assert.ok(code.includes(marker), `Missing memory observation marker: ${path}: ${marker}`)
          return code.replace(marker, `${marker}; ${calls}`)
        }
        const watch = (kind, value) => `globalThis.__packedMemoryObserve?.('${kind}', ${value});`
        if (allocations) {
          const count = (kind) => `globalThis.__packedMemoryCount?.('${kind}');`
          if (path.endsWith('/core/src/packing-bytes.ts'))
            return inject('this.offset = offset', count('reader'))
          if (path.endsWith('/core/src/packing-view.ts'))
            return inject('this.#node = node', count('view'))
          if (path.endsWith('/core/src/packing-capture.ts')) {
            code = inject('this.#get = get', count('scope'))
            return inject('const keys = this.#get().keys(path, this.#path)', count('keyCopies'))
          }
        }
        if (path.endsWith('/core/src/packing-arena.ts'))
          return inject(
            'this.#index = index',
            watch('arena', 'this') +
              watch('arena-index', 'index') +
              watch('arena-payload', 'payload'),
          )
        for (const kind of ['document', 'word', 'projection']) {
          if (
            !path.endsWith(`/src/packed-${kind}-baseline.ts`) &&
            !path.endsWith(`/src/packing-${kind}-baseline.ts`)
          )
            continue
          code = inject(
            'this.#data = data',
            watch(`${kind}-metadata`, 'data') + watch(`${kind}-map`, 'data.records'),
          )
          if (kind === 'word')
            code = inject('const chunks = buffer.finishChunks()', watch('word-chunks', 'chunks'))
          return code
        }
        if (path.endsWith('/renderer/src/packed-preview.ts'))
          return inject(
            'const retainedBytes = 16384 + plan.retained',
            watch('native-input', 'input'),
          )
        if (path.endsWith('/preview/packed-preparation.ts'))
          return inject(
            'data.tracker = tracker',
            watch('native-model', 'data') + watch('occurrences', 'tracker'),
          )
      },
    },
  ],
}
await mkdir('test/artifacts/logs', { recursive: true })
const profile = await mkdtemp(resolve('test/artifacts/logs/packed-memory-profile-'))
const oracle = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
})
let server, application
try {
  const load = (name) => oracle.ssrLoadModule(`/packages/${name}.ts`)
  const { parseMarkdown } = await load('core/src/parse')
  const { packValue, unpackValue } = await load('core/src/packing')
  const { sourceHash } = await load('core/src/contracts')
  const { rendererVersion } = await load('renderer/src/index')
  const { renderProjectionLayout } = await load('renderer/src/projection-layout')
  await build(config)
  server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } })
  const address = server.httpServer.address()
  application = await electron.launch({
    args: [resolve('test/benchmark/fixtures/packed-memory/main.cjs')],
    env: {
      ...process.env,
      MANUSLIP_PACKED_MEMORY_PROFILE: profile,
      MANUSLIP_PACKED_MEMORY_URL: `http://127.0.0.1:${address.port}/index.html${producerMode ? '?producer' : constructionSites ? '?construction-sites' : ''}`,
    },
  })
  const page = await application.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.packedMemory))
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.debugger.attach('1.3'),
  )
  async function heap(collect = false) {
    const memory = await application.evaluate(async ({ BrowserWindow }, collect) => {
      const debug = BrowserWindow.getAllWindows()[0].webContents.debugger
      if (collect)
        for (let index = 0; index < 3; index++)
          await debug.sendCommand('HeapProfiler.collectGarbage')
      const isolate = await debug.sendCommand('Runtime.getIsolateId')
      const usage = await debug.sendCommand('Runtime.getHeapUsage')
      if (
        typeof usage.backingStorageSize !== 'number' ||
        typeof usage.embedderHeapUsedSize !== 'number'
      )
        throw new Error('Renderer backing/embedder heap observations unavailable')
      return { isolate: isolate.id, ...usage }
    }, collect)
    if (processMemory) memory.processMemory = await application.evaluate(readPackedProcessMemory)
    if (producerMode)
      memory.producer = await page.evaluate(() => {
        const stats = window.packedMemory.stats()
        return { phase: stats.producerPhase, running: stats.producerRunning }
      })
    return memory
  }
  async function debuggerCommand(method, params = {}) {
    return application.evaluate(
      ({ BrowserWindow }, { method, params }) =>
        BrowserWindow.getAllWindows()[0].webContents.debugger.sendCommand(method, params),
      { method, params },
    )
  }
  function sampledBytes(node) {
    return node.selfSize + node.children.reduce((sum, child) => sum + sampledBytes(child), 0)
  }
  async function allocationReport(peakProfile) {
    const stopped = await debuggerCommand('HeapProfiler.stopSampling')
    const profile =
      peakProfile && sampledBytes(peakProfile.head) > sampledBytes(stopped.profile.head)
        ? peakProfile
        : stopped.profile
    await writeFile(
      'test/artifacts/logs/packed-projection-allocations.heapprofile',
      JSON.stringify(profile),
    )
    const totals = new Map()
    function visit(node) {
      const frame = node.callFrame
      const key = `${frame.functionName || '(anonymous)'} ${frame.url}:${frame.lineNumber + 1}`
      totals.set(key, (totals.get(key) ?? 0) + node.selfSize)
      for (const child of node.children) visit(child)
    }
    visit(profile.head)
    return {
      sampledEstimatedBytes: [...totals.values()].reduce((sum, bytes) => sum + bytes, 0),
      top: [...totals]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 40)
        .map(([frame, bytes]) => ({ frame, bytes })),
    }
  }
  // CDP reports these as distinct components. Total is an observation, never an admission rule.
  const total = (value) => value.usedSize + value.backingStorageSize + value.embedderHeapUsedSize
  const phases = ['document', 'projection', 'words', 'preview', 'serialize']
  const configuration = await page.evaluate(() => ({
    capacity: window.packedMemory.capacity,
    limits: window.packedMemory.limits,
    options: window.packedMemory.options,
  }))
  function fixture(text) {
    const document = parseMarkdown(text)
    const { projection, layout } = renderProjectionLayout(
      document.root,
      configuration.options,
      configuration.capacity.retained,
    )
    const payload = packValue({ document, projection, layout }, configuration.capacity.bytes)
    return {
      document,
      projection,
      payload,
      identity: {
        generation: 1,
        revision: 0,
        documentId: 'packed-renderer-memory',
        sourceHash: sourceHash(text),
        parserVersion: document.parserVersion,
        rendererVersion,
        options: JSON.stringify(configuration.options),
      },
    }
  }
  async function clear() {
    const result = await page.evaluate(() => window.packedMemory.clear())
    assert.equal(result.finalOwner.retainedBytes, 0)
    assert.equal(result.finalOwner.readers, 0)
    assert.equal(result.finalOwner.readerStagingBytes, 0)
    const memory = await heap(true)
    const watched = await page.evaluate(() => window.packedMemory.stats())
    for (const [kind, refs] of Object.entries(watched.watched))
      assert.equal(refs.alive, 0, `Closed handles retain ${kind}`)
    return { result, memory, watched }
  }
  async function open(text, value) {
    if (producerMode) {
      const result = await page.evaluate(
        ({ text, identity }) => window.packedMemory.open(text, identity, ''),
        {
          text,
          identity: value.identity,
        },
      )
      await producerStopped()
      return result
    }
    const name = `${createHash('sha256').update(new Uint8Array(value.payload)).digest('hex')}.bin`
    await mkdir(resolve(buildRoot, 'cases'), { recursive: true })
    await writeFile(resolve(buildRoot, 'cases', name), new Uint8Array(value.payload))
    return page.evaluate(
      ({ text, identity, url }) => window.packedMemory.open(text, identity, url),
      { text, identity: value.identity, url: `./cases/${name}` },
    )
  }
  const producerWorkers = () =>
    page.workers().filter((worker) => worker.url().includes('producer.worker'))
  async function producerStopped() {
    const deadline = Date.now() + 5000
    while (producerWorkers().length) {
      assert.ok(Date.now() < deadline, 'Diagnostic producer worker survived termination')
      await delay(20)
    }
  }
  const warm = fixture('Warm **text**.\n\n~~~text\nsource\n~~~\n')
  await open('Warm **text**.\n\n~~~text\nsource\n~~~\n', warm)
  for (const phase of phases) await page.evaluate((phase) => window.packedMemory.run(phase), phase)
  await clear()
  const initialBaseline = await heap(true)
  async function measured(name, action, allocationPhase = false) {
    const samplingStart = performance.now()
    let settled = false
    const running = action().finally(() => {
      settled = true
    })
    // Immediately attach rejection handling while CDP samples run.
    const completion = running.then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    const samples = []
    let peakProfile
    do {
      samples.push(await heap())
      if (allocationPhase) {
        const { profile } = await debuggerCommand('HeapProfiler.getSamplingProfile')
        if (!peakProfile || sampledBytes(profile.head) > sampledBytes(peakProfile.head))
          peakProfile = profile
      }
      if (!settled) await delay(20)
    } while (!settled)
    const outcome = await completion
    if (outcome.error) throw outcome.error
    const uncollected = await heap()
    samples.push(uncollected)
    const allocationSummary = allocationPhase ? await allocationReport(peakProfile) : undefined
    const retained = await heap(true)
    return {
      phase: name,
      result: outcome.value,
      uncollected,
      retained,
      observedMaximum: samples.reduce((largest, sample) =>
        total(sample) > total(largest) ? sample : largest,
      ),
      samples: samples.length,
      samplingWindowMs: performance.now() - samplingStart,
      ...(processMemory
        ? { processMemorySamples: samples.map((sample) => sample.processMemory) }
        : {}),
      ...(producerMode
        ? {
            producerSamples: samples.map((sample) => ({
              producer: sample.producer,
              processMemory: sample.processMemory,
            })),
          }
        : {}),
      ...(allocationSummary ? { allocations: allocationSummary } : {}),
    }
  }
  async function run(name, text) {
    console.log(`Measuring actual Electron renderer: ${name}`)
    const value = fixture(text)
    const baseline = await heap(true)
    const stages = [await measured('admit-complete-snapshot', () => open(text, value))]
    assert.equal(stages[0].result.descriptors, value.document.blocks.length)
    if (producerMode) {
      assert.equal(stages[0].result.producerRunning, false)
      assert.equal(stages[0].result.producerReport.descriptors, value.document.blocks.length)
      assert.equal(stages[0].result.producerReport.widgets, value.projection.blocks.length)
      assert.ok(stages[0].result.producerReport.payloadBytes + 1024 <= configuration.capacity.bytes)
    }
    for (const phase of phases) {
      const sampleAllocations = allocations && name === 'nested-complete' && phase === 'projection'
      if (sampleAllocations)
        await debuggerCommand('HeapProfiler.startSampling', {
          samplingInterval: 262144,
        })
      const stage = await measured(
        phase,
        () => page.evaluate((phase) => window.packedMemory.run(phase), phase),
        sampleAllocations,
      )
      stages.push(stage)
      if (phase === 'preview') {
        assert.equal(stage.result.preview.widgets, value.projection.blocks.length)
        assert.ok(stage.result.owner.retainedBytes <= configuration.capacity.retained)
      }
    }
    // Export this diagnostic copy only after the measured serialization checkpoint.
    // Base64/Node unpacking are independent oracle overhead, outside renderer calibration.
    const encodedRoot = await page.evaluate(() => window.packedMemory.encodedRoot())
    const payload = Uint8Array.from(Buffer.from(encodedRoot, 'base64')).buffer
    const root = unpackValue(payload, {
      bytes: 8 * 1024 * 1024,
      retained: 32 * 1024 * 1024,
      staging: 8 * 1024 * 1024,
    }).value
    assert.deepEqual(root, value.document.root)
    const expectedRoot = JSON.stringify(value.document.root)
    await page.evaluate(() => window.packedMemory.retainChildScopes())
    const dropped = await page.evaluate(() => window.packedMemory.dropBaselines())
    const afterDrop = await heap(true)
    const remaining = await page.evaluate(() => window.packedMemory.stats())
    for (const kind of [
      'document-metadata',
      'document-map',
      'projection-metadata',
      'projection-map',
      'word-metadata',
      'word-map',
      'word-chunks',
    ]) {
      assert.ok(remaining.watched[kind]?.observed > 0, `Missing ${kind} observation`)
      assert.equal(remaining.watched[kind].alive, 0, `Closed baseline retains ${kind}`)
    }
    assert.ok(remaining.watched['native-input'].alive > 0)
    assert.ok(remaining.watched['native-model'].alive > 0)
    assert.ok(remaining.watched.arena.alive > 0)
    const cleared = await clear()
    const isolates = new Set(
      [
        baseline,
        afterDrop,
        cleared.memory,
        ...stages.flatMap((stage) => [stage.retained, stage.uncollected, stage.observedMaximum]),
      ].map((sample) => sample.isolate),
    )
    assert.equal(isolates.size, 1)
    for (const stage of stages)
      assert.ok(
        total(stage.retained) - total(baseline) <= stage.result.owner.retainedBytes,
        `Retained measured subset exceeds ownership estimate at ${name}/${stage.phase}`,
      )
    assert.ok(
      total(afterDrop) - total(baseline) <= dropped.owner.retainedBytes,
      'Retained measured subset exceeds ownership estimate after cache release',
    )
    const result = {
      name,
      sourceBytes: Buffer.byteLength(text),
      sourceSha256: createHash('sha256').update(text).digest('hex'),
      snapshotBytes: producerMode
        ? stages[0].result.producerReport.payloadBytes
        : value.payload.byteLength,
      ...(producerMode ? { oracleSnapshotBytes: value.payload.byteLength } : {}),
      descriptors: value.document.blocks.length,
      widgets: value.projection.blocks.length,
      fullRootBytes: payload.byteLength,
      completeRootSha256: createHash('sha256').update(expectedRoot).digest('hex'),
      baseline,
      stages,
      afterBaselineRelease: { result: dropped, memory: afterDrop, watched: remaining },
      cleared,
      retainedMeasuredSubsetWithinOwnership: true,
      retainedMeasuredIncrease: total(stages.at(-1).retained) - total(baseline),
      sampledMeasuredMaximumIncrease:
        Math.max(...stages.map((stage) => total(stage.observedMaximum))) - total(baseline),
      clearedGrowth: total(cleared.memory) - total(baseline),
      ...(processMemory
        ? {
            processMemory: summarizePackedProcessMemory(
              stages.flatMap((stage) => stage.processMemorySamples),
              baseline.processMemory,
            ),
          }
        : {}),
    }
    console.log(
      JSON.stringify({
        name,
        snapshotBytes: result.snapshotBytes,
        descriptors: result.descriptors,
        retainedMeasuredIncrease: result.retainedMeasuredIncrease,
        sampledMeasuredMaximumIncrease: result.sampledMeasuredMaximumIncrease,
        clearedGrowth: result.clearedGrowth,
        ...(processMemory ? { processMemory: result.processMemory } : {}),
      }),
    )
    return result
  }
  const MiB = 1024 * 1024
  const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const nested = `# nested-containers\n\n${chunk.repeat(Math.ceil(MiB / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
  assert.equal(Buffer.byteLength(nested), 1048669)
  assert.equal(
    createHash('sha256').update(nested).digest('hex'),
    '93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3',
  )
  const cases = [await run('nested-complete', nested)]
  const widgets = `${Array.from(
    { length: 80 },
    (_, index) =>
      `## Heading ${index}\n\nText 😀 [ref][r] and [^n].\n\n~~~text\n${'private source <tag> & '.repeat(64)}\n~~~\n\n$$\nx_${index}^2\n$$\n\n`,
  ).join('')}[r]: https://example.invalid/\n\n[^n]: Footer with ![image](local.png).\n`
  cases.push(await run('widgets-footnotes', widgets))
  cases.push(await run('nested-repeat', nested))
  let producerCancellation
  if (producerMode) {
    console.log('Measuring pending native producer cancellation with the complete predecessor live')
    const value = fixture(nested)
    await open(nested, value)
    for (const phase of phases)
      await page.evaluate((phase) => window.packedMemory.run(phase), phase)
    const before = await page.evaluate(() => window.packedMemory.stats())
    const baseline = await heap(true)
    const producing = page
      .evaluate((text) => window.packedMemory.producePending(text), `Pending edit.\n\n${nested}`)
      .then(
        (value) => ({ value }),
        (error) => ({ error: error.message }),
      )
    const pending = await measured('pending-native-producer', async () => {
      await page.waitForFunction(
        () => window.packedMemory.stats().producerPhase === 'paused-native-snapshot',
      )
      const paused = await heap(true)
      const retained = await page.evaluate(() => window.packedMemory.stats())
      assert.equal(retained.producerRunning, true)
      const workerUrls = producerWorkers().map((worker) => worker.url())
      assert.equal(workerUrls.length, 1, 'Missing actual suspended producer target')
      assert.deepEqual(retained.owner, before.owner)
      await page.evaluate(() => window.packedMemory.cancelProducer())
      const outcome = await producing
      await producerStopped()
      assert.match(outcome.error ?? '', /Diagnostic producer cancelled/)
      return {
        paused,
        retained,
        outcome,
        workerUrls,
        remainingProducerTargets: producerWorkers().length,
      }
    })
    const after = await page.evaluate(() => window.packedMemory.stats())
    assert.equal(after.producerRunning, false)
    assert.equal(after.busy, false)
    assert.deepEqual(after.owner, before.owner)
    const original = await page.evaluate(() => window.packedMemory.encodedRoot())
    const root = unpackValue(Uint8Array.from(Buffer.from(original, 'base64')).buffer, {
      bytes: configuration.capacity.bytes,
      retained: 32 * MiB,
      staging: 8 * MiB,
    }).value
    assert.deepEqual(root, value.document.root)
    producerCancellation = {
      baseline,
      before,
      pending,
      after,
      processMemory: summarizePackedProcessMemory(
        pending.processMemorySamples,
        baseline.processMemory,
      ),
      cleared: await clear(),
    }
  }
  console.log('Measuring cancellation after actual native word-cache chunks are copied')
  await open(nested, fixture(nested))
  for (const phase of ['document', 'projection'])
    await page.evaluate((phase) => window.packedMemory.run(phase), phase)
  await page.evaluate(() => window.packedMemory.retainChildScopes())
  await page.evaluate(() => window.packedMemory.armChunkCancellation())
  const copying = page
    .evaluate(() => window.packedMemory.run('words'))
    .then(
      (value) => ({ value }),
      (error) => ({ error: error.message }),
    )
  await page.waitForFunction(() => window.packedMemory.stats().chunkPaused)
  const pausedMemory = await heap(true)
  const paused = await page.evaluate(() => window.packedMemory.stats())
  assert.ok(paused.watched['word-chunks'].alive > 0)
  const cancelled = await page.evaluate(() => window.packedMemory.cancelAtChunks())
  const outcome = await copying
  assert.match(outcome.error ?? '', /Incomplete packed operation/)
  const cancelledMemory = await heap(true)
  const revoked = await page.evaluate(() => window.packedMemory.stats())
  assert.equal(revoked.watched['word-chunks'].alive, 0)
  assert.ok(revoked.watched.arena.alive > 0, 'Current owner must keep its packed arena alive')
  assert.equal(revoked.owner.readers, 0)
  assert.equal(revoked.owner.readerStagingBytes, 0)
  const cancellation = {
    paused,
    pausedMemory,
    cancelled,
    revoked,
    cancelledMemory,
    cleared: await clear(),
  }
  assert.deepEqual(errors, [])
  assert.equal(new Set(cases.map((item) => item.baseline.isolate)).size, 1)
  const result = {
    date: new Date().toISOString(),
    allocationProfiling: allocations,
    constructionSiteSampling: constructionSites,
    processMemoryProfiling: processMemory,
    producerMode,
    ...(producerMode
      ? {
          producerMethod:
            'Each admission starts an actual dedicated worker in the measured Electron renderer process. It receives the complete source under the existing request cap, fresh-parses and renders the complete native snapshot, encodes cooperatively under 32 MiB / 800k visits / depth 512, and transfers one payload under 8 MiB including a 1024-byte envelope reserve. Detachment is checked before the worker is terminated. Native parser/HAST/input allocations are included by OS process observations but are not admitted by the encoder ledger. Renderer isolate observations still exclude worker isolates. Node retains only independent expected parser/render output. A separate pending case pins a complete native producer snapshot while the previous owned preview and serialized root remain live, then terminates the producer and checks exact predecessor ownership/root preservation. This diagnostic does not activate production transport, calibrate a portable physical bound or satisfy packaged freshness gates.',
          producerCancellation,
        }
      : {}),
    ...(processMemory
      ? {
          processMemoryMethod:
            (producerMode
              ? 'Producer mode includes the dedicated native producer worker in the measured renderer OS process, including parsing/rendering/encoding. Successive phase observations describe the worker state after each process sample, not an atomic attribution. '
              : '') +
            'Separate minified mode. After each CDP heap query, read app.getAppMetrics in Electron main and match the measured webContents OS renderer PID and process creation time. Electron reports KiB; fields are normalized to bytes. Retain all sampled process rows and simultaneous totals. Working sets include shared pages; their sum is not unique physical memory. Windows private bytes measure private commitment, not resident physical RAM. OS peak working set is a lifetime high-water mark including startup/warmup, not a phase peak. Samples include the diagnostic loader Worker sharing the renderer process and Electron main/utility/GPU processes, but exclude the separate Node producer/oracle, browser automation and Vite host. Sampling changes cadence, can miss peaks, and does not represent mounted application widgets, production workers or aggregate production ownership. Heap and OS samples are successive, not atomic. No forced GC during work; post-GC checkpoints do not promise OS decommit. No admission threshold is inferred.',
          processMemorySource: 'https://www.electronjs.org/docs/latest/api/structures/memory-info',
          system: {
            platform: platform(),
            arch: arch(),
            release: release(),
            cpu: cpus()[0]?.model,
            logicalCpus: cpus().length,
            totalMemoryBytes: totalmem(),
          },
        }
      : {}),
    ...(allocations
      ? {
          allocationMethod:
            'Readable unminified diagnostic build; 262144-byte heap allocation sampling uses live samples and stops before forced collection. Collected samples are omitted. Estimated sampled allocations are neither a complete cumulative allocation count nor peak memory. Sampling changes execution costs. Ordinary minified runs remain the separate runtime memory evidence.',
        }
      : {}),
    runtime: await application.evaluate(() => process.versions),
    method:
      'Isolated actual Electron renderer with production packed session, document/projection/word caches, owned preview and full-root serializer. A diagnostic loader Worker fetches Node-generated fixture bytes outside the measured renderer isolate and transfers their ArrayBuffer; both sender detachment and session input consumption are checked. These isolate metrics exclude loader/producer memory and main-process IPC; no DOM widgets are mounted. Diagnostic-only numeric/WeakRef observations retain at most eight references per kind. Complete native parser/root oracle stays in Node. Request Runtime.getHeapUsage samples with a 20 ms pause between completed CDP calls during cooperative work, without forced GC; actual cadence also includes CDP latency. Three forced GCs at each retained checkpoint. Ownership weights are sampled at cooperative task boundaries and completion, not every advance, to avoid generating millions of diagnostic objects. Report V8 used heap, ArrayBuffer/external-string backing storage and embedder heap separately. Their sum is a measured subset, not process physical memory or RSS. Sampled maxima include garbage/diagnostic overhead, may miss peaks within synchronous calls and are not calibrated admission limits, packaged UI freshness or aggregate application ownership. Base64 oracle export occurs only after measured serialization. Closed handles, escaped composed capture/item scopes and revocable document context-prune callbacks remain retained through GC; all scope guards and closed-proof fallbacks are checked after cleanup.',
    configuration,
    initialBaseline,
    cases,
    cancellation,
    sameIsolateAcrossCases: true,
    finalClearedGrowthFromInitialBaseline:
      total(cancellation.cleared.memory) - total(initialBaseline),
  }
  const report = producerMode
    ? 'test/artifacts/logs/packed-producer-process-memory.json'
    : processMemory
      ? 'test/artifacts/logs/packed-renderer-process-memory.json'
      : constructionSites
        ? 'test/artifacts/logs/packed-renderer-construction-sites.json'
        : allocations
          ? 'test/artifacts/logs/packed-renderer-allocations.json'
          : 'test/artifacts/logs/packed-renderer-memory.json'
  await writeFile(report, `${JSON.stringify(result, null, 2)}\n`)
  console.log(`Saved ${report}`)
} finally {
  try {
    await application?.close()
  } finally {
    await server?.close()
    await oracle.close()
    assert.ok(
      profile.startsWith(`${resolve('test/artifacts/logs')}${sep}`),
      'Diagnostic profile cleanup escaped the log directory',
    )
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
