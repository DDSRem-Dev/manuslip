import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error('Run with node --expose-gc test/benchmark/profiles/profile-packed-preview.mjs')
const MiB = 1024 * 1024
const ownedMode = process.argv.includes('--owned')
const limits = { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const session = { ...limits, retained: 64 * MiB, bytes: 8 * MiB, captures: 8, readers: 160 }
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back' }
const key = Symbol.for('manuslip-packed-preview-profile')
let observe,
  copying = false
globalThis[key] = (phase, value) => {
  if (phase === 'copy-start') copying = true
  if (copying || ['validated', 'measured', 'widget-ranges'].includes(phase)) observe?.(phase, value)
}
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
  plugins: [
    {
      name: 'observe-packed-preview-input',
      enforce: 'pre',
      transform(code, id) {
        const path = id.replaceAll('\\', '/')
        const inject = (marker, phase, value) => {
          assert.ok(code.includes(marker), `Missing marker ${path}: ${marker}`)
          return code.replace(
            marker,
            `${marker}; globalThis[Symbol.for('manuslip-packed-preview-profile')]?.('${phase}', ${value});`,
          )
        }
        if (path.endsWith('/renderer/src/packed-preview.ts')) {
          code = inject(
            "const widgets = capture.reader.at([...path, 'projection', 'blocks'])",
            'validated',
            '[blocks, widgets]',
          )
          code = inject('const copyStagingBytes = fixed + scratch()', 'measured', 'plan')
          const marker = 'const semanticBlocks ='
          assert.ok(code.includes(marker))
          code = code.replace(
            marker,
            `globalThis[Symbol.for('manuslip-packed-preview-profile')]?.('copy-start', plan); ${marker}`,
          )
          const statusMarker = 'const headings ='
          assert.ok(code.includes(statusMarker))
          code = code.replace(
            statusMarker,
            `globalThis[Symbol.for('manuslip-packed-preview-profile')]?.('status-start', plan); ${statusMarker}`,
          )
          code = inject(
            'const renderTime = (yield* copyPackedNative(renderMs)) as number',
            'status-copied',
            '{ headings, wordCounts, parseTimings }',
          )
          return inject('const retainedBytes = 16384 + plan.retained', 'input', 'input')
        }
        if (path.endsWith('/core/src/packing-native-copy.ts')) {
          code = inject('const values = new Array<unknown>(length)', 'native-array', 'values')
          return inject('const value = {}', 'native-object', 'value')
        }
        if (path.endsWith('/core/src/packing-word-buffer.ts'))
          return inject(
            'this.#units += value.length',
            'collector',
            '{ buffer: this, units: value.length }',
          )
        if (path.endsWith('/renderer/src/preview-descriptors.ts'))
          return inject('const ranges = new Set<string>()', 'widget-ranges', 'ranges')
        if (path.endsWith('/preview/packed-preparation.ts')) {
          code = inject('data.tracker = tracker', 'model-start', 'data')
          code = inject('data.prepared = next.value', 'model-prepared', 'data')
          const marker = '          yield\n          valid()\n          transferred = true'
          assert.ok(code.includes(marker))
          return code.replace(
            marker,
            `globalThis[Symbol.for('manuslip-packed-preview-profile')]?.('model-ready', data); ${marker}`,
          )
        }
      },
    },
  ],
})
try {
  const load = (name) => server.ssrLoadModule(`/packages/${name}.ts`)
  const { inspectPackedPreview } = await load('renderer/src/packed-preview')
  const { renderProjectionLayout } = await load('renderer/src/projection-layout')
  const { rendererVersion } = await load('renderer/src/index')
  const { PackedSession } = await load('core/src/packing-session')
  const { PackedSource } = await load('core/src/packing-source')
  const { PackedArena } = await load('core/src/packing-arena')
  const { parseMarkdown } = await load('core/src/parse')
  const { packValue } = await load('core/src/packing')
  const { sourceHash } = await load('core/src/contracts')
  const { createSourceState, OccurrenceTracker } = await load('editor/src/index')
  const { preparePreview } = await server.ssrLoadModule(
    '/apps/desktop/src/renderer/src/preview/preparation.ts',
  )
  const { OwnedPackedPreview } = await server.ssrLoadModule(
    '/apps/desktop/src/renderer/src/preview/packed-preparation.ts',
  )
  const fixture = (text, owner = new PackedSession(session), revision = 0) => {
    const document = parseMarkdown(text)
    const { projection, layout } = renderProjectionLayout(document.root, options, session.bytes)
    const source = new PackedSource(
      {
        generation: 1,
        revision,
        documentId: 'preview-profile',
        sourceHash: sourceHash(text),
        parserVersion: document.parserVersion,
        rendererVersion,
        options: JSON.stringify(options),
      },
      text,
    )
    const payload = packValue({ document, projection, layout }, session.bytes)
    const payloadBytes = payload.byteLength
    owner.commit(owner.prepareFull(owner.beginPrepared(source), source.identity, payload))
    return { owner, source, capture: owner.capture(), payloadBytes }
  }
  // Exclude the library's intentionally shared empty index and its immortal arrays.
  // Actual model/range/occurrence objects are still observed below.
  const shared = new WeakSet()
  const rememberShared = (value) => {
    if (!value || typeof value !== 'object' || shared.has(value)) return
    shared.add(value)
    for (const item of Object.values(value)) rememberShared(item)
  }
  for (const value of Object.values(new OccurrenceTracker())) rememberShared(value)
  const watch = (value, refs, seen = new WeakSet()) => {
    if (!value || typeof value !== 'object' || shared.has(value) || seen.has(value)) return
    seen.add(value)
    refs.push(new WeakRef(value))
    for (const item of Object.values(value)) watch(item, refs, seen)
  }
  const finish = (work) => {
    while (true) {
      const next = work.next()
      if (next.done) return next.value
    }
  }
  const probe = (phase, keepOwner) => {
    const refs = [],
      reached = new Set()
    let units = 0,
      statusUnits = 0,
      statusCopying = false,
      steps = 0
    copying = false
    observe = (kind, value) => {
      if (kind === 'collector') {
        units += value.units
        if (statusCopying) {
          statusUnits += value.units
          if (statusUnits >= 4096) reached.add('status-strings')
        }
        watch(value.buffer, refs)
        if (units >= 4096) reached.add('copy-strings')
      } else {
        if (kind === 'status-start') statusCopying = true
        reached.add(kind)
        watch(value, refs)
      }
    }
    const open = PackedArena.open
    PackedArena.open = function (...args) {
      const arena = open.apply(this, args)
      refs.push(new WeakRef(arena))
      return arena
    }
    const context = fixture(
      `# Heading\n\n~~~text\n${'a界😀 '.repeat(5000)}\n~~~\n\n## ${'heading界😀 '.repeat(1000)}\n`,
    )
    refs.push(new WeakRef(context.source))
    if (!keepOwner) refs.push(new WeakRef(context.owner))
    const scope = context.capture.reader.at(['document', 'blocks'])
    const work = inspectPackedPreview(
      context.capture,
      context.source,
      [],
      options,
      limits,
      function* (input) {
        reached.add('inspect')
        watch(input, refs)
        yield
      },
    )
    try {
      if (phase !== 'queued')
        while (true) {
          const next = work.next()
          assert.ok(++steps < 500000)
          if (phase === 'complete' && next.done) break
          assert.equal(next.done, false, `Unreached ${phase}`)
          if (reached.has(phase)) break
        }
      context.owner.dispose()
      assert.equal(context.owner.stats.retainedBytes, 0)
      return {
        work,
        scope,
        capture: context.capture,
        refs,
        owner: keepOwner ? context.owner : undefined,
        report: { phase, keepOwner, steps, units, statusUnits, references: refs.length },
      }
    } finally {
      observe = undefined
      copying = false
      PackedArena.open = open
      context.owner.dispose()
    }
  }
  const escaped = [
    'queued',
    'validated',
    'measured',
    'copy-start',
    'copy-strings',
    'status-start',
    'status-strings',
    'status-copied',
    'input',
    'inspect',
    'complete',
  ].flatMap((phase) => [false, true].map((keep) => probe(phase, keep)))
  const unreachable = () => {
    copying = false
    const context = fixture('~~~text\nvalue\n~~~\n')
    const refs = [new WeakRef(context.owner), new WeakRef(context.source)]
    observe = (_, value) => watch(value, refs)
    const work = inspectPackedPreview(
      context.capture,
      context.source,
      [],
      options,
      limits,
      function* () {
        yield
      },
    )
    finish(work)
    context.capture.release()
    observe = undefined
    return {
      work,
      refs,
      report: { phase: 'closed-work-unreachable-live-owner', references: refs.length },
    }
  }
  escaped.push(unreachable())
  const ownedProbe = (phase, keepOwner, releaseLive = false) => {
    copying = false
    const refs = [],
      reached = new Set()
    observe = (kind, value) => {
      reached.add(kind)
      watch(value, refs)
    }
    const open = PackedArena.open
    PackedArena.open = function (...args) {
      const arena = open.apply(this, args)
      refs.push(new WeakRef(arena))
      return arena
    }
    const text = `# ${'title界😀 '.repeat(1000)}\n\n~~~text\nvalue\n~~~\n\n${'paragraph\n\n'.repeat(160)}`
    const context = fixture(text),
      doc = createSourceState(text).doc
    refs.push(new WeakRef(context.source))
    watch(doc, refs)
    if (!keepOwner) refs.push(new WeakRef(context.owner))
    const scope = context.capture.reader
    const work = OwnedPackedPreview.prepare(
      context.capture,
      context.source,
      doc,
      [],
      options,
      limits,
    )
    let preview,
      steps = 0
    try {
      if (phase !== 'queued')
        while (true) {
          const next = work.next()
          assert.ok(++steps < 500000)
          if (phase === 'complete' && next.done) {
            preview = next.value
            break
          }
          assert.equal(next.done, false)
          if (reached.has(phase)) break
        }
      if (preview) {
        assert.equal(preview.commit(), true)
        context.capture.release()
        context.owner.evict()
        assert.equal(preview.model.blocks.length, 1)
        assert.equal(preview.status.outline.length, 1)
        assert.equal(context.owner.stats.holds, 2)
        assert.equal(context.owner.stats.readers, 0)
        assert.ok(context.owner.stats.retainedBytes > preview.cost)
      }
      if (releaseLive) {
        preview.release()
        assert.equal(context.owner.stats.retainedBytes, 256)
      } else context.owner.dispose()
      return {
        work,
        preview,
        scope,
        capture: context.capture,
        owner: keepOwner ? context.owner : undefined,
        refs,
        report: {
          phase: `owned-${phase}${releaseLive ? '-released-live-owner' : ''}`,
          keepOwner,
          steps,
          references: refs.length,
        },
      }
    } finally {
      observe = undefined
      copying = false
      PackedArena.open = open
    }
  }
  for (const phase of ['queued', 'widget-ranges', 'model-start', 'model-ready', 'complete'])
    for (const keepOwner of [false, true]) escaped.push(ownedProbe(phase, keepOwner))
  escaped.push(ownedProbe('complete', true, true))
  const replacementProbe = () => {
    copying = false
    const refs = []
    observe = (_, value) => watch(value, refs)
    const text = `# Old heading\n\n~~~js\nlet x = 1\n~~~\n\n${'paragraph\n\n'.repeat(160)}`
    const first = fixture(text),
      state = createSourceState(text)
    refs.push(new WeakRef(first.source))
    const work = OwnedPackedPreview.prepare(
      first.capture,
      first.source,
      state.doc,
      [],
      options,
      limits,
    )
    const previous = finish(work)
    assert.equal(previous.commit(), true)
    first.capture.release()
    observe = undefined
    const transaction = state.update({ changes: { from: 0, insert: 'Intro.\n\n' } })
    previous.map(transaction.changes)
    const second = fixture(transaction.state.doc.toString(), first.owner, 1)
    const nextWork = OwnedPackedPreview.prepare(
      second.capture,
      second.source,
      createSourceState(second.source.text).doc,
      [],
      options,
      limits,
      previous,
    )
    const preview = finish(nextWork)
    assert.equal(preview.model.blocks[0].id, previous.model.blocks[0].id)
    assert.equal(preview.commit(), true)
    previous.release()
    second.capture.release()
    first.owner.evict()
    assert.equal(first.owner.stats.holds, 2)
    return {
      work,
      previous,
      nextWork,
      livePreview: preview,
      owner: first.owner,
      refs,
      report: { phase: 'owned-replaced-model-new-model-live', references: refs.length },
    }
  }
  escaped.push(replacementProbe())
  const leaseProbe = (keepOwner, disposeOwner) => {
    copying = false
    const refs = []
    observe = (_, value) => watch(value, refs)
    const context = fixture('# Lease heading\n\n~~~text\nBorrowed value\n~~~\n')
    const doc = createSourceState(context.source.text).doc
    watch(doc, refs)
    refs.push(new WeakRef(context.source))
    if (!keepOwner) refs.push(new WeakRef(context.owner))
    const scope = context.capture.reader
    const work = OwnedPackedPreview.prepare(
      context.capture,
      context.source,
      doc,
      [],
      options,
      limits,
    )
    const preview = finish(work)
    assert.equal(preview.commit(), true)
    const dom = preview.retain(),
      pending = dom.retain()
    preview.release()
    context.capture.release()
    context.owner.evict()
    assert.equal(pending.model.blocks.length, 1)
    assert.equal(pending.status.outline[0].text, 'Lease heading')
    dom.release()
    assert.equal(context.owner.stats.holds, 2)
    if (disposeOwner) context.owner.dispose()
    else pending.release()
    assert.throws(() => pending.model, /released/)
    assert.throws(() => pending.retain(), /released/)
    assert.equal(context.owner.stats.retainedBytes, disposeOwner ? 0 : 256)
    observe = undefined
    copying = false
    return {
      work,
      preview,
      dom,
      pending,
      scope,
      capture: context.capture,
      owner: keepOwner ? context.owner : undefined,
      refs,
      report: {
        phase: 'closed-native-consumer-leases',
        keepOwner,
        disposeOwner,
        references: refs.length,
      },
    }
  }
  for (const keepOwner of [false, true])
    for (const disposeOwner of [false, true]) escaped.push(leaseProbe(keepOwner, disposeOwner))
  let collected = false
  for (let attempt = 0; attempt < 50; attempt++) {
    await immediate()
    global.gc()
    await immediate()
    if (escaped.every((item) => item.refs.every((ref) => !ref.deref()))) {
      collected = true
      break
    }
  }
  assert.ok(
    collected,
    JSON.stringify(
      escaped.map((item) => ({
        ...item.report,
        live: item.refs.filter((ref) => ref.deref()).length,
      })),
    ),
  )
  for (const item of escaped) {
    assert.equal(item.work.next().done, true)
    if (item.scope) assert.throws(() => item.scope.kind(), /released/)
    item.livePreview?.release()
    item.owner?.dispose()
  }
  const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const text = `# nested-containers\n\n${chunk.repeat(Math.ceil(MiB / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
  const context = fixture(text),
    baseline = context.owner.stats
  const tracker = new OccurrenceTracker(),
    doc = createSourceState(text).doc
  let receivedCost,
    ownedPreview,
    measuredNodes,
    modelAdvances = 0,
    consumerBytes,
    consumerSteps = 0,
    peakRetained = 0,
    peakStaging = 0
  let steps = 0,
    activeMs = 0,
    largestStepMs = 0,
    largestBatchMs = 0
  let phase = 'validation',
    consumerCapacity = false
  const phases = {}
  copying = false
  observe = (kind, value) => {
    if (kind === 'validated') phase = 'measure'
    if (kind === 'copy-start') phase = 'copy'
    if (kind === 'input') phase = 'inspect'
    if (kind === 'measured') measuredNodes = value.nodes
    if (kind === 'model-start') {
      phase = 'model'
      consumerBytes = value.bytes
    }
  }
  const work = ownedMode
    ? OwnedPackedPreview.prepare(context.capture, context.source, doc, [], options, limits)
    : inspectPackedPreview(
        context.capture,
        context.source,
        [],
        options,
        limits,
        function* (input, cost) {
          receivedCost = cost
          assert.equal(
            input.document.blocks.length,
            context.capture.reader.length(['document', 'blocks']),
          )
          assert.equal(input.projection.blocks.length, 0)
          assert.deepEqual(input.document.outline, [
            { from: 0, to: 19, depth: 1, text: 'nested-containers' },
          ])
          // The measured nested corpus is ASCII; avoid allocating a full code-point array
          // inside the borrowed-input phase merely to check its character count.
          assert.equal(input.document.counts.characters, text.length)
          // Admit the actual preview's occurrence/model work independently, including its
          // source Text, IDs, candidate/index/builder/array metadata and final block objects.
          // These are conservative experiment weights, not calibrated heap bounds.
          consumerBytes = 65536 + doc.length * 2 + input.document.blocks.length * 1024
          let hold
          try {
            hold = context.capture.workspace(consumerBytes, 0)
          } catch (error) {
            if (!(error instanceof Error) || !/scope limit/.test(error.message)) throw error
            consumerCapacity = true
            return
          }
          try {
            const preparation = preparePreview(input, doc, tracker)
            let prepared
            while (true) {
              const next = preparation.next()
              if (next.done) {
                prepared = next.value
                break
              }
              consumerSteps++
              yield
            }
            assert.equal(prepared.model.blocks.length, 0)
            assert.deepEqual(prepared.status, {
              wordCount: input.document.counts.words,
              characterCount: input.document.counts.characters,
              outline: input.document.outline,
            })
            assert.equal(prepared.commit(), true)
            yield
          } finally {
            tracker.reset()
            hold.release()
          }
        },
      )
  const start = performance.now()
  let batch = start
  try {
    while (true) {
      const currentPhase = phase,
        before = performance.now(),
        next = work.next(),
        elapsed = performance.now() - before
      steps++
      if (currentPhase === 'model') modelAdvances++
      activeMs += elapsed
      phases[currentPhase] = (phases[currentPhase] ?? 0) + elapsed
      largestStepMs = Math.max(largestStepMs, elapsed)
      largestBatchMs = Math.max(largestBatchMs, performance.now() - batch)
      const stats = context.owner.stats
      peakRetained = Math.max(peakRetained, stats.retainedBytes)
      peakStaging = Math.max(peakStaging, stats.readerStagingBytes)
      assert.ok(
        stats.retainedBytes <= session.retained && stats.readerStagingBytes <= session.staging,
      )
      if (next.done) {
        if (ownedMode) ownedPreview = next.value
        break
      }
      if (performance.now() - batch >= 1) {
        await immediate()
        batch = performance.now()
      }
    }
    const wallMs = performance.now() - start
    let installedRetained
    if (ownedMode) {
      assert.ok(ownedPreview)
      assert.equal(ownedPreview.commit(), true)
      context.capture.release()
      context.owner.evict()
      assert.equal(ownedPreview.model.blocks.length, 0)
      assert.deepEqual(ownedPreview.status.outline, [
        { from: 0, to: 19, depth: 1, text: 'nested-containers' },
      ])
      assert.equal(ownedPreview.status.characterCount, text.length)
      assert.equal(context.owner.stats.holds, 2)
      assert.equal(context.owner.stats.readers, 0)
      installedRetained = context.owner.stats.retainedBytes
      receivedCost = { retainedBytes: ownedPreview.cost - consumerBytes, nodes: measuredNodes }
      ownedPreview.release()
      assert.equal(context.owner.stats.retainedBytes, 256)
    } else assert.deepEqual(context.owner.stats, baseline)
    const result = {
      date: new Date().toISOString(),
      collected,
      probes: escaped.map((item) => item.report),
      method: `Development Node/Vite preview-consumer diagnostic (${ownedMode ? 'independently owned application model' : 'borrowed inspection'}). Complete validation precedes separately retained native descriptors/widgets (owned models select only widget ranges), complete outline/counts and timings; no complete AST/full HTML copy is supplied. Copy scratch stays under 8 MiB, aggregate ownership under 64 MiB. Owned mode runs application model/occurrence preparation under independent session holds, verifies model/status after capture closure/base eviction, then releases output. Inspection mode resets its test model/tracker before reservations end. Source/parse/render/encoding and authoritative CodeMirror state are external fixtures. Thirty-nine probes keep closed handles unadvanced while actual native arrays/objects, collectors, source Text, occurrence indexes, model/status outputs, arenas, sources and unreachable owners collect. Four probes retain closed consumer leases after explicit release or owner disposal, with/without a retained owner. Library singleton empty ranges are excluded. A released old model collects while its replacement stays live. This is not production activation, parser equivalence, calibrated heap accounting, packaged p95 or a universal slice bound.`,
      input: {
        sourceBytes: Buffer.byteLength(text),
        sha256: createHash('sha256').update(text).digest('hex'),
        payloadBytes: context.payloadBytes,
      },
      update: {
        steps,
        activeMs,
        wallMs,
        largestStepMs,
        largestBatchMs,
        phases,
        receivedCost,
        consumerBytes,
        consumerSteps,
        consumerCapacity,
        modelAdvances,
        installedRetained,
        peakRetained,
        peakStaging,
      },
    }
    await mkdir('test/artifacts/logs', { recursive: true })
    await writeFile(
      ownedMode
        ? 'test/artifacts/logs/packed-owned-preview-profile.json'
        : 'test/artifacts/logs/packed-owned-inspection-profile.json',
      `${JSON.stringify(result, null, 2)}\n`,
    )
    console.log(JSON.stringify(result, null, 2))
  } finally {
    work.return()
    tracker.reset()
    ownedPreview?.release()
    observe = undefined
    context.owner.dispose()
  }
} finally {
  delete globalThis[key]
  await server.close()
}
