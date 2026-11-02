import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error(
    'Run with node --expose-gc test/benchmark/profiles/profile-snapshot-certificate-lifetime.mjs',
  )
const sha = (body) => createHash('sha256').update(body).digest('hex')
const root = `${resolve('.').replaceAll('\\', '/')}/`
const sources = new Map()
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  plugins: [
    {
      name: 'certificate-lifetime-source-binding',
      enforce: 'pre',
      transform(code, id) {
        const path = id.replaceAll('\\', '/')
        if (path.startsWith(root) && !path.includes('/node_modules/'))
          sources.set(path, { path: path.slice(root.length), sha256: sha(code) })
      },
    },
  ],
})
const escaped = []
try {
  const load = (path) => server.ssrLoadModule(path)
  const { packValue } = await load('/packages/core/src/packing.ts')
  const { PackedArena } = await load('/packages/core/src/packing-arena.ts')
  const { PackedRevision } = await load('/packages/core/src/packing-revision.ts')
  const { PackedSession } = await load('/packages/core/src/packing-session.ts')
  const { PackedSource } = await load('/packages/core/src/packing-source.ts')
  const { sourceHash } = await load('/packages/core/src/contracts.ts')
  const { finishPackedSteps } = await load('/packages/core/src/packing-work.ts')
  const { parseMarkdown } = await load('/packages/core/src/parse.ts')
  const { rendererVersion } = await load('/packages/renderer/src/index.ts')
  const { renderProjectionLayout } = await load('/packages/renderer/src/projection-layout.ts')
  const { PackedSnapshotCertificate } = await load(
    '/packages/renderer/src/packed-snapshot-certificate.ts',
  )
  let observe
  for (const [type, method] of [
    [PackedArena, 'open'],
    [PackedRevision, 'fullPrepared'],
  ]) {
    const original = type[method]
    type[method] = function (...args) {
      const value = original.apply(this, args)
      observe?.(method, value)
      return value
    }
  }
  const own = PackedSession.prototype.own
  PackedSession.prototype.own = function (value, bytes) {
    if (typeof value.matches === 'function') observe?.('certificate-data', value)
    return own.call(this, value, bytes)
  }
  const MiB = 1024 * 1024
  const limits = { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
  const options = { rawHtml: false, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
  const text = `# Heading\n\n${'Body [r][ref] and note[^n].\n\n'.repeat(100)}[ref]: /target\n\n[^n]: Footer.\n`
  let completeAdvances = 0
  function probe(mode, action, advance) {
    const refs = []
    observe = (kind, value) => refs.push({ kind, ref: new WeakRef(value) })
    const document = parseMarkdown(text)
    const { projection, layout } = renderProjectionLayout(document.root, options, limits.staging)
    const source = new PackedSource(
      {
        generation: 1,
        documentId: 'certificate-lifetime',
        revision: 0,
        sourceHash: sourceHash(text),
        parserVersion: document.parserVersion,
        rendererVersion,
        options: JSON.stringify(options),
      },
      text,
    )
    observe('source', source)
    const owner = new PackedSession({
      ...limits,
      retained: 64 * MiB,
      bytes: 8 * MiB,
      captures: 8,
      readers: 160,
    })
    const ticket = owner.prepareFull(
      owner.beginPrepared(source),
      source.identity,
      packValue({ document, projection, layout }, limits.staging),
    )
    const capture = owner.capturePrepared(ticket)
    observe('inspection', capture)
    const witness = capture.revisionWitness()
    const work =
      mode === 'parent'
        ? capture.work(
            (function* () {
              return yield* PackedSnapshotCertificate.createSteps(
                capture,
                source,
                [],
                options,
                limits,
              )
            })(),
          )
        : PackedSnapshotCertificate.create(capture, source, [], options, limits)
    let certificate, retained
    if (action === 'queued' || action === 'active' || advance !== undefined) {
      const steps = advance ?? (action === 'active' ? 20 : 0)
      for (let index = 0; index < steps; index++) assert.equal(work.next().done, false)
      if (action === 'capture') capture.release()
      else if (action === 'cancel-dispose') owner.dispose()
      else work.return()
      if (action !== 'cancel-dispose') {
        owner.discard(ticket)
        owner.invalidate()
      }
    } else {
      let advances = 0
      certificate = finishPackedSteps({
        next() {
          advances++
          return work.next()
        },
      })
      completeAdvances = advances
      assert.ok(certificate)
      retained = certificate.retain()
      certificate.close()
      if (action === 'discard') {
        owner.discard(ticket)
        owner.invalidate()
      } else {
        owner.commit(ticket)
        const committed = owner.capture()
        assert.equal(retained.validatesSnapshot(committed, source, [], options, limits), true)
        committed.release()
        if (action === 'dispose') owner.dispose()
        else owner.evict()
      }
    }
    observe = undefined
    assert.equal(owner.stats.readers, 0)
    return { mode, action, advance, refs, owner, witness, work, certificate, retained }
  }
  for (const mode of ['standalone', 'parent']) {
    completeAdvances = 0
    for (const action of ['queued', 'active', 'discard', 'evict', 'dispose'])
      escaped.push(probe(mode, action))
    assert.ok(completeAdvances > 20)
    for (const fraction of [0.25, 0.5, 0.9])
      for (const action of ['return', 'capture', 'cancel-dispose'])
        escaped.push(probe(mode, action, Math.floor(completeAdvances * fraction)))
  }
  async function collect() {
    for (let pass = 0; pass < 12; pass++) {
      await immediate()
      global.gc()
      await immediate()
    }
  }
  await collect()
  const probes = escaped.map(({ mode, action, advance, refs }) => {
    const graph = refs.filter(({ kind }) => kind !== 'certificate-data')
    assert.ok(graph.length >= 4)
    const survivors = graph.filter(({ ref }) => ref.deref()).length
    assert.equal(
      survivors,
      0,
      `${mode}/${action}: ${graph
        .filter(({ ref }) => ref.deref())
        .map(({ kind }) => kind)
        .join(', ')}`,
    )
    return {
      mode,
      action,
      advance,
      observedGraph: graph.map(({ kind }) => kind),
      graphSurvivors: survivors,
    }
  })
  for (const context of escaped) {
    context.retained?.close()
    context.owner.dispose()
    assert.equal(context.owner.stats.retainedBytes, 0)
  }
  await collect()
  for (const context of escaped)
    for (const { ref } of context.refs) assert.equal(ref.deref(), undefined)
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/snapshot-certificate-lifetime.json',
    `${JSON.stringify(
      {
        driverSha256: sha(await readFile(new URL(import.meta.url))),
        sources: [...sources.values()],
        method:
          'Exercise both standalone creation and creation delegated inside an already running capture-owned parent. Keep certificate handles, raw weak witnesses, closed creation tasks and sessions alive through GC. Observe actual prepared revisions, arenas, sources and inspection captures after queued/active cancellation, discard, eviction and session disposal. Also cancel by return, capture release and disposal at 25%, 50% and 90% of a complete validation, with held work unadvanced during GC. A valid prepared certificate survives commit before graph release. Certificate output metadata is collected after its final handle closes. This is lifetime evidence, not calibrated physical peak admission.',
        probes,
      },
      null,
      2,
    )}\n`,
  )
  console.log(JSON.stringify({ probes: probes.length, graphSurvivors: 0, finalSurvivors: 0 }))
} finally {
  await server.close()
}
