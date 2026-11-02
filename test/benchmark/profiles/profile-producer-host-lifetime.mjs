import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error(
    'Run with node --expose-gc test/benchmark/profiles/profile-producer-host-lifetime.mjs',
  )
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null, hmr: false },
})
const escaped = []
try {
  const load = (path) => server.ssrLoadModule(path)
  const { PackedSemanticProducer } = await load(
    '/apps/desktop/src/renderer/src/semantics/packed-producer.ts',
  )
  const { PackedProducerHost } = await load(
    '/apps/desktop/src/renderer/src/semantics/packed-producer-host.ts',
  )
  const { PackedReceiver } = await load('/packages/core/src/packing-receiver.ts')
  const { PackedSource } = await load('/packages/core/src/packing-source.ts')
  const { finishPackedSteps } = await load('/packages/core/src/packing-work.ts')
  const { parserVersion, sourceHash } = await load('/packages/core/src/contracts.ts')
  const { rendererVersion } = await load('/packages/renderer/src/index.ts')
  const { validatePackedSnapshot } = await load(
    '/packages/renderer/src/packing-validate-snapshot.ts',
  )
  let observe
  for (const method of ['prepare', 'cacheSteps']) {
    const original = PackedSemanticProducer.prototype[method]
    PackedSemanticProducer.prototype[method] = function (...args) {
      const work = original.apply(this, args)
      observe?.(work)
      return work
    }
  }
  const MiB = 1024 * 1024
  const options = { rawHtml: false, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
  const limits = { bytes: 8 * MiB, retained: 64 * MiB, staging: 8 * MiB, captures: 8, readers: 160 }
  function probe(phase, action) {
    const queue = [],
      messages = [],
      errors = [],
      refs = []
    let clock = 0,
      sequence = 0
    const port = {
      post: (value, transfer) => messages.push(structuredClone(value, { transfer })),
      failed: (error) => errors.push(error),
    }
    const host = new PackedProducerHost(port, {
      now: () => clock++,
      defer: (run) => queue.push(run),
    })
    const receiver = new PackedReceiver(limits, (capture, source) =>
      validatePackedSnapshot(capture, source, [], options, {
        ...limits,
        nodes: 800000,
        depth: 128,
      }),
    )
    function begin(text, revision = 0) {
      const source = new PackedSource(
        {
          generation: 1,
          documentId: 'host-lifetime',
          revision,
          sourceHash: sourceHash(text),
          parserVersion: `${parserVersion}/manuslip`,
          rendererVersion,
          options: JSON.stringify(options),
        },
        text,
      )
      const ticket = receiver.begin(++sequence, source)
      host.prepare(
        {
          kind: 'parse',
          sequence,
          generation: 1,
          documentId: 'host-lifetime',
          revision,
          source: text,
          options,
          sentAt: performance.timeOrigin + performance.now(),
        },
        ticket,
      )
      return ticket
    }
    const initial = `# Heading\n\n${'A [reference][r] and note[^n].\n\n'.repeat(200)}[r]: /target\n\n[^n]: Note.\n`
    if (phase === 'warmup') {
      const ticket = begin(initial)
      while (queue.length) queue.shift()()
      const offer = messages.pop()
      const accepted = finishPackedSteps(receiver.receiveSteps(ticket, offer.message))
      assert.equal(accepted.kind, 'accepted')
      host.acknowledge(accepted.acknowledgement)
      accepted.capture.release()
    }
    observe = (work) => refs.push(new WeakRef(work))
    if (phase === 'warmup') host.cache()
    else begin(initial)
    observe = undefined
    if (phase === 'running' || phase === 'warmup') {
      for (let index = 0; index < 20; index++) queue.shift()()
    } else if (phase === 'offered') while (queue.length) queue.shift()()
    assert.equal(refs.length, 1)
    if (action === 'dispose') {
      refs.push(new WeakRef(port))
      host.dispose()
      assert.equal(host.stats.retainedBytes, 0)
    } else if (action === 'cancel') host.cancel()
    else begin('# Replacement', 1)
    assert.equal(errors.length, 0)
    assert.equal(queue.length, phase === 'offered' ? 0 : 1)
    const current = host.stats.current
    if (phase === 'warmup' && action !== 'dispose') assert.equal(current.revision, 0)
    // Keep the actual deferred callback and live host unadvanced throughout collection.
    return {
      phase,
      action,
      refs,
      cleanup() {
        host.dispose()
        receiver.dispose()
        while (queue.length) queue.shift()()
        assert.equal(errors.length, 0)
        assert.equal(host.stats.retainedBytes, 0)
      },
    }
  }
  for (const phase of ['queued', 'running', 'warmup'])
    for (const action of ['cancel', 'dispose', 'supersede']) escaped.push(probe(phase, action))
  for (const action of ['cancel', 'dispose']) escaped.push(probe('offered', action))
  for (let attempt = 0; attempt < 8; attempt++) {
    await immediate()
    global.gc()
  }
  let survivors = 0
  const probes = escaped.map(({ phase, action, refs }) => {
    const alive = refs.filter((ref) => ref.deref() !== undefined).length
    survivors += alive
    return { phase, action, observed: refs.length, survivors: alive }
  })
  const report = {
    method:
      'WeakRefs of actual producer work handles and disposed port objects. Keep live hosts and actual deferred callbacks unadvanced through forced GC after cancellation, disposal or supersession. This establishes obsolete scheduling ownership release, not physical peak or native metadata admission.',
    survivors,
    probes,
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/producer-host-lifetime.json',
    `${JSON.stringify(report, null, 2)}\n`,
  )
  assert.equal(survivors, 0)
  console.log(JSON.stringify({ probes: probes.length, survivors }))
} finally {
  for (const item of escaped) item.cleanup()
  await server.close()
}
