import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error('Run with node --expose-gc test/benchmark/profiles/profile-packed-reading.mjs')
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
})
async function collectedMemory() {
  for (let i = 0; i < 3; i++) {
    await immediate()
    global.gc()
  }
  return process.memoryUsage()
}
try {
  const { parseMarkdown } = await server.ssrLoadModule('/packages/core/src/parse.ts')
  const { sourceHash } = await server.ssrLoadModule('/packages/core/src/contracts.ts')
  const { rendererVersion } = await server.ssrLoadModule('/packages/renderer/src/index.ts')
  const { readingBlocks, renderReading } = await server.ssrLoadModule(
    '/packages/renderer/src/reading.ts',
  )
  const { packValue, unpackValue } = await server.ssrLoadModule('/packages/core/src/packing.ts')
  const { PackedSession } = await server.ssrLoadModule('/packages/core/src/packing-session.ts')
  const { prepareReading } = await server.ssrLoadModule(
    '/apps/desktop/src/renderer/src/translation/prepare.ts',
  )
  const { ReadingProcessor } = await server.ssrLoadModule(
    '/apps/desktop/src/renderer/src/translation/engine.ts',
  )
  const { CompactReadingBlocks } = await server.ssrLoadModule(
    '/apps/desktop/src/renderer/src/translation/compact-blocks.ts',
  )
  const { decodeReadingValue, sharedReadingPrepared } = await server.ssrLoadModule(
    '/apps/desktop/src/renderer/src/translation/prepared-wire.ts',
  )
  const { prepareTranslation } = await server.ssrLoadModule('/packages/translate/src/identity.ts')
  const { capabilitiesFor } = await server.ssrLoadModule('/packages/translate/src/providers.ts')
  const { extractCompactTranslation, extractSharedTranslation, extractTranslation } =
    await server.ssrLoadModule('/packages/translate/src/extract.ts')
  const { reconstructSharedTranslation } = await server.ssrLoadModule(
    '/packages/translate/src/reconstruct-shared.ts',
  )
  const { reconstructTranslation } = await server.ssrLoadModule(
    '/packages/translate/src/reconstruct.ts',
  )
  const { readingLimits, readingOperationBytes } = await server.ssrLoadModule(
    '/apps/desktop/src/renderer/src/translation/protocol.ts',
  )
  const MiB = 1024 * 1024
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
  const identity = (text, document) => ({
    generation: 1,
    documentId: 'reading-profile',
    revision: 0,
    sourceHash: sourceHash(text),
    parserVersion: document.parserVersion,
    rendererVersion,
    options: JSON.stringify(options),
  })
  const text = `# Hello 世界\n\n${'Hello *world*, `PRIVATE_CODE`, $x^2$, [label][ref] and note[^n].\n\n'.repeat(120)}[ref]: https://private.invalid/ "PRIVATE_TITLE"\n\n[^n]: Hello footnote.\n\n<div>PRIVATE_HTML</div>\n`
  const document = parseMarkdown(text)
  const owner = new PackedSession({
    bytes: 8 * MiB,
    retained: 64 * MiB,
    staging: 8 * MiB,
    captures: 8,
    readers: 160,
  })
  const id = identity(text, document)
  owner.commit(
    owner.prepareFull(owner.begin(id, text), id, packValue({ root: document.root }, 8 * MiB)),
  )
  const capture = owner.capture()
  owner.evict()
  const processor = new ReadingProcessor()
  let wireBytes = 0,
    messageBytes = 0,
    workerMs = 0,
    slices = 1,
    maxSliceMs = 0
  let peakRetained = owner.stats.retainedBytes,
    peakStaging = 0
  const runtime = {
    now: () => {
      peakRetained = Math.max(peakRetained, owner.stats.retainedBytes)
      peakStaging = Math.max(peakStaging, owner.stats.readerStagingBytes)
      return performance.now()
    },
    defer: (run) =>
      setImmediate(() => {
        const start = performance.now()
        run()
        maxSliceMs = Math.max(maxSliceMs, performance.now() - start)
        slices++
      }),
  }
  const started = performance.now()
  try {
    const pending = prepareReading(
      {
        request: async (operation) => {
          assert.equal(operation.kind, 'prepare-packed')
          wireBytes = operation.payload.byteLength
          messageBytes = readingOperationBytes(operation)
          assert.ok(messageBytes <= readingLimits.message)
          // Independent complete parser oracle; this diagnostic comparison is outside the
          // production ledger. The packaged E2E separately observes an actual Worker transfer.
          const restored = unpackValue(operation.payload, {
            bytes: 8 * MiB,
            retained: 32 * MiB,
            staging: 8 * MiB,
          })
          assert.equal(JSON.stringify(restored.value), JSON.stringify(document.root))
          const transferred = structuredClone(operation, { transfer: [operation.payload] })
          assert.equal(operation.payload.byteLength, 0)
          const start = performance.now()
          const value = await processor.execute(transferred)
          workerMs = performance.now() - start
          return value
        },
        dispose: () => processor.clear(),
      },
      { kind: 'packed', capture, path: ['root'], bytes: 100 },
      text,
      settings,
      new AbortController().signal,
      runtime,
    )
    maxSliceMs = Math.max(maxSliceMs, performance.now() - started)
    const prepared = await pending
    const totalMs = performance.now() - started
    assert.equal(prepared.kind, 'prepared')
    assert.equal(owner.stats.retainedBytes, 256)
    const oracle = new ReadingProcessor()
    const native = await oracle.execute({
      kind: 'prepare',
      root: document.root,
      source: text,
      settings,
    })
    const units = (value) => value.units.map(({ occurrenceId: _, ...unit }) => unit)
    assert.deepEqual(units(prepared), units(native))
    const outputs = prepared.units
      .filter((unit) => unit.key && unit.payload)
      .map((unit) => ({ key: unit.key, output: unit.payload.text.replaceAll('Hello', '你好') }))
    const actual = await processor.execute({ kind: 'render', options, outputs })
    const expected = await oracle.execute({ kind: 'render', options, outputs })
    const normalize = (value) =>
      JSON.stringify(value).replace(
        /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g,
        'ID',
      )
    assert.equal(normalize(actual), normalize(expected))
    assert.ok(actual.projection.html.includes('你好'))
    assert.ok(actual.projection.html.includes('https://private.invalid/'))
    processor.clear()
    oracle.clear()

    const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
    const nested = `# nested-containers\n\n${chunk.repeat(Math.ceil(MiB / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
    const sourceSha256 = createHash('sha256').update(nested).digest('hex')
    assert.equal(sourceSha256, '93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3')
    const nestedDocument = parseMarkdown(nested)
    const payload = packValue(nestedDocument.root, readingLimits.message)
    const nestedPayloadBytes = payload.byteLength
    const nativeRoot = unpackValue(payload, {
      bytes: 8 * MiB,
      retained: 32 * MiB,
      staging: 8 * MiB,
    })
    const nestedPlan = extractTranslation(nativeRoot.value, nested)
    const sharedMemory = await collectedMemory()
    const sharedStart = performance.now()
    const sharedPlan = extractSharedTranslation(nativeRoot.value, nested, {
      retained: 16 * MiB,
      staging: 8 * MiB,
    })
    const sharedMs = performance.now() - sharedStart
    const sharedObserved = (await collectedMemory()).heapUsed - sharedMemory.heapUsed
    const compactMemory = await collectedMemory(),
      compactStart = performance.now()
    const compactPlan = extractCompactTranslation(nativeRoot.value, nested, {
      retained: 16 * MiB,
      staging: 8 * MiB,
    })
    const compactMs = performance.now() - compactStart
    const compactObserved = (await collectedMemory()).heapUsed - compactMemory.heapUsed
    assert.equal(
      JSON.stringify(compactPlan.units.map(({ occurrenceId: _, ...unit }) => unit)),
      JSON.stringify(nestedPlan.units.map(({ occurrenceId: _, ...unit }) => unit)),
    )
    assert.equal(sharedPlan.root, nestedPlan.root)
    assert.equal(
      JSON.stringify(sharedPlan.units.map(({ occurrenceId: _, ...unit }) => unit)),
      JSON.stringify(nestedPlan.units.map(({ occurrenceId: _, ...unit }) => unit)),
    )
    const jobs = await prepareTranslation(
      sharedPlan,
      settings,
      capabilitiesFor(settings.provider.adapter),
    )
    const nestedPrepared = {
      kind: 'prepared',
      units: sharedPlan.units.map((unit) => ({
        occurrenceId: unit.occurrenceId,
        kind: unit.kind,
        from: unit.from,
        to: unit.to,
        hash: sourceHash(nested.slice(unit.from, unit.to)),
        key: jobs.occurrences.get(unit.occurrenceId) ?? null,
        payload: unit.payload,
      })),
      blocks: readingBlocks(nativeRoot.value, nested),
    }
    const nestedResponse = sharedReadingPrepared(nestedPrepared)
    assert.deepEqual(decodeReadingValue(structuredClone(nestedResponse.value)), nestedPrepared)
    assert.equal(nestedResponse.value.payloads.length, 3)
    const nestedAccounting = {
      decodedRetained: nativeRoot.retainedBytes,
      decodedStaging: nativeRoot.stagingBytes,
      fullPlanJsonBytes: Buffer.byteLength(JSON.stringify(nestedPlan)),
      unitJsonBytes: Buffer.byteLength(JSON.stringify(nestedPlan.units)),
      units: nestedPlan.units.length,
      shared: { ...sharedPlan.cost, milliseconds: sharedMs, observedHeapDelta: sharedObserved },
      compact: {
        ...compactPlan.cost,
        milliseconds: compactMs,
        observedHeapDelta: compactObserved,
        privateBindingNodes: compactPlan.units.reduce((sum, unit) => sum + unit.bindings.length, 0),
        accessorUnits: compactPlan.units.filter(
          (unit) => Object.getOwnPropertyDescriptor(unit, 'bindings').get,
        ).length,
        completeUnitsEquivalent: true,
      },
      response: {
        repeatedJsonBytes: Buffer.byteLength(JSON.stringify(nestedPrepared)),
        sharedJsonBytes: Buffer.byteLength(JSON.stringify(nestedResponse.value)),
        descriptorBytes: nestedResponse.bytes,
        uniquePayloads: nestedResponse.value.payloads.length,
        completeUnitsEquivalent: true,
        fullWorkerPrepareAdmitted: true,
      },
    }
    const fallbackMemory = await collectedMemory()
    const reconstructStart = performance.now()
    const sourceFallback = reconstructSharedTranslation(nestedPlan, new Map(), {
      retained: 8 * MiB,
      staging: 8 * MiB,
    })
    const sourceFallbackMs = performance.now() - reconstructStart
    assert.equal(sourceFallback.root, nativeRoot.value)
    assert.equal(sourceFallback.statuses.length, nestedPlan.units.length)
    const fallbackObserved = (await collectedMemory()).heapUsed - fallbackMemory.heapUsed
    const selected = nestedPlan.units.find((unit) => unit.payload?.text.includes('Nested writing'))
    assert.ok(selected?.payload)
    const oneOutput = new Map([
      [selected.occurrenceId, selected.payload.text.replace('Nested writing', 'Changed writing')],
    ])
    const partialMemory = await collectedMemory()
    const partialStart = performance.now()
    const partial = reconstructSharedTranslation(nestedPlan, oneOutput, {
      retained: 8 * MiB,
      staging: 8 * MiB,
    })
    const partialMs = performance.now() - partialStart
    const partialObserved = (await collectedMemory()).heapUsed - partialMemory.heapUsed
    assert.equal(partial.statuses.filter((unit) => unit.status === 'translated').length, 1)
    const detachedMemory = await collectedMemory()
    const detachedStart = performance.now()
    const detached = reconstructTranslation(nestedPlan, oneOutput)
    const detachedMs = performance.now() - detachedStart
    const detachedObserved = (await collectedMemory()).heapUsed - detachedMemory.heapUsed
    assert.equal(JSON.stringify(partial.root), JSON.stringify(detached.root))
    assert.equal(partial.root.children.at(-1), nativeRoot.value.children.at(-1))
    const sharedReconstruction = {
      sourceFallback: {
        milliseconds: sourceFallbackMs,
        retainedAndWorkspaceBytes: sourceFallback.retainedBytes,
        stagingBytes: sourceFallback.stagingBytes,
        rootShared: sourceFallback.root === nativeRoot.value,
        observedHeapDelta: fallbackObserved,
      },
      oneTranslatedUnit: {
        milliseconds: partialMs,
        retainedAndWorkspaceBytes: partial.retainedBytes,
        stagingBytes: partial.stagingBytes,
        detachedEquivalent: true,
        untouchedDefinitionShared: true,
        observedHeapDelta: partialObserved,
      },
      detachedOracle: { milliseconds: detachedMs, observedHeapDelta: detachedObserved },
    }
    function releasedReconstruction() {
      const value = reconstructSharedTranslation(nestedPlan, oneOutput, {
        retained: 8 * MiB,
        staging: 8 * MiB,
      })
      let changed = value.root
      for (const index of selected.path) changed = changed.children[index]
      const text = changed.children.find((node) => node.type === 'text')
      assert.ok(text)
      return [
        new WeakRef(value.root),
        new WeakRef(value.root.children),
        new WeakRef(value.statuses),
        new WeakRef(value),
        new WeakRef(text),
      ]
    }
    const reconstructionRefs = releasedReconstruction()
    await collectedMemory()
    assert.equal(reconstructionRefs.filter((ref) => ref.deref()).length, 0)
    assert.equal(nestedPlan.root, nativeRoot.value)
    sharedReconstruction.releasedOutputCollection = {
      observed: reconstructionRefs.length,
      alive: 0,
      originalRootStillRetained: true,
    }
    const large = new ReadingProcessor()
    const largeStart = performance.now()
    const largePrepared = await large.execute({
      kind: 'prepare-packed',
      payload,
      identity: identity(nested, nestedDocument),
      source: nested,
      settings,
    })
    const largePrepareMs = performance.now() - largeStart
    assert.equal(largePrepared.kind, 'prepared')
    assert.equal(largePrepared.units.length, 6299)
    assert.equal(large.stats.payloadKeys, 3)
    const largeResponse = sharedReadingPrepared(largePrepared)
    assert.equal(normalize(largePrepared), normalize(nestedPrepared))
    assert.deepEqual(decodeReadingValue(structuredClone(largeResponse.value)), largePrepared)
    const largeStats = large.stats
    const renderStart = performance.now()
    const nestedRendered = await large.execute({
      kind: 'render',
      outputs: [],
      options,
      blocks: largePrepared.blocks,
    })
    const nestedRenderMs = performance.now() - renderStart
    assert.equal(nestedRendered.kind, 'rendered')
    await assert.rejects(
      large.execute({ kind: 'render', outputs: [], options }),
      /translation-view-limit/,
    )
    const nestedProjection = renderReading(nativeRoot.value, nativeRoot.value, options, {
      layout: 'replace',
      blocks: largePrepared.blocks,
      sourceLanguage: '',
      targetLanguage: settings.targetLanguage,
      labels: { original: 'Original', translation: 'Translation' },
      translated: new Set(),
      units: largePrepared.units,
    })
    const nestedProjectionBytes = Buffer.byteLength(JSON.stringify(nestedProjection)) * 2
    assert.ok(nestedProjectionBytes <= readingLimits.projection)
    assert.equal(normalize(nestedRendered.projection), normalize(nestedProjection))
    const heading = largePrepared.units[0]
    assert.equal(heading.kind, 'heading')
    const headingOutput = 'Nested translation'
    const headingStart = performance.now()
    const headingRendered = await large.execute({
      kind: 'render',
      options,
      blocks: largePrepared.blocks,
      outputs: [{ key: heading.key, output: headingOutput }],
    })
    const headingRenderMs = performance.now() - headingStart
    const headingOracle = reconstructTranslation(
      nestedPlan,
      new Map([[nestedPlan.units[0].occurrenceId, headingOutput]]),
    )
    assert.equal(
      headingOracle.statuses.filter((status) => status.status === 'translated').length,
      1,
    )
    const headingProjection = renderReading(nativeRoot.value, headingOracle.root, options, {
      layout: 'replace',
      blocks: largePrepared.blocks,
      sourceLanguage: '',
      targetLanguage: settings.targetLanguage,
      labels: { original: 'Original', translation: 'Translation' },
      translated: new Set([`${heading.from}:${heading.to}`]),
      units: largePrepared.units,
    })
    assert.equal(normalize(headingRendered.projection), normalize(headingProjection))
    const bilingualLimits = {}
    for (const layout of ['side-by-side', 'interlinear']) {
      await assert.rejects(
        large.execute({
          kind: 'render',
          outputs: [],
          options,
          blocks: largePrepared.blocks,
          layout,
        }),
        (error) => error.message === 'translation-view-limit' && error.cause === 'projection',
      )
      bilingualLimits[layout] = 'projection limit'
    }
    large.clear()
    await assert.rejects(
      large.execute({ kind: 'render', outputs: [], options }),
      /translation-view-worker/,
    )
    const closed = [],
      observed = []
    function closeForks(phase) {
      const session = new PackedSession({
        bytes: 8 * MiB,
        retained: 64 * MiB,
        staging: 8 * MiB,
        captures: 8,
        readers: 160,
      })
      const small = parseMarkdown('Hello'),
        key = identity('Hello', small)
      const prepared = session.prepareFull(
        session.begin(key, 'Hello'),
        key,
        packValue({ root: small.root }, 8 * MiB),
      )
      if (phase !== 'prepared') session.commit(prepared)
      const first = phase === 'prepared' ? session.capturePrepared(prepared) : session.capture()
      const fork = first.retain(),
        second = fork.retain()
      observed.push(new WeakRef(session), new WeakRef(fork.sourceResource))
      const task = second.serialize(['root'], {
        bytes: 8 * MiB,
        workspace: 3 * MiB,
        nodes: 800000,
        depth: 128,
      })
      if (phase === 'partial') for (let i = 0; i < 3; i++) task.next()
      first.release()
      if (phase === 'prepared') session.discard(prepared)
      session.evict()
      fork.release()
      second.release()
      task.return()
      assert.equal(session.stats.retainedBytes, 256)
      closed.push(first, fork, second, task)
    }
    for (const phase of ['committed', 'prepared', 'partial']) closeForks(phase)
    for (let i = 0; i < 12; i++) {
      await immediate()
      global.gc()
      await immediate()
    }
    const alive = observed.filter((ref) => ref.deref()).length
    assert.equal(alive, 0)
    const clearedProcessors = []
    async function releasedSharedPlan() {
      const text = 'Hello **world** `PRIVATE`.\n\nHello **world** `OTHER`.'
      const doc = parseMarkdown(text),
        processor = new ReadingProcessor()
      const payload = packValue(doc.root, 8 * MiB)
      const prepared = await processor.execute({
        kind: 'prepare-packed',
        payload,
        identity: identity(text, doc),
        source: text,
        settings,
      })
      assert.equal(payload.byteLength, 0)
      assert.equal(prepared.units[0].payload, prepared.units[1].payload)
      const plan = Reflect.get(processor, 'plan')
      const unit = plan.units.find((unit) => Object.getOwnPropertyDescriptor(unit, 'bindings').get)
      assert.ok(unit)
      const refs = [
        new WeakRef(plan),
        new WeakRef(plan.root),
        new WeakRef(unit),
        new WeakRef(unit.payload),
        new WeakRef(unit.payload.tokens),
        new WeakRef(Reflect.get(processor, 'blocks')),
      ]
      processor.clear()
      clearedProcessors.push(processor)
      return refs
    }
    const planRefs = await releasedSharedPlan()
    await collectedMemory()
    const planAlive = planRefs.filter((ref) => ref.deref()).length
    assert.equal(planAlive, 0)
    const responseProcessors = []
    async function releasedPreparedResponse() {
      const doc = parseMarkdown(text),
        processor = new ReadingProcessor()
      const operation = {
        kind: 'prepare-packed',
        payload: packValue(doc.root, readingLimits.message),
        identity: identity(text, doc),
        source: text,
        settings: structuredClone(settings),
      }
      const prepared = await processor.execute(operation)
      const refs = [
        new WeakRef(prepared),
        new WeakRef(prepared.units),
        new WeakRef(prepared.units[0]),
        new WeakRef(prepared.blocks),
        new WeakRef(prepared.blocks[0]),
        new WeakRef(operation),
        new WeakRef(operation.identity),
        new WeakRef(operation.settings),
        new WeakRef(operation.settings.provider),
        new WeakRef(operation.settings.glossary),
      ]
      responseProcessors.push(processor)
      return refs
    }
    const responseRefs = await releasedPreparedResponse()
    await collectedMemory()
    const responseAlive = responseRefs.filter((ref) => ref.deref()).length
    assert.equal(responseAlive, 0)
    assert.ok(Reflect.get(responseProcessors[0], 'plan'))
    assert.ok(Reflect.get(responseProcessors[0], 'keys').size > 0)
    const afterResponseRelease = await responseProcessors[0].execute({
      kind: 'render',
      outputs: [],
      options,
    })
    assert.ok(afterResponseRelease.projection.html.includes('PRIVATE_CODE'))
    responseProcessors[0].clear()
    async function capacityCase(tokens, count, translate = false) {
      const capacitySource = `Prose ${'`PRIVATE` '.repeat(tokens)}\n\n`.repeat(count)
      const capacityDocument = parseMarkdown(capacitySource)
      const capacityNative = {
        kind: 'prepare',
        root: capacityDocument.root,
        source: capacitySource,
        settings,
      }
      const nativeBytes = Buffer.byteLength(JSON.stringify(capacityNative))
      assert.ok(nativeBytes > readingLimits.message)
      const capacityProcessor = new ReadingProcessor()
      await assert.rejects(capacityProcessor.execute(capacityNative), /translation-view-limit/)
      const capacityPayload = packValue(capacityDocument.root, readingLimits.message)
      const capacityWireBytes = capacityPayload.byteLength
      const capacityStart = performance.now()
      const capacityPrepared = await capacityProcessor.execute({
        kind: 'prepare-packed',
        payload: capacityPayload,
        identity: identity(capacitySource, capacityDocument),
        source: capacitySource,
        settings,
      })
      const capacityPrepareMs = performance.now() - capacityStart
      assert.equal(capacityPrepared.units.length, count)
      const response = sharedReadingPrepared(capacityPrepared)
      assert.deepEqual(decodeReadingValue(structuredClone(response.value)), capacityPrepared)
      const uniquePayloads = new Set(capacityPrepared.units.map((unit) => unit.payload)).size
      assert.equal(uniquePayloads, 1)
      const workerBytes = Reflect.get(capacityProcessor, 'bytes')
      const capacityStats = capacityProcessor.stats
      const preparePeakBytes = capacityStats.planPeakBytes
      const extractionStagingBytes = Reflect.get(capacityProcessor, 'plan').cost.stagingBytes
      const blockCapacity = capacityDocument.root.children.length + 1
      const previousBlockCharge =
        blockCapacity * 768 - CompactReadingBlocks.reservation(blockCapacity)
      const prepareOnlyBytes = preparePeakBytes - workerBytes
      assert.ok(preparePeakBytes <= readingLimits.worker)
      // Independent ordinary-binding plan is a diagnostic oracle, outside worker ownership.
      const ordinaryPlan = extractSharedTranslation(
        Reflect.get(capacityProcessor, 'plan').root,
        capacitySource,
        {
          retained: readingLimits.worker,
          staging: readingLimits.message,
        },
      )
      const ordinaryBindingExtraBytes =
        ordinaryPlan.cost.retainedBytes - Reflect.get(capacityProcessor, 'plan').cost.retainedBytes
      assert.ok(workerBytes <= readingLimits.worker)
      const output = capacityPrepared.units[0].payload.text.replace('Prose', 'Translated')
      const renderStart = performance.now()
      const capacityRendered = await capacityProcessor.execute({
        kind: 'render',
        outputs: translate ? [{ key: capacityPrepared.units[0].key, output }] : [],
        options,
      })
      const renderMs = performance.now() - renderStart
      assert.equal(capacityRendered.projection.html.match(/PRIVATE/g).length, tokens * count)
      if (translate)
        assert.equal(capacityRendered.projection.html.match(/Translated/g).length, count)
      const oraclePlan = translate
        ? extractTranslation(capacityDocument.root, capacitySource)
        : null
      const oracleRebuilt = oraclePlan
        ? reconstructTranslation(
            oraclePlan,
            new Map(oraclePlan.units.map((unit) => [unit.occurrenceId, output])),
          )
        : null
      if (oracleRebuilt)
        assert.equal(
          oracleRebuilt.statuses.filter((status) => status.status === 'translated').length,
          count,
        )
      const capacityOracle = renderReading(
        capacityDocument.root,
        oracleRebuilt?.root ?? capacityDocument.root,
        options,
        {
          layout: 'replace',
          blocks: capacityPrepared.blocks,
          sourceLanguage: '',
          targetLanguage: settings.targetLanguage,
          labels: { original: 'Original', translation: 'Translation' },
          translated: new Set(oraclePlan?.units.map((unit) => `${unit.from}:${unit.to}`)),
          units: capacityPrepared.units,
        },
      )
      assert.equal(normalize(capacityRendered.projection), normalize(capacityOracle))
      capacityProcessor.clear()
      return {
        sourceBytes: Buffer.byteLength(capacitySource),
        nativeBytes,
        packedRootBytes: capacityWireBytes,
        prepareMs: capacityPrepareMs,
        renderMs,
        fullyTranslated: translate,
        workerBytes,
        preparePeakBytes,
        prepareOnlyBytes,
        ordinaryBindingExtraBytes,
        legacyPermanentChargeRenderFits:
          workerBytes +
            previousBlockCharge +
            capacitySource.length * 2 +
            count * 896 -
            capacityStats.payloadKeys * 512 +
            extractionStagingBytes +
            ordinaryBindingExtraBytes +
            readingLimits.message <=
          readingLimits.worker,
        units: capacityPrepared.units.length,
        uniquePayloads,
        protectedOccurrences: tokens * count,
        repeatedResponseJsonBytes: Buffer.byteLength(JSON.stringify(capacityPrepared)),
        legacyDescriptorBytes:
          (Buffer.byteLength(JSON.stringify(capacityPrepared.units)) +
            Buffer.byteLength(JSON.stringify(capacityPrepared.blocks))) *
          2,
        sharedResponseJsonBytes: Buffer.byteLength(JSON.stringify(response.value)),
        descriptorBytes: response.bytes,
        completeRenderEquivalent: true,
        mainSemanticTransportActivated: false,
      }
    }
    const workerCapacity = await capacityCase(180, 200)
    const descriptorCapacity = await capacityCase(220, 240)
    assert.ok(descriptorCapacity.legacyDescriptorBytes > readingLimits.descriptors)
    const phaseCapacity = await capacityCase(240, 260)
    assert.equal(phaseCapacity.legacyPermanentChargeRenderFits, false)
    const translatedCapacity = await capacityCase(240, 280, true)
    const result = {
      date: new Date().toISOString(),
      runtime: process.versions,
      method:
        'Development Node diagnostic using the production renderer serializer and reading processor, structured-clone transfer, independent complete native-root/provider-unit/final-projection equality. Weighted caps remain unchanged. This is not a real Worker timing, portable heap calibration or packaged freshness result.',
      bounded: {
        sourceBytes: Buffer.byteLength(text),
        nativeMessageBytes: Buffer.byteLength(
          JSON.stringify({ kind: 'prepare', root: document.root, source: text, settings }),
        ),
        wireBytes,
        messageBytes,
        units: prepared.units.length,
        slices,
        maxSliceMs,
        totalMs,
        workerMs,
        peakRetained,
        peakStaging,
        finalRetained: owner.stats.retainedBytes,
      },
      authoritativeNested: {
        accounting: nestedAccounting,
        sharedReconstruction,
        sourceSha256,
        sourceBytes: Buffer.byteLength(nested),
        rootPayloadBytes: nestedPayloadBytes,
        result: 'prepared; complete replacement rendered',
        prepareMs: largePrepareMs,
        stats: largeStats,
        completePreparedEquivalent: true,
        renderMs: nestedRenderMs,
        completeSourceRenderEquivalent: true,
        oneTranslatedHeading: { renderMs: headingRenderMs, completeRenderEquivalent: true },
        bilingualLimits,
        nativeReplacementProjectionBytes: nestedProjectionBytes,
        missingMappedBlocksResult: 'translation-view-limit',
        planClearedAfterRenderCheck: true,
      },
      closedForkCollection: { retainedHandles: closed.length, observed: observed.length, alive },
      clearedSharedPlanCollection: {
        retainedProcessors: clearedProcessors.length,
        observed: planRefs.length,
        alive: planAlive,
      },
      releasedPreparedResponseCollection: {
        retainedProcessors: responseProcessors.length,
        observed: responseRefs.length,
        alive: responseAlive,
        planRetainedDuringCollection: true,
        renderAfterCollection: true,
      },
      workerCapacity,
      descriptorCapacity,
      phaseCapacity,
      translatedCapacity,
    }
    await mkdir('test/artifacts/logs', { recursive: true })
    await writeFile(
      'test/artifacts/logs/packed-reading-profile.json',
      `${JSON.stringify(result, null, 2)}\n`,
    )
    console.log(JSON.stringify(result, null, 2))
  } finally {
    capture.release()
    owner.dispose()
    processor.clear()
  }
  await immediate()
} finally {
  await server.close()
}
