import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { Session } from 'node:inspector/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error('Run with node --expose-gc test/benchmark/profiles/profile-packed-reuse.mjs')
const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const sessionLimits = { ...limits, retained: 64 * MiB, bytes: 8 * MiB, readers: 160, captures: 8 }
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
const cpu = process.argv.includes('--cpu') ? new Session() : undefined
const reuseDocument = process.argv.includes('--document')
const producerMetadata = reuseDocument && !process.argv.includes('--no-producer-metadata')
if (process.argv.includes('--no-producer-metadata') && !reuseDocument)
  throw new Error('--no-producer-metadata requires --document')
const reuseWords = process.argv.includes('--words')
const independentBaselines = process.argv.includes('--independent-baselines')
if (independentBaselines && !reuseDocument)
  throw new Error('--independent-baselines requires --document')
const producerWords = reuseWords && !process.argv.includes('--no-producer-words')
if (process.argv.includes('--no-producer-words') && !reuseWords)
  throw new Error('--no-producer-words requires --words')
const previewOverlap = process.argv.includes('--preview')
const revalidateInitialPreview = process.argv.includes('--revalidate-initial-preview')
if (revalidateInitialPreview && !previewOverlap)
  throw new Error('--revalidate-initial-preview requires --preview')
const allDescriptors = process.argv.includes('--preview-all-descriptors')
if ((previewOverlap && (!reuseDocument || !reuseWords)) || (allDescriptors && !previewOverlap))
  throw new Error(
    'Use --preview with --document --words; --preview-all-descriptors requires --preview',
  )
const phaseArgument = process.argv.find((arg) => arg.startsWith('--cpu-phase='))
const cpuPhase = phaseArgument?.slice('--cpu-phase='.length) ?? 'validation'
if (!['producer', 'preparation', 'validation'].includes(cpuPhase) || (phaseArgument && !cpu))
  throw new Error('Use --cpu with --cpu-phase=producer|preparation|validation')
const profileName = previewOverlap
  ? 'packed-preview-overlap'
  : reuseWords
    ? 'packed-word-reuse'
    : reuseDocument
      ? 'packed-document-reuse'
      : 'packed-reuse'
const phaseSuffix = cpuPhase === 'validation' ? '' : `-${cpuPhase}`
async function startCPU(phase) {
  if (!cpu || cpuPhase !== phase) return
  cpu.connect()
  await cpu.post('Profiler.enable')
  await cpu.post('Profiler.start')
}
async function finishCPU(phase) {
  if (!cpu || cpuPhase !== phase) return
  const { profile } = await cpu.post('Profiler.stop')
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const totals = new Map()
  for (let index = 0; index < profile.samples.length; index++) {
    const frame = nodes.get(profile.samples[index]).callFrame
    const label = `${frame.functionName || '(anonymous)'} ${frame.url}:${frame.lineNumber + 1}`
    totals.set(label, (totals.get(label) ?? 0) + profile.timeDeltas[index])
  }
  const selfTime = [...totals]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 45)
    .map(([frame, us]) => ({ frame, ms: us / 1000 }))
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    `test/artifacts/logs/${profileName}${phaseSuffix}.cpuprofile`,
    JSON.stringify(profile),
  )
  cpu.disconnect()
  return selfTime
}
const key = Symbol.for('manuslip-packed-reuse-profile')
let observe
globalThis[key] = (phase, value) => observe?.(phase, value)
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
  plugins: [
    {
      name: 'observe-packed-reuse-lifetimes',
      enforce: 'pre',
      transform(code, id) {
        const path = id.replaceAll('\\', '/')
        const inject = (marker, phase, value) => {
          assert.ok(code.includes(marker), `Missing marker ${path}: ${marker}`)
          return code.replace(
            marker,
            `${marker}; globalThis[Symbol.for('manuslip-packed-reuse-profile')]?.('${phase}', ${value});`,
          )
        }
        if (revalidateInitialPreview && path.endsWith('/renderer/src/packed-preview.ts')) {
          const marker =
            'if (!reuse.projection?.validatesSnapshot(capture, source, path, render, budget))'
          assert.ok(code.includes(marker), 'Missing exact snapshot validation reuse marker')
          return code.replace(marker, 'if (true)')
        }
        if (allDescriptors && path.endsWith('/preview/packed-preparation.ts')) {
          assert.equal(code.split("'widgets',").length, 2)
          return code.replace("'widgets',", "'all',")
        }
        if (path.endsWith('/renderer/src/packed-projection-baseline.ts')) {
          code = inject('this.#data = data', 'data', 'data')
          assert.ok(code.includes('blocks.push({'))
          return code.replace(
            'blocks.push({',
            "globalThis[Symbol.for('manuslip-packed-reuse-profile')]?.('metadata', blocks); blocks.push({",
          )
        }
        if (path.endsWith('/renderer/src/packed-html-cursor.ts')) {
          code = inject('this.#stream = stream', 'cursor', 'this')
          return inject('remaining -= take', 'comparison', 'take')
        }
        if (path.endsWith('/renderer/src/packed-projection-definitions.ts'))
          return inject('walk.nodes += skipped.nodes - 1', 'context-prune', 'skipped')
        if (path.endsWith('/core/src/packing-word-texts.ts'))
          return inject('walk.nodes += cached.nodes - 1', 'word-reuse', 'cached')
        if (path.endsWith('/core/src/document-metadata.ts')) {
          code = inject('const certified = ranges?.[field]', 'metadata-range', 'certified')
          return inject(
            'const size = capture.reader.length([...document, field])',
            'metadata-scan',
            'size',
          )
        }
        if (path.endsWith('/core/src/packing-document-baseline.ts')) {
          assert.ok(code.includes('return { subtree, offset }'))
          return code.replace(
            'return { subtree, offset }',
            "globalThis[Symbol.for('manuslip-packed-reuse-profile')]?.('document-proof', subtree); return { subtree, offset }",
          )
        }
      },
    },
  ],
})
try {
  const load = (name) => server.ssrLoadModule(`/packages/${name}.ts`)
  const { PackedProjectionBaseline } = await load('renderer/src/packed-projection-baseline')
  const { PackedDocumentBaseline } = await load('core/src/packing-document-baseline')
  const { PackedWordBaseline } = await load('core/src/packing-word-baseline')
  const { validatePackedSnapshot } = await load('renderer/src/packing-validate-snapshot')
  const { renderProjectionLayout } = await load('renderer/src/projection-layout')
  const { projectMarkdownFragment, projectionFragmentOperations } = await load(
    'renderer/src/projection-fragment',
  )
  const { ProjectionSequence } = await load('renderer/src/projection-sequence')
  const { rendererVersion } = await load('renderer/src/index')
  const { describeDocumentFragment, documentFragmentOperations } = await load(
    'core/src/document-metadata',
  )
  const { reparseMarkdownFragment } = await load('core/src/markdown-fragment')
  const { PackedArena } = await load('core/src/packing-arena')
  const { PackedSession } = await load('core/src/packing-session')
  const { PackedSource } = await load('core/src/packing-source')
  const { SemanticDependencies } = await load('core/src/semantic-dependencies')
  const { packValue } = await load('core/src/packing')
  const { sourceHash } = await load('core/src/contracts')
  const { parseMarkdown } = await load('core/src/parse')
  const { unpackValue } = await load('core/src/packing')
  const { createSourceState } = await load('editor/src/index')
  const { OwnedPackedPreview } = await server.ssrLoadModule(
    '/apps/desktop/src/renderer/src/preview/packed-preparation.ts',
  )
  const fixture = (text) => {
    const document = parseMarkdown(text)
    const { projection, layout } = renderProjectionLayout(document.root, options, limits.staging)
    const source = new PackedSource(
      {
        generation: 1,
        documentId: 'reuse-profile',
        revision: 0,
        sourceHash: sourceHash(text),
        parserVersion: document.parserVersion,
        rendererVersion,
        options: JSON.stringify(options),
      },
      text,
    )
    const payload = packValue({ document, projection, layout }, limits.staging)
    const payloadBytes = payload.byteLength
    const owner = new PackedSession(sessionLimits)
    owner.commit(owner.prepareFull(owner.beginPrepared(source), source.identity, payload))
    return { source, owner, capture: owner.capture(), payloadBytes }
  }
  const noop = (context) => {
    const source = new PackedSource(
      { ...context.source.identity, revision: 1 },
      context.source.text,
    )
    const prepared = context.owner.prepareDelta(context.owner.beginPrepared(source), {
      base: context.source.identity,
      baseSource: context.source.text,
      result: source.identity,
      payload: packValue([], limits.staging),
      operations: [],
    })
    return { source, prepared, inspection: context.owner.capturePrepared(prepared) }
  }
  const finish = (work) => {
    while (true) {
      const next = work.next()
      if (next.done) return next.value
    }
  }
  const watch = (value, refs, seen = new WeakSet()) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    refs.push(new WeakRef(value))
    if (value instanceof Map) for (const item of value.values()) watch(item, refs, seen)
    else
      for (const [name, item] of Object.entries(value))
        if (name !== 'token' && name !== 'capture') watch(item, refs, seen)
  }
  const probe = (phase, keepOwner) => {
    const refs = []
    let metadata = false
    let compared = 0
    let prunedNodes = 0
    let largestPrunedSubtree = 0
    observe = (kind, value) => {
      if (kind === 'context-prune') {
        prunedNodes += value.nodes
        largestPrunedSubtree = Math.max(largestPrunedSubtree, value.nodes)
      }
      if (kind === 'metadata' && value.length) metadata = true
      if (kind === 'comparison') compared += value
      else watch(value, refs)
    }
    const open = PackedArena.open
    PackedArena.open = function (...args) {
      const value = open.apply(this, args)
      refs.push(new WeakRef(value))
      return value
    }
    const context = fixture(`~~~text\n${'a界😀'.repeat(10000)}\n~~~\n\nsecond\n`)
    refs.push(new WeakRef(context.source))
    if (!keepOwner) refs.push(new WeakRef(context.owner))
    const create = PackedProjectionBaseline.create(
      context.capture,
      context.source,
      [],
      options,
      limits,
    )
    let baseline
    let work
    let inspection
    let steps = 0
    try {
      if (phase !== 'create-queued')
        while (true) {
          const next = create.next()
          steps++
          assert.ok(steps < 100000)
          if (next.done) {
            baseline = next.value
            break
          }
          if (phase === 'create-metadata' && metadata) break
        }
      if (!phase.startsWith('create-') && phase !== 'ready') {
        assert.ok(baseline)
        const next = noop(context)
        inspection = next.inspection
        refs.push(new WeakRef(next.source))
        work = validatePackedSnapshot(inspection, next.source, [], options, limits, baseline)
        if (phase !== 'validation-queued')
          while (true) {
            const next = work.next()
            steps++
            assert.ok(steps < 200000)
            if (phase === 'completed' && next.done) break
            assert.equal(next.done, false)
            if (phase === 'comparison' && compared) break
            if (phase === 'context-prune' && largestPrunedSubtree > 1) break
          }
      }
      const escapedKey = context.capture.reader.recordKey(['document', 'root', 'children', 0])
      const report = {
        phase,
        keepOwner,
        steps,
        compared,
        prunedNodes,
        largestPrunedSubtree,
        references: refs.length,
      }
      context.owner.dispose()
      assert.equal(context.owner.stats.retainedBytes, 0)
      assert.equal(context.owner.stats.readers, 0)
      assert.equal(context.owner.stats.readerStagingBytes, 0)
      return {
        create,
        baseline,
        work,
        capture: context.capture,
        inspection,
        escapedKey,
        owner: keepOwner ? context.owner : undefined,
        refs,
        report,
      }
    } finally {
      context.owner.dispose()
      PackedArena.open = open
      observe = undefined
    }
  }
  const escaped = [
    'create-queued',
    'create-metadata',
    'ready',
    'validation-queued',
    'context-prune',
    'comparison',
    'completed',
  ].flatMap((phase) => [false, true].map((keepOwner) => probe(phase, keepOwner)))
  const unreachable = () => {
    const context = fixture('first\n\nsecond\n')
    const refs = [
      new WeakRef(context.owner),
      new WeakRef(context.capture),
      new WeakRef(context.source),
    ]
    observe = (kind, value) => {
      if (kind === 'data') watch(value, refs)
    }
    try {
      const create = PackedProjectionBaseline.create(
        context.capture,
        context.source,
        [],
        options,
        limits,
      )
      const baseline = finish(create)
      const escapedKey = context.capture.reader.recordKey(['document', 'root', 'children', 0])
      baseline.close()
      assert.equal(context.owner.stats.readers, 0)
      return {
        create,
        baseline,
        escapedKey,
        refs,
        report: { phase: 'closed-baseline-unreachable-live-owner', references: refs.length },
      }
    } finally {
      observe = undefined
    }
  }
  escaped.push(unreachable())
  let collected = false
  for (let attempt = 0; attempt < 40; attempt++) {
    await immediate()
    global.gc()
    await immediate()
    if (escaped.every((entry) => entry.refs.every((ref) => !ref.deref()))) {
      collected = true
      break
    }
  }
  if (!collected)
    console.log(
      'Uncollected:',
      escaped.filter((entry) => entry.refs.some((ref) => ref.deref())).map((entry) => entry.report),
    )
  assert.ok(collected, 'Closed baseline/work/key handles must not retain watched resources')
  const probes = escaped.map((entry) => {
    assert.equal(entry.create.next().done, true)
    if (entry.work) assert.equal(entry.work.next().done, true)
    if (entry.baseline) assert.throws(() => entry.baseline.assertOpen(), /closed/)
    return entry.report
  })
  const measure = async (work, context) => {
    let steps = 0,
      activeMs = 0,
      largestStepMs = 0,
      largestBatchMs = 0
    let peakRetained = 0,
      peakStaging = 0
    const start = performance.now()
    let batch = start
    while (true) {
      const before = performance.now()
      const next = work.next()
      const elapsed = performance.now() - before
      steps++
      activeMs += elapsed
      largestStepMs = Math.max(largestStepMs, elapsed)
      largestBatchMs = Math.max(largestBatchMs, performance.now() - batch)
      const stats = context.owner.stats
      peakRetained = Math.max(peakRetained, stats.retainedBytes)
      const staging = stats.readerStagingBytes + stats.preparingStagingBytes
      peakStaging = Math.max(peakStaging, staging)
      assert.ok(stats.retainedBytes <= sessionLimits.retained)
      assert.ok(staging <= limits.staging)
      if (next.done)
        return {
          result: next.value,
          steps,
          activeMs,
          wallMs: performance.now() - start,
          largestStepMs,
          largestBatchMs,
          peakRetained,
          peakStaging,
        }
      if (performance.now() - batch >= 1) {
        await immediate()
        batch = performance.now()
      }
    }
  }
  const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const nested = `# nested-containers\n\n${chunk.repeat(Math.ceil(MiB / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
  const context = fixture(nested)
  const documentCreation = reuseDocument
    ? await measure(
        PackedDocumentBaseline.create(context.capture, context.source, ['document'], limits),
        context,
      )
    : undefined
  const documentBaseline = documentCreation?.result
  const creation = await measure(
    PackedProjectionBaseline.create(
      context.capture,
      context.source,
      [],
      options,
      limits,
      independentBaselines ? undefined : documentBaseline,
    ),
    context,
  )
  const baseline = creation.result
  assert.ok(baseline)
  const wordCreation = reuseWords
    ? await measure(
        PackedWordBaseline.create(
          context.capture,
          context.source,
          ['document'],
          limits,
          independentBaselines ? undefined : documentBaseline,
        ),
        context,
      )
    : undefined
  const wordBaseline = wordCreation?.result
  const baselines = { projection: baseline, document: documentBaseline, words: wordBaseline }
  const previewState = previewOverlap ? createSourceState(nested) : undefined
  let oldPreview, oldDOM, oldStatus, oldReading, nextPreview
  const initialPreview = previewOverlap
    ? await measure(
        OwnedPackedPreview.prepare(
          context.capture,
          context.source,
          previewState.doc,
          [],
          options,
          { ...limits, retained: 32 * MiB },
          undefined,
          baselines,
          true,
        ),
        context,
      )
    : undefined
  if (initialPreview) {
    oldPreview = initialPreview.result
    assert.equal(oldPreview.commit(), true)
    oldDOM = oldPreview.retain()
    oldStatus = oldPreview.retain()
    oldReading = oldPreview.captureRoot()
    assert.ok(oldReading)
  }
  const initialPreviewCost = oldPreview?.cost
  const index = SemanticDependencies.build(context.capture, nested, ['document', 'root'], limits)
  const holds = [context.owner.retain(index)]
  let update
  try {
    const from = nested.indexOf('nested-containers')
    const change = { from, to: from + 'nested'.length, insert: 'nested extended' }
    const after = nested.slice(0, change.from) + change.insert + nested.slice(change.to)
    const previewTransaction = previewState?.update({ changes: change })
    if (oldPreview) oldPreview.map(previewTransaction.changes)
    const source = new PackedSource(
      { ...context.source.identity, revision: 1, sourceHash: sourceHash(after) },
      after,
    )
    await startCPU('producer')
    const start = performance.now()
    const fragment = reparseMarkdownFragment(
      {
        capture: context.capture,
        dependencies: index,
        baseSource: nested,
        source,
        change,
        root: ['document', 'root'],
        syntax: 'manuslip',
      },
      { ...limits, depth: 64, bytes: 64 * 1024, nodes: 8192 },
    )
    assert.equal(fragment.kind, 'fragment', fragment.reason)
    holds.push(context.owner.retain(fragment))
    const metadataRanges = [],
      metadataScans = []
    observe = (phase, value) => {
      if (phase === 'metadata-range' && value) metadataRanges.push(value)
      if (phase === 'metadata-scan') metadataScans.push(value)
    }
    const metadataStart = performance.now()
    let metadata
    try {
      metadata = describeDocumentFragment(
        {
          capture: context.capture,
          dependencies: index,
          fragment,
          document: ['document'],
          parseMs: 1,
          words: producerWords ? wordBaseline : undefined,
          baseline: producerMetadata ? documentBaseline : undefined,
        },
        { ...limits, depth: 64 },
      )
    } finally {
      observe = undefined
    }
    const metadataMs = performance.now() - metadataStart
    assert.equal(metadataRanges.length, producerMetadata ? 2 : 0)
    assert.equal(metadataScans.length, producerMetadata ? 0 : 2)
    holds.push(context.owner.retain(metadata))
    const projected = projectMarkdownFragment(
      {
        capture: context.capture,
        dependencies: index,
        fragment,
        root: ['document', 'root'],
        projection: ['projection'],
        layout: ['layout'],
        options,
      },
      { ...limits, depth: 64 },
    )
    holds.push(context.owner.retain(projected))
    const payload = packValue(
      {
        children: fragment.children,
        position: fragment.position,
        blocks: metadata.blocks.values,
        outline: metadata.outline.values,
        counts: metadata.counts,
        sourceHash: source.identity.sourceHash,
        parserVersion: source.identity.parserVersion,
        timings: metadata.timings,
        ...projected.fields,
      },
      limits.staging,
    )
    const deltaBytes = payload.byteLength
    const arena = PackedArena.open(payload.slice(0), sessionLimits)
    const operations = [
      ...documentFragmentOperations(fragment, metadata, arena, ['document']),
      ...projectionFragmentOperations(fragment, projected, arena),
    ]
    const producerMs = performance.now() - start
    const producerSelfTime = await finishCPU('producer')
    await startCPU('preparation')
    const preparation = context.owner.prepareDeltaSteps(context.owner.beginPrepared(source), {
      base: context.source.identity,
      baseSource: nested,
      result: source.identity,
      payload,
      operations,
    })
    const prepared = await measure(preparation, context)
    prepared.selfTime = await finishCPU('preparation')
    const inspection = context.owner.capturePrepared(prepared.result)
    let conversions = 0
    let prunedBlocks = 0
    let prunedNodes = 0
    let documentProofs = 0
    let documentNodes = 0
    let sourceUnits = 0
    let wordProofs = 0
    let wordNodes = 0
    let wordUnits = 0
    let wordTexts = 0
    observe = (phase, subtree) => {
      if (phase === 'word-reuse') {
        wordProofs++
        wordNodes += subtree.nodes
        wordUnits += subtree.units
        wordTexts += subtree.texts
      }
      if (phase === 'context-prune') {
        prunedBlocks++
        prunedNodes += subtree.nodes
      }
      if (phase === 'document-proof') {
        documentProofs++
        documentNodes += subtree.nodes
        sourceUnits +=
          subtree.to - subtree.from + Number(context.source.text.charCodeAt(0) === 0xfeff)
      }
    }
    const convert = ProjectionSequence.prototype.convertSteps
    ProjectionSequence.prototype.convertSteps = function (...args) {
      conversions++
      return convert.apply(this, args)
    }
    let optimized
    try {
      await startCPU('validation')
      optimized = await measure(
        validatePackedSnapshot(
          inspection,
          source,
          [],
          options,
          limits,
          baseline,
          documentBaseline,
          wordBaseline,
        ),
        context,
      )
      optimized.selfTime = await finishCPU('validation')
    } finally {
      cpu?.disconnect()
      observe = undefined
      ProjectionSequence.prototype.convertSteps = convert
    }
    // A separate complete recomputation remains the independent functional check.
    const full = await measure(
      validatePackedSnapshot(inspection, source, [], options, limits),
      context,
    )
    let overlap
    if (previewOverlap) {
      const candidate = await measure(
        OwnedPackedPreview.prepare(
          inspection,
          source,
          previewTransaction.state.doc,
          [],
          options,
          { ...limits, retained: 32 * MiB },
          oldPreview,
          baselines,
          true,
        ),
        context,
      )
      nextPreview = candidate.result
      assert.equal(oldDOM.status.characterCount, nested.length)
      assert.equal(oldStatus.status.characterCount, nested.length)
      assert.equal(nextPreview.status.characterCount, after.length)
      assert.equal(nextPreview.commit(), true)
      oldPreview.release()
      // Both native predecessor leases and its complete reading capture stay live.
      assert.equal(oldDOM.status.characterCount, nested.length)
      const retainedWithOldConsumers = context.owner.stats.retainedBytes
      const rootChecks = []
      const nextReading = nextPreview.captureRoot()
      try {
        for (const [reading, text] of [
          [oldReading, nested],
          [nextReading, after],
        ]) {
          const serialized = await measure(
            reading.capture.serialize(reading.path, {
              bytes: 8 * MiB - 65536,
              workspace: 3 * MiB,
              nodes: 800000,
              depth: 128,
            }),
            context,
          )
          const output = serialized.result
          try {
            const payloadBytes = output.value.payload.byteLength
            const transferred = structuredClone(output.value.payload, {
              transfer: [output.value.payload],
            })
            assert.equal(output.value.payload.byteLength, 0)
            // Complete independent parser oracle lives outside the application ledger.
            const actual = unpackValue(transferred, {
              bytes: 8 * MiB,
              retained: 32 * MiB,
              staging: 8 * MiB,
            }).value
            const expected = parseMarkdown(text).root
            assert.equal(JSON.stringify(actual), JSON.stringify(expected))
            rootChecks.push({
              ...serialized,
              result: 'complete native root equivalent',
              payloadBytes,
            })
          } finally {
            output.release()
          }
        }
      } finally {
        nextReading.capture.release()
      }
      assert.equal(oldDOM.model.blocks.length, 0)
      oldDOM.release()
      oldStatus.release()
      oldReading.capture.release()
      overlap = {
        allDescriptors,
        semanticDescriptors: context.capture.reader.length(['document', 'blocks']),
        initialPreviewCost,
        replacementPreviewCost: nextPreview.cost,
        initial: { ...initialPreview, result: 'complete preview' },
        candidate: { ...candidate, result: 'complete replacement preview' },
        retainedWithOldConsumers,
        retainedAfterConsumerRelease: context.owner.stats.retainedBytes,
        rootChecks,
      }
    }
    inspection.release()
    context.owner.commit(prepared.result)
    assert.equal(context.capture.identity.revision, 0)
    assert.equal(context.owner.stats.readerStagingBytes, 0)
    update = {
      sourceBytes: Buffer.byteLength(nested),
      sha256: createHash('sha256').update(nested).digest('hex'),
      snapshotBytes: context.payloadBytes,
      resultSha256: createHash('sha256').update(after).digest('hex'),
      deltaBytes,
      producerMs,
      metadata: { activeMs: metadataMs, ranges: metadataRanges, scannedDescriptors: metadataScans },
      ...(producerSelfTime ? { producerSelfTime } : {}),
      creation: { ...creation, result: 'baseline' },
      ...(documentCreation
        ? { documentCreation: { ...documentCreation, result: 'document baseline' } }
        : {}),
      ...(wordCreation ? { wordCreation: { ...wordCreation, result: 'word baseline' } } : {}),
      preparation: { ...prepared, result: 'prepared' },
      optimized,
      conversions,
      contextPruning: { blocks: prunedBlocks, logicalNodes: prunedNodes },
      ...(reuseDocument
        ? { documentReuse: { proofs: documentProofs, logicalNodes: documentNodes, sourceUnits } }
        : {}),
      ...(reuseWords
        ? {
            wordReuse: {
              proofs: wordProofs,
              logicalNodes: wordNodes,
              proseUnits: wordUnits,
              texts: wordTexts,
            },
          }
        : {}),
      full,
      currentRetained: context.owner.stats.retainedBytes,
      ...(overlap ? { previewOverlap: overlap } : {}),
    }
  } finally {
    oldDOM?.release()
    oldStatus?.release()
    oldReading?.capture.release()
    oldPreview?.release()
    nextPreview?.release()
    for (const hold of holds) hold.release()
    context.owner.dispose()
  }
  assert.equal(context.owner.stats.retainedBytes, 0)
  const result = {
    date: new Date().toISOString(),
    independentBaselines,
    ...(previewOverlap
      ? {
          revalidateInitialPreview,
          previewMethod:
            'Compose complete old/new owned application previews, independently retained old DOM/status leases and full-root reading captures with all three admitted validation baselines and the actual nested fragment transaction. Initial preview may reuse complete validation only for the exact immutable revision, original source object, snapshot path, render policy and valid non-stricter limits. Baseline creation still performs complete validation; --revalidate-initial-preview forces repeated validation only in the diagnostic module transform. Transfer and independently compare both complete roots with fresh parser output. All production limits remain unchanged. Development Node costs and weighted ownership are not portable physical memory bounds or packaged freshness acceptance.',
        }
      : {}),
    ...(cpu ? { cpuPhase } : {}),
    ...(reuseWords
      ? {
          producerWordReuse: producerWords,
          wordMethod:
            'Separately admitted immutable-subtree text cache supplies bounded prose chunks and full logical traversal/text costs. Current prose is rebuilt in exact parser text-node order with the original separators and empty leaves, then one complete Intl segmentation and count comparison run. No block word totals are added. New records/overlays fall back; cached capabilities revoke with the borrowed capture and source-dependent length limits remain checked. When producerWordReuse is true, fragment metadata also borrows this already admitted cache only for its exact original source/owner; the complete new prose, one Intl count and logical limits remain. --no-producer-words retains the original producer traversal for comparison. This does not admit a cache in the ordinary semantic worker. Word lifetime probes are recorded separately.',
        }
      : {}),
    ...(reuseDocument
      ? {
          producerMetadataReuse: producerMetadata,
          documentMethod:
            'Also builds a separately admitted document baseline after complete independent document validation. A charged prefix table locates metadata intervals only for the exact original source, owner, immutable revision and document path. --no-producer-metadata keeps full descriptor scans for comparison; the complete current prose/word count and changed-node checks remain. Exact shared subtree records, supported position shifts, exact source units and source-length bounds prove immutable schema/geometry reuse after new root anchors are checked. Every nested descriptor/heading is compared with its certified forward stream, logical nodes/depth stay charged, character/word validation remains complete, and projection/output checks compose before commit. Baseline and both captures own the inspection; revocation cannot become successful EOF. Actual typed prefix/backing lifetime evidence is recorded separately by profile-packed-document-lifetime.mjs.',
        }
      : {}),
    method:
      'Development scoped reuse diagnostic. A complete validated baseline owns source-free metadata under retained admission and borrows a live same-owner capture. Shared arena record identity plus exact lazy position shifts prove unchanged blocks; immutable definition-context identity additionally gates link/image-reference blocks. Context walks prune only shared subtrees proved free of definitions/footnote calls, preserving complete logical node/depth charges. Footnote calls/definitions render normally. Reused full HTML is compared by two forward UTF-16 cursors and widget records must be exactly shared with matching range shifts; changed/unsupported cases render normally. Complete root/count/geometry/widget obligations remain; optional document reuse is described separately. Initial baseline creation includes complete validation and cooperative metadata construction. Actual local nested edit uses existing parser/metadata/projection transaction and remains checked against complete recomputation. Fifteen projection-reuse GC probes retain closed baseline/work/source-free keys unadvanced, including actual context pruning and an otherwise unreachable live owner; document lifetime probes are separate. Weights are not calibrated heap caps, these are not packaged p95 results, and production integration/parser equivalence/release gates remain open.',
    collected,
    probes,
    update,
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    `test/artifacts/logs/${profileName}-${cpu ? `cpu${phaseSuffix}` : 'profile'}.json`,
    `${JSON.stringify(result, null, 2)}\n`,
  )
  console.log(JSON.stringify(result, null, 2))
} finally {
  cpu?.disconnect()
  delete globalThis[key]
  await server.close()
}
