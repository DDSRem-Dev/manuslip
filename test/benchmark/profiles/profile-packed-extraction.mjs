import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error('Run with node --expose-gc test/benchmark/profiles/profile-packed-extraction.mjs')
const MiB = 1024 * 1024
const limits = { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const key = Symbol.for('manuslip-packed-extraction-lifetime')
let observe
globalThis[key] = (phase, value) => observe?.(phase, value)
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
  plugins: [
    {
      name: 'observe-packed-extraction-lifetime',
      enforce: 'pre',
      transform(code, id) {
        const path = id.replaceAll('\\', '/')
        const inject = (marker, calls) => {
          assert.ok(code.includes(marker), `Missing extraction marker ${path}: ${marker}`)
          return code.replace(marker, `${marker}; ${calls}`)
        }
        const watch = (phase, value) =>
          `globalThis[Symbol.for('manuslip-packed-extraction-lifetime')]?.('${phase}', ${value});`
        if (path.endsWith('/core/src/packing-native-copy.ts')) {
          code = inject('const values = new Array<unknown>(length)', watch('native', 'values'))
          code = inject('frame.object = record ?? {}', watch('native', 'frame.object'))
          return inject(
            '} else value = scope.position(path, { retained: 272, staging: 0 })',
            watch('position', 'value'),
          )
        }
        if (path.endsWith('/translate/src/unit-projection.ts'))
          return inject(
            'const parts: string[] = []',
            watch('projection', '[tokens, bindings, parts]'),
          )
        if (path.endsWith('/translate/src/extract-unit.ts'))
          return inject('this.#count++', watch('ids', 'this.#ids') + watch('unit', 'unit'))
        if (path.endsWith('/translate/src/packed-extract.ts'))
          return inject(
            'const budget = capture.reserveWorkspace(fixed, fixed)',
            watch('workspace', 'budget'),
          )
      },
    },
  ],
})
try {
  const load = (name) => server.ssrLoadModule(`/packages/${name}.ts`)
  const { parseMarkdown } = await load('core/src/parse')
  const { sourceHash } = await load('core/src/contracts')
  const { packValue } = await load('core/src/packing')
  const { PackedArena } = await load('core/src/packing-arena')
  const { PackedSession } = await load('core/src/packing-session')
  const { PackedSource } = await load('core/src/packing-source')
  const { inspectPackedTranslationUnits } = await load('translate/src/packed-extract')
  const watch = (value, refs, seen) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    refs.push(new WeakRef(value))
    for (const child of Object.values(value)) watch(child, refs, seen)
  }
  function probe(phase, action, keepOwner) {
    const refs = [],
      reached = new Set(),
      seen = new WeakSet()
    let workspace
    observe = (kind, value) => {
      reached.add(kind)
      if (kind === 'workspace') workspace = value
      else watch(value, refs, seen)
    }
    const open = PackedArena.open
    PackedArena.open = function (...args) {
      const arena = open.apply(this, args)
      refs.push(new WeakRef(arena))
      return arena
    }
    const owner = new PackedSession({ bytes: 8 * MiB, ...limits, readers: 160, captures: 8 })
    const text =
      '# Hello 世界\n\n> Prose **strong** and `PRIVATE`, $x^2$, [label][r].\n\nAnother <span>PRIVATE</span> end.\n\n[r]: https://private.invalid/ "TITLE"\n'
    const document = parseMarkdown(text)
    const source = new PackedSource(
      {
        generation: 1,
        documentId: 'extraction-lifetime',
        revision: 0,
        sourceHash: sourceHash(text),
        parserVersion: document.parserVersion,
        rendererVersion: 'test',
        options: 'test',
      },
      text,
    )
    refs.push(new WeakRef(source))
    if (!keepOwner) refs.push(new WeakRef(owner))
    let capture, work
    let inspected = false
    const failure = new Error('Extraction inspector failure')
    try {
      owner.commit(
        owner.prepareFull(
          owner.beginPrepared(source),
          source.identity,
          packValue({ document: { root: document.root } }, 8 * MiB),
        ),
      )
      capture = owner.capture()
      owner.evict()
      const before = owner.stats
      const occurrence = phase === 'duplicate' ? () => 'duplicate' : undefined
      work = inspectPackedTranslationUnits(
        capture,
        source,
        ['document', 'root'],
        phase === 'limit' ? { ...limits, staging: 1024 * 1024 } : limits,
        function* (unit) {
          inspected = true
          watch(unit, refs, seen)
          if (phase === 'throw') throw failure
          yield
        },
        occurrence,
      )
      if (['throw', 'duplicate', 'limit'].includes(phase)) {
        assert.throws(
          () => {
            while (!work.next().done) {}
          },
          phase === 'throw'
            ? (error) => error === failure
            : phase === 'duplicate'
              ? /translation-invalid/
              : /workspace/,
        )
        assert.deepEqual(owner.stats, before)
      } else if (phase === 'complete' || phase === 'unreachable') {
        while (!work.next().done) {}
        assert.ok(inspected)
        assert.deepEqual(owner.stats, before)
      } else if (phase !== 'queued') {
        let steps = 0
        do {
          assert.equal(work.next().done, false)
          assert.ok(++steps < 100000)
        } while (
          phase === 'validation'
            ? steps < 1
            : phase === 'inspect'
              ? !inspected
              : !reached.has(phase)
        )
      }
      if (action === 'return') {
        work.return()
        assert.deepEqual(owner.stats, before)
      } else if (action === 'release') capture.release()
      else owner.dispose()
      capture.release()
      assert.equal(owner.stats.readers, 0)
      assert.equal(owner.stats.readerStagingBytes, 0)
      if (phase === 'unreachable') assert.equal(owner.stats.retainedBytes, 256)
      if (phase !== 'unreachable') {
        owner.dispose()
        assert.equal(owner.stats.retainedBytes, 0)
      }
      return {
        work,
        capture,
        workspace,
        owner: keepOwner ? owner : undefined,
        refs,
        report: { phase, action, keepOwner, references: refs.length, reached: [...reached] },
      }
    } finally {
      PackedArena.open = open
      observe = undefined
    }
  }
  const cases = ['queued', 'validation', 'native', 'inspect'].flatMap((phase) =>
    ['return', 'release', 'dispose'].map((action) => [phase, action]),
  )
  cases.push(...['complete', 'throw', 'duplicate', 'limit'].map((phase) => [phase, 'return']))
  const escaped = cases.flatMap(([phase, action]) =>
    [false, true].map((keepOwner) => probe(phase, action, keepOwner)),
  )
  escaped.push(probe('unreachable', 'return', false))
  let collected = false
  for (let attempt = 0; attempt < 40; attempt++) {
    await immediate()
    global.gc()
    await immediate()
    if (escaped.every((entry) => entry.refs.every((ref) => !ref.deref()))) {
      collected = true
      break
    }
  }
  if (!collected)
    console.log(
      'Uncollected:',
      escaped.filter((entry) => entry.refs.some((ref) => ref.deref())).map((entry) => entry.report),
    )
  assert.ok(collected, 'Closed extraction handles must release actual native units and owners')
  for (const entry of escaped) {
    assert.equal(entry.work.next().done, true)
    if (entry.workspace) assert.throws(() => entry.workspace.resize(0, 0), /released/)
  }
  const report = {
    date: new Date().toISOString(),
    collected,
    probes: escaped.map((entry) => entry.report),
    method:
      'Development Node/Vite instrumentation tracks actual partial/complete native subtrees, positions, projected token/binding/text arrays, occurrence ID sets, units, source resources and arenas. Closed work/capture/workspace handles stay held and unadvanced during forced GC, with both externally retained and unreachable sessions. Includes pre-start/validation/native-copy/inspector cancellation, completion, inspector failure, duplicate IDs and workspace failure. Collection proves reachability cleanup; weighted ledgers are checked separately and are not physical heap calibration, production reading integration or packaged performance.',
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/packed-extraction-lifetime.json',
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(JSON.stringify(report, null, 2))
} finally {
  delete globalThis[key]
  await server.close()
}
