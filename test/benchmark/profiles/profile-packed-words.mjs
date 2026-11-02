import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error('Run with node --expose-gc test/benchmark/profiles/profile-packed-words.mjs')
const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 64 * MiB, staging: 8 * MiB, captures: 8, readers: 160 }
const validation = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
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
  const { packValue } = await server.ssrLoadModule('/packages/core/src/packing.ts')
  const { PackedArena } = await server.ssrLoadModule('/packages/core/src/packing-arena.ts')
  const { PackedSession } = await server.ssrLoadModule('/packages/core/src/packing-session.ts')
  const { PackedReceiver } = await server.ssrLoadModule('/packages/core/src/packing-receiver.ts')
  const { PackedSource } = await server.ssrLoadModule('/packages/core/src/packing-source.ts')
  const { PackedWordBuffer } = await server.ssrLoadModule(
    '/packages/core/src/packing-word-buffer.ts',
  )
  const { validatePackedWords } = await server.ssrLoadModule(
    '/packages/core/src/packing-validate-words.ts',
  )
  const { validatePackedDocument } = await server.ssrLoadModule(
    '/packages/core/src/packing-validate-document.ts',
  )
  const { sourceHash } = await server.ssrLoadModule('/packages/core/src/contracts.ts')
  const { newPackedToken } = await server.ssrLoadModule('/packages/core/src/packing-token.ts')
  const { packedWireVersion } = await server.ssrLoadModule('/packages/core/src/packing-wire.ts')
  const checkedSource = (text, document, revision = 0) =>
    new PackedSource(
      {
        generation: 1,
        documentId: 'word-diagnostic',
        revision,
        sourceHash: sourceHash(text),
        parserVersion: document.parserVersion,
        rendererVersion: 'diagnostic',
        options: 'diagnostic',
      },
      text,
    )

  const originalOpen = PackedArena.open
  const originalCreate = PackedWordBuffer.create
  const originalAppend = PackedWordBuffer.prototype.append
  const originalFinish = PackedWordBuffer.prototype.finish
  const originalSegment = Intl.Segmenter.prototype.segment
  const probe = (target, keepOwner, observed = true, action = 'release') => {
    const arenas = []
    const buffers = []
    const segments = []
    const iterators = []
    let appendedUnits = 0
    let phase
    PackedArena.open = function (...args) {
      const arena = originalOpen.apply(this, args)
      arenas.push(new WeakRef(arena))
      return arena
    }
    PackedWordBuffer.create = function (...args) {
      const buffer = originalCreate.apply(this, args)
      buffers.push(new WeakRef(buffer))
      return buffer
    }
    PackedWordBuffer.prototype.append = function (value) {
      originalAppend.call(this, value)
      appendedUnits += value.length
    }
    PackedWordBuffer.prototype.finish = function () {
      const prose = originalFinish.call(this)
      if (!observed) phase = 'joined'
      return prose
    }
    Intl.Segmenter.prototype.segment = function (...args) {
      const result = originalSegment.apply(this, args)
      segments.push(new WeakRef(result))
      const iterate = result[Symbol.iterator]
      result[Symbol.iterator] = function () {
        const iterator = iterate.call(this)
        iterators.push(new WeakRef(iterator))
        if (!observed) phase = 'count'
        return iterator
      }
      return result
    }
    const owner = new PackedSession(limits)
    try {
      const text = observed
        ? `${'word '.repeat(5000)}\n`
        : `**first** ${'word '.repeat(5000)}\n\nlast\n`
      const document = parseMarkdown(text)
      // Only validator allocations belong to these probes, not the independent parser.
      segments.length = 0
      iterators.length = 0
      phase = undefined
      const checked = checkedSource(text, document)
      owner.commit(
        owner.prepareFull(
          owner.beginPrepared(checked),
          checked.identity,
          packValue({ document }, limits.bytes),
        ),
      )
      const capture = owner.capture()
      const work = validatePackedWords(
        capture,
        checked,
        ['document'],
        validation,
        observed
          ? (value) => {
              phase = value
            }
          : undefined,
      )
      let steps = 0
      if (target !== 'unstarted') {
        while (true) {
          const step = work.next()
          steps++
          assert.ok(steps < 100000)
          if (target === 'completed' && step.done) break
          assert.equal(step.done, false)
          if (target === 'decoded' && (!observed || phase === 'read') && appendedUnits > 0) break
          if (target === 'grown' && appendedUnits >= 4096) break
          if (target === 'iterating' && phase === 'count') {
            assert.equal(work.next().done, false)
            steps++
            break
          }
          if (target === phase) break
        }
      }
      if (
        [
          'decoded',
          'grown',
          'joined',
          'join',
          'segment',
          'count',
          'iterating',
          'completed',
        ].includes(target)
      )
        assert.equal(buffers.length, 1)
      if (['count', 'iterating', 'completed'].includes(target)) {
        assert.equal(segments.length, 1)
        assert.equal(iterators.length, 1)
      }
      const references = [
        ...arenas,
        ...buffers,
        ...segments,
        ...iterators,
        new WeakRef(checked),
        ...(keepOwner ? [] : [new WeakRef(owner)]),
      ]
      if (action === 'return') work.return()
      else if (action === 'dispose') owner.dispose()
      else capture.release()
      assert.equal(owner.stats.readerStagingBytes, 0)
      assert.equal(owner.stats.readers, 0)
      capture.release()
      owner.dispose()
      assert.equal(owner.stats.retainedBytes, 0)
      assert.equal(owner.stats.readerStagingBytes, 0)
      assert.equal(owner.stats.readers, 0)
      return {
        work,
        capture,
        owner: keepOwner ? owner : undefined,
        references,
        report: {
          target,
          observed,
          action,
          appendedUnits,
          keepOwner,
          steps,
          arenas: arenas.length,
          buffers: buffers.length,
          segments: segments.length,
          iterators: iterators.length,
        },
      }
    } finally {
      owner.dispose()
      PackedArena.open = originalOpen
      PackedWordBuffer.create = originalCreate
      PackedWordBuffer.prototype.append = originalAppend
      PackedWordBuffer.prototype.finish = originalFinish
      Intl.Segmenter.prototype.segment = originalSegment
    }
  }
  const escaped = [
    'unstarted',
    'scan',
    'read',
    'decoded',
    'join',
    'segment',
    'count',
    'iterating',
    'completed',
  ].flatMap((phase) => [false, true].map((keepOwner) => probe(phase, keepOwner)))
  for (const phase of ['unstarted', 'decoded', 'grown', 'joined', 'iterating', 'completed'])
    for (const action of ['return', 'release', 'dispose'])
      for (const keepOwner of [false, true]) escaped.push(probe(phase, keepOwner, false, action))
  let collected = false
  for (let attempt = 0; attempt < 40; attempt++) {
    await immediate()
    global.gc()
    await immediate()
    if (escaped.every((entry) => entry.references.every((reference) => !reference.deref()))) {
      collected = true
      break
    }
  }
  assert.ok(
    collected,
    'Closed unadvanced work/captures must release arenas, prose buffers, Intl objects, sources and owners',
  )
  // Keep escaped handles alive without advancing them until after the collection assertion.
  const probes = escaped.map(({ work, capture, owner, report }) => {
    assert.equal(work.next().done, true)
    assert.throws(() => capture.reader.kind(), /released/)
    if (owner) assert.equal(owner.stats.retainedBytes, 0)
    return report
  })

  const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const text = `# nested-containers\n\n${chunk.repeat(Math.ceil(MiB / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
  const sha256 = createHash('sha256').update(text).digest('hex')
  assert.equal(sha256, '93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3')
  const oracleStart = performance.now()
  const document = parseMarkdown(text)
  const { projection, layout } = renderProjectionLayout(
    document.root,
    { rawHtml: false, footnotesLabel: 'Footnotes', footnoteBackLabel: 'Back' },
    8 * MiB,
  )
  const oracleMs = performance.now() - oracleStart
  const payload = packValue({ document, projection, layout }, limits.bytes)
  const checked = checkedSource(text, document)
  let phase = 'receipt'
  const receiver = new PackedReceiver(limits, (capture, source) => {
    phase = 'descriptions'
    return validatePackedDocument(capture, source, ['document'], validation, (value) => {
      phase = value
    })
  })
  const packet = (ticket, bytes) => ({
    protocol: packedWireVersion,
    kind: 'full',
    sequence: ticket.sequence,
    result: ticket.identity,
    requestToken: ticket.requestToken,
    resultToken: newPackedToken(),
    sentAt: performance.now(),
    payload: bytes,
    metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
  })
  const observations = []
  const drain = async (work, invalid, previous) => {
    const report = {
      steps: 0,
      activeMs: 0,
      largestStepMs: 0,
      largestBatchMs: 0,
      peakRetainedBytes: receiver.stats.retainedBytes,
      peakStagingBytes: 0,
      phases: {},
    }
    const started = performance.now()
    let batchStart = started
    let rejected = false
    while (true) {
      const before = phase
      const start = performance.now()
      let step
      try {
        step = work.next()
      } catch (error) {
        if (!invalid) throw error
        assert.match(String(error), /Invalid packed semantic document/)
        rejected = true
      }
      const elapsed = performance.now() - start
      report.steps++
      report.activeMs += elapsed
      report.largestStepMs = Math.max(report.largestStepMs, elapsed)
      report.phases[before] ??= { steps: 0, activeMs: 0, largestStepMs: 0 }
      const record = report.phases[before]
      record.steps++
      record.activeMs += elapsed
      record.largestStepMs = Math.max(record.largestStepMs, elapsed)
      const stats = receiver.stats
      report.peakRetainedBytes = Math.max(report.peakRetainedBytes, stats.retainedBytes)
      report.peakStagingBytes = Math.max(
        report.peakStagingBytes,
        stats.readerStagingBytes + stats.preparingStagingBytes,
      )
      assert.ok(stats.retainedBytes <= limits.retained)
      assert.ok(stats.readerStagingBytes + stats.preparingStagingBytes <= limits.staging)
      report.largestBatchMs = Math.max(report.largestBatchMs, performance.now() - batchStart)
      if (rejected || step.done) {
        report.wallMs = performance.now() - started
        report.rejected = rejected
        observations.push(report)
        assert.equal(rejected, invalid)
        if (rejected) {
          assert.deepEqual(stats.current, previous)
          assert.equal(work.next().done, true)
          return undefined
        }
        return step.value
      }
      assert.equal(step.value, undefined)
      assert.deepEqual(stats.current, previous)
      if (performance.now() - batchStart >= 1) {
        await immediate()
        batchStart = performance.now()
      }
    }
  }
  let accepted
  try {
    const ticket = receiver.begin(1, checked)
    const message = packet(ticket, payload.slice(0))
    const work = receiver.receiveSteps(ticket, message)
    assert.equal(message.payload.byteLength, 0)
    accepted = await drain(work, false, null)
    assert.equal(accepted.kind, 'accepted')
    assert.equal(accepted.acknowledgement.resultToken, message.resultToken)
    const actualWords = accepted.capture.reader.scalar(['document', 'counts', 'words'], validation)
    const independent = parseMarkdown(text)
    assert.equal(actualWords, independent.counts.words)
    assert.equal(actualWords, document.counts.words)
    document.counts.words--
    const wrong = packValue({ document, projection, layout }, limits.bytes)
    document.counts.words++
    phase = 'receipt'
    const retrySource = checkedSource(text, document, 1)
    const retry = receiver.begin(2, retrySource)
    await drain(receiver.receiveSteps(retry, packet(retry, wrong)), true, checked.identity)
    assert.equal(phase, 'count')
    assert.equal(receiver.stats.prepared, null)
    assert.equal(receiver.stats.requested, null)
    assert.equal(receiver.stats.readers, 0)
    assert.equal(receiver.stats.readerStagingBytes, 0)
    assert.equal(
      accepted.capture.reader.scalar(['document', 'counts', 'words'], validation),
      actualWords,
    )
  } finally {
    accepted?.capture.release()
    receiver.dispose()
  }
  assert.equal(receiver.stats.retainedBytes, 0)
  const result = {
    method:
      'Development Node/Vite diagnostic, not a packaged performance or calibrated heap gate. Exact parser preorder text leaves are joined with ASCII spaces and passed once as a complete string to runtime-default Intl.Segmenter. Full nested snapshot contains document, projection and layout; only the document receives production-schema checks in this diagnostic. The renderer ledger is explicitly 64 MiB with 8 MiB staging; the existing separate 16 MiB nested diagnostic is unchanged. One full receipt succeeds and an incorrect in-range word total fails at the final exact comparison with the original capture retained, no publication and no acknowledgement. A 1 ms target scheduler reports actual steps and batches; native final join, Segmenter creation/segment and individual iterator.next calls are synchronous and have no universal time bound. Fifty-four GC probes retain closed work and revoked captures unadvanced, including partially decoded/grown prose, whole joined prose, native segments/iterator and completed work, with and without a retained disposed owner. Eighteen cover explicit phase observers; thirty-six cover normal single-pass collection with explicit return, capture release or session disposal. Memory values are conservative ledger weights, not observed heap calibration. Projection equivalence, incremental proof reuse, runtime integration and all packaged release gates remain separate.',
    date: new Date().toISOString(),
    runtime: process.versions,
    sourceBytes: Buffer.byteLength(text),
    sha256,
    payloadBytes: payload.byteLength,
    expectedWords: document.counts.words,
    oracleMs,
    limits,
    validation,
    collected,
    probes,
    observations,
    disposed: receiver.stats,
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/packed-word-profile.json',
    `${JSON.stringify(result, null, 2)}\n`,
  )
  console.log(JSON.stringify(result, null, 2))
} finally {
  await server.close()
}
