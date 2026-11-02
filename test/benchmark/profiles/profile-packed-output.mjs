import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setImmediate as immediate } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error('Run with node --expose-gc test/benchmark/profiles/profile-packed-output.mjs')
const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const sessionLimits = { ...limits, retained: 64 * MiB, bytes: 8 * MiB, captures: 8, readers: 160 }
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
const probeKey = Symbol.for('manuslip-packed-output-profile')
let observe
await mkdir('test/artifacts/logs', { recursive: true })
const output = await mkdtemp(resolve('test/artifacts/logs/packed-output-'))
await mkdir(resolve(output, 'sources'))
await copyFile(fileURLToPath(import.meta.url), resolve(output, 'driver.mjs'))
const inputs = new Map()
globalThis[probeKey] = (phase, value) => observe?.(phase, value)
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
  plugins: [
    {
      name: 'profile-public-state-and-string-planning',
      enforce: 'pre',
      async transform(code, id) {
        const path = id.replaceAll('\\', '/')
        const root = `${resolve('.').replaceAll('\\', '/')}/`
        if (path.startsWith(root) && /\.[cm]?[jt]sx?$/.test(path)) {
          const relative = path.slice(root.length)
          const sha256 = createHash('sha256').update(code).digest('hex')
          const previous = inputs.get(relative)
          if (previous) assert.equal(previous.sha256, sha256, relative)
          else {
            const archive = resolve(output, 'sources', sha256)
            try {
              await writeFile(archive, code, { flag: 'wx' })
            } catch (error) {
              if (error.code !== 'EEXIST') throw error
              assert.equal(await readFile(archive, 'utf8'), code)
            }
            inputs.set(relative, { path: relative, archive, sha256 })
          }
        }
        const inject = (marker, phase, value) => {
          assert.ok(code.includes(marker), `Missing marker ${path}: ${marker}`)
          return code.replace(
            marker,
            `${marker}; globalThis[Symbol.for('manuslip-packed-output-profile')]?.('${phase}', ${value});`,
          )
        }
        if (path.endsWith('/renderer/src/projection-owned-output.ts')) {
          code = inject('const frames: DescriptionFrame[] = []', 'description-frames', 'frames')
          code = inject(
            'const progress = new ProjectionTraversalBudget()',
            'traversal-budget',
            'progress',
          )
          code = inject(
            'if (value) descriptions.set(value.key, value.description)',
            'described',
            'descriptions',
          )
          code = inject('const to = node.position?.end.offset', 'widget-visit', 'blocks')
          return inject(
            'html: toHtml(node, { allowDangerousHtml: options.rawHtml }),\n      })',
            'widget-serialized',
            'blocks',
          )
        }
        if (path.endsWith('/renderer/src/projection-sequence.ts')) {
          assert.equal(code.split('root(state) {').length, 3)
          return code.replaceAll(
            'root(state) {',
            "root(state) { globalThis[Symbol.for('manuslip-packed-output-profile')]?.('state', state);",
          )
        }
        if (path.endsWith('/renderer/src/projection-conversion-steps.ts')) {
          code = inject('const value = invoke(node, parent)', 'native-result', 'value')
          code = inject(
            'frames.push({ node, parent, depth, children, at: 0 })',
            'conversion-frame',
            'frames',
          )
          return inject('value = invoke(frame.node, frame.parent)', 'native-result', 'value')
        }
        if (path.endsWith('/renderer/src/projection-serialization-plan.ts')) {
          code = inject('policy(node)', 'policy', 'node')
          code = inject(
            'const progress = new ProjectionTraversalBudget()',
            'traversal-budget',
            'progress',
          )
          return inject(
            'const end = Math.min(from + progress.textCapacity, value.length)',
            'scan',
            'end',
          )
        }
      },
    },
  ],
})
try {
  const load = (name) => server.ssrLoadModule(`/packages/${name}.ts`)
  const { inspectPackedProjectionOutput, packedProjectionOutputInspectionSteps } = await load(
    'renderer/src/packed-projection-output',
  )
  const inspectOutput = (mode, capture, ...args) =>
    mode === 'parent-owned'
      ? capture.work(packedProjectionOutputInspectionSteps(capture, ...args))
      : inspectPackedProjectionOutput(capture, ...args)
  const { ProjectionSequence } = await load('renderer/src/projection-sequence')
  const { renderProjectionLayout } = await load('renderer/src/projection-layout')
  const { rendererVersion } = await load('renderer/src/index')
  const { PackedArena } = await load('core/src/packing-arena')
  const { PackedCapture } = await load('core/src/packing-capture')
  const { PackedSession } = await load('core/src/packing-session')
  const { PackedSource } = await load('core/src/packing-source')
  const { PackedWordBuffer } = await load('core/src/packing-word-buffer')
  const { packValue } = await load('core/src/packing')
  const { sourceHash } = await load('core/src/contracts')
  const { parseMarkdown } = await load('core/src/parse')
  const fixture = (text) => {
    const document = parseMarkdown(text)
    const source = new PackedSource(
      {
        generation: 1,
        documentId: 'packed-output-profile',
        revision: 0,
        sourceHash: sourceHash(text),
        parserVersion: document.parserVersion,
        rendererVersion,
        options: JSON.stringify(options),
      },
      text,
    )
    const owner = new PackedSession(sessionLimits)
    const payload = packValue({ root: document.root }, limits.staging)
    const payloadBytes = payload.byteLength
    owner.commit(owner.prepareFull(owner.beginPrepared(source), source.identity, payload))
    return { document, source, owner, capture: owner.capture(), payloadBytes }
  }
  const watch = (value, references, seen = new WeakSet()) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    references.push(new WeakRef(value))
    if (value instanceof Map) for (const child of value.values()) watch(child, references, seen)
    else for (const child of Object.values(value)) watch(child, references, seen)
  }
  const probe = (phase, keepOwner, mode) => {
    const references = []
    let appendedUnits = 0
    let contextUnits = 0
    let states = 0
    let converted = false
    let converting = false,
      conversionFrames = 0,
      nativeResults = 0
    let scannedUnits = 0
    let body = false
    let footer = false
    let escapedSequence
    let descriptionFrames = 0,
      described = 0,
      policies = 0,
      widgetVisits = 0,
      serialized = 0
    const originals = {
      open: PackedArena.open,
      create: PackedWordBuffer.create,
      append: PackedWordBuffer.prototype.append,
      workspace: PackedCapture.prototype.workspace,
      convert: ProjectionSequence.prototype.convertSteps,
      finish: ProjectionSequence.prototype.finishConversion,
    }
    observe = (kind, value) => {
      if (kind === 'state') {
        states++
        contextUnits = appendedUnits
        watch(value, references)
      } else if (kind === 'scan') scannedUnits = Math.max(scannedUnits, value)
      else {
        if (kind === 'description-frames') descriptionFrames++
        if (kind === 'described') described++
        if (kind === 'policy') policies++
        if (kind === 'widget-visit') widgetVisits++
        if (kind === 'widget-serialized') serialized++
        if (kind === 'conversion-frame') conversionFrames++
        if (kind === 'native-result') nativeResults++
        watch(value, references)
      }
    }
    PackedArena.open = function (...args) {
      const value = originals.open.apply(this, args)
      references.push(new WeakRef(value))
      return value
    }
    PackedWordBuffer.create = function (...args) {
      const value = originals.create.apply(this, args)
      references.push(new WeakRef(value))
      return value
    }
    PackedWordBuffer.prototype.append = function (value) {
      originals.append.call(this, value)
      appendedUnits += value.length
    }
    PackedCapture.prototype.workspace = function (...args) {
      const hold = originals.workspace.apply(this, args)
      references.push(new WeakRef(hold))
      return hold
    }
    ProjectionSequence.prototype.convertSteps = function* (...args) {
      escapedSequence = this
      converting = true
      const value = yield* originals.convert.apply(this, args)
      converted = true
      watch(value, references)
      return value
    }
    ProjectionSequence.prototype.finishConversion = function (...args) {
      const value = originals.finish.apply(this, args)
      watch(value, references)
      return value
    }
    const context = fixture(
      phase.endsWith('-batch') || phase === 'widget-serialized' || phase === 'conversion'
        ? `> ${Array.from({ length: 96 }, (_, index) => `*${index}* $x${index}$`).join(' ')}\n`
        : `~~~text\n${'a界😀'.repeat(10000)}\n~~~\n\nbody[^a] [r][r]\n\n[r]: /url\n\n[^a]: ${'a界😀'.repeat(10000)}\n`,
    )
    references.push(new WeakRef(context.source))
    if (!keepOwner) references.push(new WeakRef(context.owner))
    const work = inspectOutput(
      mode,
      context.capture,
      context.source,
      ['root'],
      options,
      limits,
      function* (output, cost) {
        watch(output, references)
        assert.equal(context.owner.stats.readerStagingBytes, cost.stagingBytes)
        if (output.footer) footer = true
        else body = true
        yield
      },
    )
    let steps = 0
    try {
      if (phase !== 'queued')
        while (true) {
          const next = work.next()
          steps++
          assert.ok(steps < 100000)
          if (phase === 'complete' && next.done) break
          assert.equal(next.done, false)
          if (phase === 'scan') break
          if (phase === 'context-decode' && !states && appendedUnits > 1000) break
          if (phase === 'input-decode' && states && appendedUnits > contextUnits + 1000) break
          if (
            phase === 'conversion' &&
            converting &&
            !converted &&
            conversionFrames &&
            nativeResults
          )
            break
          if (phase === 'hast' && converted) break
          if (phase === 'output-plan' && scannedUnits >= 4096) break
          if (phase === 'description-batch' && described >= 16) break
          if (phase === 'policy-batch' && policies >= 16) break
          if (phase === 'widget-batch' && widgetVisits >= 16) break
          if (phase === 'widget-serialized' && serialized > 0) break
          if (phase === 'body' && body) break
          if (phase === 'footer' && footer) break
        }
      if (phase === 'description-batch') assert.ok(descriptionFrames > 0)
      const report = {
        mode,
        phase,
        keepOwner,
        steps,
        appendedUnits,
        contextUnits,
        states,
        converted,
        conversionFrames,
        nativeResults,
        scannedUnits,
        descriptionFrames,
        described,
        policies,
        widgetVisits,
        serialized,
        body,
        footer,
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
      PackedArena.open = originals.open
      PackedWordBuffer.create = originals.create
      PackedWordBuffer.prototype.append = originals.append
      PackedCapture.prototype.workspace = originals.workspace
      ProjectionSequence.prototype.convertSteps = originals.convert
      ProjectionSequence.prototype.finishConversion = originals.finish
      observe = undefined
    }
  }
  const escaped = [
    'queued',
    'scan',
    'context-decode',
    'input-decode',
    'conversion',
    'hast',
    'output-plan',
    'description-batch',
    'policy-batch',
    'widget-batch',
    'widget-serialized',
    'body',
    'footer',
    'complete',
  ].flatMap((phase) =>
    ['standalone', 'parent-owned'].flatMap((mode) =>
      [false, true].map((keepOwner) => probe(phase, keepOwner, mode)),
    ),
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
    'Closed, unadvanced output work/captures/sequences must drop every watched object',
  )
  const probes = escaped.map(({ work, capture, owner, sequence, report }) => {
    assert.equal(work.next().done, true)
    assert.throws(() => capture.reader.kind(), /released/)
    if (sequence) assert.throws(() => sequence.finish(), /closed/)
    if (owner) assert.equal(owner.stats.retainedBytes, 0)
    return report
  })
  const nestedChunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const nested = `# nested-containers\n\n${nestedChunk.repeat(Math.ceil(MiB / Buffer.byteLength(nestedChunk)))}\n[r]: https://example.invalid/\n`
  const notes = `first[^a] and [r][r]\n\nsecond[^b] and again[^a]\n\n[r]: /first\n\n[r]: /second\n\n[^a]: ${'note 界😀 '.repeat(20000)}\n\n    > [r]: /inside\n    >\n    > ![picture][r]\n\n[^b]: other with [^a]\n`
  const reports = []
  for (const [name, text] of [
    ['nested', nested],
    ['notes', notes],
    ['widget', `~~~plain\n${'a界😀'.repeat(100000)}\n~~~\n`],
  ]) {
    const context = fixture(text)
    const baseline = context.owner.stats
    const expected = renderProjectionLayout(context.document.root, options, limits.staging)
    let at = 0
    let visible = false
    let outputs = 0
    let maxOutputBytes = 0
    let largestHtmlUnits = 0
    let peakRetained = baseline.retainedBytes
    let peakStaging = 0
    let lastCost
    const widgets = new Set()
    const expectedWidgets = new Map(
      expected.projection.blocks.map((block) => [`${block.from}:${block.to}`, block]),
    )
    const work = inspectPackedProjectionOutput(
      context.capture,
      context.source,
      ['root'],
      options,
      limits,
      function* (output, cost) {
        outputs++
        lastCost = cost
        maxOutputBytes = Math.max(maxOutputBytes, cost.outputBytes)
        largestHtmlUnits = Math.max(largestHtmlUnits, output.projection.html.length)
        assert.equal(context.owner.stats.readerStagingBytes, cost.stagingBytes)
        if (output.footer) {
          assert.equal(at, expected.layout.bodyEnd)
          assert.equal(output.projection.html, expected.projection.html.slice(at))
        } else {
          const from = at + Number(visible && output.visible)
          if (visible && output.visible) {
            assert.equal(expected.projection.html[at], '\n')
            at++
          }
          assert.equal(
            output.projection.html,
            expected.projection.html.slice(at, at + output.projection.html.length),
          )
          assert.deepEqual(
            { from, to: at + output.projection.html.length, visible: output.visible },
            expected.layout.blocks[output.index],
          )
          visible ||= output.visible
        }
        at += output.projection.html.length
        for (const widget of output.projection.blocks) {
          const key = `${widget.from}:${widget.to}`
          assert.deepEqual(widget, expectedWidgets.get(key))
          widgets.add(key)
        }
        yield
        assert.equal(context.owner.stats.readerStagingBytes, cost.stagingBytes)
      },
    )
    let steps = 0
    let activeMs = 0
    let largestStepMs = 0
    let largestBatchMs = 0
    const started = performance.now()
    let batchStart = started
    try {
      while (true) {
        const before = performance.now()
        const next = work.next()
        const elapsed = performance.now() - before
        steps++
        activeMs += elapsed
        largestStepMs = Math.max(largestStepMs, elapsed)
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
      assert.equal(at, expected.layout.htmlLength)
      assert.equal(widgets.size, expected.projection.blocks.length)
      assert.deepEqual(context.owner.stats, baseline)
      const sha256 = createHash('sha256').update(text).digest('hex')
      if (name === 'nested')
        assert.equal(sha256, '93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3')
      if (name === 'widget')
        assert.equal(sha256, '2e41ac4f2ffbcd125da7edaa8fc453949cffc5fc9d67cf936553835d24c21cd3')
      reports.push({
        name,
        sha256,
        sourceBytes: Buffer.byteLength(text),
        payloadBytes: context.payloadBytes,
        outputs,
        steps,
        activeMs,
        wallMs: performance.now() - started,
        largestStepMs,
        largestBatchMs,
        peakRetained,
        peakStaging,
        maxOutputBytes,
        largestHtmlUnits,
        lastCost,
      })
    } finally {
      work.return()
      context.owner.dispose()
    }
    assert.equal(context.owner.stats.retainedBytes, 0)
  }
  const result = {
    method:
      'Development Node/Vite owned output diagnostic. Packed context, persistent/footer state, one immutable native block, HAST construction and policy scratch, serialized widgets including overwritten code/pre results, and complete output have simultaneous capture-owned admission. Native copy collectors/frames release before inspection. Serialization planning scans at most 4096 UTF-16 units between yields across adjacent values and includes recursive joins, sibling/attribute strings and entity-replacement scratch. Fifty-six standalone/parent-owned GC probes retain closed work/captures/sequences unadvanced with and without disposed owners, including cancellation during native child conversion, in actual partial description/policy/widget batches and after partial widget serialization. Actual native input, active conversion frames/results, public State/maps/context, HAST, description/widget maps, traversal budgets, output metadata, workspace holds, collectors, arenas, source and otherwise unreachable owners must collect before any held task resumes. Independent full native roots/results and comparison bookkeeping are external functional oracles. This is not a packed-snapshot equivalence validator, calibrated heap model or packaged performance gate. Individual native handlers, footer, URL policy, widget/full serialization and some admission scans remain synchronous; a 1 ms scheduler records actual maxima. Production integration and release gates remain open.',
    date: new Date().toISOString(),
    runtime: process.versions,
    inputs: [...inputs.values()].sort((a, b) => a.path.localeCompare(b.path)),
    collected,
    probes,
    reports,
  }
  const path = resolve(output, 'report.json')
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
  console.log(JSON.stringify({ path, collected, probes: probes.length, reports }))
} finally {
  delete globalThis[probeKey]
  await server.close()
}
