import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error(
    'Run with node --expose-gc test/benchmark/profiles/profile-producer-dependency-lifetime.mjs',
  )
const key = Symbol.for('manuslip-producer-dependency-lifetime')
let observe
globalThis[key] = (...values) => observe?.(...values)
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
  plugins: [
    {
      name: 'observe-actual-producer-dependency-metadata',
      enforce: 'pre',
      transform(code, id) {
        if (!id.replaceAll('\\', '/').endsWith('/core/src/semantic-dependencies.ts')) return
        for (const [marker, phase, values] of [
          [
            'const groups = new Map<number | null, number[]>()',
            'allocated',
            'blocks, definitions, references, links, footnotes, groups',
          ],
          ['currentBlock.nodes++', 'traversal', 'currentBlock'],
          ['Object.freeze(reference)', 'references', 'reference'],
          [
            'calls.push(Object.freeze({ reference: index, ...count }))',
            'calls',
            'calls, footnoteOrder, counts',
          ],
        ]) {
          assert.ok(code.includes(marker), `Missing dependency observation marker: ${marker}`)
          code = code.replace(
            marker,
            `${marker}; globalThis[Symbol.for('manuslip-producer-dependency-lifetime')]?.('${phase}', ${values})`,
          )
        }
        return code
      },
    },
  ],
})
const escaped = []
try {
  const load = (path) => server.ssrLoadModule(path)
  const { PackedSemanticProducer } = await load(
    '/apps/desktop/src/renderer/src/semantics/packed-producer.ts',
  )
  const { PackedReceiver } = await load('/packages/core/src/packing-receiver.ts')
  const { PackedSource } = await load('/packages/core/src/packing-source.ts')
  const { finishPackedSteps } = await load('/packages/core/src/packing-work.ts')
  const { parserVersion, sourceHash } = await load('/packages/core/src/contracts.ts')
  const { rendererVersion } = await load('/packages/renderer/src/index.ts')
  const { validatePackedSnapshot } = await load(
    '/packages/renderer/src/packing-validate-snapshot.ts',
  )
  const MiB = 1024 * 1024
  const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 8, readers: 64 }
  const validation = { ...limits, nodes: 800000, depth: 128 }
  const options = { rawHtml: false, footnotesLabel: 'Footnotes', footnoteBackLabel: 'Back' }
  function probe(phase, action) {
    const producer = new PackedSemanticProducer(limits)
    const receiver = new PackedReceiver(limits, (capture, source) =>
      validatePackedSnapshot(capture, source, [], options, validation),
    )
    const begin = (text, revision = 0, documentId = 'dependency-lifetime') => {
      const source = new PackedSource(
        {
          generation: 1,
          documentId,
          revision,
          sourceHash: sourceHash(text),
          parserVersion: `${parserVersion}/manuslip`,
          rendererVersion,
          options: JSON.stringify(options),
        },
        text,
      )
      const ticket = receiver.begin(revision + 1, source)
      const work = producer.prepare(
        {
          kind: 'parse',
          sequence: revision + 1,
          generation: 1,
          documentId,
          revision,
          source: text,
          options,
          sentAt: performance.timeOrigin + performance.now(),
        },
        ticket,
      )
      return { work, ticket }
    }
    const accept = ({ work, ticket }) => {
      const message = finishPackedSteps(work)
      const received = finishPackedSteps(
        receiver.receiveSteps(ticket, structuredClone(message, { transfer: [message.payload] })),
      )
      assert.equal(received.kind, 'accepted')
      producer.acknowledge(received.acknowledgement)
      received.capture.release()
    }
    const initial = `# Heading\n\n${'A [reference][r] and note[^n].\n\n'.repeat(30)}[r]: /target\n\n[^n]: Another note[^m].\n\n[^m]: Last note.\n`
    accept(begin(initial))
    const old = producer.capture(),
      baseline = producer.stats.retainedBytes
    const refs = [],
      seen = new WeakSet()
    let reached = false
    observe = (current, ...values) => {
      for (const value of values)
        if (!seen.has(value)) {
          seen.add(value)
          refs.push(new WeakRef(value))
        }
      reached ||= current === phase
    }
    const work = producer.cacheSteps()
    let pending
    try {
      for (let steps = 0; steps < 100000 && !reached; steps++) {
        const step = work.next()
        if (step.done) {
          assert.equal(phase, 'complete')
          assert.equal(step.value, true)
          reached = true
        }
      }
      assert.ok(reached && refs.length >= 6, 'Missing actual dependency metadata')
      if (action === 'cancel') {
        producer.cancel()
        assert.equal(producer.stats.retainedBytes, baseline)
      } else if (action === 'dispose') producer.dispose()
      else if (action === 'supersede')
        pending = begin(initial.replace('Heading', 'Heading extended'), 1)
      else accept(begin('A complete replacement.\n', 1, 'different-document'))
      assert.equal(producer.stats.readerStagingBytes, 0)
      return {
        producer,
        receiver,
        old,
        work,
        pending,
        refs,
        report: { phase, action, objects: refs.length },
      }
    } finally {
      observe = undefined
    }
  }
  for (const phase of ['traversal', 'references', 'calls'])
    for (const action of ['cancel', 'dispose', 'supersede']) escaped.push(probe(phase, action))
  escaped.push(probe('complete', 'dispose'), probe('complete', 'replace'))
  let survivors
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
  assert.equal(survivors, 0, 'Closed warmup retained native dependency metadata')
  for (const entry of escaped) {
    assert.equal(entry.work.next().done, true)
    if (entry.report.action !== 'dispose') assert.equal(entry.old.identity.revision, 0)
    entry.producer.dispose()
    entry.receiver.dispose()
    assert.equal(entry.producer.stats.retainedBytes, 0)
    assert.equal(entry.receiver.stats.retainedBytes, 0)
  }
  const report = {
    method:
      'WeakRef observation of actual dependency maps/arrays/records during cooperative producer warmup. Keep closed handles unadvanced through GC. Cancel/dispose/supersede in three construction phases; dispose a completed cache or replace it by exact ACK while retaining an old packed consumer. Source resources/binary revisions are intentionally outside these native-metadata observations. This is lifetime evidence, not a physical or aggregate admission bound.',
    survivors,
    probes: escaped.map((entry) => entry.report),
  }
  await writeFile(
    'test/artifacts/logs/producer-dependency-lifetime.json',
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
