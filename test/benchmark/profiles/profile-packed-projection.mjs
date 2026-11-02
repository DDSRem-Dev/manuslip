import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error('Run with node --expose-gc test/benchmark/profiles/profile-packed-projection.mjs')
const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 64 * MiB, staging: 8 * MiB, captures: 8, readers: 160 }
const validation = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const options = { rawHtml: false, footnotesLabel: 'Footnotes', footnoteBackLabel: 'Back' }
const paths = { root: ['document', 'root'], projection: ['projection'], layout: ['layout'] }
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
})
try {
  const load = (file) => server.ssrLoadModule(`/packages/${file}.ts`)
  const { parseMarkdown } = await load('core/src/parse')
  const { renderProjectionLayout } = await load('renderer/src/projection-layout')
  const { rendererVersion } = await load('renderer/src/index')
  const { PackedHtmlCursor } = await load('renderer/src/packed-html-cursor')
  const { validatePackedProjection } = await load('renderer/src/packing-validate-projection')
  const { validatePackedSnapshot } = await load('renderer/src/packing-validate-snapshot')
  const { PackedArena } = await load('core/src/packing-arena')
  const { PackedSession } = await load('core/src/packing-session')
  const { PackedReceiver } = await load('core/src/packing-receiver')
  const { PackedReadScope, PackedTextSteps } = await load('core/src/packing-capture')
  const { PackedSource } = await load('core/src/packing-source')
  const { packValue } = await load('core/src/packing')
  const { sourceHash } = await load('core/src/contracts')
  const { packedWireVersion } = await load('core/src/packing-wire')
  const { newPackedToken } = await load('core/src/packing-token')
  const snapshot = (text) => {
    const document = parseMarkdown(text)
    const { projection, layout } = renderProjectionLayout(document.root, options, 8 * MiB)
    return { document, projection, layout }
  }
  const source = (text, value, revision = 0) =>
    new PackedSource(
      {
        generation: 1,
        documentId: 'projection-diagnostic',
        revision,
        sourceHash: sourceHash(text),
        parserVersion: value.document.parserVersion,
        rendererVersion,
        options: JSON.stringify(options),
      },
      text,
    )
  const probe = (target, keepOwner) => {
    const text = `~~~plain\n${'a界😀'.repeat(5000)}\n~~~\n`
    const value = snapshot(text)
    const checked = source(text, value)
    const owner = new PackedSession(limits)
    const payload = packValue(value, limits.bytes)
    const references = [new WeakRef(checked), ...(keepOwner ? [] : [new WeakRef(owner)])]
    const originalOpen = PackedArena.open
    PackedArena.open = function (...args) {
      const arena = originalOpen.apply(this, args)
      references.push(new WeakRef(arena))
      return arena
    }
    const readText = PackedReadScope.prototype.textSteps
    const nextText = PackedTextSteps.prototype.next
    const skipHtml = PackedHtmlCursor.prototype.skip
    const NativeUnits = global.Uint16Array
    const roles = new WeakMap()
    const cursors = new WeakSet()
    const values = []
    const copied = []
    let htmlUnits = 0
    PackedReadScope.prototype.textSteps = function (path, budget) {
      const stream = readText.call(this, path, budget)
      const role = { path: path[0], units: 0 }
      roles.set(stream, role)
      references.push(new WeakRef(stream))
      if (role.path === 'value') values.push(role)
      return stream
    }
    PackedTextSteps.prototype.next = function () {
      const next = nextText.call(this)
      if (!next.done && typeof next.value === 'string') {
        const role = roles.get(this)
        if (role) {
          role.units += next.value.length
          if (role.path === 'html') htmlUnits += next.value.length
        }
      }
      return next
    }
    PackedHtmlCursor.prototype.skip = function* (...args) {
      if (!cursors.has(this)) {
        cursors.add(this)
        references.push(new WeakRef(this))
      }
      yield* skipHtml.apply(this, args)
    }
    const valueLength = value.projection.blocks[0].value.length
    global.Uint16Array = new Proxy(NativeUnits, {
      construct(arrayType, args, newTarget) {
        const result = Reflect.construct(arrayType, args, newTarget)
        if (args[0] === valueLength) {
          const reference = new WeakRef(result)
          copied.push(reference)
          references.push(reference)
        }
        return result
      },
    })
    try {
      owner.commit(owner.prepareFull(owner.beginPrepared(checked), checked.identity, payload))
      const capture = owner.capture()
      const work = validatePackedProjection(capture, checked, paths, options, validation)
      let steps = 0
      if (target !== 'unstarted') {
        while (true) {
          const step = work.next()
          steps++
          assert.ok(steps < 100000)
          if (target === 'completed' && step.done) break
          assert.equal(step.done, false)
          if (target === 'html' && htmlUnits > 0) break
          if (target === 'value-copy' && values[0]?.units > 0) break
          if (target === 'root-value' && values[1]?.units > 0) break
        }
      }
      if (['value-copy', 'root-value', 'completed'].includes(target)) {
        assert.equal(copied.length, 1)
        assert.equal(copied[0].deref()[0], 'a'.charCodeAt(0))
      }
      const report = {
        target,
        keepOwner,
        steps,
        htmlUnits,
        valueStreamUnits: values.map((role) => role.units),
        copiedArrays: copied.length,
      }
      capture.release()
      owner.dispose()
      assert.equal(owner.stats.retainedBytes, 0)
      assert.equal(owner.stats.readers, 0)
      assert.equal(owner.stats.readerStagingBytes, 0)
      return { work, capture, owner: keepOwner ? owner : undefined, references, report }
    } finally {
      owner.dispose()
      PackedArena.open = originalOpen
      PackedReadScope.prototype.textSteps = readText
      PackedTextSteps.prototype.next = nextText
      PackedHtmlCursor.prototype.skip = skipHtml
      global.Uint16Array = NativeUnits
    }
  }
  const escaped = ['unstarted', 'html', 'value-copy', 'root-value', 'completed'].flatMap((phase) =>
    [false, true].map((keepOwner) => probe(phase, keepOwner)),
  )
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
    'Closed handles must release arenas, sources, owners, HTML cursors, streams and copied widget arrays',
  )
  const probes = escaped.map(({ work, capture, owner, report }) => {
    assert.equal(work.next().done, true)
    assert.throws(() => capture.reader.kind(), /released/)
    if (owner) assert.equal(owner.stats.retainedBytes, 0)
    return report
  })
  const measure = async (owner, work, previous, invalid = false) => {
    const report = {
      steps: 0,
      activeMs: 0,
      largestStepMs: 0,
      largestBatchMs: 0,
      peakRetainedBytes: owner.stats.retainedBytes,
      peakStagingBytes: 0,
      rejected: false,
    }
    const started = performance.now()
    let batchStart = started
    while (true) {
      const start = performance.now()
      let step
      try {
        step = work.next()
      } catch (error) {
        if (!invalid) throw error
        assert.match(String(error), /Invalid packed semantic document/)
        report.rejected = true
      }
      const elapsed = performance.now() - start
      report.steps++
      report.activeMs += elapsed
      report.largestStepMs = Math.max(report.largestStepMs, elapsed)
      const stats = owner.stats
      report.peakRetainedBytes = Math.max(report.peakRetainedBytes, stats.retainedBytes)
      report.peakStagingBytes = Math.max(
        report.peakStagingBytes,
        stats.readerStagingBytes + stats.preparingStagingBytes,
      )
      assert.ok(stats.retainedBytes <= limits.retained)
      assert.ok(stats.readerStagingBytes + stats.preparingStagingBytes <= limits.staging)
      report.largestBatchMs = Math.max(report.largestBatchMs, performance.now() - batchStart)
      if (report.rejected || step.done) {
        assert.equal(report.rejected, invalid)
        report.wallMs = performance.now() - started
        return { report, value: step?.value }
      }
      assert.equal(step.value, undefined)
      assert.deepEqual(stats.current, previous)
      if (performance.now() - batchStart >= 1) {
        await immediate()
        batchStart = performance.now()
      }
    }
  }
  const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const nested = `# nested-containers\n\n${chunk.repeat(Math.ceil(MiB / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
  const results = []
  for (const [name, text] of [
    ['nested', nested],
    ['widgets', `~~~plain\n${'a界😀'.repeat(100000)}\n~~~\n`],
  ]) {
    const sha256 = createHash('sha256').update(text).digest('hex')
    if (name === 'nested')
      assert.equal(sha256, '93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3')
    const value = snapshot(text)
    const checked = source(text, value)
    const payload = packValue(value, limits.bytes)
    const receiver = new PackedReceiver(limits, (capture, source) =>
      validatePackedSnapshot(capture, source, [], options, validation),
    )
    const packet = (ticket, bytes) => ({
      protocol: packedWireVersion,
      kind: 'full',
      sequence: ticket.sequence,
      result: ticket.identity,
      requestToken: ticket.requestToken,
      resultToken: newPackedToken(),
      sentAt: 0,
      payload: bytes,
      metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
    })
    let accepted
    try {
      const ticket = receiver.begin(1, checked)
      const message = packet(ticket, payload.slice(0))
      const first = await measure(receiver, receiver.receiveSteps(ticket, message), null)
      accepted = first.value
      assert.equal(message.payload.byteLength, 0)
      assert.equal(accepted.kind, 'accepted')
      assert.equal(accepted.acknowledgement.resultToken, message.resultToken)
      const geometry = await measure(
        receiver,
        validatePackedProjection(accepted.capture, checked, paths, options, validation),
        checked.identity,
      )
      const wrong = structuredClone(value)
      if (name === 'nested') wrong.layout.bodyEnd--
      else wrong.projection.blocks[0].value = `x${wrong.projection.blocks[0].value.slice(1)}`
      const updated = source(text, value, 1)
      const next = receiver.begin(2, updated)
      const rejected = await measure(
        receiver,
        receiver.receiveSteps(next, packet(next, packValue(wrong, limits.bytes))),
        checked.identity,
        true,
      )
      assert.deepEqual(receiver.stats.current, checked.identity)
      assert.equal(receiver.stats.readers, 0)
      assert.equal(receiver.stats.readerStagingBytes, 0)
      assert.equal(receiver.stats.prepared, null)
      assert.equal(receiver.stats.requested, null)
      assert.equal(
        accepted.capture.reader.textLength(['projection', 'html']),
        value.projection.html.length,
      )
      results.push({
        name,
        sourceBytes: Buffer.byteLength(text),
        sha256,
        payloadBytes: payload.byteLength,
        widgets: value.projection.blocks.length,
        accepted: first.report,
        projection: geometry.report,
        rejected: rejected.report,
      })
    } finally {
      accepted?.capture.release()
      receiver.dispose()
    }
    assert.equal(receiver.stats.retainedBytes, 0)
  }
  const output = {
    method:
      'Development Node/Vite diagnostic, not packaged p95 or calibrated heap evidence. Full packed receipts validate exact document metadata/counts, strict projection/layout fields, top-level visibility/anchors/separators, ordered source ranges and supplied widget kinds/ranges/exact UTF-16 values against the packed root. Whole HTML renderer equivalence, missing-widget completeness and footer reference semantics remain separate. Original captures survive rejected bad-layout and same-length bad-widget-value replacements; no acceptance or ACK escapes. Limits are 64 MiB retained / 8 MiB staging; the existing 16 MiB diagnostic is unchanged. Scheduler targets 1 ms; actual maxima include native allocation, cleanup and GC with no universal time bound. Ten GC probes keep closed work/captures unadvanced, with and without a retained disposed owner; decoded phases require actual emitted/compared code units, and copied-array probes confirm populated data before release. Arenas, sources, HTML cursors, decoder streams, Uint16 widget copies and otherwise unreachable owners must collect. All disposed ledgers are zero. Runtime integration, proof reuse, complete projection equivalence and packaged release gates remain open.',
    date: new Date().toISOString(),
    runtime: process.versions,
    limits,
    validation,
    collected,
    probes,
    results,
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/packed-projection-profile.json',
    `${JSON.stringify(output, null, 2)}\n`,
  )
  console.log(JSON.stringify(output, null, 2))
} finally {
  await server.close()
}
