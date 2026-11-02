import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error(
    'Run with node --expose-gc test/benchmark/profiles/profile-producer-fragment-lifetime.mjs',
  )
const key = Symbol.for('manuslip-producer-fragment-lifetime')
let observe
globalThis[key] = (...values) => observe?.(...values)
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null, hmr: false },
  plugins: [
    {
      name: 'observe-actual-producer-native-patches',
      enforce: 'pre',
      transform(code, id) {
        if (!id.replaceAll('\\', '/').endsWith('/semantics/packed-producer-fragment.ts')) return
        for (const [marker, value] of [
          ["if (fragment.kind === 'full') return undefined", 'fragment'],
          ['holds.push(owner.retain(metadata))', 'metadata'],
          ['holds.push(owner.retain(projected))', 'projected'],
        ]) {
          assert.ok(code.includes(marker), `Missing observation marker: ${marker}`)
          code = code.replace(
            marker,
            `${marker}; globalThis[Symbol.for('manuslip-producer-fragment-lifetime')]?.(${value})`,
          )
        }
        return code
      },
    },
  ],
})
const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 8, readers: 64 }
const validation = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const options = { rawHtml: false, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
const escaped = []
try {
  const load = (path) => server.ssrLoadModule(path)
  const { PackedSemanticProducer } = await load(
    '/apps/desktop/src/renderer/src/semantics/packed-producer.ts',
  )
  const { PackedReceiver } = await load('/packages/core/src/packing-receiver.ts')
  const { PackedSource } = await load('/packages/core/src/packing-source.ts')
  const { parserVersion, sourceHash } = await load('/packages/core/src/contracts.ts')
  const { rendererVersion } = await load('/packages/renderer/src/index.ts')
  const { validatePackedSnapshot } = await load(
    '/packages/renderer/src/packing-validate-snapshot.ts',
  )
  const { finishPackedSteps } = await load('/packages/core/src/packing-work.ts')
  function probe(phase, action) {
    const producer = new PackedSemanticProducer(limits)
    const receiver = new PackedReceiver(limits, (capture, source) =>
      validatePackedSnapshot(capture, source, [], options, validation),
    )
    const begin = (text, revision) => {
      const identity = {
        generation: 1,
        documentId: 'fragment-lifetime',
        revision,
        sourceHash: sourceHash(text),
        parserVersion: `${parserVersion}/manuslip`,
        rendererVersion,
        options: JSON.stringify(options),
      }
      const ticket = receiver.begin(1, new PackedSource(identity, text))
      const input = {
        kind: 'parse',
        sequence: 1,
        generation: 1,
        documentId: identity.documentId,
        revision,
        source: text,
        options,
        sentAt: performance.timeOrigin + performance.now(),
      }
      return { ticket, work: producer.prepare(input, ticket) }
    }
    const accept = (ticket, message) => {
      const received = finishPackedSteps(
        receiver.receiveSteps(ticket, structuredClone(message, { transfer: [message.payload] })),
      )
      assert.equal(received.kind, 'accepted')
      producer.acknowledge(received.acknowledgement)
      received.capture.release()
    }
    const initial = `# Heading\n\n${'A **paragraph** [reference][r].\n\n'.repeat(30)}call[^n]\n\n[^n]: A note.\n\n[r]: /target\n`
    const first = begin(initial, 0)
    accept(first.ticket, finishPackedSteps(first.work))
    const old = producer.capture()
    const baseline = producer.stats.retainedBytes
    const refs = []
    const seen = new WeakSet()
    const watch = (value) => {
      if (!value || typeof value !== 'object' || seen.has(value)) return
      // Source resources and revision identities intentionally remain live in old/current
      // packed captures. Observe the native patch containers/trees, not those owners.
      if (value instanceof PackedSource || ('sourceHash' in value && 'documentId' in value)) return
      seen.add(value)
      refs.push(new WeakRef(value))
      if (value instanceof Map) for (const item of value.values()) watch(item)
      else for (const item of Object.values(value)) watch(item)
    }
    observe = watch
    const started = begin(initial.replace('Heading', 'Heading extended'), 1)
    let message,
      reached = false,
      steps = 0
    try {
      while (++steps < 100000) {
        const step = started.work.next()
        if (step.done) {
          message = step.value
          reached = phase === 'offered'
          break
        }
        if (producer.stats.phase === phase) {
          reached = true
          break
        }
      }
      assert.ok(reached, `Did not reach ${phase}`)
      assert.ok(refs.length > 0, 'No actual native fragment graph observed')
      if (action === 'ack') {
        assert.equal(message.kind, 'delta')
        accept(started.ticket, message)
        assert.equal(producer.stats.current.revision, 1)
      } else if (action === 'dispose') producer.dispose()
      else producer.cancel()
      if (action === 'cancel') assert.equal(producer.stats.retainedBytes, baseline)
      assert.equal(producer.stats.readers, 0)
      assert.equal(producer.stats.readerStagingBytes, 0)
      assert.equal(producer.stats.prepared, null)
      assert.equal(producer.stats.requested, null)
      return {
        producer,
        receiver,
        old,
        work: started.work,
        message,
        refs,
        report: { phase, action, steps, objects: refs.length },
      }
    } finally {
      observe = undefined
    }
  }
  for (const phase of ['fragment', 'metadata', 'projection', 'encode', 'prepare', 'offered'])
    for (const action of ['cancel', 'dispose']) escaped.push(probe(phase, action))
  escaped.push(probe('offered', 'ack'))
  let survivors = Infinity
  for (let attempt = 0; attempt < 30; attempt++) {
    await immediate()
    global.gc()
    await immediate()
    survivors = escaped.reduce(
      (sum, entry) => sum + entry.refs.filter((ref) => ref.deref()).length,
      0,
    )
    if (!survivors) break
  }
  assert.equal(survivors, 0, 'Closed or acknowledged producer work retained native patches')
  for (const entry of escaped) {
    // Keep closed handles unadvanced through collection; close itself must drop graphs.
    assert.equal(entry.work.next().done, true)
    if (entry.report.action !== 'dispose') {
      assert.equal(entry.old.identity.revision, 0)
      entry.old.release()
    }
    entry.producer.dispose()
    entry.receiver.dispose()
    assert.equal(entry.producer.stats.retainedBytes, 0)
    assert.equal(entry.receiver.stats.retainedBytes, 0)
  }
  const report = {
    method:
      'WeakRef observation of actual fragment children, positions, metadata arrays and projection patch fields in the application producer. Retain closed scheduler/message/capture/owner handles unadvanced through forced GC. Cancel or dispose during six phases; acknowledge an actual transferred delta while preserving a live producer and old packed capture. Dependency cache/session/binary graphs may remain live by design. This tests native patch graph lifetime, not physical peak or aggregate memory admission.',
    survivors,
    probes: escaped.map((entry) => entry.report),
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/producer-fragment-lifetime.json',
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(JSON.stringify(report))
} finally {
  observe = undefined
  delete globalThis[key]
  for (const entry of escaped) {
    entry.producer.dispose()
    entry.receiver.dispose()
  }
  await server.close()
}
