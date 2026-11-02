import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error('Run with node --expose-gc test/benchmark/profiles/profile-packed-context.mjs')
const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const sessionLimits = { ...limits, retained: 64 * MiB, bytes: 8 * MiB, captures: 8, readers: 160 }
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
  plugins: [
    {
      name: 'observe-private-definition-context',
      enforce: 'pre',
      transform(code, id) {
        if (!id.replaceAll('\\', '/').endsWith('/renderer/src/packed-projection-context.ts')) return
        const marker = 'context.push((yield* copyPackedNative(node)) as ProjectionDefinition)'
        assert.equal(code.split(marker).length, 2, 'Missing private context-copy probe anchor')
        return code.replace(
          marker,
          `${marker}\n        globalThis[Symbol.for('manuslip-context-lifetime')]?.(context, recordKeys)`,
        )
      },
    },
  ],
})
try {
  const load = (name) => server.ssrLoadModule(`/packages/${name}.ts`)
  const { inspectPackedProjectionContext } = await load('renderer/src/packed-projection-context')
  const { ProjectionSequence } = await load('renderer/src/projection-sequence')
  const { renderProjectionLayout } = await load('renderer/src/projection-layout')
  const { rendererVersion } = await load('renderer/src/index')
  const { inspectPackedNative } = await load('core/src/packing-native-steps')
  const { PackedArena } = await load('core/src/packing-arena')
  const { PackedSession } = await load('core/src/packing-session')
  const { PackedWordBuffer } = await load('core/src/packing-word-buffer')
  const { PackedSource } = await load('core/src/packing-source')
  const { parseMarkdown } = await load('core/src/parse')
  const { packValue } = await load('core/src/packing')
  const { sourceHash } = await load('core/src/contracts')
  const fixture = (text) => {
    const document = parseMarkdown(text)
    const checked = new PackedSource(
      {
        generation: 1,
        documentId: 'packed-context-profile',
        revision: 0,
        sourceHash: sourceHash(text),
        parserVersion: document.parserVersion,
        rendererVersion,
        options: JSON.stringify(options),
      },
      text,
    )
    const owner = new PackedSession(sessionLimits)
    const payload = packValue({ root: document.root }, sessionLimits.bytes)
    const payloadBytes = payload.byteLength
    owner.commit(owner.prepareFull(owner.beginPrepared(checked), checked.identity, payload))
    return { document, checked, owner, capture: owner.capture(), payloadBytes }
  }
  const watchObjects = (value, references) => {
    if (!value || typeof value !== 'object') return
    references.push(new WeakRef(value))
    for (const child of Object.values(value)) watchObjects(child, references)
  }
  const probe = (phase, keepOwner) => {
    const references = []
    let appendedUnits = 0
    const create = PackedWordBuffer.create
    const append = PackedWordBuffer.prototype.append
    const open = PackedArena.open
    PackedWordBuffer.create = function (...args) {
      const buffer = create.apply(this, args)
      references.push(new WeakRef(buffer))
      return buffer
    }
    PackedWordBuffer.prototype.append = function (value) {
      append.call(this, value)
      appendedUnits += value.length
    }
    PackedArena.open = function (...args) {
      const arena = open.apply(this, args)
      references.push(new WeakRef(arena))
      return arena
    }
    const context = fixture(`body[^a] [r][r]\n\n[r]: /url\n\n[^a]: ${'a界😀'.repeat(10000)}\n`)
    references.push(new WeakRef(context.checked))
    if (!keepOwner) references.push(new WeakRef(context.owner))
    let inspected = false
    let sequenced = false
    let escapedSequence
    const work = inspectPackedProjectionContext(
      context.capture,
      context.checked,
      ['root'],
      limits,
      function* (definitions, cost) {
        watchObjects(definitions, references)
        assert.equal(context.owner.stats.readerStagingBytes, cost.stagingBytes)
        inspected = true
        yield
        const sequence = new ProjectionSequence(definitions, options)
        escapedSequence = sequence
        try {
          sequence.render({
            type: 'paragraph',
            children: [{ type: 'footnoteReference', identifier: 'a', label: 'a' }],
          })
          sequenced = true
          yield
          sequence.finish()
        } finally {
          sequence.close()
        }
      },
    )
    let steps = 0
    try {
      if (phase !== 'unstarted') {
        while (true) {
          const step = work.next()
          steps++
          assert.ok(steps < 100000)
          if (phase === 'completed' && step.done) break
          assert.equal(step.done, false)
          if (phase === 'scan') break
          if (phase === 'decode' && appendedUnits > 1000) break
          if (phase === 'inspect' && inspected) break
          if (phase === 'sequence' && sequenced) break
        }
      }
      const report = {
        phase,
        keepOwner,
        steps,
        appendedUnits,
        inspected,
        sequenced,
        references: references.length,
      }
      context.capture.release()
      context.owner.dispose()
      assert.equal(context.owner.stats.retainedBytes, 0)
      assert.equal(context.owner.stats.readerStagingBytes, 0)
      assert.equal(context.owner.stats.readers, 0)
      return {
        work,
        capture: context.capture,
        owner: keepOwner ? context.owner : undefined,
        sequence: escapedSequence,
        references,
        report,
      }
    } finally {
      context.owner.dispose()
      PackedWordBuffer.create = create
      PackedWordBuffer.prototype.append = append
      PackedArena.open = open
    }
  }
  const escaped = ['unstarted', 'scan', 'decode', 'inspect', 'sequence', 'completed'].flatMap(
    (phase) => [false, true].map((keepOwner) => probe(phase, keepOwner)),
  )
  const partialProbe = (phase, action) => {
    const references = []
    let copied = 0,
      appended = 0
    const hook = Symbol.for('manuslip-context-lifetime')
    assert.equal(globalThis[hook], undefined)
    const context = fixture(`[r]: /copied\n\n[^later]: ${'a界😀'.repeat(10000)}\n`)
    const before = context.owner.stats
    const create = PackedWordBuffer.create,
      append = PackedWordBuffer.prototype.append
    globalThis[hook] = (definitions, recordKeys) => {
      copied++
      watchObjects(definitions, references)
      // Record keys can legitimately stay interned in the live arena; only their
      // private context array belongs to this suspended operation.
      references.push(new WeakRef(recordKeys))
    }
    PackedWordBuffer.create = function (...args) {
      const buffer = create.apply(this, args)
      references.push(new WeakRef(buffer))
      return buffer
    }
    PackedWordBuffer.prototype.append = function (value) {
      append.call(this, value)
      appended += value.length
    }
    const work = inspectPackedProjectionContext(
      context.capture,
      context.checked,
      ['root'],
      limits,
      () => {
        throw new Error('Partial context must not reach inspection')
      },
    )
    let steps = 0
    try {
      while (copied < 1 || (phase === 'later-decode' && appended < 1000)) {
        assert.equal(work.next().done, false)
        assert.ok(++steps < 100000)
      }
      assert.equal(copied, 1)
      if (action === 'return') work.return()
      else if (action === 'release') context.capture.release()
      else context.owner.dispose()
      assert.equal(context.owner.stats.readers, 0)
      assert.equal(context.owner.stats.readerStagingBytes, 0)
      if (action === 'return') assert.deepEqual(context.owner.stats, before)
      else if (action === 'dispose') assert.equal(context.owner.stats.retainedBytes, 0)
      else assert.ok(context.owner.stats.current)
      return {
        work,
        capture: context.capture,
        owner: context.owner,
        references,
        report: { phase, action, steps, copied, appended, references: references.length },
      }
    } catch (error) {
      work.return()
      context.owner.dispose()
      throw error
    } finally {
      Reflect.deleteProperty(globalThis, hook)
      PackedWordBuffer.create = create
      PackedWordBuffer.prototype.append = append
    }
  }
  const partial = ['copied-definition', 'later-decode'].flatMap((phase) =>
    ['return', 'release', 'dispose'].map((action) => partialProbe(phase, action)),
  )
  let collected = false
  for (let attempt = 0; attempt < 40; attempt++) {
    await immediate()
    global.gc()
    await immediate()
    if (
      [...escaped, ...partial].every((entry) =>
        entry.references.every((reference) => !reference.deref()),
      )
    ) {
      collected = true
      break
    }
  }
  assert.ok(
    collected,
    'Escaped closed context work/captures/sequences must release native context, collectors, arenas, sources and unreachable owners',
  )
  const probes = escaped.map(({ work, capture, owner, sequence, report }) => {
    assert.equal(work.next().done, true)
    assert.throws(() => capture.reader.kind(), /released/)
    if (sequence) assert.throws(() => sequence.finish(), /closed/)
    if (owner) assert.equal(owner.stats.retainedBytes, 0)
    return report
  })
  for (const { work, owner, report } of partial) {
    assert.equal(work.next().done, true)
    owner.dispose()
    assert.equal(owner.stats.retainedBytes, 0)
    probes.push(report)
  }
  const nestedChunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const nested = `# nested-containers\n\n${nestedChunk.repeat(Math.ceil(MiB / Buffer.byteLength(nestedChunk)))}\n[r]: https://example.invalid/\n`
  const notes = `first[^a] and [r][r]\n\nsecond[^b] and again[^a]\n\n[r]: /first\n\n[r]: /second\n\n[^a]: ${'note 界😀 '.repeat(20000)}\n\n    > [r]: /inside\n    >\n    > ![picture][r]\n\n[^b]: other with [^a]\n`
  const reports = []
  for (const [name, text] of [
    ['nested', nested],
    ['notes', notes],
  ]) {
    const sha256 = createHash('sha256').update(text).digest('hex')
    if (name === 'nested')
      assert.equal(sha256, '93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3')
    const context = fixture(text)
    const baseline = context.owner.stats
    const expected = renderProjectionLayout(context.document.root, options, 8 * MiB)
    let receivedCost
    let peakRetained = baseline.retainedBytes
    let peakStaging = 0
    let steps = 0
    let activeMs = 0
    let largestStepMs = 0
    let largestBatchMs = 0
    let blockCopySteps = 0
    let phase = 'collection'
    const phases = {}
    const work = inspectPackedProjectionContext(
      context.capture,
      context.checked,
      ['root'],
      limits,
      function* (definitions, cost) {
        phase = 'inspection'
        receivedCost = cost
        // Functional oracle only: native renderer allocations here are outside the collector
        // budget. The standalone one-block copy below exercises separate admitted ownership.
        const sequence = new ProjectionSequence(definitions, options)
        let at = 0
        let visible = false
        const widgets = new Map()
        try {
          for (const [index, node] of context.document.root.children.entries()) {
            const result = sequence.render(node)
            const from = at + Number(visible && result.visible)
            if (visible && result.visible) {
              assert.equal(expected.projection.html[at], '\n')
              at++
            }
            assert.equal(
              result.projection.html,
              expected.projection.html.slice(at, at + result.projection.html.length),
            )
            at += result.projection.html.length
            assert.deepEqual(
              { from, to: at, visible: result.visible },
              expected.layout.blocks[index],
            )
            if (result.visible) visible = true
            for (const widget of result.projection.blocks)
              widgets.set(`${widget.from}:${widget.to}`, widget)
            yield
          }
          assert.equal(at, expected.layout.bodyEnd)
          const footer = sequence.finish()
          assert.equal(footer.html, expected.projection.html.slice(at))
          for (const widget of footer.blocks) widgets.set(`${widget.from}:${widget.to}`, widget)
          assert.deepEqual(
            [...widgets.values()].sort((a, b) => a.from - b.from || b.to - a.to),
            expected.projection.blocks,
          )
        } finally {
          sequence.close()
        }
        const remaining = {
          ...limits,
          retained: limits.retained - cost.retainedBytes,
          staging: limits.staging - cost.stagingBytes,
        }
        const items = context.capture.reader.elementSteps(['root', 'children'])
        try {
          const first = items.next().value
          assert.ok(first)
          const copied = inspectPackedNative(context.capture, first, remaining, function* (value) {
            assert.deepEqual(value, context.document.root.children[0])
            yield
          })
          try {
            while (!copied.next().done) {
              blockCopySteps++
              yield
            }
          } finally {
            copied.return()
          }
        } finally {
          items.return()
        }
        assert.equal(context.owner.stats.readerStagingBytes, cost.stagingBytes)
      },
    )
    const started = performance.now()
    let batchStart = started
    try {
      while (true) {
        const phaseBefore = phase
        const before = performance.now()
        const next = work.next()
        const elapsed = performance.now() - before
        steps++
        activeMs += elapsed
        largestStepMs = Math.max(largestStepMs, elapsed)
        phases[phaseBefore] ??= { steps: 0, activeMs: 0, largestStepMs: 0 }
        phases[phaseBefore].steps++
        phases[phaseBefore].activeMs += elapsed
        phases[phaseBefore].largestStepMs = Math.max(phases[phaseBefore].largestStepMs, elapsed)
        largestBatchMs = Math.max(largestBatchMs, performance.now() - batchStart)
        const stats = context.owner.stats
        peakRetained = Math.max(peakRetained, stats.retainedBytes)
        peakStaging = Math.max(peakStaging, stats.readerStagingBytes)
        assert.ok(stats.retainedBytes <= sessionLimits.retained)
        assert.ok(stats.readerStagingBytes <= limits.staging)
        if (next.done) break
        if (performance.now() - batchStart >= 1) {
          await immediate()
          batchStart = performance.now()
        }
      }
      assert.deepEqual(context.owner.stats, baseline)
      assert.ok(context.payloadBytes > 0)
      reports.push({
        name,
        sourceBytes: Buffer.byteLength(text),
        sha256,
        payloadBytes: context.payloadBytes,
        steps,
        activeMs,
        wallMs: performance.now() - started,
        largestStepMs,
        largestBatchMs,
        peakRetained,
        peakStaging,
        receivedCost,
        blockCopySteps,
        phases,
      })
    } finally {
      work.return()
      context.owner.dispose()
    }
    assert.equal(context.owner.stats.retainedBytes, 0)
  }
  const output = {
    method:
      'Development Node/Vite context-ownership diagnostic, not packaged performance or physical admission. One document walk preflights and admits each complete outermost definition/footnote before copying it; earlier private copies stay charged. Nested definitions remain inside copied footnotes. Complete native roots/HTML/layout/widget outputs and native sequenced rendering in the inspector are independent functional oracles outside this ledger. Twelve original GC probes retain closed work/captures/sequences with and without disposed owners. Six additional probes observe actual private context/record-key arrays, copied native descendants and collectors before inspection, after the first copied definition or during later decoding, at return/release/dispose. Return/release probes keep their ordinary owner live through GC; interned record-key objects are excluded. All closed work stays held and unadvanced through GC. Observed transients must collect, and all finally disposed ledgers are zero. Scheduler targets 1 ms and reports actual maxima; joins, freezes and native calls have no universal time bound.',
    date: new Date().toISOString(),
    runtime: process.versions,
    collected,
    probes,
    reports,
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/packed-context-profile.json',
    `${JSON.stringify(output, null, 2)}\n`,
  )
  console.log(JSON.stringify(output, null, 2))
} finally {
  await server.close()
}
