import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'

// Development diagnostic: two independently parsed complete states, forty alternating updates.
// Full parsing/diffing is an oracle, not an incremental parser or packaged freshness sample.
if (!global.gc)
  throw new Error('Run with node --expose-gc test/benchmark/profiles/profile-semantic-text.mjs')
const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB }
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
})
try {
  const { parseMarkdown } = await server.ssrLoadModule('/packages/core/src/parse.ts')
  const { sourceHash } = await server.ssrLoadModule('/packages/core/src/contracts.ts')
  const { renderMarkdown } = await server.ssrLoadModule('/packages/renderer/src/index.ts')
  const { packValue } = await server.ssrLoadModule('/packages/core/src/packing.ts')
  const { PackedArena } = await server.ssrLoadModule('/packages/core/src/packing-arena.ts')
  const { PackedRevision } = await server.ssrLoadModule('/packages/core/src/packing-revision.ts')
  const { PackedSession } = await server.ssrLoadModule('/packages/core/src/packing-session.ts')
  const sessionLimits = { ...limits, captures: 16, readers: 64 }
  const makeReachabilityProbe = () => {
    const owner = new PackedSession(sessionLimits)
    const identity = {
      generation: 1,
      documentId: 'probe',
      revision: 0,
      sourceHash: sourceHash('probe'),
      parserVersion: 'probe',
      rendererVersion: 'probe',
      options: 'probe',
    }
    const request = owner.begin(identity, 'probe')
    owner.commit(owner.prepareFull(request, identity, packValue([[1]], limits.bytes)))
    const capture = owner.capture()
    const outer = capture.reader.elements()
    const parent = outer.next().value
    const inner = parent.elements()
    const child = inner.next().value
    const next = { ...identity, revision: 1, sourceHash: sourceHash('next-probe') }
    const nextRequest = owner.begin(next, 'next-probe')
    const prepared = owner.prepareFull(nextRequest, next, packValue([[2]], limits.bytes))
    const inspection = owner.capturePrepared(prepared)
    const inspected = inspection.reader.elements()
    inspected.next()
    owner.discard(prepared)
    owner.invalidate()
    return {
      weak: new WeakRef(owner),
      capture,
      held: [capture.reader, parent, child, outer, inner, inspection.reader, inspected],
    }
  }
  const reachability = makeReachabilityProbe()
  await new Promise((resolve) => setImmediate(resolve))
  global.gc()
  global.gc()
  assert.notEqual(reachability.weak.deref(), undefined) // The active capture pins its owner.
  reachability.capture.release()
  let collected = false
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setImmediate(resolve))
    global.gc()
    global.gc()
    if (reachability.weak.deref() === undefined) {
      collected = true
      break
    }
  }
  assert.ok(collected, 'Released root/item/iterator handles must not retain their session')
  assert.throws(() => reachability.held[0].kind(), /released/)
  const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const source = `# nested-containers\n\n${chunk.repeat(Math.ceil(MiB / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
  const sha256 = createHash('sha256').update(source).digest('hex')
  assert.equal(sha256, '93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3')
  const sources = [source, source.replace('Nested writing', 'Nested editing')]
  const options = { rawHtml: false, footnotesLabel: 'Footnotes', footnoteBackLabel: 'Back' }
  const oracleTimes = []
  const states = sources.map((text) => {
    const started = performance.now()
    const document = parseMarkdown(text)
    const projection = renderMarkdown(document.root, options)
    oracleTimes.push(performance.now() - started)
    return { document, projection }
  })
  const makeIdentity = (state, revision) => ({
    generation: 1,
    documentId: 'text-diagnostic',
    revision,
    sourceHash: sourceHash(sources[state]),
    parserVersion: states[state].document.parserVersion,
    rendererVersion: states[state].projection.rendererVersion,
    options: JSON.stringify(options),
  })
  const diff = (before, after, path = [], changes = []) => {
    if (Object.is(before, after)) return changes
    if (
      typeof before === 'string' &&
      typeof after === 'string' &&
      Math.max(before.length, after.length) > 4096
    ) {
      let start = 0
      while (
        start < before.length &&
        start < after.length &&
        before.charCodeAt(start) === after.charCodeAt(start)
      )
        start++
      let suffix = 0
      while (
        suffix < before.length - start &&
        suffix < after.length - start &&
        before.charCodeAt(before.length - 1 - suffix) ===
          after.charCodeAt(after.length - 1 - suffix)
      )
        suffix++
      changes.push({
        kind: 'text',
        path,
        start,
        remove: before.length - start - suffix,
        value: after.slice(start, after.length - suffix),
      })
    } else if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
      for (let index = 0; index < before.length; index++)
        diff(before[index], after[index], [...path, index], changes)
    } else if (
      before &&
      after &&
      typeof before === 'object' &&
      typeof after === 'object' &&
      !Array.isArray(before) &&
      !Array.isArray(after) &&
      JSON.stringify(Object.keys(before)) === JSON.stringify(Object.keys(after))
    ) {
      for (const key of Object.keys(after)) diff(before[key], after[key], [...path, key], changes)
    } else changes.push({ kind: 'replace', path, value: after })
    return changes
  }
  const diffStarted = performance.now()
  const changes = [diff(states[1], states[0]), diff(states[0], states[1])]
  const diffMs = performance.now() - diffStarted
  const compare = (view, value) => {
    if (view.kind() === 'scalar')
      assert.equal(view.readScalar({ retained: 8 * MiB, staging: 8 * MiB }), value)
    else if (view.kind() === 'position') assert.deepEqual(view.position(), value)
    else if (view.kind() === 'array') {
      assert.equal(view.length(), value.length)
      let index = 0
      for (const child of view.elements()) compare(child, value[index++])
    } else {
      assert.deepEqual(view.keys(), Object.keys(value))
      for (const key of view.keys()) compare(view.at([key]), value[key])
    }
  }
  const base = PackedRevision.full(
    PackedArena.open(packValue(states[0], limits.bytes), limits),
    source,
    makeIdentity(0, 0),
    limits,
  )
  const compareScope = (reader, value, path = []) => {
    const outputLimits = { retained: 8 * MiB, staging: 8 * MiB }
    const kind = reader.kind(path)
    if (kind === 'scalar') assert.equal(reader.scalar(path, outputLimits), value)
    else if (kind === 'position') assert.deepEqual(reader.position(path, outputLimits), value)
    else if (kind === 'array') {
      assert.equal(reader.length(path), value.length)
      let index = 0
      for (const child of reader.elements(path)) compareScope(child, value[index++])
    } else {
      const keys = reader.keys(path, outputLimits)
      assert.deepEqual(keys, Object.keys(value))
      for (const key of keys) compareScope(reader, value[key], [...path, key])
    }
  }
  const session = new PackedSession(sessionLimits)
  const initialIdentity = makeIdentity(0, 0)
  const initialRequest = session.begin(initialIdentity, source)
  const initialPayload = packValue(states[0], limits.bytes)
  const initialReserve = initialPayload.byteLength + 2048
  const initialPrepared = session.prepareFull(
    initialRequest,
    initialIdentity,
    initialPayload,
    initialReserve,
  )
  const initialSessionPeak = session.stats.retainedBytes
  session.commit(initialPrepared)
  const heldCapture = session.capture()
  let maxSessionUpdatePeak = session.stats.retainedBytes
  const sessionSamples = []
  const captures = [{ revision: base, state: 0 }]
  let revision = base
  const samples = []
  global.gc()
  global.gc()
  const before = process.memoryUsage()
  for (let index = 1; index <= 40; index++) {
    const state = index % 2
    const changed = changes[state]
    const encodeStarted = performance.now()
    const payload = packValue(
      changed.map(({ value }) => value),
      limits.bytes,
    )
    const bytes = payload.byteLength
    const arena = PackedArena.open(payload, limits)
    const records = [...arena.elements(arena.root)]
    const operations = changed.map(({ value: _value, ...operation }, offset) => ({
      ...operation,
      record: records[offset],
    }))
    const result = makeIdentity(state, index)
    // Candidate envelope sizing includes operation paths; exact source strings already belong
    // to the request/receiver and are local application arguments, not duplicated in this wire.
    const envelopeBytes = Buffer.byteLength(
      JSON.stringify({ base: revision.identity, result, operations }),
    )
    assert.ok(bytes + envelopeBytes <= limits.bytes)
    const outgoingReserve = bytes + envelopeBytes * 2
    const encodeIndexMs = performance.now() - encodeStarted
    const started = performance.now()
    const next = revision.apply(
      {
        base: revision.identity,
        baseSource: revision.source,
        result,
        source: sources[state],
        arena,
        operations,
      },
      { ...limits, retained: limits.retained - outgoingReserve },
    )
    const applyMs = performance.now() - started
    const readStarted = performance.now()
    assert.equal(
      next.root.at(['projection', 'html']).readScalar({ retained: 8 * MiB, staging: 8 * MiB }),
      states[state].projection.html,
    )
    const htmlReadMs = performance.now() - readStarted
    compare(next.root, states[state])
    const beginStarted = performance.now()
    const sessionRequest = session.begin(result, sources[state])
    const sessionBeginMs = performance.now() - beginStarted
    const prepareStarted = performance.now()
    const prepared = session.prepareDelta(
      sessionRequest,
      {
        base: revision.identity,
        baseSource: revision.source,
        result,
        payload: packValue(
          changed.map(({ value }) => value),
          limits.bytes,
        ),
        operations,
      },
      outgoingReserve,
    )
    const sessionPrepareMs = performance.now() - prepareStarted
    maxSessionUpdatePeak = Math.max(maxSessionUpdatePeak, session.stats.retainedBytes)
    assert.ok(session.stats.retainedBytes <= limits.retained)
    const commitStarted = performance.now()
    session.commit(prepared)
    const sessionCommitMs = performance.now() - commitStarted
    const scoped = session.capture()
    compareScope(scoped.reader, states[state])
    scoped.release()
    if (index === 10) {
      compareScope(heldCapture.reader, states[0])
      heldCapture.release()
    }
    assert.equal(session.stats.readers, 0)
    assert.equal(session.stats.captures, index < 10 ? 1 : 0)
    sessionSamples.push({
      revision: index,
      beginMs: sessionBeginMs,
      prepareMs: sessionPrepareMs,
      commitMs: sessionCommitMs,
      retained: session.stats.retainedBytes,
    })
    samples.push({
      revision: index,
      bytes,
      envelopeBytes,
      encodeIndexMs,
      applyMs,
      htmlReadMs,
      retained: next.retainedBytes,
      preparationWithOutgoingReserve: next.preparationBytes + outgoingReserve,
      htmlCost: next.root.at(['projection', 'html']).scalarCost(),
    })
    if (index === 1 || index === 20) captures.push({ revision: next, state })
    revision = next
    if (index % 10 === 0) console.log(`Verified complete updated graph ${index}/40`)
  }
  global.gc()
  global.gc()
  const after = process.memoryUsage()
  for (const capture of captures) compare(capture.revision.root, states[capture.state])
  const sessionBeforeDispose = session.stats
  session.dispose()
  assert.equal(session.stats.retainedBytes, 0)
  assert.equal(session.stats.resources, 0)
  const result = {
    method:
      'Development Node/Vite diagnostic, exact complete nested corpus. Two independently parsed/rendered states produce complete diffs with UTF-16 text splices. Forty alternating raw revisions and separately session-owned updates each compare every semantic/projection field. The session holds one old capture for ten updates, revokes it, accounts current/request/prepared/readers/outgoing reserve, then releases every managed resource. This is not forty fresh parses, incremental parsing, a production transport, packaged freshness or a portable heap bound. Baseline keeps both native oracle graphs, diff plans, raw base and session base alive.',
    date: new Date().toISOString(),
    runtime: process.versions,
    sourceBytes: Buffer.byteLength(source),
    sourceSha256: sha256,
    independentOracleMs: oracleTimes,
    twoWholeDiffsMs: diffMs,
    updates: samples.length,
    baseRetained: base.retainedBytes,
    finalRetained: revision.retainedBytes,
    maxDeltaBytes: Math.max(...samples.map((sample) => sample.bytes)),
    maxWireBytes: Math.max(...samples.map((sample) => sample.bytes + sample.envelopeBytes)),
    maxPreparationWithOutgoingReserve: Math.max(
      ...samples.map((sample) => sample.preparationWithOutgoingReserve),
    ),
    heapDelta: after.heapUsed - before.heapUsed,
    arrayBufferDelta: after.arrayBuffers - before.arrayBuffers,
    equivalent: true,
    oldCapturesEquivalent: true,
    session: {
      initialPreparationWithOutgoingReserve: initialSessionPeak,
      maximumUpdatePreparationWithOutgoingReserve: maxSessionUpdatePeak,
      finalRetained: sessionBeforeDispose.retainedBytes,
      finalResources: sessionBeforeDispose.resources,
      disposed: session.stats,
      releasedReadersDoNotRetainOwner: collected,
      method:
        'Independent 16 MiB owner; exact source object shared between request and result. Object identities union arenas/overlay resources; captures, iterators, metadata and the full prepared outgoing reserve remain charged. An original capture stays alive for ten updates. Native scalar/key/position outputs have independent caller budgets and are not owner-held caches.',
      samples: sessionSamples,
    },
    samples,
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/semantic-text-profile.json',
    `${JSON.stringify(result, null, 2)}\n`,
  )
  console.log(JSON.stringify(result, null, 2))
} finally {
  await server.close()
}
