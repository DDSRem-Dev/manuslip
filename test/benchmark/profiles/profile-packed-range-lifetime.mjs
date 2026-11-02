import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error(
    'Run with node --expose-gc test/benchmark/profiles/profile-packed-range-lifetime.mjs',
  )
const positions = process.argv.includes('--positions')
const hook = Symbol.for('manuslip-range-proof-lifetime')
const summaryHook = Symbol.for('manuslip-position-proof-summary-lifetime')
let observe
let observeSummary
globalThis[hook] = (value, index, payload) => observe?.(value, index, payload)
globalThis[summaryHook] = (value) => observeSummary?.(value)
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  plugins: [
    {
      name: 'observe-range-proof-arena-ownership',
      enforce: 'pre',
      transform(code, id) {
        if (
          positions &&
          id.replaceAll('\\', '/').endsWith('/core/src/packing-position-summary.ts')
        ) {
          const marker = 'const values = new Uint32Array(offsets.length * 4)'
          assert.ok(code.includes(marker))
          return {
            code: code.replace(
              marker,
              `${marker}; globalThis[Symbol.for('manuslip-position-proof-summary-lifetime')]?.(values);`,
            ),
            map: null,
          }
        }
        if (!id.replaceAll('\\', '/').endsWith('/core/src/packing-arena.ts')) return
        const marker = 'this.#reader = new PackedReader(payload)'
        assert.ok(code.includes(marker))
        return {
          code: code.replace(
            marker,
            `${marker}; globalThis[Symbol.for('manuslip-range-proof-lifetime')]?.(this, index, payload);`,
          ),
          map: null,
        }
      },
    },
  ],
})
try {
  const load = (name) => server.ssrLoadModule(`/packages/core/src/${name}.ts`)
  const { PackedArena } = await load('packing-arena')
  const { packValue } = await load('packing')
  const transforms = await load(positions ? 'packing-offsets' : 'packing-ranges')
  const transform = positions ? transforms.offsetSuffix : transforms.rangeSuffix
  const transformSteps = positions ? transforms.offsetSuffixSteps : transforms.rangeSuffixSteps
  const { PackedView, segments } = await load('packing-view')
  const { PackedWork, finishPackedSteps } = await load('packing-work')
  const limits = { bytes: 8 * 1024 * 1024, retained: 16 * 1024 * 1024, staging: 8 * 1024 * 1024 }
  const noCharge = () => {}
  function probe(action) {
    const refs = []
    const recordSummary = (values) => {
      refs.push(
        { kind: 'summary', ref: new WeakRef(values) },
        { kind: 'summary-buffer', ref: new WeakRef(values.buffer) },
      )
    }
    observeSummary = recordSummary
    observe = (arena, index, payload) => {
      for (const [kind, value] of Object.entries({
        arena,
        index,
        payload,
        offsets: index.offsets,
        buffer: index.offsets.buffer,
        strings: index.strings,
        largeStrings: index.largeStrings,
        shapes: index.shapes,
      }))
        refs.push({ kind, ref: new WeakRef(value) })
    }
    const arena = PackedArena.open(
      packValue(
        Array.from({ length: 5000 }, (_, index) => ({
          from: index * 10,
          to: index * 10 + 5,
          text: `Range ${index}`,
          ...(positions
            ? {
                position: {
                  start: { line: 2, column: 3, offset: index * 10 },
                  end: { line: 2, column: 4, offset: index * 10 + 5 },
                },
              }
            : {}),
        })),
        limits.bytes,
      ),
      limits,
    )
    observe = undefined
    const original = { arena, id: arena.root }
    const first = transform(original, 0, 1, noCharge, noCharge)
    observeSummary = undefined
    if (positions) assert.ok(refs.some(({ kind }) => kind === 'summary'))
    const proof = segments(first)[0]?.[positions ? 'positionProof' : 'rangeProof']
    assert.ok(proof)
    let work
    if (action !== 'proof-only') {
      // Application/session callers retain this revocable handle, never the raw helper
      // generator: closing PackedWork drops the body even before its first advance.
      work = new PackedWork(
        transformSteps(
          action.startsWith('scan-') || action.startsWith('summary-') ? original : first,
          0,
          1,
          noCharge,
          noCharge,
        ),
        noCharge,
      )
      if (action === 'complete') finishPackedSteps(work)
      else {
        if (action.startsWith('summary-')) {
          const previous = refs.length
          observeSummary = recordSummary
          let advances = 0
          while (refs.length === previous) {
            assert.ok(++advances < 10000, 'Missing suspended summary allocation')
            assert.equal(work.next().done, false)
          }
          observeSummary = undefined
        } else if (action !== 'unstarted') assert.equal(work.next().done, false)
        if (action.endsWith('throw')) assert.throws(() => work.throw(new Error('cancel')), /cancel/)
        else work.return()
      }
      assert.equal(work.next().done, true)
    }
    const view = new PackedView(first)
    assert.equal(
      view.readScalar({ retained: 16, staging: 0 }, [4999, 'from']),
      positions ? 49990 : 49991,
    )
    if (positions) assert.equal(view.position([4999, 'position']).start.offset, 49991)
    return { action, refs, proof, work }
  }
  const held = [
    'proof-only',
    'unstarted',
    'return',
    'throw',
    'complete',
    'scan-return',
    'scan-throw',
    ...(positions ? ['summary-return', 'summary-throw'] : []),
  ].map(probe)
  for (let pass = 0; pass < 12; pass++) {
    await immediate()
    global.gc()
    await immediate()
  }
  const probes = held.map(({ action, refs, proof, work }) => {
    const survivors = refs.filter(({ ref }) => ref.deref()).map(({ kind }) => kind)
    assert.deepEqual(survivors, [], action)
    assert.ok(Object.isFrozen(proof))
    if (work) assert.equal(work.next().done, true)
    return { action, observed: refs.map(({ kind }) => kind), survivors: survivors.length }
  })
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    `test/artifacts/logs/packed-${positions ? 'position' : 'range'}-lifetime.json`,
    `${JSON.stringify(
      {
        method: `Hold actual sealed ${positions ? 'position' : 'range'} evidence and closed revocable PackedWork handles used by application/session callers while forced GC observes the arena, index, owned payload, offsets/backing buffer, string maps and shapes${positions ? ', plus the actual temporary position summary table/backing buffer' : ''}. Raw helper generators have no independent revocable ownership contract. Source-free lifetime evidence only; not calibrated physical peak admission.`,
        probes,
      },
      null,
      2,
    )}\n`,
  )
  console.log(JSON.stringify({ probes: probes.length, survivors: 0 }))
} finally {
  Reflect.deleteProperty(globalThis, hook)
  Reflect.deleteProperty(globalThis, summaryHook)
  await server.close()
}
