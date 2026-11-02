import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error(
    'Run with node --expose-gc test/benchmark/profiles/profile-packed-serialization.mjs',
  )
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
})
try {
  const { parseMarkdown } = await server.ssrLoadModule('/packages/core/src/parse.ts')
  const { renderMarkdown } = await server.ssrLoadModule('/packages/renderer/src/index.ts')
  const { sourceHash } = await server.ssrLoadModule('/packages/core/src/contracts.ts')
  const { packValue, unpackValue } = await server.ssrLoadModule('/packages/core/src/packing.ts')
  const { PackedSession } = await server.ssrLoadModule('/packages/core/src/packing-session.ts')
  const MiB = 1024 * 1024
  const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 8, readers: 16 }
  const budget = { bytes: 8 * MiB - 65536, workspace: 3 * MiB, nodes: 2000000, depth: 128 }
  const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const text = `# nested-containers\n\n${chunk.repeat(Math.ceil(MiB / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
  const sourceSha256 = createHash('sha256').update(text).digest('hex')
  assert.equal(sourceSha256, '93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3')
  const document = parseMarkdown(text)
  const options = { rawHtml: false, footnotesLabel: 'Footnotes', footnoteBackLabel: 'Back' }
  const projection = renderMarkdown(document.root, options)
  const payload = packValue({ document, projection }, budget.bytes)
  const identity = {
    generation: 1,
    documentId: 'nested',
    revision: 0,
    sourceHash: sourceHash(text),
    parserVersion: document.parserVersion,
    rendererVersion: 'test',
    options: 'test',
  }
  const owner = new PackedSession(limits)
  const request = owner.begin(identity, text)
  owner.commit(owner.prepareFull(request, identity, payload))
  const capture = owner.capture()
  const baseline = owner.stats
  global.gc()
  global.gc()
  const memoryBaseline = process.memoryUsage(),
    memorySamples = []
  const work = capture.serialize(['document', 'root'], budget)
  let output,
    advances = 0,
    largestStepMs = 0,
    peakRetained = 0,
    peakStaging = 0
  const started = performance.now()
  try {
    while (true) {
      const start = performance.now()
      const step = work.next()
      largestStepMs = Math.max(largestStepMs, performance.now() - start)
      const stats = owner.stats
      peakRetained = Math.max(peakRetained, stats.retainedBytes)
      peakStaging = Math.max(peakStaging, stats.readerStagingBytes)
      assert.ok(stats.retainedBytes <= limits.retained)
      assert.ok(stats.readerStagingBytes <= limits.staging)
      if ([50000, 160000, 300000].includes(advances)) {
        global.gc()
        global.gc()
        const memory = process.memoryUsage()
        memorySamples.push({
          advances,
          heapDelta: memory.heapUsed - memoryBaseline.heapUsed,
          arrayBufferDelta: memory.arrayBuffers - memoryBaseline.arrayBuffers,
          retainedAccounting: stats.retainedBytes,
          stagingAccounting: stats.readerStagingBytes,
        })
      }
      if (step.done) {
        output = step.value
        break
      }
      advances++
    }
    const serializeMs = performance.now() - started
    assert.ok(output)
    const bytes = output.value.payload.byteLength
    const workspaceBytes = output.value.workspaceBytes
    const records = output.value.records
    assert.ok(bytes <= budget.bytes)
    const restored = unpackValue(output.value.payload, {
      bytes: limits.bytes,
      retained: 32 * MiB,
      staging: limits.staging,
    })
    assert.deepEqual(restored.value, document.root)
    const rendered = renderMarkdown(restored.value, options)
    assert.equal(rendered.html, projection.html)
    assert.deepEqual(rendered.blocks, projection.blocks)
    capture.release()
    owner.evict()
    const outputOnlyBytes = owner.stats.retainedBytes
    assert.equal(outputOnlyBytes, bytes + 1024)
    output.release()
    assert.equal(owner.stats.retainedBytes, 256)

    // Retained closed scheduler handles must not keep a capture, owner or arena alive.
    const closed = [],
      observed = []
    function cancelled(steps) {
      const session = new PackedSession(limits)
      const ticket = session.begin({ ...identity, sourceHash: sourceHash('small') }, 'small')
      session.commit(
        session.prepareFull(
          ticket,
          { ...identity, sourceHash: sourceHash('small') },
          packValue(
            Array.from({ length: 10000 }, (_, index) => ({ index, text: '界😀'.repeat(100) })),
            limits.bytes,
          ),
        ),
      )
      const captured = session.capture()
      const task = captured.serialize([], budget)
      const refs = [new WeakRef(session), new WeakRef(captured)]
      if (steps === 'emission') {
        let reached = false
        for (let i = 0; i < 100000; i++) {
          assert.equal(task.next().done, false)
          if (session.stats.holds > 0) {
            reached = true
            break
          }
        }
        assert.ok(reached)
      } else for (let i = 0; i < steps; i++) assert.equal(task.next().done, false)
      task.return()
      captured.release()
      session.evict()
      assert.equal(session.stats.retainedBytes, 256)
      closed.push(task)
      return refs
    }
    for (const steps of [0, 1, 100, 5000, 'emission']) observed.push(...cancelled(steps))
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
        'Development Node diagnostic: complete authoritative nested corpus root serialized directly from a capture, without a native tree, under existing worker ledger limits. Independent full parser equality and HTML/block equality. These working weights are not a portable heap bound or packaged acceptance evidence; application wire transport remains JSON.',
      sourceSha256,
      sourceBytes: Buffer.byteLength(text),
      originalJsonBytes: Buffer.byteLength(JSON.stringify({ document, projection })),
      baseline,
      rootExport: {
        bytes,
        records,
        workspaceBytes,
        advances,
        serializeMs,
        largestStepMs,
        peakRetained,
        peakStaging,
        outputOnlyBytes,
        equivalent: true,
        renderEquivalent: true,
      },
      closedHandleCollection: { retainedHandles: closed.length, observed: observed.length, alive },
      memorySamples,
    }
    await mkdir('test/artifacts/logs', { recursive: true })
    await writeFile(
      'test/artifacts/logs/packed-serialization-profile.json',
      `${JSON.stringify(result, null, 2)}\n`,
    )
    console.log(JSON.stringify(result, null, 2))
  } finally {
    work.return()
    output?.release()
    capture.release()
    owner.dispose()
  }
} finally {
  await server.close()
}
