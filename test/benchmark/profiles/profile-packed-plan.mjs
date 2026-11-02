import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error('Run with node --expose-gc test/benchmark/profiles/profile-packed-plan.mjs')
const MiB = 1024 * 1024
const limits = {
  retained: 24 * MiB,
  metadata: 8 * MiB,
  staging: 8 * MiB,
  nodes: 800000,
  depth: 128,
}
const key = Symbol.for('manuslip-packed-plan-lifetime')
let observe
globalThis[key] = (phase, value) => observe?.(phase, value)
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
  plugins: [
    {
      name: 'observe-packed-plan-lifetime',
      enforce: 'pre',
      transform(code, id) {
        const path = id.replaceAll('\\', '/')
        const watch = (marker, phase, value) => {
          assert.ok(code.includes(marker), `Missing packed plan marker ${path}: ${marker}`)
          return code.replace(
            marker,
            `${marker}; globalThis[Symbol.for('manuslip-packed-plan-lifetime')]?.('${phase}', ${value});`,
          )
        }
        if (path.endsWith('/translate/src/packed-plan.ts'))
          return watch('const cost = memory.cost', 'metadata', '[units, memory]')
        if (path.endsWith('/translate/src/extract-unit.ts'))
          return watch('this.#count++', 'native', 'unit')
        if (path.endsWith('/translate/src/packed-projection.ts'))
          return watch('this.#data = data', 'metadata', 'data')
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
  const watch = (value, refs, seen, privateOnly = false) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    refs.push(new WeakRef(value))
    for (const [field, child] of Object.entries(value)) {
      // Canonical provider payloads/tokens intentionally survive in the persistent plan.
      if (privateOnly && (field === 'payload' || field === 'token')) continue
      watch(child, refs, seen, privateOnly)
    }
  }
  function probe(phase, keepOwner) {
    const native = [],
      metadata = [],
      persistent = [],
      seen = new WeakSet()
    observe = (kind, value) =>
      watch(value, kind === 'native' ? native : metadata, seen, kind === 'native')
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
      '# Hello\n\nProse **strong** `PRIVATE_A` [label](https://a.invalid/).\n\nProse **strong** `PRIVATE_B` [label](https://b.invalid/).\n'
    const document = parseMarkdown(text)
    const source = new PackedSource(
      {
        generation: 1,
        documentId: 'plan-lifetime',
        revision: 0,
        sourceHash: sourceHash(text),
        parserVersion: document.parserVersion,
        rendererVersion: 'test',
        options: 'test',
      },
      text,
    )
    persistent.push(new WeakRef(source))
    if (!keepOwner) persistent.push(new WeakRef(owner))
    let capture, plan, work, projection
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
      const before = owner.stats
      work = buildPackedTranslationPlan(
        capture,
        source,
        ['root'],
        phase === 'limit' ? { ...limits, metadata: 4096 } : limits,
      )
      if (phase === 'limit') {
        assert.throws(() => finishPackedSteps(work), /limit/)
        assert.deepEqual(owner.stats, before)
      } else if (phase === 'queued' || phase === 'building') {
        if (phase === 'building') {
          let steps = 0
          while (native.length === 0) {
            assert.equal(work.next().done, false)
            assert.ok(++steps < 100000)
          }
        }
        work.return()
        assert.deepEqual(owner.stats, before)
      } else {
        plan = finishPackedSteps(work)
        assert.ok(plan)
        assert.equal(plan.units.length, 3)
        assert.equal(plan.units[1].payload, plan.units[2].payload)
        watch(plan.units, metadata, seen)
        capture.release()
        const retained = owner.stats
        let entered = false
        const rejectCleanup = () => {
          throw new Error('Plan inspector cleanup failed')
        }
        const renderUnit = (projected) => {
          const node = structuredClone(document.root.children[1])
          const children = projected.children(node, 32768)
          assert.ok(children?.length)
          watch(children, native, seen, true)
          projected.reset()
        }
        work = phase.startsWith('projection-')
          ? plan.inspectProjection(
              (unit) => unit.payload?.text,
              limits,
              function* (projected) {
                projection = projected
                renderUnit(projected)
                entered = true
                yield
              },
            )
          : plan.inspectUnits(function* (unit) {
              try {
                watch(unit, native, seen, true)
                entered = true
                yield
              } finally {
                if (phase === 'cleanup-failure') rejectCleanup()
              }
            })
        if (
          phase === 'suspended' ||
          phase === 'dispose' ||
          phase === 'cleanup-failure' ||
          ['projection-cancel', 'projection-dispose', 'projection-live'].includes(phase)
        ) {
          while (!entered) assert.equal(work.next().done, false)
        } else {
          finishPackedSteps(work)
          assert.deepEqual(owner.stats, retained)
        }
        if (phase === 'suspended') plan.release()
        else if (phase === 'projection-cancel') work.return()
        else if (phase === 'projection-dispose') owner.dispose()
        else if (phase === 'cleanup-failure')
          assert.throws(() => plan.release(), /Plan inspector cleanup failed/)
        else if (phase === 'dispose') owner.dispose()
        // phase live keeps the plan, source/arena and metadata alive through the first GC.
      }
      if (phase !== 'live' && phase !== 'projection-live') {
        plan?.release()
        capture.release()
        owner.dispose()
        assert.equal(owner.stats.retainedBytes, 0)
      }
      return {
        plan,
        projection,
        work,
        capture,
        owner: keepOwner || phase === 'live' || phase === 'projection-live' ? owner : undefined,
        native,
        metadata,
        persistent,
        report: {
          phase,
          keepOwner,
          native: native.length,
          metadata: metadata.length,
          persistent: persistent.length,
          cost: phase === 'live' ? plan.cost : undefined,
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
  const escaped = [
    'queued',
    'building',
    'limit',
    'suspended',
    'dispose',
    'cleanup-failure',
    'complete',
    'live',
    'projection-complete',
    'projection-cancel',
    'projection-dispose',
    'projection-live',
  ].flatMap((phase) => [false, true].map((keep) => probe(phase, keep)))
  await collect(
    () => escaped.every((entry) => entry.native.every((ref) => !ref.deref())),
    'A live packed plan or closed handles retain native units/private bindings',
  )
  const live = escaped.filter((entry) => ['live', 'projection-live'].includes(entry.report.phase))
  for (const entry of live) {
    assert.equal(entry.plan.units.length, 3)
    assert.ok(
      entry.metadata.some((ref) => ref.deref()),
      'Live plan metadata disappeared',
    )
    entry.plan.release()
    entry.owner.dispose()
    if (!entry.report.keepOwner) entry.owner = undefined
  }
  await collect(
    () =>
      escaped.every((entry) =>
        [...entry.metadata, ...entry.persistent].every((ref) => !ref.deref()),
      ),
    'Closed plan handles retain metadata/source/arena/owners',
  )
  for (const entry of escaped) {
    assert.equal(entry.work.next().done, true)
    if (entry.plan) assert.throws(() => entry.plan.units, /released/)
    if (entry.projection) assert.throws(() => entry.projection.status(0), /closed/)
  }
  const report = {
    date: new Date().toISOString(),
    nativeCollectedWhilePlansLive: true,
    allCollectedAfterRelease: true,
    probes: escaped.map((entry) => entry.report),
    method:
      'Development Node/Vite instrumentation watches actual unit/private-binding graphs, projection state, payload/occurrence metadata, extraction memory, source resources and arenas. Native units/reconstructed children must collect while complete plans and borrowed projections remain live and readable; after release, every watched metadata/source/arena/otherwise unreachable owner must collect with closed plan/projection/work/capture handles held and unadvanced. Covers queued/build cancellation, metadata rejection, complete/suspended inspection, throwing inspector cleanup, projection completion/cancellation and session disposal, with live and unreachable external session owners. This proves reachability, not physical memory calibration, worker integration or packaged latency.',
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/packed-plan-lifetime.json',
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(JSON.stringify(report, null, 2))
} finally {
  delete globalThis[key]
  await server.close()
}
