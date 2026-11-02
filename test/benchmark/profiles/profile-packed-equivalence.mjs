import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error(
    'Run with node --expose-gc test/benchmark/profiles/profile-packed-equivalence.mjs',
  )
const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const sessionLimits = { ...limits, retained: 64 * MiB, bytes: 8 * MiB, captures: 8, readers: 160 }
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
const key = Symbol.for('manuslip-packed-equivalence-profile')
let observe
globalThis[key] = (phase, value) => observe?.(phase, value)
const hook = (phase, value) =>
  `globalThis[Symbol.for('manuslip-packed-equivalence-profile')]?.('${phase}', ${value});`
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
  plugins: [
    {
      name: 'profile-exact-snapshot-lifetimes',
      enforce: 'pre',
      transform(code, id) {
        const path = id.replaceAll('\\', '/')
        const replace = (marker, extra, before = false) => {
          assert.ok(code.includes(marker), `Missing diagnostic marker in ${path}: ${marker}`)
          return code.replace(marker, before ? `${extra} ${marker}` : `${marker}; ${extra}`)
        }
        if (path.endsWith('/core/src/packing-array-lookup.ts'))
          return replace('this.#values = values', hook('lookup-storage', 'values'))
        if (path.endsWith('/core/src/packing-capture.ts'))
          return replace('values = new Array<PackedView>(size)', hook('index-building', 'values'))
        if (path.endsWith('/renderer/src/projection-sequence.ts')) {
          assert.equal(code.split('root(state) {').length, 3)
          return code.replaceAll('root(state) {', `root(state) { ${hook('state', 'state')}`)
        }
        if (path.endsWith('/renderer/src/packed-html-cursor.ts')) {
          code = replace('this.#stream = stream', hook('cursor', 'this'))
          code = replace('*skip(to: number): Generator<void> {', hook('fields', 'to'))
          return replace('        at += take', hook('compared', 'take'))
        }
        if (path.endsWith('/renderer/src/packing-validate-output.ts')) {
          code = replace(
            'const widgets = new Map<string, WidgetIndex>()',
            hook('widget-map', 'widgets'),
          )
          code = replace('yield* cursor.equal(value)', hook('comparison-kind', 'field'), true)
          code = replace(
            "if (event.kind === 'begin') {",
            hook('comparison-kind', "event.footer ? 'footer' : 'body'"),
          )
          return replace(
            'yield* widgetHtml.equal(event.value)',
            hook('comparison-kind', "'html'"),
            true,
          )
        }
      },
    },
  ],
})
try {
  const load = (name) => server.ssrLoadModule(`/packages/${name}.ts`)
  const { validatePackedSnapshot } = await load('renderer/src/packing-validate-snapshot')
  const { renderProjectionLayout } = await load('renderer/src/projection-layout')
  const { ProjectionSequence } = await load('renderer/src/projection-sequence')
  const { rendererVersion } = await load('renderer/src/index')
  const { PackedArena } = await load('core/src/packing-arena')
  const { PackedCapture } = await load('core/src/packing-capture')
  const { PackedSession } = await load('core/src/packing-session')
  const { PackedReceiver } = await load('core/src/packing-receiver')
  const { PackedSource } = await load('core/src/packing-source')
  const { PackedWordBuffer } = await load('core/src/packing-word-buffer')
  const { packValue } = await load('core/src/packing')
  const { sourceHash } = await load('core/src/contracts')
  const { parseMarkdown } = await load('core/src/parse')
  const { newPackedToken } = await load('core/src/packing-token')
  const { packedWireVersion } = await load('core/src/packing-wire')
  const produce = (text) => {
    // Full native parse/render is an external producer/oracle, never retained by validation.
    const document = parseMarkdown(text)
    const { projection, layout } = renderProjectionLayout(document.root, options, limits.staging)
    const snapshot = { document, projection, layout }
    const source = new PackedSource(
      {
        generation: 1,
        documentId: 'packed-equivalence-profile',
        revision: 0,
        sourceHash: sourceHash(text),
        parserVersion: document.parserVersion,
        rendererVersion,
        options: JSON.stringify(options),
      },
      text,
    )
    const payload = packValue(snapshot, limits.staging)
    return { source, payload }
  }
  const fixture = (text) => {
    const { source, payload } = produce(text)
    const owner = new PackedSession(sessionLimits)
    const payloadBytes = payload.byteLength
    owner.commit(owner.prepareFull(owner.beginPrepared(source), source.identity, payload))
    return { source, owner, capture: owner.capture(), payloadBytes }
  }
  const packet = (ticket, payload) => ({
    protocol: packedWireVersion,
    kind: 'full',
    sequence: ticket.sequence,
    result: ticket.identity,
    requestToken: ticket.requestToken,
    resultToken: newPackedToken(),
    sentAt: 0,
    payload,
    metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
  })
  const watch = (value, refs, seen = new WeakSet()) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    refs.push(new WeakRef(value))
    if (value instanceof Map) for (const item of value.values()) watch(item, refs, seen)
    else for (const item of Object.values(value)) watch(item, refs, seen)
  }
  const probe = (phase, keepOwner) => {
    const refs = []
    const reached = new Set()
    let comparisonKind
    const compared = {}
    let lookup
    let scope
    const original = {
      open: PackedArena.open,
      create: PackedWordBuffer.create,
      workspace: PackedCapture.prototype.workspace,
      array: PackedCapture.prototype.inspectArray,
      convert: ProjectionSequence.prototype.convertSteps,
      footer: ProjectionSequence.prototype.finishConversion,
    }
    observe = (kind, value) => {
      if (kind === 'comparison-kind') comparisonKind = value
      else if (kind === 'compared') {
        assert.ok(value > 0 && value <= 4098)
        compared[comparisonKind] = (compared[comparisonKind] ?? 0) + value
        reached.add(`${comparisonKind}-compare`)
      } else {
        reached.add(kind)
        watch(value, refs)
      }
    }
    PackedArena.open = function (...args) {
      const value = original.open.apply(this, args)
      refs.push(new WeakRef(value))
      return value
    }
    PackedWordBuffer.create = function (...args) {
      const value = original.create.apply(this, args)
      refs.push(new WeakRef(value))
      return value
    }
    PackedCapture.prototype.workspace = function (...args) {
      const value = original.workspace.apply(this, args)
      refs.push(new WeakRef(value))
      return value
    }
    PackedCapture.prototype.inspectArray = function (path, budget, inspect) {
      return original.array.call(this, path, budget, function* (index, cost) {
        lookup = index
        if (index.length) scope = index.at(0)
        yield* inspect(index, cost)
      })
    }
    ProjectionSequence.prototype.convertSteps = function* (...args) {
      const value = yield* original.convert.apply(this, args)
      reached.add('hast')
      watch(value, refs)
      return value
    }
    ProjectionSequence.prototype.finishConversion = function (...args) {
      const value = original.footer.apply(this, args)
      watch(value, refs)
      return value
    }
    const context = fixture(
      `~~~text\n${'a界😀'.repeat(10000)}\n~~~\n\nbody[^a] [r][r]\n\n[r]: /url\n\n[^a]: ${'a界😀'.repeat(10000)}\n`,
    )
    refs.push(new WeakRef(context.source))
    if (!keepOwner) refs.push(new WeakRef(context.owner))
    const work = validatePackedSnapshot(context.capture, context.source, [], options, limits)
    let steps = 0
    try {
      if (phase !== 'queued')
        while (true) {
          const next = work.next()
          steps++
          assert.ok(steps < 1000000, `Unreached phase ${phase}`)
          if (phase === 'complete' && next.done) break
          assert.equal(next.done, false, `Premature completion before ${phase}`)
          if (reached.has(phase)) break
        }
      const report = { phase, keepOwner, steps, compared, references: refs.length }
      context.capture.release()
      context.owner.dispose()
      assert.equal(context.owner.stats.retainedBytes, 0)
      assert.equal(context.owner.stats.readers, 0)
      assert.equal(context.owner.stats.readerStagingBytes, 0)
      return {
        work,
        capture: context.capture,
        owner: keepOwner ? context.owner : undefined,
        lookup,
        scope,
        refs,
        report,
      }
    } finally {
      context.owner.dispose()
      PackedArena.open = original.open
      PackedWordBuffer.create = original.create
      PackedCapture.prototype.workspace = original.workspace
      PackedCapture.prototype.inspectArray = original.array
      ProjectionSequence.prototype.convertSteps = original.convert
      ProjectionSequence.prototype.finishConversion = original.footer
      observe = undefined
    }
  }
  const escaped = [
    'queued',
    'fields',
    'index-building',
    'lookup-storage',
    'hast',
    'body-compare',
    'html-compare',
    'value-compare',
    'footer-compare',
    'complete',
  ].flatMap((phase) => [false, true].map((keepOwner) => probe(phase, keepOwner)))
  // This separate probe deliberately does not release/dispose the owner or capture. A
  // closed borrowed lookup/scope/work must not keep an otherwise unreachable live owner.
  const unreachableLookup = () => {
    const context = fixture('~~~text\nold\n~~~\n')
    const refs = [
      new WeakRef(context.owner),
      new WeakRef(context.capture),
      new WeakRef(context.source),
    ]
    let lookup
    let scope
    observe = (kind, value) => {
      if (kind === 'lookup-storage') watch(value, refs)
    }
    const work = context.capture.inspectArray(
      ['projection', 'blocks'],
      { ...limits, items: 50000 },
      function* (index) {
        lookup = index
        scope = index.at(0)
        yield
      },
    )
    try {
      while (!work.next().done) {}
      assert.equal(context.owner.stats.readers, 0)
      return {
        work,
        lookup,
        scope,
        refs,
        report: { phase: 'unreachable-live-owner', references: refs.length },
      }
    } finally {
      observe = undefined
    }
  }
  escaped.push(unreachableLookup())
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
      'Uncollected probes:',
      escaped.filter((e) => e.refs.some((r) => r.deref())).map((e) => e.report),
    )
  assert.ok(collected, 'Closed unadvanced handles must drop all watched resources')
  const probes = escaped.map(({ work, lookup, scope, report }) => {
    assert.equal(work.next().done, true)
    if (lookup) assert.throws(() => lookup.at(0), /closed/)
    if (scope) assert.throws(() => scope.kind(), /closed/)
    return report
  })
  const nestedChunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const nested = `# nested-containers\n\n${nestedChunk.repeat(Math.ceil(MiB / Buffer.byteLength(nestedChunk)))}\n[r]: https://example.invalid/\n`
  const notes = `first[^a] and [r][r]\n\nsecond[^b] and again[^a]\n\n[r]: /first\n\n[r]: /second\n\n[^a]: ${'note 界😀 '.repeat(20000)}\n\n    > [r]: /inside\n    >\n    > ![picture][r]\n\n[^b]: other with [^a]\n`
  const measure = async (work, stats) => {
    let steps = 0
    let activeMs = 0
    let largestStepMs = 0
    let largestBatchMs = 0
    let peakRetained = 0
    let peakStaging = 0
    const started = performance.now()
    let batchStart = started
    while (true) {
      const before = performance.now()
      const next = work.next()
      const elapsed = performance.now() - before
      steps++
      activeMs += elapsed
      largestStepMs = Math.max(largestStepMs, elapsed)
      largestBatchMs = Math.max(largestBatchMs, performance.now() - batchStart)
      const current = stats()
      peakRetained = Math.max(peakRetained, current.retainedBytes)
      const staging = current.readerStagingBytes + current.preparingStagingBytes
      peakStaging = Math.max(peakStaging, staging)
      assert.ok(current.retainedBytes <= sessionLimits.retained)
      assert.ok(staging <= limits.staging)
      if (next.done)
        return {
          steps,
          activeMs,
          wallMs: performance.now() - started,
          largestStepMs,
          largestBatchMs,
          peakRetained,
          peakStaging,
          result: next.value,
        }
      if (performance.now() - batchStart >= 1) {
        await immediate()
        batchStart = performance.now()
      }
    }
  }
  const reports = []
  for (const [name, text] of [
    ['nested', nested],
    ['notes', notes],
    ['widget', `~~~plain\n${'a界😀'.repeat(100000)}\n~~~\n`],
  ]) {
    const context = fixture(text)
    const baseline = context.owner.stats
    const work = validatePackedSnapshot(context.capture, context.source, [], options, limits)
    try {
      const { result, ...timing } = await measure(work, () => context.owner.stats)
      assert.equal(result, undefined)
      assert.deepEqual(context.owner.stats, baseline)
      context.capture.release()
      context.owner.dispose()
      const receiver = new PackedReceiver(sessionLimits, (capture, source) =>
        validatePackedSnapshot(capture, source, [], options, limits),
      )
      const producer = produce(text)
      let receipts
      try {
        const initialTicket = receiver.begin(1, producer.source)
        // Each received buffer is independently owned; producer-side full snapshots are
        // outside this diagnostic's renderer ledger, as with the real worker boundary.
        const initial = await measure(
          receiver.receiveSteps(initialTicket, packet(initialTicket, producer.payload.slice(0))),
          () => receiver.stats,
        )
        assert.equal(initial.result?.kind, 'accepted')
        const old = initial.result.capture
        const revised = new PackedSource({ ...producer.source.identity, revision: 1 }, text)
        const replacementTicket = receiver.begin(2, revised)
        const replacement = await measure(
          receiver.receiveSteps(
            replacementTicket,
            packet(replacementTicket, producer.payload.slice(0)),
          ),
          () => receiver.stats,
        )
        assert.equal(replacement.result?.kind, 'accepted')
        assert.deepEqual(old.identity, producer.source.identity)
        assert.equal(receiver.stats.readers, 0)
        assert.equal(receiver.stats.readerStagingBytes, 0)
        receipts = {
          initial: { ...initial, result: initial.result.kind },
          replacementWithOldCapture: { ...replacement, result: replacement.result.kind },
        }
        old.release()
        replacement.result.capture.release()
      } finally {
        receiver.dispose()
      }
      assert.equal(receiver.stats.retainedBytes, 0)
      reports.push({
        name,
        sourceBytes: Buffer.byteLength(text),
        sha256: createHash('sha256').update(text).digest('hex'),
        payloadBytes: context.payloadBytes,
        ...timing,
        receipts,
      })
    } finally {
      work.return()
      context.owner.dispose()
    }
    assert.equal(context.owner.stats.retainedBytes, 0)
  }
  const text = '~~~text\nold\n~~~\n\nbody[^a]\n\n[^a]: note $x$\n'
  const document = parseMarkdown(text)
  const { projection, layout } = renderProjectionLayout(document.root, options, limits.staging)
  const snapshot = { document, projection, layout }
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'receiver-equivalence',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: document.parserVersion,
      rendererVersion,
      options: JSON.stringify(options),
    },
    text,
  )
  const receiver = new PackedReceiver(sessionLimits, (capture, checked) =>
    validatePackedSnapshot(capture, checked, [], options, limits),
  )
  const receive = (sequence, value, revision) => {
    const checked = revision ? new PackedSource({ ...source.identity, revision }, text) : source
    const ticket = receiver.begin(sequence, checked)
    const message = {
      protocol: packedWireVersion,
      kind: 'full',
      sequence,
      result: checked.identity,
      requestToken: ticket.requestToken,
      resultToken: newPackedToken(),
      sentAt: 0,
      payload: packValue(value, limits.staging),
      metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
    }
    return receiver.receiveSteps(ticket, message)
  }
  let receiverReport
  try {
    const first = await measure(receive(1, snapshot, 0), () => receiver.stats)
    assert.equal(first.result?.kind, 'accepted')
    const old = first.result.capture
    const forged = structuredClone(snapshot)
    forged.projection.html = forged.projection.html.replace('old', 'bad')
    await assert.rejects(
      measure(receive(2, forged, 1), () => receiver.stats),
      /semantic/,
    )
    assert.deepEqual(receiver.stats.current, source.identity)
    assert.equal(receiver.stats.prepared, null)
    assert.equal(receiver.stats.readers, 0)
    assert.equal(receiver.stats.readerStagingBytes, 0)
    assert.equal(old.reader.textLength(['projection', 'html']), projection.html.length)
    const retry = await measure(receive(3, snapshot, 1), () => receiver.stats)
    assert.equal(retry.result?.kind, 'accepted')
    receiverReport = {
      initial: { ...first, result: first.result.kind },
      forgedRejected: true,
      oldCapturePreserved: true,
      retry: { ...retry, result: retry.result.kind },
    }
    old.release()
    retry.result.capture.release()
  } finally {
    receiver.dispose()
  }
  assert.equal(receiver.stats.retainedBytes, 0)
  const output = {
    date: new Date().toISOString(),
    method:
      'Development Node/Vite composed snapshot diagnostic. Strict document/count/projection/layout/supplied-widget checks precede capture-owned packed-to-native rendering and exact streamed UTF-16 comparison of full HTML, every layout span, widget HTML/value and widget completeness. One persistent full-HTML decoder and one temporary widget decoder coexist with rendering under unchanged 64 MiB retained/8 MiB staging caps. Twenty cancellation/completion GC probes retain closed handles unadvanced; an additional probe retains only closed work/lookup/scope while an otherwise unreachable live owner is not explicitly disposed. Instrumentation observes actual indexed storage, maps, public state, HAST, collectors, holds, cursors, arenas and source. Full native parse/render is an external producer/oracle. Receiver rejection preserves old capture and permits retry without early acceptance/ACK. Single-run development timing is not a packaged performance gate or calibrated heap bound. Fresh-parser equivalence, verified reuse, production transport/DOM integration and release gates remain open.',
    runtime: process.versions,
    collected,
    probes,
    reports,
    receiver: receiverReport,
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/packed-equivalence-profile.json',
    `${JSON.stringify(output, null, 2)}\n`,
  )
  console.log(JSON.stringify(output, null, 2))
} finally {
  delete globalThis[key]
  await server.close()
}
