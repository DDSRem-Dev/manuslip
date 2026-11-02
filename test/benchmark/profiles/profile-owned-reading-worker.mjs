import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _electron as electron } from '@playwright/test'
import { build, createServer, preview } from 'vite'

const config = {
  configFile: false,
  root: resolve('test/e2e/fixtures/owned-reading-memory'),
  clearScreen: false,
  logLevel: 'silent',
  base: './',
  build: {
    outDir: resolve('test/artifacts/logs/owned-reading-memory-build'),
    emptyOutDir: false,
    minify: false,
  },
  worker: {
    format: 'es',
    plugins: () => [
      {
        name: 'owned-reading-checkpoints',
        enforce: 'pre',
        transform(code, id) {
          const path = id.replaceAll('\\', '/')
          if (path.endsWith('/owned-reading-memory/reading.worker.ts'))
            return `${code}
          const maxima = new Map()
          Reflect.set(globalThis, '__ownedReadingMaxima', maxima)
          Reflect.set(globalThis, '__ownedReadingCheckpoint', (phase, bytes, scratch) => {
            if (bytes <= (maxima.get(phase) ?? -1)) return
            maxima.set(phase, bytes)
            Reflect.set(globalThis, '__ownedReadingSample', {phase, bytes, scratch: typeof scratch === 'number' ? scratch : undefined, stats: owner?.stats})
            for (let cycle = 0; cycle < 3; cycle++) Reflect.get(globalThis, 'gc')()
            debugger
          })`
          if (path.endsWith('/renderer/src/packed-reading.ts')) {
            const marker = 'admit(undefined, bytes, scratch)'
            assert.ok(code.includes(marker), 'Missing output reservation checkpoint')
            return code.replace(
              marker,
              `if (scratch > 0) Reflect.get(globalThis, '__ownedReadingCheckpoint')('join-reserve', bytes, scratch); ${marker}`,
            )
          }
          if (!path.endsWith('/renderer/src/reading-workspace.ts')) return
          for (const [marker, phase] of [
            ['const descriptions: ProjectionDescriptions = new Map()', 'constructed'],
            ['this.#lastNodes = plan.nodes', 'policy'],
            [
              'const plan = finish(planProjectionSerialization(tree, new Map(), this.options, this.limits))',
              'serialize',
            ],
          ]) {
            assert.ok(code.includes(marker), `Missing owned reading checkpoint: ${marker}`)
            code = code.replace(
              marker,
              `${marker}; Reflect.get(globalThis, '__ownedReadingCheckpoint')('${phase}', this.bytes)`,
            )
          }
          return code
        },
      },
    ],
  },
  resolve: { conditions: ['worker', 'module', 'browser', 'development|production'] },
}
await mkdir('test/artifacts/logs', { recursive: true })
const profile = await mkdtemp(resolve('test/artifacts/logs/owned-reading-memory-profile-'))
const oracle = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
})
let server, application
try {
  const load = (name) => oracle.ssrLoadModule(`/packages/${name}.ts`)
  const { parseMarkdown } = await load('core/src/parse')
  const { sourceHash } = await load('core/src/contracts')
  const { packValue } = await load('core/src/packing')
  const { rendererVersion } = await load('renderer/src/index')
  const { readingBlocks, renderReading, expandReadingIndex } = await load('renderer/src/reading')
  const { extractTranslation } = await load('translate/src/extract')
  const { reconstructTranslation } = await load('translate/src/reconstruct')
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
  await page.waitForFunction(() => Boolean(window.ownedReadingMemory))
  await application.evaluate(async ({ app, BrowserWindow }) => {
    const debug = BrowserWindow.getAllWindows()[0].webContents.debugger
    debug.attach('1.3')
    const state = { debug, session: undefined, samples: [], errors: [] }
    Reflect.set(app, '__ownedReadingDebug', state)
    debug.on('message', async (_event, method, params, session) => {
      try {
        if (method === 'Target.attachedToTarget' && params.targetInfo?.type === 'worker') {
          await debug.sendCommand('Debugger.enable', {}, params.sessionId)
          state.session = params.sessionId
        }
        if (method === 'Debugger.paused') {
          const measured = await debug.sendCommand(
            'Debugger.evaluateOnCallFrame',
            {
              callFrameId: params.callFrames[0].callFrameId,
              expression: 'JSON.stringify(globalThis.__ownedReadingSample)',
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
    await debug.sendCommand('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    })
  })
  async function inspect(expression) {
    return application.evaluate(async ({ app }, expression) => {
      const { debug, session } = Reflect.get(app, '__ownedReadingDebug')
      if (!session) throw new Error('Diagnostic worker session unavailable')
      const result = await debug.sendCommand(
        'Runtime.evaluate',
        {
          expression: `JSON.stringify(${expression})`,
          returnByValue: true,
        },
        session,
      )
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return JSON.parse(result.result.value)
    }, expression)
  }
  async function heap() {
    return application.evaluate(async ({ app }) => {
      const { debug, session } = Reflect.get(app, '__ownedReadingDebug')
      for (let i = 0; i < 3; i++)
        await debug.sendCommand('HeapProfiler.collectGarbage', {}, session)
      return debug.sendCommand('Runtime.getHeapUsage', {}, session)
    })
  }
  async function samples(reset = false) {
    return application.evaluate(({ app }, reset) => {
      const state = Reflect.get(app, '__ownedReadingDebug')
      if (state.errors.length) throw new Error(state.errors.join('\n'))
      const values = state.samples
      if (reset) state.samples = []
      return values
    }, reset)
  }
  const request = (operation) =>
    page.evaluate((operation) => window.ownedReadingMemory.request(operation), operation)
  const options = { rawHtml: true, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
  const normalize = (projection) =>
    JSON.stringify(
      projection.indexed
        ? { ...projection, html: expandReadingIndex(projection), indexed: undefined }
        : projection,
    ).replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, 'UUID')
  const digest = (projection) => createHash('sha256').update(normalize(projection)).digest('hex')
  const total = (usage) => {
    assert.equal(typeof usage.backingStorageSize, 'number')
    assert.equal(typeof usage.embedderHeapUsedSize, 'number')
    return usage.usedSize + usage.backingStorageSize + usage.embedderHeapUsedSize
  }
  async function run(name, text, syntax) {
    console.log(`Measuring owned Electron reading: ${name}/${syntax}`)
    await request({ kind: 'clear' })
    await inspect('globalThis.__ownedReadingMaxima.clear() ?? true')
    await samples(true)
    const baseline = await heap()
    const document = parseMarkdown(text, syntax)
    const blocks = readingBlocks(document.root, text)
    const payload = packValue({ root: document.root }, 8 * 1024 * 1024)
    const encoded = Buffer.from(payload).toString('base64')
    const prepared = await page.evaluate(
      async ({ encoded, operation }) => {
        const payload = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)).buffer
        return window.ownedReadingMemory.request({ ...operation, payload })
      },
      {
        encoded,
        operation: {
          kind: 'prepare',
          source: text,
          blocks,
          identity: {
            generation: 1,
            documentId: 'owned-reading-runtime',
            revision: 0,
            sourceHash: sourceHash(text),
            parserVersion: document.parserVersion,
            rendererVersion,
            options: JSON.stringify(options),
          },
        },
      },
    )
    assert.equal(prepared.detached, true)
    const afterPlan = await heap()
    const native = extractTranslation(document.root, text)
    const rebuilt = reconstructTranslation(
      native,
      new Map(
        native.units.flatMap((unit) =>
          unit.payload ? [[unit.occurrenceId, `Changed ${unit.payload.text}`]] : [],
        ),
      ),
    )
    const layouts = []
    for (const layout of ['replace', 'side-by-side', 'interlinear']) {
      await inspect('globalThis.__ownedReadingMaxima.clear() ?? true')
      await samples(true)
      const rendered = await request({ kind: 'render', layout })
      const expected = renderReading(document.root, rebuilt.root, options, {
        layout,
        blocks,
        units: native.units,
        translated: new Set(
          rebuilt.statuses
            .filter((value) => value.status === 'translated')
            .map((value) => native.units.find((unit) => unit.occurrenceId === value.occurrenceId))
            .map((unit) => `${unit.from}:${unit.to}`),
        ),
        sourceLanguage: 'en',
        targetLanguage: 'ar',
        labels: { original: 'Original', translation: 'Translation' },
        indexAboveBytes: 0,
      })
      assert.equal(digest(rendered.value.projection), digest(expected))
      const observed = await samples()
      assert.ok(observed.some((entry) => entry.phase === 'serialize'))
      assert.ok(observed.some((entry) => entry.phase === 'output'))
      const measuredIncrease =
        Math.max(...observed.map((entry) => total(entry.usage))) - total(baseline)
      const weightedPeak = Math.max(...observed.map((entry) => entry.stats.retainedBytes))
      assert.ok(
        weightedPeak >= measuredIncrease,
        `Sampled ${name}/${syntax}/${layout} worker increase ${measuredIncrease} exceeds admission weight ${weightedPeak}`,
      )
      layouts.push({
        layout,
        equality: true,
        cost: rendered.value.cost,
        checkpoints: observed,
        sampledMeasuredIncrease: measuredIncrease,
        weightedPeak,
        sampledWeightCoversIncrease: weightedPeak >= measuredIncrease,
        afterRender: await heap(),
      })
      console.log(JSON.stringify({ name, syntax, layout, measuredIncrease, weightedPeak }))
    }
    await request({ kind: 'clear' })
    return {
      name,
      syntax,
      sourceBytes: Buffer.byteLength(text),
      sourceSha256: createHash('sha256').update(text).digest('hex'),
      payloadBytes: payload.byteLength,
      baseline,
      prepared: prepared.value,
      afterPlan,
      layouts,
      afterClear: await heap(),
    }
  }
  const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const nested = `# nested-containers\n\n${chunk.repeat(Math.ceil((1024 * 1024) / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
  assert.equal(Buffer.byteLength(nested), 1048669)
  assert.equal(
    createHash('sha256').update(nested).digest('hex'),
    '93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3',
  )
  const cases = []
  // Establish the runtime baseline after exercising lazy native renderer/module setup.
  // Cold-start code/regex/backing allocations are outside this retained-graph comparison;
  // the separately recorded cold probe does not fit the small frame's graph weight.
  const warmText =
    '# Hello\n\nProse **strong** `secret` [link][r] and note[^n].\n\n[r]: /private\n\n[^n]: Note $x$.\n'
  const warmDocument = parseMarkdown(warmText)
  await page.evaluate(
    async ({ encoded, operation }) => {
      const payload = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)).buffer
      return window.ownedReadingMemory.request({ ...operation, payload })
    },
    {
      encoded: Buffer.from(packValue({ root: warmDocument.root }, 8 * 1024 * 1024)).toString(
        'base64',
      ),
      operation: {
        kind: 'prepare',
        source: warmText,
        blocks: readingBlocks(warmDocument.root, warmText),
        identity: {
          generation: 1,
          documentId: 'owned-reading-warmup',
          revision: 0,
          sourceHash: sourceHash(warmText),
          parserVersion: warmDocument.parserVersion,
          rendererVersion,
          options: JSON.stringify(options),
        },
      },
    },
  )
  for (const layout of ['replace', 'side-by-side', 'interlinear'])
    await request({ kind: 'render', layout })
  await request({ kind: 'clear' })
  cases.push(
    await run(
      'warm',
      '# Hello\n\nProse **strong** `secret` [link][r] and note[^n].\n\n[r]: /private\n\n[^n]: Note $x$.\n',
      'manuslip',
    ),
  )
  for (const syntax of ['commonmark', 'manuslip'])
    cases.push(await run('nested-complete', nested, syntax))
  const report = {
    date: new Date().toISOString(),
    electron: await application.evaluate(() => process.versions.electron),
    runtimeWarmup:
      'All three layouts, protected text, references, footnotes and math before each measured baseline. Cold runtime setup is excluded; its small-case admission mismatch remains recorded separately.',
    method:
      'Isolated Vite build (minification disabled to preserve debugger checkpoints) in an actual Electron worker using the owned packed plan/reading consumers. At increasing frame admission weights and complete output, the worker forces GC before pausing; CDP then measures V8 used heap plus backing storage plus embedder heap. Independent full native output oracles stay in the Node driver. Diagnostic output copies to the driver synchronously inside its admitted borrow. This samples retained graph peaks; it does not bound synchronous transient allocations, outgoing response clone/envelope scratch, process RSS, aggregate current/pending/captured application ownership, provider jobs or the production queue. Debugger pauses invalidate latency measurements. Production reading adoption and semantic activation remain separate gates.',
    cases,
  }
  await writeFile(
    'test/artifacts/logs/owned-reading-worker-memory.json',
    `${JSON.stringify(report, null, 2)}\n`,
  )
} finally {
  await application?.close()
  await server?.close()
  await oracle.close()
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
}
