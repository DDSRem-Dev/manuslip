import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { MessageChannel } from 'node:worker_threads'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error('Run with node --expose-gc test/benchmark/profiles/profile-packed-resync.mjs')
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
})
try {
  const { parseMarkdown } = await server.ssrLoadModule('/packages/core/src/parse.ts')
  const { renderProjectionLayout } = await server.ssrLoadModule(
    '/packages/renderer/src/projection-layout.ts',
  )
  const { validatePackedSnapshot } = await server.ssrLoadModule(
    '/packages/renderer/src/packing-validate-snapshot.ts',
  )
  const { rendererVersion } = await server.ssrLoadModule('/packages/renderer/src/index.ts')
  const { sourceHash } = await server.ssrLoadModule('/packages/core/src/contracts.ts')
  const { packValue, unpackValue } = await server.ssrLoadModule('/packages/core/src/packing.ts')
  const { PackedSession } = await server.ssrLoadModule('/packages/core/src/packing-session.ts')
  const { PackedPublisher } = await server.ssrLoadModule('/packages/core/src/packing-publisher.ts')
  const { PackedReceiver } = await server.ssrLoadModule('/packages/core/src/packing-receiver.ts')
  const { PackedSource } = await server.ssrLoadModule('/packages/core/src/packing-source.ts')
  const { PackedArena } = await server.ssrLoadModule('/packages/core/src/packing-arena.ts')
  const MiB = 1024 * 1024
  const workerLimits = {
    bytes: 8 * MiB,
    retained: 16 * MiB,
    staging: 8 * MiB,
    captures: 8,
    readers: 160,
  }
  const rendererLimits = { ...workerLimits, retained: 64 * MiB }
  const budget = { bytes: 8 * MiB - 65536, workspace: 3 * MiB, nodes: 2000000, depth: 128 }
  const validation = { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
  const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const text = `# nested-containers\n\n${chunk.repeat(Math.ceil(MiB / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
  const sourceSha256 = createHash('sha256').update(text).digest('hex')
  assert.equal(sourceSha256, '93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3')
  const options = { rawHtml: false, footnotesLabel: 'Footnotes', footnoteBackLabel: 'Back' }
  const document = parseMarkdown(text)
  const { projection, layout } = renderProjectionLayout(document.root, options, 64 * MiB)
  const snapshot = { document, projection, layout }
  const checked = new PackedSource(
    {
      generation: 1,
      documentId: 'nested-resync',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: document.parserVersion,
      rendererVersion,
      options: JSON.stringify(options),
    },
    text,
  )
  const owner = new PackedSession(workerLimits)
  const publisher = new PackedPublisher(owner)
  const receiver = new PackedReceiver(rendererLimits, (capture, source) =>
    validatePackedSnapshot(capture, source, [], options, validation),
  )
  const packed = packValue(snapshot, budget.bytes)
  const packedBytes = packed.byteLength
  owner.commit(owner.prepareFull(owner.beginPrepared(checked), checked.identity, packed))
  const baseline = owner.stats
  const rounds = []
  const original = owner.capture()
  function transfer(message) {
    return new Promise((resolve, reject) => {
      const { port1, port2 } = new MessageChannel()
      const close = () => {
        port1.close()
        port2.close()
      }
      port2.once('message', (value) => {
        close()
        resolve(value)
      })
      port2.once('messageerror', (error) => {
        close()
        reject(error)
      })
      try {
        port1.postMessage(message, 'payload' in message ? [message.payload] : [])
      } catch (error) {
        close()
        reject(error)
      }
    })
  }
  try {
    for (let round = 0; round < 3; round++) {
      if (round === 1) receiver.evict()
      const request = receiver.begin(1, checked)
      const work = publisher.offerCurrentSteps(await transfer(request), checked, budget)
      let wire,
        advances = 0,
        maxStepMs = 0,
        peakWorkerBytes = 0,
        peakWorkerStaging = 0
      const started = performance.now()
      while (true) {
        const at = performance.now(),
          step = work.next()
        maxStepMs = Math.max(maxStepMs, performance.now() - at)
        const stats = owner.stats
        peakWorkerBytes = Math.max(peakWorkerBytes, stats.retainedBytes)
        peakWorkerStaging = Math.max(peakWorkerStaging, stats.readerStagingBytes)
        assert.ok(stats.retainedBytes <= workerLimits.retained)
        if (step.done) {
          wire = step.value
          break
        }
        advances++
      }
      const encodeMs = performance.now() - started
      assert.equal(wire.kind, 'full')
      assert.deepEqual(
        unpackValue(wire.payload, {
          bytes: workerLimits.bytes,
          retained: 64 * MiB,
          staging: workerLimits.staging,
        }).value,
        snapshot,
      )
      const input = await transfer(wire)
      assert.equal(wire.payload.byteLength, 0)
      const receive = receiver.receiveSteps(request, input)
      let accepted,
        receiveAdvances = 0,
        maxReceiveStepMs = 0,
        peakRendererBytes = 0,
        peakRendererStaging = 0
      const receiveStarted = performance.now()
      while (true) {
        const at = performance.now(),
          step = receive.next()
        maxReceiveStepMs = Math.max(maxReceiveStepMs, performance.now() - at)
        const stats = receiver.stats
        peakRendererBytes = Math.max(peakRendererBytes, stats.retainedBytes)
        peakRendererStaging = Math.max(
          peakRendererStaging,
          stats.readerStagingBytes + stats.preparingStagingBytes,
        )
        assert.ok(stats.retainedBytes <= rendererLimits.retained)
        if (step.done) {
          accepted = step.value
          break
        }
        receiveAdvances++
      }
      assert.equal(accepted.kind, 'accepted')
      const receiveMs = performance.now() - receiveStarted
      if (round === 1)
        publisher.cancel() // Deliberately lose this receipt after receiver commit.
      else publisher.acknowledge(await transfer(accepted.acknowledgement))
      accepted.capture.release()
      const current = owner.capture()
      assert.ok(current.sameRevision(original))
      current.release()
      assert.equal(owner.stats.prepared, null)
      rounds.push({
        round,
        scenario: ['initial full', 'receiver evicted / receipt lost', 'retry after lost receipt'][
          round
        ],
        bytes: accepted.bytes,
        encodeMs,
        advances,
        maxStepMs,
        peakWorkerBytes,
        peakWorkerStaging,
        receiveMs,
        receiveAdvances,
        maxReceiveStepMs,
        peakRendererBytes,
        peakRendererStaging,
        workerAfter: owner.stats.retainedBytes,
        receiverAfter: receiver.stats.retainedBytes,
      })
    }
    const next = receiver.begin(1, checked)
    assert.equal(publisher.base(next, checked), checked)
    receiver.cancel(next)
    original.release()
    publisher.dispose()
    receiver.dispose()
    owner.evict()
    assert.equal(owner.stats.retainedBytes, 256)
    assert.equal(receiver.stats.retainedBytes, 0)
    const closed = [],
      escaped = [],
      observed = []
    function lifetime(phase) {
      const session = new PackedSession(workerLimits),
        sender = new PackedPublisher(session)
      const source = new PackedSource(
        { ...checked.identity, sourceHash: sourceHash('small') },
        'small',
      )
      const refs = [new WeakRef(session), new WeakRef(sender), new WeakRef(source)]
      const open = PackedArena.open
      PackedArena.open = (...args) => {
        const arena = open.apply(PackedArena, args)
        refs.push(new WeakRef(arena))
        return arena
      }
      try {
        session.commit(
          session.prepareFull(
            session.beginPrepared(source),
            source.identity,
            packValue({ value: 'small', text: '界😀'.repeat(100000) }, workerLimits.bytes),
          ),
        )
      } finally {
        PackedArena.open = open
      }
      const capture = session.capture()
      refs.push(new WeakRef(capture))
      const request = { ...next, identity: source.identity, base: null }
      const task = sender.offerCurrentSteps(request, source, budget)
      let offered
      if (phase === 'running') assert.equal(task.next().done, false)
      if (['offered', 'transferred', 'owner-first'].includes(phase)) {
        while (true) {
          const step = task.next()
          if (step.done) {
            offered = step.value
            break
          }
        }
        if (phase === 'transferred')
          structuredClone(offered.payload, { transfer: [offered.payload] })
        escaped.push(offered)
      }
      if (phase === 'owner-first') session.dispose()
      sender.dispose()
      session.dispose()
      if (offered) assert.equal(offered.payload.byteLength, 0)
      assert.deepEqual(task.next(), { done: true, value: undefined })
      assert.equal(session.stats.retainedBytes, 0)
      closed.push(task)
      observed.push(...refs)
    }
    for (const phase of ['queued', 'running', 'offered', 'transferred', 'owner-first'])
      lifetime(phase)
    for (let i = 0; i < 12; i++) {
      await immediate()
      global.gc()
      await immediate()
    }
    const alive = observed.filter((ref) => ref.deref()).length
    assert.equal(alive, 0)
    const result = {
      date: new Date().toISOString(),
      runtime: process.versions,
      method:
        'Development Node full-snapshot resync diagnostic over real MessagePorts. Exact authoritative nested corpus, complete document/projection/layout, mandatory receiver source/root/count/render validation before ACK, independent full native equality, exact graph identity preserved on publisher, explicit receiver eviction and lost-ACK retry. Existing worker/renderer/message/staging limits. Working weights are not portable heap guarantees; production service transport remains JSON and packaged freshness is not established.',
      sourceSha256,
      sourceBytes: Buffer.byteLength(text),
      jsonBytes: Buffer.byteLength(JSON.stringify(snapshot)),
      packedBytes,
      baseline,
      rounds,
      closedHandleCollection: {
        retainedTasks: closed.length,
        retainedDetachedMessages: escaped.length,
        observed: observed.length,
        alive,
      },
    }
    await mkdir('test/artifacts/logs', { recursive: true })
    await writeFile(
      'test/artifacts/logs/packed-resync-profile.json',
      `${JSON.stringify(result, null, 2)}\n`,
    )
    console.log(JSON.stringify(result, null, 2))
  } finally {
    original.release()
    publisher.dispose()
    receiver.dispose()
    owner.dispose()
  }
} finally {
  await server.close()
}
