import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { MessageChannel } from 'node:worker_threads'
import { createServer } from 'vite'

// Full native roots below are independent test oracles, never an application cache/path.
if (!global.gc)
  throw new Error(
    'Run with node --expose-gc test/benchmark/profiles/profile-markdown-fragments.mjs',
  )
const MiB = 1024 * 1024
const transferWire = (message) =>
  new Promise((resolve, reject) => {
    const { port1, port2 } = new MessageChannel()
    const close = () => {
      port1.close()
      port2.close()
    }
    port2.once('message', (value) => {
      close()
      resolve(value)
    })
    port2.once('messageerror', (error) => {
      close()
      reject(error)
    })
    try {
      port1.postMessage(message, 'payload' in message ? [message.payload] : [])
    } catch (error) {
      close()
      reject(error)
    }
  })
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
})
try {
  const { parseMarkdown } = await server.ssrLoadModule('/packages/core/src/parse.ts')
  const { renderProjectionLayout } = await server.ssrLoadModule(
    '/packages/renderer/src/projection-layout.ts',
  )
  const { projectMarkdownFragment, projectionFragmentOperations } = await server.ssrLoadModule(
    '/packages/renderer/src/projection-fragment.ts',
  )
  const { sourceHash } = await server.ssrLoadModule('/packages/core/src/contracts.ts')
  const { packValue } = await server.ssrLoadModule('/packages/core/src/packing.ts')
  const { PackedSource } = await server.ssrLoadModule('/packages/core/src/packing-source.ts')
  const { PackedSession } = await server.ssrLoadModule('/packages/core/src/packing-session.ts')
  const { PackedReceiver } = await server.ssrLoadModule('/packages/core/src/packing-receiver.ts')
  const { PackedPublisher } = await server.ssrLoadModule('/packages/core/src/packing-publisher.ts')
  const { newPackedToken } = await server.ssrLoadModule('/packages/core/src/packing-token.ts')
  const { packedWireVersion, readPackedWire } = await server.ssrLoadModule(
    '/packages/core/src/packing-wire.ts',
  )
  const { PackedArena } = await server.ssrLoadModule('/packages/core/src/packing-arena.ts')
  const { validatePackedDescriptions } = await server.ssrLoadModule(
    '/packages/core/src/packing-validate-descriptions.ts',
  )
  const { PackedSourcePoints } = await server.ssrLoadModule(
    '/packages/core/src/packing-source-points.ts',
  )
  const sourcePointIndexes = []
  const sourcePointBuilders = []
  const buildSourcePoints = PackedSourcePoints.build
  const watchSourcePoints = (builders, indexes) => {
    PackedSourcePoints.build = function* (source) {
      const builder = buildSourcePoints.call(this, source)
      builders.push(new WeakRef(builder))
      const index = yield* builder
      indexes.push(new WeakRef(index))
      return index
    }
  }
  watchSourcePoints(sourcePointBuilders, sourcePointIndexes)
  const validationSummaries = []
  const summarizePositions = PackedArena.prototype.summarizePositions
  const summarizePositionSteps = PackedArena.prototype.summarizePositionSteps
  const summaryBuilders = []
  PackedArena.prototype.summarizePositions = function (stage) {
    const summary = summarizePositions.call(this, stage)
    validationSummaries.push(new WeakRef(summary))
    return summary
  }
  PackedArena.prototype.summarizePositionSteps = function* (stage) {
    const builder = summarizePositionSteps.call(this, stage)
    summaryBuilders.push(new WeakRef(builder))
    const summary = yield* builder
    validationSummaries.push(new WeakRef(summary))
    return summary
  }
  const { SemanticDependencies } = await server.ssrLoadModule(
    '/packages/core/src/semantic-dependencies.ts',
  )
  const { reparseMarkdownFragment } = await server.ssrLoadModule(
    '/packages/core/src/markdown-fragment.ts',
  )
  const { describeDocumentFragment, documentFragmentOperations } = await server.ssrLoadModule(
    '/packages/core/src/document-metadata.ts',
  )
  const indexLimits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 64 }
  const receiverDisposalProbe = (keepReceiver) => {
    const context = { value: 'probe context' }
    const checked = new PackedSource(
      {
        generation: 1,
        documentId: 'receiver-gc-probe',
        revision: 0,
        sourceHash: sourceHash(context.value),
        parserVersion: 'probe',
        rendererVersion: 'probe',
        options: 'probe',
      },
      context.value,
    )
    const receiver = new PackedReceiver(
      { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 4, readers: 64 },
      (capture) => {
        assert.equal(
          capture.reader.scalar(['value'], { retained: 1024, staging: 1024 }),
          context.value,
        )
      },
    )
    const ticket = receiver.begin(0, checked)
    const accepted = receiver.receive(ticket, {
      protocol: packedWireVersion,
      kind: 'full',
      sequence: 0,
      result: checked.identity,
      requestToken: ticket.requestToken,
      resultToken: newPackedToken(),
      sentAt: 0,
      payload: packValue(context, 8 * MiB),
      metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
    })
    assert.equal(accepted.kind, 'accepted')
    receiver.dispose()
    return {
      receiver: keepReceiver ? receiver : undefined,
      owner: new WeakRef(receiver),
      context: new WeakRef(context),
      capture: accepted.capture,
      ticket,
    }
  }
  const keptReceiver = receiverDisposalProbe(true)
  const releasedReceiver = receiverDisposalProbe(false)
  const publisherDisposalProbe = (keepPublisher) => {
    const source = new PackedSource(
      {
        generation: 1,
        documentId: 'publisher-gc-probe',
        revision: 0,
        sourceHash: sourceHash('probe'),
        parserVersion: 'probe',
        rendererVersion: 'probe',
        options: 'probe',
      },
      'probe',
    )
    const owner = new PackedSession({
      bytes: 8 * MiB,
      retained: 16 * MiB,
      staging: 8 * MiB,
      captures: 4,
      readers: 64,
    })
    const publisher = new PackedPublisher(owner)
    const request = {
      protocol: packedWireVersion,
      kind: 'request',
      sequence: 0,
      identity: source.identity,
      requestToken: newPackedToken(),
      base: null,
    }
    const payload = packValue({ value: source.text }, 8 * MiB)
    const wire = readPackedWire(
      {
        protocol: packedWireVersion,
        kind: 'full',
        sequence: 0,
        result: source.identity,
        requestToken: request.requestToken,
        resultToken: newPackedToken(),
        sentAt: 0,
        payload: payload.slice(0),
        metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
      },
      { sequence: 0, result: source.identity, requestToken: request.requestToken },
    )
    const ticket = owner.prepareFull(
      owner.beginPrepared(source),
      source.identity,
      payload,
      wire.bytes + wire.retainedBytes,
    )
    const offered = publisher.offer(request, source, ticket, wire.message)
    structuredClone(offered, { transfer: [offered.payload] })
    const acknowledgement = {
      protocol: packedWireVersion,
      kind: 'accepted',
      sequence: 0,
      result: source.identity,
      requestToken: request.requestToken,
      resultToken: offered.resultToken,
    }
    publisher.acknowledge(acknowledgement)
    publisher.dispose()
    owner.dispose()
    assert.equal(owner.stats.retainedBytes, 0)
    return {
      kept: keepPublisher ? publisher : undefined,
      publisher: new WeakRef(publisher),
      owner: new WeakRef(owner),
      source: new WeakRef(source),
      offered,
      ticket,
      acknowledgement,
    }
  }
  const keptPublisher = publisherDisposalProbe(true)
  const releasedPublisher = publisherDisposalProbe(false)
  let disposedPublisherCollected = false
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setImmediate(resolve))
    global.gc()
    global.gc()
    if (
      keptPublisher.owner.deref() === undefined &&
      keptPublisher.source.deref() === undefined &&
      releasedPublisher.publisher.deref() === undefined &&
      releasedPublisher.owner.deref() === undefined &&
      releasedPublisher.source.deref() === undefined
    ) {
      disposedPublisherCollected = true
      break
    }
  }
  assert.ok(
    disposedPublisherCollected,
    'Disposed publishers and escaped messages/tickets/receipts must release source and owner',
  )
  assert.equal(keptPublisher.offered.payload.byteLength, 0)
  let disposedReceiverCollected = false
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setImmediate(resolve))
    global.gc()
    global.gc()
    if (
      keptReceiver.context.deref() === undefined &&
      releasedReceiver.owner.deref() === undefined
    ) {
      disposedReceiverCollected = true
      break
    }
  }
  assert.ok(
    disposedReceiverCollected,
    'Disposal must release validator context and escaped handles must not retain the receiver',
  )
  assert.equal(keptReceiver.receiver.stats.retainedBytes, 0)
  assert.throws(() => releasedReceiver.capture.reader.kind(), /released/)
  const receiptBuffers = []
  const transferBuffer = global.structuredClone
  global.structuredClone = (value, options) => {
    const owned = transferBuffer(value, options)
    if (value instanceof ArrayBuffer && owned instanceof ArrayBuffer)
      receiptBuffers.push(new WeakRef(owned))
    return owned
  }
  const queuedReceiptProbe = (phase) => {
    const context = { value: 'queued validation' }
    const checked = new PackedSource(
      {
        generation: 1,
        documentId: 'queued-gc-probe',
        revision: 0,
        sourceHash: sourceHash(context.value),
        parserVersion: 'probe',
        rendererVersion: 'probe',
        options: 'probe',
      },
      context.value,
    )
    let escapedReader
    const receiver = new PackedReceiver(
      { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 4, readers: 64 },
      function* (capture) {
        for (const item of capture.reader.elements(['items'])) {
          escapedReader = item
          assert.equal(item.scalar([], { retained: 1024, staging: 1024 }), context.value)
          yield
        }
      },
    )
    const ticket = receiver.begin(0, checked)
    const packet = {
      protocol: packedWireVersion,
      kind: 'full',
      sequence: 0,
      result: checked.identity,
      requestToken: ticket.requestToken,
      resultToken: newPackedToken(),
      sentAt: 0,
      payload: packValue({ items: [context.value, context.value] }, 8 * MiB),
      metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
    }
    const work = receiver.receiveSteps(ticket, packet)
    assert.equal(packet.payload.byteLength, 0)
    if (phase === 'indexing') {
      assert.equal(work.next().done, false)
      assert.equal(work.next().done, false)
      assert.ok(receiver.stats.preparingBytes > 0)
      assert.equal(receiver.stats.prepared, null)
    } else if (phase === 'validation') {
      let steps = 0
      while (!escapedReader) {
        assert.equal(work.next().done, false)
        assert.ok(++steps < 100)
      }
    }
    receiver.dispose()
    assert.equal(receiver.stats.retainedBytes, 0)
    assert.equal(work.next().done, true)
    return {
      work,
      packet,
      ticket,
      reader: escapedReader,
      receiver: new WeakRef(receiver),
      source: new WeakRef(checked),
      context: new WeakRef(context),
    }
  }
  const queuedReceiptProbes = ['unstarted', 'indexing', 'validation'].map(queuedReceiptProbe)
  global.structuredClone = transferBuffer
  let queuedReceiptCollected = false
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setImmediate(resolve))
    global.gc()
    global.gc()
    if (
      receiptBuffers.every((buffer) => buffer.deref() === undefined) &&
      queuedReceiptProbes.every(
        (probe) =>
          probe.receiver.deref() === undefined &&
          probe.source.deref() === undefined &&
          probe.context.deref() === undefined,
      )
    ) {
      queuedReceiptCollected = true
      break
    }
  }
  assert.ok(
    queuedReceiptCollected,
    'Queued revoked receipt handles/readers must release receiver, source and validator context',
  )
  assert.throws(() => queuedReceiptProbes[2].reader.kind(), /expired|released/)
  const transformSources = []
  const transformArenas = []
  const openTransformArena = PackedArena.open
  PackedArena.open = (...args) => {
    const arena = openTransformArena(...args)
    transformArenas.push(new WeakRef(arena))
    return arena
  }
  const cancelledTransformProbe = (keepOwner) => {
    const owner = new PackedSession({
      bytes: 8 * MiB,
      retained: 16 * MiB,
      staging: 8 * MiB,
      captures: 4,
      readers: 8,
    })
    const makeSource = (text, revision) => {
      const checked = new PackedSource(
        {
          generation: 1,
          documentId: 'transform-gc',
          revision,
          sourceHash: sourceHash(text),
          parserVersion: 'probe',
          rendererVersion: 'probe',
          options: 'probe',
        },
        text,
      )
      transformSources.push(new WeakRef(checked))
      return checked
    }
    const initial = makeSource('old', 0)
    const values = Array.from({ length: 5000 }, (_, i) => ({
      value: i,
      position: {
        start: { line: 1, column: 1, offset: i + 10 },
        end: { line: 1, column: 2, offset: i + 11 },
      },
    }))
    owner.commit(
      owner.prepareFull(owner.beginPrepared(initial), initial.identity, packValue(values, 8 * MiB)),
    )
    const capture = owner.capture()
    const next = makeSource('new', 1)
    const work = owner.prepareDeltaSteps(owner.beginPrepared(next), {
      base: initial.identity,
      baseSource: initial.text,
      result: next.identity,
      payload: packValue(null, 8 * MiB),
      operations: [{ kind: 'offset', path: [], start: 0, offset: 1 }],
    })
    let steps = 0
    while (owner.stats.preparingStagingBytes < 50000) {
      assert.equal(work.next().done, false)
      assert.ok(++steps < 1000)
    }
    assert.equal(owner.stats.preparingPhase, 'revision')
    assert.ok(summaryBuilders.length > 0)
    owner.dispose()
    assert.equal(owner.stats.retainedBytes, 0)
    assert.equal(work.next().done, true)
    return { kept: keepOwner ? owner : undefined, owner: new WeakRef(owner), work, capture }
  }
  const transformProbes = [cancelledTransformProbe(true), cancelledTransformProbe(false)]
  PackedArena.open = openTransformArena
  let cancelledTransformsCollected = false
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setImmediate(resolve))
    global.gc()
    global.gc()
    if (
      transformArenas.every((ref) => !ref.deref()) &&
      transformSources.every((ref) => !ref.deref()) &&
      summaryBuilders.every((ref) => !ref.deref()) &&
      !transformProbes[1].owner.deref()
    ) {
      cancelledTransformsCollected = true
      break
    }
  }
  assert.ok(
    cancelledTransformsCollected,
    'Closed suspended transforms must release summary builders, arenas, source and owner despite escaped handles/captures',
  )
  assert.equal(transformProbes[0].kept.stats.retainedBytes, 0)
  assert.throws(() => transformProbes[1].capture.reader.kind(), /released/)
  const textStreamArenas = []
  const openTextArena = PackedArena.open
  PackedArena.open = (...args) => {
    const arena = openTextArena(...args)
    textStreamArenas.push(new WeakRef(arena))
    return arena
  }
  const textStreamProbe = (started, keepOwner) => {
    const owner = new PackedSession({
      bytes: 8 * MiB,
      retained: 16 * MiB,
      staging: 8 * MiB,
      captures: 4,
      readers: 64,
    })
    const identity = {
      generation: 1,
      documentId: 'text-stream-gc',
      revision: 0,
      sourceHash: sourceHash('source'),
      parserVersion: 'probe',
      rendererVersion: 'probe',
      options: 'probe',
    }
    owner.commit(
      owner.prepareFull(
        owner.begin(identity, 'source'),
        identity,
        packValue({ html: 'text 😀'.repeat(20000) }, 8 * MiB),
      ),
    )
    const capture = owner.capture()
    const source = new WeakRef(capture.sourceResource)
    const stream = capture.reader.textSteps(['html'], { retained: 16384, staging: 512 * 1024 })
    assert.equal(owner.stats.readerStagingBytes, capture.reader.textStepCost(['html']).workspace)
    let emitted
    if (started) emitted = stream.next().value
    owner.dispose()
    assert.equal(owner.stats.retainedBytes, 0)
    assert.equal(owner.stats.readerStagingBytes, 0)
    assert.equal(stream.next().done, true)
    return {
      stream,
      capture,
      emitted,
      source,
      owner: new WeakRef(owner),
      keptOwner: keepOwner ? owner : undefined,
    }
  }
  const textStreamProbes = [
    textStreamProbe(false, false),
    textStreamProbe(true, false),
    textStreamProbe(true, true),
  ]
  PackedArena.open = openTextArena
  let textStreamsCollected = false
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setImmediate(resolve))
    global.gc()
    global.gc()
    if (
      textStreamArenas.every((arena) => arena.deref() === undefined) &&
      textStreamProbes.every(
        (probe) =>
          probe.source.deref() === undefined &&
          (probe.keptOwner || probe.owner.deref() === undefined),
      )
    ) {
      textStreamsCollected = true
      break
    }
  }
  assert.ok(
    textStreamsCollected,
    'Closed text stream/capture/output handles must not retain arenas, sources or their disposed session',
  )
  assert.equal(typeof textStreamProbes[1].emitted, 'string')
  const makeOwnershipProbe = (keepOriginal = true) => {
    const source = 'Ordinary writing.'
    const document = parseMarkdown(source)
    const probeOptions = { rawHtml: false, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
    const rendered = renderProjectionLayout(document.root, probeOptions, 8 * MiB)
    const identity = {
      generation: 1,
      documentId: 'ownership-probe',
      revision: 0,
      sourceHash: sourceHash(source),
      parserVersion: document.parserVersion,
      rendererVersion: rendered.projection.rendererVersion,
      options: JSON.stringify(probeOptions),
    }
    const owner = new PackedSession({
      bytes: 8 * MiB,
      retained: 16 * MiB,
      staging: 8 * MiB,
      captures: 4,
      readers: 64,
    })
    owner.commit(
      owner.prepareFull(
        owner.begin(identity, source),
        identity,
        packValue({ document, projection: rendered.projection, layout: rendered.layout }, 8 * MiB),
      ),
    )
    const capture = owner.capture()
    const index = SemanticDependencies.build(capture, source, ['document', 'root'], {
      retained: 8 * MiB,
      staging: 8 * MiB,
      nodes: 800000,
      depth: 64,
    })
    const next = 'Ordinary edits.'
    const result = new PackedSource(
      { ...identity, revision: 1, sourceHash: sourceHash(next) },
      next,
    )
    const patch = reparseMarkdownFragment(
      {
        capture,
        dependencies: index,
        baseSource: source,
        source: result,
        change: { from: 9, to: 16, insert: 'edits' },
        root: ['document', 'root'],
        syntax: 'manuslip',
      },
      { bytes: 64 * 1024, retained: 8 * MiB, staging: 8 * MiB, nodes: 8192, depth: 64 },
    )
    assert.equal(patch.kind, 'fragment')
    const updated = index.advance(patch, indexLimits)
    const metadata = describeDocumentFragment(
      { capture, dependencies: index, fragment: patch, document: ['document'], parseMs: 1 },
      indexLimits,
    )
    const projection = projectMarkdownFragment(
      {
        capture,
        dependencies: index,
        fragment: patch,
        root: ['document', 'root'],
        projection: ['projection'],
        layout: ['layout'],
        options: probeOptions,
      },
      indexLimits,
    )
    const holds = [
      owner.retain(index),
      owner.retain(patch),
      owner.retain(updated),
      owner.retain(metadata),
      owner.retain(projection),
    ]
    capture.release()
    return {
      owner: new WeakRef(owner),
      index: new WeakRef(index),
      holds,
      patch: keepOriginal ? patch : undefined,
      source: keepOriginal ? index.sourceResource : undefined,
      oldSource: new WeakRef(index.sourceResource),
      updated,
      metadata,
      projection,
    }
  }
  const ownershipProbe = makeOwnershipProbe()
  await new Promise((resolve) => setImmediate(resolve))
  global.gc()
  global.gc()
  assert.notEqual(
    ownershipProbe.owner.deref(),
    undefined,
    'Active accounting holds must pin their owner',
  )
  for (const hold of ownershipProbe.holds) hold.release()
  let releasedOwnershipCollected = false
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setImmediate(resolve))
    global.gc()
    global.gc()
    if (ownershipProbe.owner.deref() === undefined && ownershipProbe.index.deref() === undefined) {
      releasedOwnershipCollected = true
      break
    }
  }
  assert.ok(
    releasedOwnershipCollected,
    'Released accounting handles/fragment/source must not retain the owner or old index',
  )
  const updatedOwnershipProbe = makeOwnershipProbe(false)
  for (const hold of updatedOwnershipProbe.holds) hold.release()
  let oldIndexAndSourceCollected = false
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setImmediate(resolve))
    global.gc()
    global.gc()
    if (
      updatedOwnershipProbe.owner.deref() === undefined &&
      updatedOwnershipProbe.index.deref() === undefined &&
      updatedOwnershipProbe.oldSource.deref() === undefined
    ) {
      oldIndexAndSourceCollected = true
      break
    }
  }
  assert.ok(
    oldIndexAndSourceCollected,
    'A live updated index must not retain the old index, source wrapper or owner',
  )
  assert.equal(updatedOwnershipProbe.updated.sourceResource.text, 'Ordinary edits.')
  assert.equal(updatedOwnershipProbe.updated.blocks.at(0).to, 'Ordinary edits.'.length)
  assert.equal(updatedOwnershipProbe.metadata.counts.words, 2)
  const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const source = `# nested-containers\n\n${chunk.repeat(Math.ceil(MiB / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
  const sha256 = createHash('sha256').update(source).digest('hex')
  assert.equal(sha256, '93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3')
  const options = { rawHtml: false, footnotesLabel: 'Footnotes', footnoteBackLabel: 'Back' }
  const oracleStarted = performance.now()
  const document = parseMarkdown(source)
  const { projection, layout } = renderProjectionLayout(document.root, options, 8 * MiB)
  const initialSnapshot = { document, projection, layout }
  const initialOracleMs = performance.now() - oracleStarted
  const identity = {
    generation: 1,
    documentId: 'fragment-diagnostic',
    revision: 0,
    sourceHash: sourceHash(source),
    parserVersion: document.parserVersion,
    rendererVersion: projection.rendererVersion,
    options: JSON.stringify(options),
  }
  let owner = new PackedSession({
    bytes: 8 * MiB,
    retained: 16 * MiB,
    staging: 8 * MiB,
    captures: 4,
    readers: 64,
  })
  const request = owner.begin(identity, source)
  owner.commit(owner.prepareFull(request, identity, packValue(initialSnapshot, 8 * MiB)))
  const capture = owner.capture()
  const dependencies = SemanticDependencies.build(capture, source, ['document', 'root'], {
    retained: 8 * MiB,
    staging: 8 * MiB,
    nodes: 800000,
    depth: 64,
  })
  const limits = { bytes: 64 * 1024, retained: 8 * MiB, staging: 8 * MiB, nodes: 8192, depth: 64 }
  const compare = (reader, path, expected, offset) => {
    const kind = reader.kind(path)
    if (kind === 'scalar')
      assert.equal(reader.scalar(path, { retained: 8 * MiB, staging: 8 * MiB }), expected)
    else if (kind === 'position') {
      const actual = reader.position(path, { retained: 512, staging: 0 })
      assert.deepEqual(
        {
          start: { ...actual.start, offset: actual.start.offset + offset },
          end: { ...actual.end, offset: actual.end.offset + offset },
        },
        expected,
      )
    } else if (kind === 'array') {
      assert.equal(reader.length(path), expected.length)
      let index = 0
      for (const child of reader.elements(path)) compare(child, [], expected[index++], offset)
    } else {
      const keys = reader.keys(path, { retained: 8192, staging: 0 })
      assert.deepEqual(keys, Object.keys(expected))
      for (const key of keys) compare(reader, [...path, key], expected[key], offset)
    }
  }
  // Independent development oracle. Yield between fields/elements and bounded long-text
  // chunks. Binary preparation and scheduler overhead still need explicit measurement.
  const compareSteps = function* (reader, path, expected) {
    const kind = reader.kind(path)
    if (kind === 'scalar') {
      if (typeof expected === 'string' && expected.length > 4096) {
        assert.equal(reader.textLength(path), expected.length)
        let offset = 0
        for (const chunk of reader.textSteps(path, { retained: 16384, staging: 512 * 1024 })) {
          if (chunk !== undefined) {
            assert.ok(chunk.length <= 4098)
            assert.equal(chunk, expected.slice(offset, offset + chunk.length))
            offset += chunk.length
          }
          yield
        }
        assert.equal(offset, expected.length)
      } else assert.equal(reader.scalar(path, { retained: 8 * MiB, staging: 8 * MiB }), expected)
    } else if (kind === 'position')
      assert.deepEqual(reader.position(path, { retained: 512, staging: 0 }), expected)
    else if (kind === 'array') {
      assert.equal(reader.length(path), expected.length)
      let index = 0
      for (const child of reader.elementSteps(path)) {
        if (child === undefined) yield
        else yield* compareSteps(child, [], expected[index++])
      }
    } else {
      const keys = reader.keys(path, { retained: 8192, staging: 0 })
      assert.deepEqual(keys, Object.keys(expected))
      for (const key of keys) yield* compareSteps(reader, [...path, key], expected[key])
    }
    yield
  }
  const finishReceipt = async (work, previousIdentity) => {
    const stats = {
      slices: 0,
      steps: 0,
      maxSliceMs: 0,
      maxStepMs: 0,
      maxStepIndex: 0,
      preparationStepMs: 0,
      preparationActiveMs: 0,
      preparationSteps: 0,
      maxIndexStepMs: 0,
      maxRevisionStepMs: 0,
      revisionSteps: 0,
      finalPreparationStepMs: 0,
      indexStagingPeakBytes: 0,
      revisionStagingPeakBytes: 0,
      maxValidationStepMs: 0,
      maxDescriptionStepMs: 0,
      descriptionActiveMs: 0,
      descriptionSteps: 0,
      descriptionStagingPeakBytes: 0,
      maxOracleStepMs: 0,
      activeMs: 0,
    }
    const wallStarted = performance.now()
    let validating = false
    let preparingPhase = 'index'
    while (true) {
      const started = performance.now()
      let result
      do {
        const stepStarted = performance.now()
        const validationPhase = receiverValidationPhase
        result = work.next()
        const stepMs = performance.now() - stepStarted
        const sample = receiver.stats
        receiverPeak = Math.max(receiverPeak, sample.retainedBytes)
        assert.ok(sample.retainedBytes <= 16 * MiB)
        if (stepMs > stats.maxStepMs) {
          stats.maxStepMs = stepMs
          stats.maxStepIndex = stats.steps
        }
        if (!validating) {
          stats.preparationStepMs = Math.max(stats.preparationStepMs, stepMs)
          stats.preparationActiveMs += stepMs
          stats.preparationSteps++
          const revisionStep =
            preparingPhase === 'revision' ||
            sample.preparingPhase === 'revision' ||
            sample.prepared !== null
          if (revisionStep) {
            stats.maxRevisionStepMs = Math.max(stats.maxRevisionStepMs, stepMs)
            stats.revisionSteps++
            stats.revisionStagingPeakBytes = Math.max(
              stats.revisionStagingPeakBytes,
              sample.preparingStagingBytes,
            )
          } else {
            stats.maxIndexStepMs = Math.max(stats.maxIndexStepMs, stepMs)
            stats.indexStagingPeakBytes = Math.max(
              stats.indexStagingPeakBytes,
              sample.preparingStagingBytes,
            )
          }
          preparingPhase = sample.preparingPhase ?? preparingPhase
          receiverPeak = Math.max(receiverPeak, sample.retainedBytes)
          assert.ok(sample.retainedBytes <= 16 * MiB)
          if (sample.prepared) {
            validating = true
            stats.finalPreparationStepMs = stepMs
          }
        } else {
          stats.maxValidationStepMs = Math.max(stats.maxValidationStepMs, stepMs)
          if (validationPhase === 'descriptions' || receiverValidationPhase === 'descriptions') {
            stats.maxDescriptionStepMs = Math.max(stats.maxDescriptionStepMs, stepMs)
            stats.descriptionActiveMs += stepMs
            stats.descriptionSteps++
            stats.descriptionStagingPeakBytes = Math.max(
              stats.descriptionStagingPeakBytes,
              sample.readerStagingBytes,
            )
          } else stats.maxOracleStepMs = Math.max(stats.maxOracleStepMs, stepMs)
        }
        stats.steps++
        if (result.done) break
      } while (performance.now() - started < 1)
      const elapsed = performance.now() - started
      stats.slices++
      stats.activeMs += elapsed
      stats.maxSliceMs = Math.max(stats.maxSliceMs, elapsed)
      if (result.done) {
        assert.ok(result.value)
        return {
          received: result.value,
          stats: { ...stats, wallMs: performance.now() - wallStarted },
        }
      }
      assert.deepEqual(receiver.stats.current, previousIdentity)
      assert.ok(receiver.stats.retainedBytes <= 16 * MiB)
      receiverPeak = Math.max(receiverPeak, receiver.stats.retainedBytes)
      await new Promise((resolve) => setImmediate(resolve))
    }
  }
  const compareIndex = (actual, expected) => {
    assert.deepEqual([...actual.blocks], [...expected.blocks])
    assert.deepEqual([...actual.definitions], [...expected.definitions])
    assert.deepEqual([...actual.references], [...expected.references])
    assert.deepEqual(actual.calls, expected.calls)
    assert.deepEqual(actual.footnoteOrder, expected.footnoteOrder)
    assert.equal(actual.nodes, expected.nodes)
    for (const definition of expected.definitions)
      assert.deepEqual(
        actual.resolve(definition.kind, definition.key),
        expected.resolve(definition.kind, definition.key),
      )
  }
  const preparePatch = (target, patch, index, capture, parseMs, wireRequest) => {
    const metadataStarted = performance.now()
    const metadata = describeDocumentFragment(
      { capture, dependencies: index, fragment: patch, document: ['document'], parseMs },
      indexLimits,
    )
    const metadataMs = performance.now() - metadataStarted
    const metadataHold = target.retain(metadata)
    const projectionStarted = performance.now()
    const projectionPatch = projectMarkdownFragment(
      {
        capture,
        dependencies: index,
        fragment: patch,
        root: ['document', 'root'],
        projection: ['projection'],
        layout: ['layout'],
        options,
      },
      indexLimits,
    )
    const projectionMs = performance.now() - projectionStarted
    const projectionHold = target.retain(projectionPatch)
    const payload = packValue(
      {
        children: patch.children,
        position: patch.position,
        blocks: metadata.blocks.values,
        outline: metadata.outline.values,
        counts: metadata.counts,
        sourceHash: patch.source.identity.sourceHash,
        parserVersion: patch.source.identity.parserVersion,
        timings: metadata.timings,
        ...projectionPatch.fields,
      },
      8 * MiB,
    )
    const records = PackedArena.open(payload.slice(0), {
      bytes: 8 * MiB,
      retained: 16 * MiB,
      staging: 8 * MiB,
    })
    const operations = [
      ...documentFragmentOperations(patch, metadata, records, ['document']),
      ...projectionFragmentOperations(patch, projectionPatch, records),
    ]
    const bytes = payload.byteLength
    const requestToken = wireRequest?.requestToken ?? newPackedToken()
    const wire = readPackedWire(
      {
        protocol: packedWireVersion,
        kind: 'delta',
        sequence: patch.source.identity.revision,
        base: patch.base,
        baseToken: wireRequest?.base?.token ?? newPackedToken(),
        requestToken,
        resultToken: newPackedToken(),
        result: patch.source.identity,
        sentAt: 0,
        payload: payload.slice(0),
        operations,
        metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
      },
      { sequence: patch.source.identity.revision, result: patch.source.identity, requestToken },
    )
    const operationWeight =
      1024 +
      operations.reduce(
        (sum, operation) =>
          sum +
          384 +
          operation.path.reduce((pathBytes, part) => pathBytes + 64 + String(part).length * 2, 0),
        0,
      )
    const outgoingReserve =
      wire.bytes + wire.retainedBytes + operationWeight + (wireRequest ? 8192 : 0)
    const request = target.beginPrepared(patch.source)
    const started = performance.now()
    const prepared = target.prepareDelta(
      request,
      {
        base: patch.base,
        baseSource: patch.baseSource,
        result: patch.source.identity,
        payload,
        operations,
      },
      outgoingReserve,
    )
    return {
      prepared,
      preparationMs: performance.now() - started,
      preparationStagingBytes: target.stats.preparedStagingBytes,
      bytes,
      outgoingReserve,
      metadata,
      metadataHold,
      metadataMs,
      projectionPatch,
      projectionMs,
      projectionHold,
      wire: wire.message,
      wireBytes: wire.bytes,
      wireStagingBytes: wire.stagingBytes,
    }
  }
  const scenarios = [
    {
      name: 'nested word grows',
      from: source.indexOf('writing'),
      to: source.indexOf('writing') + 7,
      insert: 'longer edited prose',
    },
    {
      name: 'EOF typing after final definition',
      from: source.length,
      to: source.length,
      insert: 'abcdefghijklmnopqrst',
    },
  ]
  const samples = []
  const held = []
  for (const change of scenarios) {
    const after = source.slice(0, change.from) + change.insert + source.slice(change.to)
    const validationStarted = performance.now()
    const checked = new PackedSource(
      { ...identity, revision: 1, sourceHash: sourceHash(after) },
      after,
    )
    const sourceValidationMs = performance.now() - validationStarted
    const started = performance.now()
    const patch = reparseMarkdownFragment(
      {
        capture,
        dependencies,
        baseSource: source,
        source: checked,
        change,
        root: ['document', 'root'],
        syntax: 'manuslip',
      },
      limits,
    )
    const fragmentMs = performance.now() - started
    assert.equal(patch.kind, 'fragment', patch.kind === 'full' ? patch.reason : undefined)
    const oracleStarted = performance.now()
    const expectedDocument = parseMarkdown(after)
    const expected = expectedDocument.root
    const freshParseMs = performance.now() - oracleStarted
    assert.deepEqual(patch.position, expected.position)
    assert.equal(
      expected.children.length,
      document.root.children.length - patch.remove + patch.children.length,
    )
    for (let index = 0; index < patch.start; index++)
      compare(capture.reader, ['document', 'root', 'children', index], expected.children[index], 0)
    assert.deepEqual(
      patch.children,
      expected.children.slice(patch.start, patch.start + patch.children.length),
    )
    for (let index = patch.start + patch.remove; index < document.root.children.length; index++)
      compare(
        capture.reader,
        ['document', 'root', 'children', index],
        expected.children[index - patch.remove + patch.children.length],
        patch.suffixOffset,
      )
    assert.equal(owner.stats.readers, 0)
    // Publish parser document, HTML/renders and layout in the same ordered transaction.
    const shiftedOwner = new PackedSession({
      bytes: 8 * MiB,
      retained: 16 * MiB,
      staging: 8 * MiB,
      captures: 4,
      readers: 64,
    })
    shiftedOwner.commit(
      shiftedOwner.prepareFull(
        shiftedOwner.beginPrepared(capture.sourceResource),
        identity,
        packValue(initialSnapshot, 8 * MiB),
      ),
    )
    const old = shiftedOwner.capture()
    const indexHold = shiftedOwner.retain(dependencies)
    const patchHold = shiftedOwner.retain(patch)
    const derivedBeforeRequest = shiftedOwner.stats.retainedBytes
    const rootPath = ['document', 'root']
    const {
      prepared,
      preparationMs: packedPreparationMs,
      preparationStagingBytes,
      bytes: deltaBytes,
      outgoingReserve,
      metadata,
      metadataHold,
      metadataMs,
      projectionPatch,
      projectionMs,
      projectionHold,
    } = preparePatch(shiftedOwner, patch, dependencies, old, fragmentMs)
    const packedPreparationWeight = shiftedOwner.stats.retainedBytes
    assert.ok(packedPreparationWeight <= 16 * MiB)
    assert.equal(shiftedOwner.stats.holds, 4)
    const inspection = shiftedOwner.capturePrepared(prepared)
    compare(inspection.reader, rootPath, expected, 0)
    compare(inspection.reader, ['document'], { ...expectedDocument, timings: metadata.timings }, 0)
    const expectedRendered = renderProjectionLayout(expectedDocument.root, options, 8 * MiB)
    const expectedProjection = {
      ...expectedRendered.projection,
      renderMs: projectionPatch.renderMs,
    }
    compare(inspection.reader, ['projection'], expectedProjection, 0)
    compare(inspection.reader, ['layout'], expectedRendered.layout, 0)
    const indexStarted = performance.now()
    const updatedIndex = dependencies.advance(patch, indexLimits)
    const indexUpdateMs = performance.now() - indexStarted
    const updatedIndexHold = shiftedOwner.retain(updatedIndex)
    const withUpdatedIndex = shiftedOwner.stats.retainedBytes
    assert.ok(withUpdatedIndex <= 16 * MiB)
    compareIndex(updatedIndex, SemanticDependencies.build(inspection, after, rootPath, indexLimits))
    inspection.release()
    const commitStarted = performance.now()
    shiftedOwner.commit(prepared)
    const packedCommitMs = performance.now() - commitStarted
    const current = shiftedOwner.capture()
    compare(current.reader, rootPath, expected, 0)
    compare(current.reader, ['document'], { ...expectedDocument, timings: metadata.timings }, 0)
    compare(current.reader, ['projection'], expectedProjection, 0)
    compare(old.reader, [], initialSnapshot, 0)
    const packedRootRetained = shiftedOwner.stats.retainedBytes
    assert.equal(shiftedOwner.stats.holds, 5)
    indexHold.release()
    patchHold.release()
    updatedIndexHold.release()
    metadataHold.release()
    projectionHold.release()
    const packedAfterDerivedRelease = shiftedOwner.stats.retainedBytes
    shiftedOwner.dispose()
    assert.equal(shiftedOwner.stats.retainedBytes, 0)
    held.push(patch)
    samples.push({
      scenario: change.name,
      sourceValidationMs,
      fragmentMs,
      freshParseMs,
      start: patch.start,
      remove: patch.remove,
      added: patch.children.length,
      suffixOffset: patch.suffixOffset,
      inputBytesUpperBound: patch.inputBytesUpperBound,
      retainedBytes: patch.retainedBytes,
      stagingBytes: patch.stagingBytes,
      independentOwnerIndexPatchWeight:
        owner.stats.retainedBytes + dependencies.retainedBytes + patch.retainedBytes,
      equivalent: true,
      packedRoot: {
        preparationMs: packedPreparationMs,
        preparationStagingBytes,
        commitMs: packedCommitMs,
        preparationWeight: packedPreparationWeight,
        derivedBeforeRequest,
        retainedWithTwoCaptures: packedRootRetained,
        bytes: deltaBytes,
        outgoingReserve,
        afterDerivedRelease: packedAfterDerivedRelease,
        indexUpdateMs,
        withUpdatedIndex,
        updatedIndexEquivalent: true,
        completeDocumentEquivalent: true,
        completeProjectionEquivalent: true,
        projectionMs,
        projectionStagingBytes: projectionPatch.stagingBytes,
        metadataMs,
        metadataStagingBytes: metadata.stagingBytes,
        combinedAdmissionIncludesIndexAndPatch: true,
        currentAndOldEquivalent: true,
        disposed: shiftedOwner.stats,
      },
    })
  }
  const sequenceOwner = new PackedSession({
    bytes: 8 * MiB,
    retained: 16 * MiB,
    staging: 8 * MiB,
    captures: 4,
    readers: 64,
  })
  let senderRetainedPeak = 0
  const sequenceCommit = sequenceOwner.commit.bind(sequenceOwner)
  sequenceOwner.commit = (ticket) => {
    senderRetainedPeak = Math.max(senderRetainedPeak, sequenceOwner.stats.retainedBytes)
    sequenceCommit(ticket)
  }
  const publisher = new PackedPublisher(sequenceOwner)
  let receiverExpected = initialSnapshot
  let receiverPeak = 0
  let receiverOracleWallMs = 0
  let receiverDescriptionWallMs = 0
  let receiverValidationPhase = 'descriptions'
  const receiver = new PackedReceiver(
    { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 4, readers: 64 },
    function* (inspection, resultSource) {
      receiverValidationPhase = 'descriptions'
      const descriptionsStarted = performance.now()
      yield* validatePackedDescriptions(inspection, resultSource, ['document'], {
        retained: MiB,
        staging: MiB,
        nodes: 800000,
        depth: 64,
      })
      receiverDescriptionWallMs = performance.now() - descriptionsStarted
      receiverValidationPhase = 'oracle'
      const started = performance.now()
      assert.equal(resultSource.identity.sourceHash, receiverExpected.document.sourceHash)
      yield* compareSteps(inspection.reader, [], receiverExpected)
      receiverOracleWallMs = performance.now() - started
      receiverPeak = Math.max(receiverPeak, receiver.stats.retainedBytes)
      assert.ok(receiverPeak <= 16 * MiB)
    },
  )
  const receiverTicket = receiver.begin(0, new PackedSource(identity, source))
  const initialRequest = await transferWire(receiverTicket)
  const initialPayload = packValue(initialSnapshot, 8 * MiB)
  const initialEnvelope = readPackedWire(
    {
      protocol: packedWireVersion,
      kind: 'full',
      sequence: 0,
      result: identity,
      requestToken: initialRequest.requestToken,
      resultToken: newPackedToken(),
      sentAt: 0,
      payload: initialPayload.slice(0),
      metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
    },
    { sequence: 0, result: identity, requestToken: initialRequest.requestToken },
  )
  const initialPrepared = sequenceOwner.prepareFull(
    sequenceOwner.beginPrepared(capture.sourceResource),
    identity,
    initialPayload,
    initialEnvelope.bytes + initialEnvelope.retainedBytes + 8192,
  )
  const initialOffer = publisher.offer(
    initialRequest,
    capture.sourceResource,
    initialPrepared,
    initialEnvelope.message,
  )
  assert.equal(sequenceOwner.stats.current, null)
  const initialIncoming = await transferWire(initialOffer)
  const initialAdmissionStarted = performance.now()
  const initialReceiptWork = receiver.receiveSteps(receiverTicket, initialIncoming)
  const initialAdmissionMs = performance.now() - initialAdmissionStarted
  const initialReceipt = await finishReceipt(initialReceiptWork, null)
  const receiverInitial = initialReceipt.received
  assert.equal(receiverInitial.kind, 'accepted')
  assert.equal(sequenceOwner.stats.current, null)
  publisher.acknowledge(await transferWire(receiverInitial.acknowledgement))
  let sequenceCapture = sequenceOwner.capture()
  let sequenceIndex = dependencies
  let sequenceHold = sequenceOwner.retain(sequenceIndex)
  let sequenceSource = source
  let previousDocument = document
  let previousProjection = projection
  let previousLayout = layout
  const receiverOriginal = receiverInitial.capture
  const initialWire = {
    bytes: receiverInitial.bytes,
    senderRetainedPeak,
    exactAcknowledgement: true,
    envelopeBytes: receiverInitial.envelopeBytes,
    retainedPeak: receiverPeak,
    wireStagingBytes: receiverInitial.wireStagingBytes,
    preparationStagingBytes: receiverInitial.preparationStagingBytes,
    oracleWallMs: receiverOracleWallMs,
    descriptionWallMs: receiverDescriptionWallMs,
    receiptSteps: initialReceipt.stats,
    admissionMs: initialAdmissionMs,
  }
  const sequence = []
  for (let step = 0; step < 6; step++) {
    const offset =
      step % 3 === 0
        ? 0
        : step % 3 === 1
          ? Math.floor(sequenceSource.length / 2)
          : Math.floor(sequenceSource.length * 0.9)
    const from = sequenceSource.indexOf('writing', offset)
    assert.ok(from >= 0)
    const insert = step % 2 ? '文字 prose' : 'longer written words'
    const after = sequenceSource.slice(0, from) + insert + sequenceSource.slice(from + 7)
    const started = performance.now()
    const checked = new PackedSource(
      {
        ...sequenceIndex.identity,
        revision: sequenceIndex.identity.revision + 1,
        sourceHash: sourceHash(after),
      },
      after,
    )
    const validationMs = performance.now() - started
    const parseStarted = performance.now()
    const patch = reparseMarkdownFragment(
      {
        capture: sequenceCapture,
        dependencies: sequenceIndex,
        baseSource: sequenceSource,
        source: checked,
        change: { from, to: from + 7, insert },
        root: ['document', 'root'],
        syntax: 'manuslip',
      },
      limits,
    )
    const fragmentMs = performance.now() - parseStarted
    assert.equal(patch.kind, 'fragment')
    const patchHold = sequenceOwner.retain(patch)
    const receivedSource = new PackedSource(patch.source.identity, after)
    const receiveTicket = receiver.begin(patch.source.identity.revision, receivedSource)
    const wireRequest = await transferWire(receiveTicket)
    assert.equal(publisher.base(wireRequest, patch.source), sequenceCapture.sourceResource)
    const transaction = preparePatch(
      sequenceOwner,
      patch,
      sequenceIndex,
      sequenceCapture,
      fragmentMs,
      wireRequest,
    )
    const indexStarted = performance.now()
    const updated = sequenceIndex.advance(patch, indexLimits)
    const indexUpdateMs = performance.now() - indexStarted
    const updatedHold = sequenceOwner.retain(updated)
    const prepared = sequenceOwner.capturePrepared(transaction.prepared)
    let retainedPeak = sequenceOwner.stats.retainedBytes
    assert.ok(retainedPeak <= 16 * MiB)
    const expected = parseMarkdown(after)
    const expectedDocument = { ...expected, timings: transaction.metadata.timings }
    compare(prepared.reader, ['document'], expectedDocument, 0)
    const expectedRendered = renderProjectionLayout(expected.root, options, 8 * MiB)
    const expectedProjection = {
      ...expectedRendered.projection,
      renderMs: transaction.projectionPatch.renderMs,
    }
    compare(prepared.reader, ['projection'], expectedProjection, 0)
    compare(prepared.reader, ['layout'], expectedRendered.layout, 0)
    receiverExpected = {
      document: expectedDocument,
      projection: expectedProjection,
      layout: expectedRendered.layout,
    }
    receiverPeak = 0
    const receiveStarted = performance.now()
    const offered = publisher.offer(
      wireRequest,
      patch.source,
      transaction.prepared,
      transaction.wire,
    )
    retainedPeak = Math.max(retainedPeak, sequenceOwner.stats.retainedBytes)
    const incoming = await transferWire(offered)
    const admissionStarted = performance.now()
    const receiptWork = receiver.receiveSteps(receiveTicket, incoming)
    const receiverAdmissionMs = performance.now() - admissionStarted
    const receipt = await finishReceipt(receiptWork, sequenceIndex.identity)
    const received = receipt.received
    assert.equal(received.kind, 'accepted')
    const receiveWithOracleMs = performance.now() - receiveStarted
    compare(receiverOriginal.reader, [], initialSnapshot, 0)
    received.capture.release()
    assert.equal(receiver.stats.readers, 0)
    assert.equal(receiver.stats.holds, 1)
    compareIndex(
      updated,
      SemanticDependencies.build(prepared, after, ['document', 'root'], indexLimits),
    )
    prepared.release()
    assert.deepEqual(sequenceOwner.stats.current, sequenceIndex.identity)
    publisher.acknowledge(await transferWire(received.acknowledgement))
    retainedPeak = Math.max(retainedPeak, senderRetainedPeak)
    assert.ok(retainedPeak <= 16 * MiB)
    compare(sequenceCapture.reader, ['document'], previousDocument, 0)
    compare(sequenceCapture.reader, ['projection'], previousProjection, 0)
    compare(sequenceCapture.reader, ['layout'], previousLayout, 0)
    sequenceCapture.release()
    sequenceHold.release()
    patchHold.release()
    transaction.metadataHold.release()
    transaction.projectionHold.release()
    sequenceCapture = sequenceOwner.capture()
    compare(sequenceCapture.reader, ['document'], expectedDocument, 0)
    compare(sequenceCapture.reader, ['projection'], expectedProjection, 0)
    sequenceIndex = updated
    sequenceHold = updatedHold
    sequenceSource = after
    previousDocument = expectedDocument
    previousProjection = expectedProjection
    previousLayout = expectedRendered.layout
    sequence.push({
      step: step + 1,
      validationMs,
      fragmentMs,
      metadataMs: transaction.metadataMs,
      metadataStagingBytes: transaction.metadata.stagingBytes,
      projectionMs: transaction.projectionMs,
      projectionStagingBytes: transaction.projectionPatch.stagingBytes,
      preparationMs: transaction.preparationMs,
      preparationStagingBytes: transaction.preparationStagingBytes,
      indexUpdateMs,
      retainedPeak,
      afterOldRelease: sequenceOwner.stats.retainedBytes,
      bytes: transaction.bytes,
      wireBytes: transaction.wireBytes,
      senderWireStagingBytes: transaction.wireStagingBytes,
      receiverRetainedPeak: receiverPeak,
      receiverAfterRelease: receiver.stats.retainedBytes,
      receiverWithOracleMs: receiveWithOracleMs,
      receiverOracleWallMs,
      receiverDescriptionWallMs,
      receiptSteps: receipt.stats,
      receiverAdmissionMs,
      receiverPreparationStagingBytes: received.preparationStagingBytes,
      receiverWireStagingBytes: received.wireStagingBytes,
      exactAcknowledgement: true,
      receiverCompleteEquivalent: true,
      receiverOriginalEquivalent: true,
      rootAndIndexEquivalent: true,
      completeDocumentEquivalent: true,
      completeProjectionEquivalent: true,
      oldCaptureEquivalent: true,
    })
  }
  PackedArena.prototype.summarizePositions = summarizePositions
  PackedArena.prototype.summarizePositionSteps = summarizePositionSteps
  PackedSourcePoints.build = buildSourcePoints
  assert.equal(sourcePointIndexes.length, 7)
  assert.ok(
    validationSummaries.length > 0,
    'The nested diagnostic must exercise summary validation',
  )
  let validationSummariesCollected = false
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setImmediate(resolve))
    global.gc()
    global.gc()
    if (validationSummaries.every((summary) => summary.deref() === undefined)) {
      validationSummariesCollected = true
      break
    }
  }
  assert.ok(
    validationSummariesCollected,
    'Live captures/outputs must not retain temporary position summaries',
  )
  let sourcePointWorkspacesCollected = false
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setImmediate(resolve))
    global.gc()
    global.gc()
    if (
      [...sourcePointIndexes, ...sourcePointBuilders].every(
        (reference) => reference.deref() === undefined,
      )
    ) {
      sourcePointWorkspacesCollected = true
      break
    }
  }
  assert.ok(
    sourcePointWorkspacesCollected,
    'Live captures and completed work must release source-position workspaces',
  )
  const cancelledDescriptionProbe = (phase) => {
    const text = `# ${'x'.repeat(100000)}\n`
    const document = parseMarkdown(text)
    const source = new PackedSource(
      {
        generation: 1,
        documentId: `cancel-descriptions-${phase}`,
        revision: 0,
        sourceHash: sourceHash(text),
        parserVersion: document.parserVersion,
        rendererVersion: 'probe',
        options: 'probe',
      },
      text,
    )
    const builders = []
    const indexes = []
    let inspection
    watchSourcePoints(builders, indexes)
    const receiver = new PackedReceiver(
      { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 4, readers: 64 },
      function* (capture, checked) {
        inspection = capture
        yield* validatePackedDescriptions(capture, checked, ['document'], {
          retained: MiB,
          staging: MiB,
          nodes: 800000,
          depth: 64,
        })
      },
    )
    try {
      const ticket = receiver.begin(0, source)
      const work = receiver.receiveSteps(ticket, {
        protocol: packedWireVersion,
        kind: 'full',
        sequence: 0,
        result: source.identity,
        requestToken: ticket.requestToken,
        resultToken: newPackedToken(),
        sentAt: 0,
        payload: packValue({ document }, 8 * MiB),
        metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
      })
      let reached = false
      for (let step = 0; step < 10000; step++) {
        assert.equal(work.next().done, false)
        if (
          phase === 'source-index'
            ? builders.length > 0
            : receiver.stats.readerStagingBytes > 512 * 1024
        ) {
          reached = true
          break
        }
      }
      assert.ok(reached)
      assert.equal(indexes.length, phase === 'source-index' ? 0 : 1)
      assert.equal(receiver.stats.current, null)
      receiver.cancel(ticket)
      assert.equal(receiver.stats.readers, 0)
      assert.equal(receiver.stats.readerStagingBytes, 0)
      receiver.dispose()
      assert.equal(receiver.stats.retainedBytes, 0)
      assert.equal(work.next().done, true)
      assert.throws(() => inspection.reader.kind(), /released/)
      return {
        work,
        inspection,
        disposedOwner: receiver,
        references: [new WeakRef(source), ...builders, ...indexes],
      }
    } finally {
      PackedSourcePoints.build = buildSourcePoints
      receiver.dispose()
    }
  }
  const cancelledDescriptions = ['source-index', 'heading-stream'].map(cancelledDescriptionProbe)
  const standaloneDescriptionProbe = (phase) => {
    const text = `# ${'x'.repeat(100000)}\n`
    const document = parseMarkdown(text)
    const source = new PackedSource(
      {
        generation: 1,
        documentId: `standalone-descriptions-${phase}`,
        revision: 0,
        sourceHash: sourceHash(text),
        parserVersion: document.parserVersion,
        rendererVersion: 'probe',
        options: 'probe',
      },
      text,
    )
    const builders = []
    const indexes = []
    watchSourcePoints(builders, indexes)
    const owner = new PackedSession({
      bytes: 8 * MiB,
      retained: 16 * MiB,
      staging: 8 * MiB,
      captures: 4,
      readers: 64,
    })
    try {
      owner.commit(
        owner.prepareFull(
          owner.beginPrepared(source),
          source.identity,
          packValue({ document }, 8 * MiB),
        ),
      )
      const inspection = owner.capture()
      const work = validatePackedDescriptions(inspection, source, ['document'], {
        retained: MiB,
        staging: MiB,
        nodes: 800000,
        depth: 64,
      })
      if (phase !== 'unstarted') {
        let reached = false
        for (let step = 0; step < 10000; step++) {
          assert.equal(work.next().done, false)
          if (
            phase === 'source-index'
              ? builders.length > 0
              : owner.stats.readerStagingBytes > 512 * 1024
          ) {
            reached = true
            break
          }
        }
        assert.ok(reached)
      }
      assert.equal(indexes.length, phase === 'heading-stream' ? 1 : 0)
      inspection.release()
      assert.equal(owner.stats.readers, 0)
      assert.equal(owner.stats.readerStagingBytes, 0)
      owner.dispose()
      // Deliberately keep the closed handle unadvanced throughout the GC check below.
      return {
        work,
        inspection,
        disposedOwner: owner,
        references: [new WeakRef(source), ...builders, ...indexes],
      }
    } finally {
      PackedSourcePoints.build = buildSourcePoints
      owner.dispose()
    }
  }
  cancelledDescriptions.push(
    ...['unstarted', 'source-index', 'heading-stream'].map(standaloneDescriptionProbe),
  )
  let cancelledDescriptionsCollected = false
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setImmediate(resolve))
    global.gc()
    global.gc()
    if (
      cancelledDescriptions.every((probe) =>
        probe.references.every((reference) => reference.deref() === undefined),
      )
    ) {
      cancelledDescriptionsCollected = true
      break
    }
  }
  assert.ok(
    cancelledDescriptionsCollected,
    'Cancelled validators must release source/index/builders even with work, capture and disposed owner retained',
  )
  for (const probe of cancelledDescriptions) {
    assert.equal(probe.disposedOwner.stats.retainedBytes, 0)
    assert.equal(probe.work.next().done, true)
  }
  sequenceCapture.release()
  sequenceHold.release()
  publisher.dispose()
  sequenceOwner.dispose()
  assert.equal(sequenceOwner.stats.retainedBytes, 0)
  receiverOriginal.release()
  receiver.dispose()
  assert.equal(receiver.stats.retainedBytes, 0)
  capture.release()
  const independentAllHeldWeight =
    owner.stats.retainedBytes +
    dependencies.retainedBytes +
    held.reduce((sum, patch) => sum + patch.retainedBytes, 0)
  const weak = new WeakRef(owner)
  owner.dispose()
  assert.equal(owner.stats.retainedBytes, 0)
  const disposed = owner.stats
  owner = null
  await new Promise((resolve) => setImmediate(resolve))
  global.gc()
  global.gc()
  assert.equal(
    weak.deref(),
    undefined,
    'Independent patches and context must not retain their disposed owner',
  )
  for (const patch of held) assert.ok(patch.children.length)
  const output = {
    method:
      'Development Node/Vite diagnostic. Two local reparses and a six-edit sequence on the exact nested corpus atomically prepare/inspect/commit complete parser documents, HTML, rendered blocks and projection layouts. A separate receiver accepts an initial full message and all six actual transferable delta envelopes under its own unchanged 16 MiB ledger. Fresh request/result/base tokens bind each result to its receiver request and last acknowledged base; requests and exact acknowledgements also cross real MessagePorts. The sender commits only after that acknowledgement. Each prepared receiver snapshot is validated against an independent full parse/render/layout oracle before commit; its original capture remains exact. The independent receiver oracle now yields between fields and elements through revocable receiveSteps handles. A 1 ms target scheduler defers with setImmediate and reports actual step/slice maxima, active work and wall time. Oracle wall time includes scheduling; it is not a production validator or freshness measurement. Binary indexing now yields within long strings and reference lists under charged session preparation ownership. Delta offset/range validation, late path/prefix scans and temporary DAG summary construction now yield too, with scratch and overlay ownership charged throughout suspension. The diagnostic separates index, revision and final publication steps. Metadata/native allocations remain synchronous and all measured step maxima must still be assessed. Long scalar comparison uses charged fixed-workspace streams with at most one 4096-byte lexical batch per advance, including discarded prefixes; emitted strings are at most 4098 UTF-16 units. Stream workspace is charged through its full live scope, and GC checks escaped closed stream/capture/emitted-chunk handles release arenas, sources and owners. Queued-handle disposal GC checks transferred buffers, source, receiver and callback contexts collect before first advancement, during binary indexing and during an open nested reader. Sender admission includes outgoing payload, normalized wire/request/receipt metadata, acknowledged-source ownership and operation construction reserve. Sender peak samples include the acknowledgement hold before commit. GC verifies disposed publisher handles and escaped wire/ticket/receipt values release their source and owner. Semantic fields and updated indexes match fresh complete results; timings describe actual incremental work. Old/current/prepared captures and all managed derived outputs stay charged. Scratch has a separate bounded reserve. Temporary DAG position summaries retain expanded alias/depth limits and collect while live captures/outputs remain. Additional GC probes retain closed suspended-transform handles and revoked captures while checking summary builders, arenas, sources and disposed sessions collect. Exact word counting and layout validation still traverse unchanged data. Standalone sums overcount sharing. Production semantic validators, application/full-root consumers, bounded resync/compaction, service/watchdog ownership, calibrated construction/heap peaks and packaged performance remain gates. Development samples are not p95 or renderer-slice evidence.',
    descriptionValidationMethod:
      'Every receiver candidate first runs source-bound mdast schemas, sparse exact line/column checks, metadata identity/schema checks, exact block descriptors and streamed outline plaintext checks. Unicode character counts are exact; word counts are only type/bounds checked by this layer. Source hashing and index construction yield per 4096 UTF-16 units. Index/frame reserves and concurrent text streams share the unchanged receiver ledger. Description and independent-oracle steps are reported separately; the independent full oracle remains mandatory in this diagnostic. GC checks all seven temporary source indexes and builders collect while captures and completed receipt handles remain live. These checks do not certify parser equivalence, exact words or projection HTML and are not the complete production semantic validator.',
    date: new Date().toISOString(),
    runtime: process.versions,
    sourceBytes: Buffer.byteLength(source),
    sourceSha256: sha256,
    initialOracleMs,
    initialWire,
    samples,
    sequence,
    sequenceDisposed: sequenceOwner.stats,
    receiverDisposed: receiver.stats,
    independentAllHeldWeight,
    withinCacheLimit: independentAllHeldWeight <= 16 * MiB,
    sharedResourceAdmissionWithinCacheLimit:
      samples.every((sample) => sample.packedRoot.withUpdatedIndex <= 16 * MiB) &&
      sequence.every((sample) => sample.retainedPeak <= 16 * MiB),
    releasedOwnershipCollected,
    oldIndexAndSourceCollected,
    disposed,
    ownerCollectedWhileOutputsAlive: true,
    validationSummaryCount: validationSummaries.length,
    validationSummariesCollected,
    sourcePointWorkspacesCollected,
    sourcePointIndexCount: sourcePointIndexes.length,
    cancelledDescriptionsCollected,
    disposedReceiverCollected,
    disposedPublisherCollected,
    queuedReceiptCollected,
    cancelledTransformsCollected,
    textStreamsCollected,
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/markdown-fragment-profile.json',
    `${JSON.stringify(output, null, 2)}\n`,
  )
  console.log(JSON.stringify(output, null, 2))
} finally {
  await server.close()
}
