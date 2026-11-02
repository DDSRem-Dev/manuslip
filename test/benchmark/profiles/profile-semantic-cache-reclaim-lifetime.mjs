import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error(
    'Run with node --expose-gc test/benchmark/profiles/profile-semantic-cache-reclaim-lifetime.mjs',
  )
const hook = Symbol.for('manuslip-semantic-cache-reclaim')
let observe
globalThis[hook] = (...args) => observe?.(...args)
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  plugins: [
    {
      name: 'observe-reclaimed-word-cache',
      enforce: 'pre',
      transform(code, id) {
        if (!id.replaceAll('\\', '/').endsWith('/core/src/packing-word-baseline.ts')) return
        const marker = 'baseline.#lifetime = capture.work(lifetime(baseline, hold))'
        assert.ok(code.includes(marker))
        return {
          code: code.replace(
            marker,
            `${marker}; globalThis[Symbol.for('manuslip-semantic-cache-reclaim')]?.(baseline, records, metadata, cachedChunks);`,
          ),
          map: null,
        }
      },
    },
  ],
})
const escaped = []
try {
  const load = (path) => server.ssrLoadModule(path)
  const { sourceHash } = await load('/packages/core/src/contracts.ts')
  const { PackedSource } = await load('/packages/core/src/packing-source.ts')
  const { finishPackedSteps } = await load('/packages/core/src/packing-work.ts')
  const { PackedSemanticProducer } = await load(
    '/apps/desktop/src/renderer/src/semantics/packed-producer.ts',
  )
  const { PackedSemanticReceiver } = await load(
    '/apps/desktop/src/renderer/src/semantics/packed-receiver.ts',
  )
  const MiB = 1024 * 1024
  const session = {
    bytes: 8 * MiB,
    retained: 64 * MiB,
    staging: 8 * MiB,
    captures: 8,
    readers: 160,
  }
  const limits = { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
  const options = { rawHtml: false, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
  const text = `# Heading\n\n${`Paragraph ${'word '.repeat(500)}\n\n`.repeat(100)}`
  function probe(action) {
    const receiver = new PackedSemanticReceiver(session, limits)
    const producer = new PackedSemanticProducer({ ...session, retained: 16 * MiB })
    function offer(sourceText, revision, identity) {
      const input = {
        kind: 'parse',
        sequence: revision + 1,
        generation: 1,
        documentId: 'cache-reclaim',
        revision,
        source: sourceText,
        options,
        sentAt: performance.timeOrigin + performance.now(),
      }
      const source = new PackedSource(
        { ...identity, revision, sourceHash: sourceHash(sourceText) },
        sourceText,
      )
      const ticket = receiver.begin(input.sequence, source, options)
      const message = finishPackedSteps(producer.prepare(input, structuredClone(ticket)))
      assert.ok(message)
      return { ticket, message }
    }
    // The versions are imported from the same runtime modules used by real requests.
    const first = offer(text, 0, versions)
    const accepted = finishPackedSteps(receiver.receiveSteps(first.ticket, first.message))
    assert.equal(accepted?.kind, 'accepted')
    producer.acknowledge(accepted.acknowledgement)
    accepted.capture.release()
    const consumer = receiver.capture()
    const refs = []
    let baseline
    observe = (value, records, metadata, chunks) => {
      baseline = value
      refs.push({ kind: 'records', ref: new WeakRef(records) })
      const table = records.values().next().value
      refs.push({ kind: 'table', ref: new WeakRef(table) })
      refs.push({ kind: 'metadata', ref: new WeakRef(metadata) })
      refs.push({ kind: 'metadata-buffer', ref: new WeakRef(metadata.buffer) })
      refs.push({ kind: 'chunk-table', ref: new WeakRef(chunks) })
    }
    assert.deepEqual(finishPackedSteps(receiver.cacheSteps()), {
      document: true,
      projection: true,
      words: true,
    })
    observe = undefined
    const next = offer(text.replace('Heading', 'Heading extended'), 1, versions)
    const resource = { key: {}, bytes: session.retained - receiver.stats.retainedBytes - 1500000 }
    const pressure = receiver.retain({ resources: () => [resource] })
    const work = receiver.receiveSteps(next.ticket, next.message)
    let current
    if (action === 'accepted') {
      current = finishPackedSteps(work)
      assert.equal(current?.kind, 'accepted')
      producer.acknowledge(current.acknowledgement)
    } else {
      for (let step = 0; receiver.stats.cache.words; step++) {
        assert.ok(step < 100000)
        assert.equal(work.next().done, false)
      }
      if (action === 'cancelled') assert.equal(receiver.cancel(next.ticket), true)
      else receiver.dispose()
    }
    pressure.release()
    assert.equal(receiver.stats.cache.words, false)
    assert.throws(() => baseline.assertOpen(), /closed/)
    if (action === 'disposed') assert.throws(() => consumer.identity, /released/)
    else {
      assert.equal(consumer.identity.revision, 0)
      assert.equal(
        consumer.reader.scalar(['document', 'counts', 'words'], { retained: 128, staging: 0 }),
        50101,
      )
    }
    return {
      action,
      refs,
      baseline,
      receiver,
      producer,
      consumer,
      current,
      work,
      callback: () => work.next(),
    }
  }
  const { parserVersion } = await load('/packages/core/src/contracts.ts')
  const { rendererVersion } = await load('/packages/renderer/src/index.ts')
  const versions = {
    generation: 1,
    documentId: 'cache-reclaim',
    parserVersion: `${parserVersion}/manuslip`,
    rendererVersion,
    options: JSON.stringify(options),
  }
  for (const action of ['accepted', 'cancelled', 'disposed']) escaped.push(probe(action))
  async function collect() {
    for (let pass = 0; pass < 12; pass++) {
      await immediate()
      global.gc()
      await immediate()
    }
  }
  await collect()
  const probes = escaped.map(({ action, refs }) => {
    const survivors = refs.filter(({ ref }) => ref.deref()).length
    assert.equal(survivors, 0, action)
    return { action, observed: refs.map(({ kind }) => kind), survivors }
  })
  for (const context of escaped) {
    assert.equal(context.callback().done, true)
    context.current?.capture.release()
    context.consumer.release()
    context.producer.dispose()
    context.receiver.dispose()
    assert.equal(context.receiver.stats.retainedBytes, 0)
    assert.equal(context.producer.stats.retainedBytes, 0)
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/semantic-cache-reclaim-lifetime.json',
    `${JSON.stringify(
      {
        method:
          'Actual cached prose maps, typed metadata/backing buffer, chunk table and native chunk arrays observed after mandatory validation reclaims optional cache under unchanged admission. Receivers, closed baselines, closed receipt work, old accepted consumers and unadvanced callbacks stay alive. Ownership/lifetime evidence only; no physical peak claim.',
        probes,
      },
      null,
      2,
    )}\n`,
  )
  console.log(JSON.stringify({ probes: probes.length, survivors: 0 }))
} finally {
  Reflect.deleteProperty(globalThis, hook)
  await server.close()
}
