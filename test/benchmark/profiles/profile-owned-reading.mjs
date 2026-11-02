import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error('Run with node --expose-gc test/benchmark/profiles/profile-owned-reading.mjs')
const MiB = 1024 * 1024
const limits = {
  retained: 24 * MiB,
  metadata: 8 * MiB,
  staging: 8 * MiB,
  nodes: 800000,
  depth: 64,
}
const key = Symbol.for('manuslip-owned-reading-lifetime')
let observe
globalThis[key] = (phase, value) => observe?.(phase, value)
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
  plugins: [
    {
      name: 'observe-owned-reading-lifetime',
      enforce: 'pre',
      transform(code, id) {
        const path = id.replaceAll('\\', '/')
        const after = (marker, phase, value) => {
          assert.ok(code.includes(marker), `Missing reading marker ${path}: ${marker}`)
          return code.replace(
            marker,
            `${marker}; globalThis[Symbol.for('manuslip-owned-reading-lifetime')]?.('${phase}', ${value});`,
          )
        }
        if (path.endsWith('/renderer/src/projection-sequence.ts')) {
          code = after('this.#state = captured', 'context', 'this.#context')
          code = after('const state = captured', 'state', 'state')
          return after(
            "if (hast.children.length > 1) throw new Error('Unsupported sequenced root output')",
            'block',
            '[root, hast]',
          )
        }
        if (path.endsWith('/renderer/src/reading-sequence.ts')) {
          code = after('this.#data = data', 'handle', 'this')
          return after('const data = this.#data', 'rows', 'data')
        }
        if (path.endsWith('/renderer/src/reading-workspace.ts'))
          return after('this.#workspace.close()', 'handle', 'this')
      },
    },
  ],
})
try {
  const load = (name) => server.ssrLoadModule(`/packages/${name}.ts`)
  const { parseMarkdown } = await load('core/src/parse')
  const { sourceHash } = await load('core/src/contracts')
  const { packValue } = await load('core/src/packing')
  const { PackedArena } = await load('core/src/packing-arena')
  const { PackedSession } = await load('core/src/packing-session')
  const { PackedSource } = await load('core/src/packing-source')
  const { buildPackedTranslationPlan } = await load('translate/src/packed-plan')
  const { finishPackedSteps } = await load('core/src/packing-work')
  const { rendererVersion } = await load('renderer/src/index')
  const { readingBlocks } = await load('renderer/src/reading')
  const { inspectPackedReading } = await load('renderer/src/packed-reading')
  function watch(value, refs, seen) {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    refs.push(new WeakRef(value))
    for (const child of Object.values(value)) watch(child, refs, seen)
  }
  function probe(phase, layout, keepOwner) {
    const block = [],
      context = [],
      state = [],
      rows = [],
      privateRows = [],
      persistent = [],
      handles = []
    const seen = new WeakSet()
    const shallow = (value, refs) => {
      if (value && typeof value === 'object') refs.push(new WeakRef(value))
    }
    observe = (kind, value) => {
      if (kind === 'handle') handles.push(value)
      else if (kind === 'block' || kind === 'context')
        watch(value, kind === 'block' ? block : context, seen)
      else if (kind === 'state') {
        shallow(value, state)
        for (const field of ['definitionById', 'footnoteById', 'footnoteOrder', 'footnoteCounts'])
          shallow(value[field], state)
      } else if (kind === 'rows' && value) {
        shallow(value, privateRows)
        shallow(value.decoration, privateRows)
        for (const field of ['rows', 'sourceSlots', 'targetSlots']) watch(value[field], rows, seen)
        shallow(value.dictionary, privateRows)
        shallow(value.byId, privateRows)
      }
    }
    const open = PackedArena.open
    PackedArena.open = function (...args) {
      const arena = open.apply(this, args)
      persistent.push(new WeakRef(arena))
      return arena
    }
    const owner = new PackedSession({
      retained: 32 * MiB,
      staging: 8 * MiB,
      bytes: 8 * MiB,
      readers: 160,
      captures: 8,
    })
    const text =
      '# Heading\n\nHello **world** `PRIVATE_A` [label][r] and note[^n].\n\n' +
      'Hello **world** `PRIVATE_B` [label][r] and note[^n].\n\n' +
      '[r]: https://private.invalid/ "PRIVATE_TITLE"\n\n[^n]: Footnote $x$.\n'
    const options = { rawHtml: true, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
    const document = parseMarkdown(text)
    const source = new PackedSource(
      {
        generation: 1,
        documentId: 'owned-reading-lifetime',
        revision: 0,
        sourceHash: sourceHash(text),
        parserVersion: document.parserVersion,
        rendererVersion,
        options: JSON.stringify(options),
      },
      text,
    )
    persistent.push(new WeakRef(source))
    if (!keepOwner) persistent.push(new WeakRef(owner))
    let plan, capture, work, projection, cost, output, escapedRetain
    try {
      owner.commit(
        owner.prepareFull(
          owner.beginPrepared(source),
          source.identity,
          packValue({ root: document.root }, 8 * MiB),
        ),
      )
      capture = owner.capture()
      owner.evict()
      plan = finishPackedSteps(buildPackedTranslationPlan(capture, source, ['root'], limits))
      const before = owner.stats
      let entered = false
      work = plan.inspectProjection(
        (unit) => (unit.payload ? `Changed ${unit.payload.text}` : undefined),
        limits,
        function* (projected) {
          projection = projected
          yield* inspectPackedReading(
            capture,
            source,
            ['root'],
            options,
            {
              layout,
              blocks: readingBlocks(document.root, text),
              units: plan.units,
              translated: new Set(
                plan.units
                  .filter((_, index) => projected.status(index) === 'translated')
                  .map((unit) => `${unit.from}:${unit.to}`),
              ),
              sourceLanguage: 'en',
              targetLanguage: 'ar',
              labels: { original: 'Original', translation: 'Translation' },
              indexAboveBytes: 0,
            },
            limits,
            projected,
            function* (result, measured, retain) {
              assert.ok(result.html || result.indexed)
              cost = measured
              entered = true
              if (phase === 'owned') {
                output = retain()
                escapedRetain = retain
              }
              yield
              if (phase === 'throw') throw new Error('Reading inspector failed')
            },
          )
        },
      )
      if (phase === 'complete' || phase === 'owned') finishPackedSteps(work)
      else {
        let steps = 0
        while (phase === 'body' ? block.length === 0 : !entered) {
          assert.equal(work.next().done, false)
          assert.ok(++steps < 100000)
        }
        if (phase === 'dispose') owner.dispose()
        else if (phase === 'throw')
          assert.throws(() => finishPackedSteps(work), /Reading inspector failed/)
        else if (phase !== 'live') work.return()
      }
      assert.ok(block.length > 0 && context.length > 0 && state.length > 0)
      if (phase !== 'live' && phase !== 'owned') {
        if (phase !== 'dispose') assert.deepEqual(owner.stats, before)
        plan.release()
        capture.release()
        owner.dispose()
        assert.equal(owner.stats.retainedBytes, 0)
      }
      return {
        plan,
        projection,
        capture,
        work,
        handles,
        owner: keepOwner || phase === 'live' || phase === 'owned' ? owner : undefined,
        output,
        escapedRetain,
        block,
        context,
        state,
        rows,
        privateRows,
        persistent,
        report: {
          phase,
          layout,
          keepOwner,
          block: block.length,
          context: context.length,
          state: state.length,
          rows: rows.length,
          privateRows: privateRows.length,
          persistent: persistent.length,
          cost,
        },
      }
    } finally {
      observe = undefined
      PackedArena.open = open
    }
  }
  async function collect(check, message) {
    for (let attempt = 0; attempt < 40; attempt++) {
      await immediate()
      global.gc()
      await immediate()
      if (check()) return
    }
    throw new Error(message)
  }
  const escaped = ['complete', 'body', 'output', 'dispose', 'throw', 'live', 'owned'].flatMap(
    (phase) =>
      ['replace', 'side-by-side', 'interlinear'].flatMap((layout) =>
        [false, true].map((keepOwner) => probe(phase, layout, keepOwner)),
      ),
  )
  await collect(
    () => escaped.every((entry) => entry.block.every((ref) => !ref.deref())),
    'A closed frame/sequence or live output inspector retains body mdast/HAST',
  )
  await collect(
    () =>
      escaped
        .filter((entry) => entry.report.phase === 'owned')
        .every((entry) =>
          [...entry.context, ...entry.state, ...entry.privateRows].every((ref) => !ref.deref()),
        ),
    'Completed owned output or escaped retention callback keeps closed context/state/row machinery',
  )
  for (const entry of escaped.filter((entry) => ['live', 'owned'].includes(entry.report.phase))) {
    if (entry.output) {
      assert.ok(entry.output.value.indexed || entry.output.value.html)
      assert.throws(() => entry.escapedRetain(), /borrow closed/)
      if (entry.report.keepOwner) entry.output.release()
    }
    entry.plan.release()
    entry.capture.release()
    entry.owner.dispose()
    if (!entry.report.keepOwner) entry.owner = undefined
  }
  await collect(
    () =>
      escaped.every((entry) =>
        [
          ...entry.context,
          ...entry.state,
          ...entry.rows,
          ...entry.privateRows,
          ...entry.persistent,
        ].every((ref) => !ref.deref()),
      ),
    'Closed reading handles retain context/state/rows/source/arena/otherwise unreachable owner',
  )
  for (const entry of escaped) {
    assert.equal(entry.work.next().done, true)
    assert.throws(() => entry.projection.status(0), /closed/)
    assert.throws(() => entry.plan.units, /released/)
    if (entry.output) {
      assert.throws(() => entry.output.value, /released/)
      assert.throws(() => entry.escapedRetain(), /borrow closed/)
    }
  }
  const report = {
    date: new Date().toISOString(),
    bodyCollectedWhileOutputLive: true,
    allCollectedAfterRelease: true,
    probes: escaped.map((entry) => entry.report),
    method:
      'Development Node/Vite instrumentation observes actual copied body mdast/HAST, native definition context, public renderer states/maps/counters, row/slot state, sources and arenas. Completed, cancelled, disposed and throwing inspections retain closed sequence/frame/projection/plan/work/capture handles without advancing them. Body graphs must collect while complete output inspection remains live; all remaining watched graphs must collect after release, with both externally held and unreachable session owners. This proves reachability, not physical calibration, production integration or packaged latency.',
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/owned-reading-lifetime.json',
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(JSON.stringify(report, null, 2))
} finally {
  delete globalThis[key]
  await server.close()
}
