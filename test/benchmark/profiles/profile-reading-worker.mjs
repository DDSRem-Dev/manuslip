import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _electron as electron } from '@playwright/test'
import { build, createServer, preview } from 'vite'

// The isolated diagnostic build adds numeric/WeakRef inspection only. It leaves the
// production wrapper, transfer, processor and response publication intact. The diagnostic
// request queue runs directly; debugger pauses exclude production watchdog/latency gates.
const inspection = `
const observed = []
const temporary = []
const maxima = new Map()
Object.defineProperty(globalThis, '__readingMemory', { value: Object.freeze({
  stats: () => processor.stats,
  clear: () => processor.clear(),
  reset: () => maxima.clear(),
  checkpoint: (phase, bytes) => {
    if (bytes <= (maxima.get(phase) ?? -1)) return
    maxima.set(phase, bytes)
    Reflect.set(globalThis, '__readingSample', {
      phase, bytes, stats: processor.packed?.owner.stats,
    })
    // Match the idle samples: backing-store release can lag the first full GC.
    for (let cycle = 0; cycle < 3; cycle++) Reflect.get(globalThis, 'gc')()
    debugger
  },
  observe: () => {
    observed.length = 0
    temporary.length = 0
    const packed = processor.packed
    const plan = packed?.plan
    const unit = plan?.units.find(unit => Object.getOwnPropertyDescriptor(unit, 'bindings')?.get)
      ?? plan?.units.find(unit => unit.payload)
    for (const value of [packed, plan, plan?.units, unit, unit?.payload,
      unit?.payload?.tokens, packed?.blocks, packed?.source, packed?.capture]) {
      if (value) observed.push(new WeakRef(value))
    }
    return observed.length
  },
  alive: () => observed.reduce((count, ref) => count + Number(!!ref.deref()), 0),
  observeChildren: children => {
    if (!children || temporary.length >= 6) return
    temporary.push(new WeakRef(children))
    const node = children.find(node => node.type === 'text')
    if (node) temporary.push(new WeakRef(node))
  },
  temporary: () => ({ observed: temporary.length,
    alive: temporary.reduce((count, ref) => count + Number(!!ref.deref()), 0) }),
}) })
`
const config = {
  configFile: false,
  root: resolve('test/e2e/fixtures/reading-memory'),
  clearScreen: false,
  logLevel: 'silent',
  base: './',
  build: {
    outDir: resolve('test/artifacts/logs/reading-memory-build'),
    emptyOutDir: false,
    minify: false,
  },
  worker: {
    format: 'es',
    plugins: () => [
      {
        name: 'reading-memory-inspection',
        enforce: 'pre',
        transform(code, id) {
          code = code.replaceAll('\r\n', '\n')
          const path = id.replaceAll('\\', '/')
          if (path.endsWith('/renderer/src/projection-children.ts')) {
            const anchor = 'const replacement = children(node)'
            assert.ok(code.includes(anchor), 'Projection callback changed')
            return code.replace(
              anchor,
              `${anchor}\nglobalThis.__readingMemory.observeChildren(replacement)`,
            )
          }
          if (path.endsWith('/renderer/src/reading-workspace.ts')) {
            for (const [marker, phase] of [
              ['const descriptions: ProjectionDescriptions = new Map()', 'constructed'],
              ['this.#lastNodes = plan.nodes', 'policy'],
              ['this.#workspace.add(plan.bytes)\n  }\n  close()', 'serialize'],
            ]) {
              assert.ok(code.includes(marker), `Missing frame checkpoint: ${marker}`)
              const checkpoint = `globalThis.__readingMemory.checkpoint('${phase}', this.bytes)`
              code =
                phase === 'serialize'
                  ? code.replace(
                      marker,
                      `this.#workspace.add(plan.bytes); ${checkpoint}\n  }\n  close()`,
                    )
                  : code.replace(marker, `${marker}; ${checkpoint}`)
            }
            return code
          }
          if (path.endsWith('/renderer/src/packed-reading.ts')) {
            const marker = 'output.resize(bytes, scratch)'
            assert.ok(code.includes(marker), 'Missing join checkpoint')
            return code.replace(
              marker,
              `${marker}; if (scratch > 0) globalThis.__readingMemory.checkpoint('join', bytes)`,
            )
          }
          if (path.endsWith('/translation/packed-engine.ts')) {
            const marker = 'send(response)'
            assert.ok(code.includes(marker), 'Missing publication checkpoint')
            return code.replace(
              marker,
              `globalThis.__readingMemory.checkpoint('clone-before', this.owner.stats.retainedBytes); ${marker}; globalThis.__readingMemory.checkpoint('clone-after', this.owner.stats.retainedBytes)`,
            )
          }
          if (!path.endsWith('/translation/reading.worker.ts')) return
          const anchor = 'const processor = new ReadingProcessor()'
          assert.ok(code.includes(anchor), 'Production reading wrapper changed')
          return code.replace(anchor, `${anchor}\n${inspection}`)
        },
      },
    ],
  },
  resolve: { conditions: ['worker', 'module', 'browser', 'development|production'] },
}
await mkdir('test/artifacts/logs', { recursive: true })
const profile = await mkdtemp(resolve('test/artifacts/logs/reading-memory-profile-'))
const oracle = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
})
let server, application
try {
  const { parseMarkdown } = await oracle.ssrLoadModule('/packages/core/src/parse.ts')
  const { sourceHash } = await oracle.ssrLoadModule('/packages/core/src/contracts.ts')
  const { packValue } = await oracle.ssrLoadModule('/packages/core/src/packing.ts')
  const { rendererVersion } = await oracle.ssrLoadModule('/packages/renderer/src/index.ts')
  const { readingBlocks, renderReading, expandReadingIndex, readingProjectionBytes } =
    await oracle.ssrLoadModule('/packages/renderer/src/reading.ts')
  const { extractTranslation } = await oracle.ssrLoadModule('/packages/translate/src/extract.ts')
  const { reconstructTranslation } = await oracle.ssrLoadModule(
    '/packages/translate/src/reconstruct.ts',
  )
  const { reconstructSharedTranslation } = await oracle.ssrLoadModule(
    '/packages/translate/src/reconstruct-shared.ts',
  )
  const { prepareTranslation } = await oracle.ssrLoadModule('/packages/translate/src/identity.ts')
  const { capabilitiesFor } = await oracle.ssrLoadModule('/packages/translate/src/providers.ts')
  const { decodeReadingValue } = await oracle.ssrLoadModule(
    '/apps/desktop/src/renderer/src/translation/prepared-wire.ts',
  )
  const { readingLimits } = await oracle.ssrLoadModule(
    '/apps/desktop/src/renderer/src/translation/protocol.ts',
  )
  await build(config)
  server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } })
  const address = server.httpServer.address()
  application = await electron.launch({
    args: ['--js-flags=--expose-gc', resolve('test/e2e/fixtures/reading-memory/main.cjs')],
    env: {
      ...process.env,
      MANUSLIP_READING_MEMORY_PROFILE: profile,
      MANUSLIP_READING_MEMORY_URL: `http://127.0.0.1:${address.port}/index.html`,
    },
  })
  const page = await application.firstWindow()
  await page.waitForFunction(() => Boolean(window.readingMemory))
  await application.evaluate(async ({ app, BrowserWindow }) => {
    const debug = BrowserWindow.getAllWindows()[0].webContents.debugger
    debug.attach('1.3')
    const sessions = new Map()
    const state = { debug, sessions, samples: [], errors: [] }
    debug.on('message', async (_event, method, params, session) => {
      try {
        if (method === 'Target.attachedToTarget' && params.targetInfo?.type === 'worker') {
          await debug.sendCommand('Debugger.enable', {}, params.sessionId)
          sessions.set(params.sessionId, params.targetInfo)
        }
        if (method === 'Target.detachedFromTarget') sessions.delete(params.sessionId)
        if (method === 'Debugger.paused') {
          const measured = await debug.sendCommand(
            'Debugger.evaluateOnCallFrame',
            {
              callFrameId: params.callFrames[0].callFrameId,
              expression: 'JSON.stringify(globalThis.__readingSample)',
              returnByValue: true,
            },
            session,
          )
          const usage = await debug.sendCommand('Runtime.getHeapUsage', {}, session)
          state.samples.push({ ...JSON.parse(measured.result.value), usage })
          await debug.sendCommand('Debugger.resume', {}, session)
        }
      } catch (error) {
        state.errors.push(String(error))
        if (method === 'Debugger.paused') await debug.sendCommand('Debugger.resume', {}, session)
      }
    })
    Reflect.set(app, '__readingMemoryDebug', state)
    await debug.sendCommand('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    })
  })
  async function inspect(expression) {
    return application.evaluate(async ({ app }, expression) => {
      const { debug, sessions } = Reflect.get(app, '__readingMemoryDebug')
      if (sessions.size !== 1) throw new Error(`Expected one worker, found ${sessions.size}`)
      const [session] = sessions.keys()
      const result = await debug.sendCommand(
        'Runtime.evaluate',
        { expression: `JSON.stringify(${expression})`, returnByValue: true },
        session,
      )
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
      return JSON.parse(result.result.value)
    }, expression)
  }
  async function heap() {
    return application.evaluate(async ({ app }) => {
      const { debug, sessions } = Reflect.get(app, '__readingMemoryDebug')
      if (sessions.size !== 1) throw new Error(`Expected one worker, found ${sessions.size}`)
      const [session] = sessions.keys()
      for (let i = 0; i < 3; i++)
        await debug.sendCommand('HeapProfiler.collectGarbage', {}, session)
      const isolate = await debug.sendCommand('Runtime.getIsolateId', {}, session)
      const usage = await debug.sendCommand('Runtime.getHeapUsage', {}, session)
      if (typeof usage.backingStorageSize !== 'number')
        throw new Error('Runtime lacks worker backing-store measurements')
      return { isolate: isolate.id, ...usage }
    })
  }
  async function samples(reset = false) {
    return application.evaluate(({ app }, reset) => {
      const state = Reflect.get(app, '__readingMemoryDebug')
      if (state.errors.length) throw new Error(state.errors.join('\n'))
      const values = state.samples
      if (reset) state.samples = []
      return values
    }, reset)
  }
  const options = { rawHtml: true, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
  const settings = {
    provider: {
      adapter: 'ollama',
      version: '1',
      baseUrl: 'http://localhost:11434/api/chat',
      model: 'fake',
      profile: null,
      options: {},
    },
    sourceLanguage: 'auto',
    targetLanguage: 'zh-CN',
    glossary: [],
    formality: 'default',
    promptVersion: 'prose-translation/v1',
  }
  const normalize = (value) =>
    JSON.stringify(
      value?.indexed ? { ...value, html: expandReadingIndex(value), indexed: undefined } : value,
    ).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID')
  const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  await page.evaluate(() => window.readingMemory.start())
  async function prepare(source, document) {
    const payload = packValue(document.root, readingLimits.message)
    const payloadBytes = payload.byteLength
    const started = performance.now()
    const response = await page.evaluate(
      async ({ encoded, operation }) => {
        const payload = Uint8Array.from(atob(encoded), (character) =>
          character.charCodeAt(0),
        ).buffer
        return window.readingMemory.request({ ...operation, payload })
      },
      {
        encoded: Buffer.from(payload).toString('base64'),
        operation: {
          kind: 'prepare-packed',
          source,
          settings,
          identity: {
            generation: 1,
            documentId: 'reading-worker-memory',
            revision: 0,
            sourceHash: sourceHash(source),
            parserVersion: document.parserVersion,
            rendererVersion,
            options: JSON.stringify(options),
          },
        },
      },
    )
    assert.equal(response.detached, true)
    const elapsed = performance.now() - started
    assert.equal(response.value.kind, 'prepared-shared')
    const prepared = decodeReadingValue(response.value)
    return {
      prepared,
      payloadBytes,
      elapsed,
      responseBytes: Buffer.byteLength(JSON.stringify(response.value)),
      payloads: response.value.payloads.length,
    }
  }
  const total = (usage) => usage.usedSize + usage.backingStorageSize + usage.embedderHeapUsedSize
  async function run(name, source, translate, checkCapacity = false, syntax = 'manuslip') {
    console.log(`Measuring actual Electron worker: ${name}`)
    // A real small prepare/render warms decode, hash, serializer and render modules.
    const warmSource = '# Warm\n\nHello **world** `PRIVATE`.\n'
    const warm = await prepare(warmSource, parseMarkdown(warmSource))
    await page.evaluate(
      ({ blocks, options }) =>
        window.readingMemory.request({
          kind: 'render',
          outputs: [],
          blocks,
          options,
        }),
      { blocks: warm.prepared.blocks, options },
    )
    await inspect('globalThis.__readingMemory.clear() ?? true')
    await inspect('globalThis.__readingMemory.reset() ?? true')
    await samples(true)
    const baseline = await heap()
    const document = parseMarkdown(source, syntax)
    const plan = extractTranslation(document.root, source)
    const jobs = await prepareTranslation(
      plan,
      settings,
      capabilitiesFor(settings.provider.adapter),
    )
    const measured = await prepare(source, document)
    const retained = await heap()
    const stats = await inspect('globalThis.__readingMemory.stats()')
    const observed = await inspect('globalThis.__readingMemory.observe()')
    const fields = ({ occurrenceId: _, ...unit }) => unit
    const expectedUnits = plan.units.map((unit) => ({
      kind: unit.kind,
      from: unit.from,
      to: unit.to,
      hash: sourceHash(source.slice(unit.from, unit.to)),
      key: jobs.occurrences.get(unit.occurrenceId) ?? null,
      payload: unit.payload,
    }))
    assert.equal(digest(measured.prepared.units.map(fields)), digest(expectedUnits))
    const blockFields = ({ id: _, ...block }) => block
    assert.equal(
      digest(measured.prepared.blocks.map(blockFields)),
      digest(readingBlocks(document.root, source).map(blockFields)),
    )
    const outputs = translate
      ? jobs.jobs.map((job) => ({
          key: job.key,
          output: job.payload.text.replace('Prose', 'Translated'),
        }))
      : []
    const byKey = new Map(outputs.map((entry) => [entry.key, entry.output]))
    const nativeOutputs = new Map(
      plan.units.flatMap((unit) => {
        const output = byKey.get(jobs.occurrences.get(unit.occurrenceId))
        return output === undefined ? [] : [[unit.occurrenceId, output]]
      }),
    )
    const rebuilt = reconstructTranslation(plan, nativeOutputs)
    const renderStarted = performance.now()
    const rendered = await page.evaluate((operation) => window.readingMemory.request(operation), {
      kind: 'render',
      outputs,
      options,
      blocks: measured.prepared.blocks,
    })
    const renderMs = performance.now() - renderStarted
    assert.equal(rendered.value.kind, 'rendered')
    const afterRender = await heap()
    const temporaryAfterRender = await inspect('globalThis.__readingMemory.temporary()')
    if (translate) {
      assert.ok(temporaryAfterRender.observed > 0)
      assert.equal(temporaryAfterRender.alive, 0)
    }
    const renderStats = await inspect('globalThis.__readingMemory.stats()')
    const byOccurrence = new Map(plan.units.map((unit) => [unit.occurrenceId, unit]))
    const projectionOracle = (layout, rebuilt) =>
      renderReading(document.root, rebuilt.root, options, {
        layout,
        blocks: measured.prepared.blocks,
        sourceLanguage: '',
        targetLanguage: settings.targetLanguage,
        labels: { original: 'Original', translation: 'Translation' },
        translated: new Set(
          rebuilt.statuses
            .filter((status) => status.status === 'translated')
            .map((status) => {
              const unit = byOccurrence.get(status.occurrenceId)
              assert.ok(unit)
              return `${unit.from}:${unit.to}`
            }),
        ),
        units: plan.units,
      })
    const expectedProjection = projectionOracle('replace', rebuilt)
    assert.equal(
      digest(normalize(rendered.value.projection)),
      digest(normalize(expectedProjection)),
    )
    if (translate)
      assert.equal(
        rebuilt.statuses.filter((s) => s.status === 'translated').length,
        plan.units.length,
      )
    const capacity = []
    if (checkCapacity) {
      const variants = [
        { layout: 'side-by-side', outputs, rebuilt },
        { layout: 'interlinear', outputs, rebuilt },
      ]
      if (!translate) {
        const fullOutputs = jobs.jobs.map((job) => ({
          key: job.key,
          output: `Translated ${job.payload.text}`,
        }))
        const byKey = new Map(fullOutputs.map((entry) => [entry.key, entry.output]))
        const rebuilt = reconstructTranslation(
          plan,
          new Map(
            plan.units.map((unit) => [
              unit.occurrenceId,
              byKey.get(jobs.occurrences.get(unit.occurrenceId)),
            ]),
          ),
        )
        assert.equal(
          rebuilt.statuses.filter((status) => status.status === 'translated').length,
          plan.units.length,
        )
        variants.push({ layout: 'replace', outputs: fullOutputs, rebuilt })
        variants.push(
          { layout: 'side-by-side', outputs: fullOutputs, rebuilt },
          { layout: 'interlinear', outputs: fullOutputs, rebuilt },
        )
      }
      for (const variant of variants) {
        const expected = projectionOracle(variant.layout, variant.rebuilt)
        const outputsByKey = new Map(variant.outputs.map((entry) => [entry.key, entry.output]))
        let reconstructionOracle
        try {
          const reconstructed = reconstructSharedTranslation(
            plan,
            (unit) => outputsByKey.get(jobs.occurrences.get(unit.occurrenceId)),
            { retained: readingLimits.worker, staging: readingLimits.message },
          )
          assert.equal(digest(reconstructed.root), digest(variant.rebuilt.root))
          reconstructionOracle = {
            result: 'complete root equivalent',
            retainedAndWorkspaceCharge: reconstructed.retainedBytes,
            stagingCharge: reconstructed.stagingBytes,
          }
        } catch (error) {
          assert.equal(error.code, 'translation-limit')
          reconstructionOracle = { result: 'translation-limit', limit: readingLimits.worker }
        }
        const value = await page.evaluate((operation) => window.readingMemory.request(operation), {
          kind: 'render',
          outputs: variant.outputs,
          layout: variant.layout,
          options,
          blocks: measured.prepared.blocks,
        })
        assert.equal(value.value.kind, 'rendered')
        assert.equal(digest(normalize(value.value.projection)), digest(normalize(expected)))
        const memory = await heap()
        const temporaryAfterRender = await inspect('globalThis.__readingMemory.temporary()')
        if (value && variant.outputs.length > 0) {
          assert.ok(temporaryAfterRender.observed > 0)
          assert.equal(temporaryAfterRender.alive, 0)
        }
        const currentStats = await inspect('globalThis.__readingMemory.stats()')
        const entry = {
          layout: variant.layout,
          fullyTranslated: variant.outputs.length > 0,
          result: 'complete render equivalent',
          nativeProjectionCharge: Buffer.byteLength(JSON.stringify(expected)) * 2,
          retainedProjectionCharge: value ? readingProjectionBytes(value.value.projection) : null,
          indexedRows: value?.value.projection.indexed?.order.length ?? 0,
          indexedValues: value?.value.projection.indexed?.values.length ?? 0,
          stats: currentStats,
          temporaryAfterRender,
          reconstructionOracle: {
            ...reconstructionOracle,
            availableWorkerCharge:
              readingLimits.worker - currentStats.retainedBytes - readingLimits.message,
          },
          memory,
          observedRetainedDelta: total(memory) - total(baseline),
        }
        capacity.push(entry)
        console.log(JSON.stringify({ name, capacity: { ...entry, memory: undefined } }))
      }
    }
    await inspect('globalThis.__readingMemory.clear() ?? true')
    const cleared = await heap()
    const alive = await inspect('globalThis.__readingMemory.alive()')
    assert.equal(alive, 0)
    assert.equal((await inspect('globalThis.__readingMemory.stats()')).retainedBytes, 0)
    const checkpoints = await samples()
    await writeFile(
      'test/artifacts/logs/reading-worker-latest-checkpoints.json',
      `${JSON.stringify({ name, baseline, checkpoints }, null, 2)}\n`,
    )
    for (const phase of [
      'constructed',
      'policy',
      'serialize',
      'join',
      'clone-before',
      'clone-after',
    ])
      assert.ok(
        checkpoints.some((entry) => entry.phase === phase),
        `Missing ${phase} sample`,
      )
    for (const entry of checkpoints) {
      assert.ok(entry.stats.retainedBytes <= readingLimits.worker)
      assert.ok(entry.stats.readerStagingBytes <= readingLimits.message)
      assert.ok(
        entry.stats.retainedBytes >= total(entry.usage) - total(baseline),
        `Underweighted ${name}/${entry.phase}: measured ${total(entry.usage) - total(baseline)}, admitted ${entry.stats.retainedBytes}`,
      )
    }
    const result = {
      name,
      syntax,
      sourceBytes: Buffer.byteLength(source),
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      payloadBytes: measured.payloadBytes,
      responseBytes: measured.responseBytes,
      units: measured.prepared.units.length,
      blocks: measured.prepared.blocks.length,
      canonicalPayloads: measured.payloads,
      fullyTranslated: translate,
      completePreparedEquivalent: true,
      completeProjectionEquivalent: true,
      prepareRoundTripMs: measured.elapsed,
      renderRoundTripMs: renderMs,
      stats,
      renderStats,
      baseline,
      retained,
      afterRender,
      capacity,
      cleared,
      observedRetainedDelta: total(retained) - total(baseline),
      observedAfterRenderDelta: total(afterRender) - total(baseline),
      observedClearedDelta: total(cleared) - total(baseline),
      collection: { observed, alive },
      temporaryAfterRender,
      checkpoints,
      sampledPeakIncrease: Math.max(
        ...checkpoints.map((entry) => total(entry.usage) - total(baseline)),
      ),
      weightedPeak: Math.max(
        stats.planPeakBytes,
        ...checkpoints.map((entry) => entry.stats.retainedBytes),
      ),
    }
    console.log(
      JSON.stringify({
        name,
        stats,
        observedRetainedDelta: result.observedRetainedDelta,
        observedAfterRenderDelta: result.observedAfterRenderDelta,
        observedClearedDelta: result.observedClearedDelta,
        collection: result.collection,
      }),
    )
    return result
  }
  const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const nested = `# nested-containers\n\n${chunk.repeat(Math.ceil(1048576 / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
  assert.equal(
    createHash('sha256').update(nested).digest('hex'),
    '93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3',
  )
  const cases = []
  cases.push(await run('nested-complete-source', nested, false, true))
  cases.push(await run('nested-commonmark-source', nested, false, true, 'commonmark'))
  cases.push(
    await run(
      'protected-complete-translation',
      `Prose ${'`PRIVATE` '.repeat(240)}\n\n`.repeat(280),
      true,
      true,
    ),
  )
  cases.push(await run('nested-repeat', nested, false))
  assert.equal(new Set(cases.map((item) => item.retained.isolate)).size, 1)
  const result = {
    date: new Date().toISOString(),
    runtime: await application.evaluate(() => process.versions),
    method:
      'Actual production Electron Worker and response publication, diagnostic-only numeric/WeakRef hooks, separate complete native oracle. At increasing frame weights, admitted final joins and before/after real postMessage, force GC before debugger pause and measure V8 heap plus backing storage plus embedder heap. Every sampled live graph must fit its simultaneous ledger; all layouts and complete translations must succeed. Closed native replacements and persistent packed metadata must collect. Samples do not bound synchronous transient native/clone allocations, process RSS, aggregate application ownership, portable limits or semantic admission. Debugger pauses invalidate latency measurements.',
    limits: readingLimits,
    cases,
    sameIsolateAcrossCases: true,
    finalClearedGrowthFromInitialBaseline: total(cases.at(-1).cleared) - total(cases[0].baseline),
  }
  await writeFile(
    'test/artifacts/logs/reading-worker-memory.json',
    `${JSON.stringify(result, null, 2)}\n`,
  )
  console.log('Saved test/artifacts/logs/reading-worker-memory.json')
} finally {
  try {
    await application?.close()
  } finally {
    await server?.close()
    await oracle.close()
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
