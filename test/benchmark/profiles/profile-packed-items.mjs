import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error('Run with node --expose-gc test/benchmark/profiles/profile-packed-items.mjs')
const MiB = 1024 * 1024
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
})
try {
  const { PackedArena } = await server.ssrLoadModule('/packages/core/src/packing-arena.ts')
  const { PackedSession } = await server.ssrLoadModule('/packages/core/src/packing-session.ts')
  const { packValue } = await server.ssrLoadModule('/packages/core/src/packing.ts')
  const { sourceHash } = await server.ssrLoadModule('/packages/core/src/contracts.ts')
  const originalOpen = PackedArena.open
  const originalElements = PackedArena.prototype.elements
  const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 8, readers: 16 }
  const reports = []
  const probe = (phase, keepOwner) => {
    const arenas = []
    let reads = 0
    PackedArena.open = function (...args) {
      const arena = originalOpen.apply(this, args)
      arenas.push(new WeakRef(arena))
      return arena
    }
    PackedArena.prototype.elements = function* (id) {
      for (const value of originalElements.call(this, id)) {
        reads++
        yield value
      }
    }
    const owner = new PackedSession(limits)
    try {
      const text = 'original source'
      const identity = {
        generation: 1,
        documentId: `items-${phase}`,
        revision: 0,
        sourceHash: sourceHash(text),
        parserVersion: 'probe',
        rendererVersion: 'probe',
        options: 'probe',
      }
      owner.commit(
        owner.prepareFull(
          owner.begin(identity, text),
          identity,
          packValue(
            { values: Array.from({ length: 20000 }, (_, index) => ({ index, children: [index] })) },
            limits.bytes,
          ),
        ),
      )
      const old = owner.capture()
      const oldSource = new WeakRef(old.sourceResource)
      old.release()
      const after = 'updated source'
      const result = { ...identity, revision: 1, sourceHash: sourceHash(after) }
      const payload = packValue([], limits.bytes)
      const root = PackedArena.open(payload.slice(0), limits).root
      owner.commit(
        owner.prepareDelta(owner.begin(result, after), {
          base: identity,
          baseSource: text,
          result,
          payload,
          operations: [{ kind: 'splice', path: ['values'], start: 0, remove: 19999, record: root }],
        }),
      )
      const capture = owner.capture()
      const source = new WeakRef(capture.sourceResource)
      const ownerReference = new WeakRef(owner)
      const reader = capture.reader.elementSteps(['values'])
      let selected
      let nested
      let steps = 0
      let maxReferences = 0
      let progress = 0
      if (phase !== 'unstarted') {
        while (true) {
          const before = reads
          const step = reader.next()
          maxReferences = Math.max(maxReferences, reads - before)
          assert.ok(reads - before <= 256)
          assert.equal(step.done, false)
          steps++
          if (step.value === undefined) {
            progress++
            if (phase === 'prefix' && reads > before) break
          } else {
            selected = step.value
            assert.equal(selected.scalar(['index'], { retained: 16, staging: 0 }), 19999)
            if (phase === 'nested') {
              nested = selected.elementSteps(['children'])
              const child = nested.next()
              assert.equal(child.done, false)
              assert.ok(child.value)
              assert.equal(child.value.scalar([], { retained: 16, staging: 0 }), 19999)
            }
            break
          }
          assert.ok(steps < 1000)
        }
      }
      const beforeRelease = owner.stats
      assert.equal(beforeRelease.readers, phase === 'nested' ? 2 : 1)
      capture.release()
      assert.equal(owner.stats.readers, 0)
      assert.equal(owner.stats.readerStagingBytes, 0)
      owner.dispose()
      assert.equal(owner.stats.retainedBytes, 0)
      // Keep cursors unadvanced throughout collection, plus their escaped item/capture.
      reports.push({
        phase,
        keepOwner,
        steps,
        progress,
        maxReferences,
        beforeRelease,
        disposed: owner.stats,
      })
      return {
        reader,
        nested,
        selected,
        capture,
        owner: keepOwner ? owner : undefined,
        references: [...arenas, source, oldSource, ...(keepOwner ? [] : [ownerReference])],
      }
    } finally {
      PackedArena.open = originalOpen
      PackedArena.prototype.elements = originalElements
      owner.dispose()
    }
  }
  const escaped = []
  for (const keepOwner of [false, true])
    for (const phase of ['unstarted', 'prefix', 'selected', 'nested'])
      escaped.push(probe(phase, keepOwner))
  let collected = false
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise((resolve) => setImmediate(resolve))
    global.gc()
    global.gc()
    if (
      escaped.every((value) =>
        value.references.every((reference) => reference.deref() === undefined),
      )
    ) {
      collected = true
      break
    }
  }
  assert.ok(
    collected,
    'Closed item cursors/scopes/captures and retained disposed owners must release every arena and source',
  )
  for (const value of escaped) {
    assert.equal(value.reader.next().done, true)
    if (value.nested) assert.equal(value.nested.next().done, true)
    if (value.selected) assert.throws(() => value.selected.kind(), /expired/)
    assert.throws(() => value.capture.reader.kind(), /released/)
  }
  const result = {
    method:
      'Development Node/Vite ownership diagnostic, not a renderer timing or heap calibration gate. Eight probes retain unadvanced closed cursors, item scopes and captures after release, with and without deliberately retained disposed owners. A real prepared delta removes 19,999 array entries without expanding the suffix. Each cooperative cursor advance must consume at most 256 arena references. Probe phases are queued/unstarted, discarded prefix, selected item and independent nested iterator. GC must collect all source objects and arenas, plus otherwise unreachable owners. Every disposed ledger is zero.',
    date: new Date().toISOString(),
    runtime: process.versions,
    collected,
    reports,
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/packed-item-profile.json',
    `${JSON.stringify(result, null, 2)}\n`,
  )
  console.log(JSON.stringify(result, null, 2))
} finally {
  await server.close()
}
