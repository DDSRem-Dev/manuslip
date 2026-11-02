import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error(
    'Run with node --expose-gc test/benchmark/profiles/profile-preview-candidate-lifetime.mjs',
  )
const hook = Symbol.for('manuslip-preview-candidate-lifetime')
let observe
globalThis[hook] = (kind, value) => observe?.(kind, value)
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  plugins: [
    {
      name: 'observe-preview-candidate-lifetime',
      enforce: 'pre',
      transform(code, id) {
        const path = id.replaceAll('\\', '/')
        const after = (marker, kind, value) => {
          assert.ok(code.includes(marker), `Missing candidate lifetime marker: ${path}: ${marker}`)
          return code.replace(
            marker,
            `${marker}; globalThis[Symbol.for('manuslip-preview-candidate-lifetime')]?.('${kind}', ${value});`,
          )
        }
        if (path.endsWith('/editor/src/occurrences.ts')) {
          code = after('fork.ranges = this.ranges', 'old-ranges', 'fork.ranges')
          code = after(
            'const candidates = new Map<string, Occurrence | null>()',
            'candidate-map',
            'candidates',
          )
        } else if (path.endsWith('/preview/packed-preparation.ts')) {
          code = after('if (retainRoot) root = capture.retain()', 'handoff', 'undefined')
        } else return
        return { code, map: null }
      },
    },
  ],
})
const escaped = []
try {
  const load = (path) => server.ssrLoadModule(path)
  const { sourceHash } = await load('/packages/core/src/contracts.ts')
  const { packValue } = await load('/packages/core/src/packing.ts')
  const { PackedSession } = await load('/packages/core/src/packing-session.ts')
  const { PackedSource } = await load('/packages/core/src/packing-source.ts')
  const { finishPackedSteps } = await load('/packages/core/src/packing-work.ts')
  const { parseMarkdown } = await load('/packages/core/src/parse.ts')
  const { createSourceState, Text } = await load('/packages/editor/src/index.ts')
  const { rendererVersion } = await load('/packages/renderer/src/index.ts')
  const { renderProjectionLayout } = await load('/packages/renderer/src/projection-layout.ts')
  const { OwnedPackedPreview } = await load(
    '/apps/desktop/src/renderer/src/preview/packed-preparation.ts',
  )
  const own = PackedSession.prototype.own
  PackedSession.prototype.own = function (value, bytes) {
    if (Object.keys(value).length === 1 && typeof value.bytes === 'number')
      observe?.('reservation', value)
    return own.call(this, value, bytes)
  }
  const MiB = 1024 * 1024
  const limits = { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
  const options = { rawHtml: false, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
  const oldText = `# Heading\n\n${'~~~js\nlet x = 1\n~~~\n\n'.repeat(200)}${'Body words 中文. '.repeat(2048)}`
  const newText = oldText.replace('Heading', 'Updated heading')
  function probe(action) {
    const refs = [],
      seen = new Set()
    const owner = new PackedSession({
      ...limits,
      retained: 64 * MiB,
      bytes: 8 * MiB,
      captures: 8,
      readers: 160,
    })
    function install(text, revision) {
      const document = parseMarkdown(text)
      const { projection, layout } = renderProjectionLayout(document.root, options, limits.staging)
      const source = new PackedSource(
        {
          generation: 1,
          documentId: 'candidate-lifetime',
          revision,
          sourceHash: sourceHash(text),
          parserVersion: document.parserVersion,
          rendererVersion,
          options: JSON.stringify(options),
        },
        text,
      )
      owner.commit(
        owner.prepareFull(
          owner.beginPrepared(source),
          source.identity,
          packValue({ document, projection, layout }, limits.staging),
        ),
      )
      return { source, capture: owner.capture(), doc: Text.of(text.split('\n')) }
    }
    const first = install(oldText, 0)
    const previous = finishPackedSteps(
      OwnedPackedPreview.prepare(first.capture, first.source, first.doc, [], options, limits),
    )
    assert.ok(previous)
    assert.equal(previous.commit(), true)
    const oldConsumer = action === 'old-consumer' ? previous.retain() : undefined
    first.capture.release()
    const current = install(newText, 1)
    refs.push({ kind: 'old-text', ref: new WeakRef(first.doc) })
    observe = (kind, value) => {
      seen.add(kind)
      if (value) refs.push({ kind, ref: new WeakRef(value) })
    }
    const work = OwnedPackedPreview.prepare(
      current.capture,
      current.source,
      current.doc,
      [],
      options,
      limits,
      previous,
    )
    let candidate, lease
    if (action.startsWith('cancel-')) {
      const target = action === 'cancel-preparing' ? 'candidate-map' : 'handoff'
      while (!seen.has(target)) assert.equal(work.next().done, false)
      work.return()
    } else {
      candidate = finishPackedSteps(work)
      assert.ok(candidate)
      lease = candidate.retain()
      if (action === 'reject') {
        previous.map(createSourceState(oldText).update({}).changes)
        assert.equal(candidate.commit(), false)
      } else if (action === 'commit' || action === 'old-consumer') {
        const before = candidate.cost
        assert.equal(candidate.commit(), true)
        assert.equal(before - candidate.cost, first.doc.length * 2 + 200 * 1024)
      }
      if (action !== 'commit' && action !== 'old-consumer') candidate.release()
    }
    observe = undefined
    previous.release()
    current.capture.release()
    owner.evict()
    if (action === 'dispose') owner.dispose()
    assert.equal(owner.stats.readers, 0)
    const needsOld = action === 'abandon' || action === 'reject' || action === 'old-consumer'
    const needsReservation = action === 'abandon' || action === 'reject'
    return {
      action,
      refs,
      owner,
      previous,
      work,
      candidate,
      lease,
      oldConsumer,
      callback: () => work.next(),
      needsOld,
      needsReservation,
      retainedBytes: owner.stats.retainedBytes,
    }
  }
  for (const action of [
    'commit',
    'abandon',
    'reject',
    'old-consumer',
    'dispose',
    'cancel-preparing',
    'cancel-handoff',
  ])
    escaped.push(probe(action))
  async function collect() {
    for (let pass = 0; pass < 12; pass++) {
      await immediate()
      global.gc()
      await immediate()
    }
  }
  await collect()
  const probes = escaped.map((context) => {
    const observed = context.refs.map(({ kind, ref }) => ({ kind, alive: !!ref.deref() }))
    assert.ok(observed.some(({ kind }) => kind === 'old-ranges'))
    assert.ok(observed.some(({ kind }) => kind === 'reservation'))
    for (const { kind, alive } of observed) {
      const expected =
        kind === 'old-text' || kind === 'old-ranges'
          ? context.needsOld
          : kind === 'reservation'
            ? context.needsReservation
            : false
      assert.equal(alive, expected, `${context.action}: ${kind}`)
    }
    if (context.lease && context.action !== 'dispose')
      assert.equal(context.lease.model.blocks.length, 200)
    if (context.oldConsumer) assert.equal(context.oldConsumer.status.outline[0].text, 'Heading')
    return { action: context.action, retainedBytes: context.retainedBytes, observed }
  })
  for (const context of escaped) {
    context.oldConsumer?.release()
    context.lease?.release()
    context.candidate?.release()
    context.owner.dispose()
    assert.equal(context.callback().done, true)
    assert.equal(context.owner.stats.retainedBytes, 0)
  }
  await collect()
  for (const context of escaped)
    for (const { kind, ref } of context.refs)
      assert.equal(ref.deref(), undefined, `${context.action}: ${kind}`)
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/preview-candidate-lifetime.json',
    `${JSON.stringify(
      {
        method:
          'Observe actual occurrence ranges, editor Text, candidate maps and admitted old-range reservation data. Keep closed preparation work, callbacks, sessions and controller handles alive through collection. Committed candidates must release old ranges; abandoned/rejected candidate leases and independent old consumers must retain their separately admitted ranges until close. Final release collects every observed object. This is ownership/lifetime evidence, not calibrated physical peak admission.',
        probes,
        finalSurvivors: 0,
      },
      null,
      2,
    )}\n`,
  )
  console.log(JSON.stringify({ probes: probes.length, finalSurvivors: 0 }))
} finally {
  delete globalThis[hook]
  await server.close()
}
