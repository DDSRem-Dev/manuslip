import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error(
    'Run with node --expose-gc test/benchmark/profiles/profile-semantic-port-lifetime.mjs',
  )
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
})
const escaped = []
try {
  const load = (path) => server.ssrLoadModule(path)
  const { PackedSemanticPort } = await load(
    '/apps/desktop/src/renderer/src/semantics/packed-port.ts',
  )
  const { PackedSemanticReceiver } = await load(
    '/apps/desktop/src/renderer/src/semantics/packed-receiver.ts',
  )
  const { PackedWorkerEndpoint } = await load(
    '/apps/desktop/src/renderer/src/semantics/packed-worker-endpoint.ts',
  )
  const { PackedProjectionBaseline } = await load(
    '/packages/renderer/src/packed-projection-baseline.ts',
  )
  let observe
  const projection = PackedProjectionBaseline.create
  PackedProjectionBaseline.create = function (...args) {
    const work = projection.apply(this, args)
    observe?.('projection-work', work)
    return work
  }
  for (const method of ['receiveSteps', 'cacheSteps']) {
    const original = PackedSemanticReceiver.prototype[method]
    PackedSemanticReceiver.prototype[method] = function (...args) {
      const work = original.apply(this, args)
      observe?.('work', work)
      return work
    }
  }
  const MiB = 1024 * 1024
  const limits = { bytes: 8 * MiB, retained: 64 * MiB, staging: 8 * MiB, captures: 8, readers: 160 }
  const options = { rawHtml: false, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
  function probe(phase, action) {
    const producerQueue = [],
      rendererQueue = [],
      refs = [],
      revisions = []
    let clock = 0,
      listener,
      failure,
      consumer,
      failures = 0,
      terminated = false
    const receiver = new PackedSemanticReceiver(limits, {
      retained: 32 * MiB,
      staging: 8 * MiB,
      nodes: 800000,
      depth: 128,
    })
    const endpoint = new PackedWorkerEndpoint(
      {
        post(message, transfer) {
          const copy = structuredClone(message, { transfer })
          if (copy.payload) observe?.('wire', copy.payload)
          listener(copy)
        },
      },
      { now: () => (clock += 0.6), defer: (run) => producerQueue.push(run) },
    )
    const port = new PackedSemanticPort(
      {
        onMessage: (run) => {
          listener = run
        },
        onFailure: (run) => {
          failure = run
        },
        post(value) {
          if (!terminated) endpoint.receive(structuredClone(value))
        },
        terminate() {
          terminated = true
          endpoint.dispose()
        },
      },
      receiver,
      {
        now: () => (clock += 0.6),
        defer: (run) => rendererQueue.push(run),
        deferBackground: (run) => rendererQueue.push(run),
      },
    )
    port.onFailure(() => failures++)
    port.onResult((result) => {
      assert.equal(result.kind, 'packed-result')
      revisions.push(result.revision)
      consumer ??= result.capture.retain()
    })
    const source = `# Heading\n\n${'A [reference][r] and note[^n].\n\n'.repeat(200)}[r]: /target\n\n[^n]: Note.\n`
    function begin(revision) {
      port.post({
        kind: 'parse',
        sequence: revision + 1,
        generation: 1,
        documentId: 'port-lifetime',
        revision,
        source: revision ? source.replace('Heading', 'Replacement') : source,
        options,
        sentAt: performance.timeOrigin + performance.now(),
      })
    }
    function drain() {
      let count = 0
      while (producerQueue.length || rendererQueue.length) {
        if (++count > 200000) throw new Error('Transport lifetime probe did not settle')
        producerQueue.shift()?.()
        rendererQueue.shift()?.()
      }
    }
    if (phase.startsWith('cache')) {
      begin(0)
      drain()
      assert.deepEqual(revisions, [0])
    }
    observe = (kind, value) => refs.push({ kind, ref: new WeakRef(value) })
    if (phase.startsWith('cache')) port.warm()
    else {
      begin(0)
      while (producerQueue.length) producerQueue.shift()()
    }
    if (phase === 'cache-and-receipt-queued') {
      begin(1)
      while (producerQueue.length) producerQueue.shift()()
      assert.ok(rendererQueue.length >= 2, 'Both priority callbacks must remain queued')
    }
    if (phase === 'cache-projection-active') {
      let advances = 0
      while (receiver.stats.cachePhase !== 'projection') {
        assert.ok(rendererQueue.length && ++advances <= 200000)
        rendererQueue.shift()()
      }
      assert.equal(refs.filter(({ kind }) => kind === 'projection-work').length, 1)
    }
    if (phase.endsWith('active')) rendererQueue.shift()()
    observe = undefined
    assert.ok(rendererQueue.length > 0, `${phase} must leave a real callback pending`)
    assert.equal(
      refs.filter(({ kind }) => kind === 'work').length,
      phase === 'cache-and-receipt-queued' ? 2 : 1,
    )
    if (!phase.startsWith('cache')) assert.deepEqual(revisions, [])
    const callbacks = [...rendererQueue]
    if (action === 'failure') failure()
    else if (action === 'terminate') port.terminate()
    else if (action === 'cancel') port.cancel()
    else begin(phase === 'cache-and-receipt-queued' ? 2 : 1)
    assert.equal(failures, action === 'failure' ? 1 : 0)
    if (consumer) assert.equal(consumer.identity.revision, 0)
    return {
      phase,
      action,
      refs,
      callbacks,
      port,
      receiver,
      endpoint,
      finish() {
        drain()
        assert.equal(failures, action === 'failure' ? 1 : 0)
        assert.deepEqual(
          revisions,
          phase.startsWith('cache')
            ? action === 'supersede'
              ? [0, phase === 'cache-and-receipt-queued' ? 2 : 1]
              : [0]
            : action === 'supersede'
              ? [1]
              : [],
        )
        if (consumer) assert.equal(consumer.identity.revision, phase.startsWith('cache') ? 0 : 1)
        port.terminate()
        consumer?.release()
        receiver.dispose()
        assert.equal(receiver.stats.retainedBytes, 0)
        assert.equal(endpoint.stats.retainedBytes, 0)
      },
    }
  }
  for (const phase of [
    'receipt-queued',
    'receipt-active',
    'cache-queued',
    'cache-active',
    'cache-projection-active',
    'cache-and-receipt-queued',
  ])
    for (const action of ['cancel', 'supersede', 'terminate', 'failure'])
      escaped.push(probe(phase, action))
  // Keep original ports, receivers and obsolete scheduler callbacks alive and unadvanced.
  for (let pass = 0; pass < 12; pass++) {
    await immediate()
    global.gc()
    await immediate()
  }
  const probes = escaped.map(({ phase, action, refs }) => ({
    phase,
    action,
    observed: refs.map(({ kind }) => kind),
    survivors: refs.filter(({ ref }) => ref.deref()).length,
  }))
  assert.equal(
    probes.reduce((sum, probe) => sum + probe.survivors, 0),
    0,
  )
  for (const context of escaped) context.finish()
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/semantic-port-lifetime.json',
    `${JSON.stringify(
      {
        method:
          'Actual endpoint/port cooperative receipt and background-priority idle cache work with separate revocable callback slots; closed work and transferred wire buffers observed through WeakRef while original receivers, ports and pending callbacks remain alive and unadvanced. Independent accepted consumers remain valid across termination. Local ownership/lifetime evidence only; no physical peak admission claim.',
        probes,
      },
      null,
      2,
    )}\n`,
  )
  console.log(JSON.stringify({ probes: probes.length, survivors: 0 }))
} finally {
  await server.close()
}
