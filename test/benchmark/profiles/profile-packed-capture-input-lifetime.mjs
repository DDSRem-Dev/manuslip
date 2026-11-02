import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

assert.equal(typeof global.gc, 'function', 'Run this probe with --expose-gc')
const sha = (value) => createHash('sha256').update(value).digest('hex')
await mkdir('test/artifacts/logs', { recursive: true })
const output = await mkdtemp(resolve('test/artifacts/logs/packed-capture-input-lifetime-'))
console.log(`Captured input lifetime artifacts: ${output}`)
const evaluated = new Map()
const injected = new Map()
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  logLevel: 'silent',
  server: { middlewareMode: true, watch: null, hmr: false },
  plugins: [
    {
      name: 'captured-input-lifetime-bindings',
      enforce: 'pre',
      transform(code, id) {
        const path = relative(resolve('.'), id.split('?')[0]).replaceAll('\\', '/')
        if (!path.startsWith('packages/') || !path.endsWith('.ts')) return
        const previous = evaluated.get(path)
        const hash = sha(code)
        if (previous) assert.equal(previous, hash, path)
        evaluated.set(path, hash)
        if (path === 'packages/core/src/packing-arena.ts') {
          const marker = '    this.#index = index'
          assert.equal(code.split(marker).length, 2)
          const replacement = code.replace(
            marker,
            `    globalThis.__manuslipCaptureArenaWitness?.(this, payload, index)\n${marker}`,
          )
          injected.set(path, replacement)
          return { code: replacement, map: null }
        }
      },
    },
  ],
})
const held = new Set(),
  observations = []
const heldKinds = new Map()
const hold = (value, kind) => {
  if (!held.has(value)) {
    held.add(value)
    heldKinds.set(kind, (heldKinds.get(kind) ?? 0) + 1)
  }
  return value
}
const live = (references) =>
  references.reduce((sum, ref) => sum + Number(ref.deref() !== undefined), 0)
async function collect(references, attempts = 24) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await immediate()
    global.gc()
    await immediate()
    if (!live(references)) return 0
  }
  return live(references)
}
try {
  const load = (path) => server.ssrLoadModule(`/${path}`)
  const { sourceHash } = await load('packages/core/src/contracts.ts')
  const { packValue, packStreamedValueSteps } = await load('packages/core/src/packing.ts')
  const { PackedReadScope } = await load('packages/core/src/packing-capture.ts')
  const { PackedCaptureInput } = await load('packages/core/src/packing-input-capture.ts')
  const { PackedSession } = await load('packages/core/src/packing-session.ts')
  const { PackedSource } = await load('packages/core/src/packing-source.ts')
  const { finishPackedSteps } = await load('packages/core/src/packing-work.ts')
  const MiB = 1024 * 1024
  const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, readers: 160, captures: 8 }
  const encoding = { working: 32 * MiB, nodes: 800000, depth: 512 }
  let observing, arenaReferences
  globalThis.__manuslipCaptureArenaWitness = (...values) => {
    if (arenaReferences) for (const value of values) arenaReferences.push(new WeakRef(value))
  }
  const originalKey = PackedReadScope.prototype.recordKey
  const originalText = PackedReadScope.prototype.textSteps
  const originalElements = PackedReadScope.prototype.elementSteps
  const originalRecord = PackedReadScope.prototype.encodedRecord
  const originalReference = PackedReadScope.prototype.encodedReference
  const originalRecordText = PackedReadScope.prototype.encodedTextSteps
  PackedReadScope.prototype.recordKey = function (...args) {
    const result = originalKey.apply(this, args)
    if (observing) {
      observing.records++
      if (observing.scopes.length < 8 && !observing.scopes.includes(this))
        observing.scopes.push(hold(this, 'reader'))
    }
    return result
  }
  PackedReadScope.prototype.textSteps = function (...args) {
    const result = originalText.apply(this, args)
    if (observing) {
      observing.texts++
      hold(result, 'text iterator')
    }
    return result
  }
  PackedReadScope.prototype.elementSteps = function (...args) {
    const result = originalElements.apply(this, args)
    if (observing) {
      observing.arrays++
      hold(result, 'array iterator')
    }
    return result
  }
  PackedReadScope.prototype.encodedRecord = function (...args) {
    const result = originalRecord.apply(this, args)
    if (observing && result) {
      observing.records++
      if (result.tag === 6) observing.arrayRecords.add(result.record)
      if (observing.scopes.length < 8 && !observing.scopes.includes(this))
        observing.scopes.push(hold(this, 'reader'))
      if (observing.metadata++ < 8) hold(result, 'record metadata')
    }
    return result
  }
  PackedReadScope.prototype.encodedReference = function (...args) {
    const result = originalReference.apply(this, args)
    if (observing?.arrayRecords.has(args[0])) observing.arrays++
    return result
  }
  PackedReadScope.prototype.encodedTextSteps = function (...args) {
    const result = originalRecordText.apply(this, args)
    if (observing) {
      observing.texts++
      hold(result, 'text iterator')
    }
    return result
  }
  try {
    for (const records of [false, true]) {
      for (const shape of ['object', 'array']) {
        for (const phase of [
          'queued',
          'field',
          'text',
          'array',
          'source',
          'owner',
          'throw',
          'wire',
          'complete',
        ]) {
          const state = (() => {
            const text = '界😀\ud800'.repeat(4000)
            const tail = Array.from({ length: 128 }, (_, i) => ({ i, nested: [i, i + 1] }))
            const value =
              shape === 'object' ? { first: text, later: tail } : [text, { later: tail }]
            const source = new PackedSource(
              {
                generation: 1,
                documentId: `capture-${records ? 'records' : 'readers'}-${shape}-${phase}`,
                revision: 0,
                sourceHash: sourceHash(text),
                parserVersion: 'test',
                rendererVersion: 'test',
                options: 'test',
              },
              text,
            )
            const payload = packValue(value, limits.bytes, encoding)
            const expected = sha(new Uint8Array(payload))
            const references = [new WeakRef(source), new WeakRef(source.identity)]
            const owner = new PackedSession(limits)
            let capture
            arenaReferences = references
            try {
              capture = finishPackedSteps(
                owner.stageFullSteps(owner.beginPrepared(source), payload),
              )
            } finally {
              arenaReferences = undefined
            }
            assert.ok(capture)
            assert.equal(references.length, 5)
            const input = hold(new PackedCaptureInput(capture, records), 'input')
            const reader = hold(capture.reader, 'capture reader')
            const root = hold(input.at(), 'root value')
            const work = hold(
              packStreamedValueSteps(
                root,
                phase === 'wire' ? 64 : limits.bytes,
                encoding,
                [],
                undefined,
                [input],
              ),
              'work',
            )
            return {
              source,
              payload,
              owner,
              capture,
              input,
              reader,
              root,
              work,
              expected,
              references,
              trace: {
                records: 0,
                texts: 0,
                arrays: 0,
                scopes: [],
                metadata: 0,
                arrayRecords: new Set(),
              },
            }
          })()
          observing = state.trace
          try {
            if (!['queued', 'wire', 'complete'].includes(phase)) {
              const ready = () =>
                phase === 'field'
                  ? observing.records >= 2
                  : ['array', 'owner', 'throw'].includes(phase)
                    ? observing.arrays > 0 && observing.records >= 3
                    : observing.texts > 0
              for (let advances = 0; !ready(); advances++) {
                assert.ok(advances < 100000, 'Captured input did not reach its suspension')
                assert.equal(state.work.next().done, false)
              }
              assert.equal(
                await collect(state.references, 2),
                5,
                'Suspended owners must remain live',
              )
            }
            if (phase === 'complete') {
              const payload = hold(finishPackedSteps(state.work), 'output')
              assert.equal(sha(new Uint8Array(payload)), state.expected)
            } else if (phase === 'wire')
              assert.throws(() => finishPackedSteps(state.work), /byte limit/)
            else if (phase === 'throw') {
              const error = new Error('Consumer closed captured input')
              assert.throws(
                () => state.work.throw(error),
                (value) => value === error,
              )
            } else if (phase === 'source') state.input.return()
            else if (phase === 'owner') state.owner.dispose()
            else state.work.return()
            const trace = {
              records: observing.records,
              texts: observing.texts,
              arrays: observing.arrays,
              heldReaders: observing.scopes.length,
            }
            const scopes = observing.scopes
            observing = undefined
            state.capture.release()
            state.owner.dispose()
            state.source = undefined
            state.payload = undefined
            state.capture = undefined
            state.owner = undefined
            // Source/session cancellation must revoke decoder/array views immediately,
            // even while the encoder work remains held and has not resumed or returned.
            const survivorsBeforeResume = await collect(state.references)
            assert.equal(survivorsBeforeResume, 0, `${shape}/${phase}: closed owners retained`)
            for (const scope of [state.reader, ...scopes])
              assert.throws(() => scope.kind(), /released|expired/)
            if (phase === 'source' || phase === 'owner')
              assert.throws(() => state.work.next(), /released|cancelled/)
            state.work.return()
            state.input.return()
            assert.deepEqual(state.work.next(), { done: true, value: undefined })
            observations.push({
              mode: records ? 'records' : 'readers',
              shape,
              phase,
              ...trace,
              witnesses: state.references.length,
              survivorsBeforeResume,
              survivors: await collect(state.references),
              exactPacket: phase === 'complete',
            })
          } finally {
            observing = undefined
            state.work.return()
            state.input.return()
            state.capture?.release()
            state.owner?.dispose()
          }
        }
      }
    }
  } finally {
    delete globalThis.__manuslipCaptureArenaWitness
    PackedReadScope.prototype.recordKey = originalKey
    PackedReadScope.prototype.textSteps = originalText
    PackedReadScope.prototype.elementSteps = originalElements
    PackedReadScope.prototype.encodedRecord = originalRecord
    PackedReadScope.prototype.encodedReference = originalReference
    PackedReadScope.prototype.encodedTextSteps = originalRecordText
  }
  const sources = []
  for (const [path, hash] of evaluated) {
    const body = await readFile(path)
    assert.equal(sha(body), hash, path)
    const target = resolve(output, path.replaceAll('/', '__'))
    await writeFile(target, body)
    const code = injected.get(path)
    let injection
    if (code) {
      const target = resolve(output, `injected-${path.replaceAll('/', '__')}`)
      await writeFile(target, code)
      injection = { target, sha256: sha(code) }
    }
    sources.push({ path, target, sha256: hash, injection })
  }
  const driver = await readFile(new URL(import.meta.url))
  await writeFile(resolve(output, 'driver.mjs'), driver)
  const report = {
    status: 'verified',
    method:
      'Forced GC of actual captured-input encoder work, guarded scopes, source-free record metadata, live text/array iterators and independently copied output held after closure. Thirty-six object/array probes cover ordinary readers and direct record imports through unopened, selected-field, text, array, source/session cancellation, throw, wire failure and completion. Witness the actual immutable source, its normalized identity, arena, transferred owned buffer and arena index. All must collect before resuming cancelled source/session work. One hash-bound arena-constructor injection creates weak witnesses only; runtime prototype hooks retain bounded handles. Evaluated originals, injected body and driver are archived with hashes. These are core encoding reachability checks, not end-to-end semantic coverage, physical peaks or latency acceptance.',
    driverSha256: sha(driver),
    sources,
    observations,
    heldHandles: held.size,
    heldKinds: Object.fromEntries(heldKinds),
    witnesses: observations.reduce((sum, row) => sum + row.witnesses, 0),
    survivors: observations.reduce((sum, row) => sum + row.survivors, 0),
  }
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    JSON.stringify({
      ...report,
      sources: sources.length,
      observations: observations.length,
      output,
    }),
  )
} finally {
  await server.close()
}
