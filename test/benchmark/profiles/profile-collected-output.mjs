import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setImmediate as immediate } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error('Run with node --expose-gc test/benchmark/profiles/profile-collected-output.mjs')
const output = await mkdtemp(resolve('test/artifacts/logs/collected-output-'))
await mkdir(resolve(output, 'sources'))
await copyFile(fileURLToPath(import.meta.url), resolve(output, 'driver.mjs'))
const inputs = new Map()
const probeKey = Symbol.for('manuslip-collected-output-profile')
let observe
globalThis[probeKey] = (...values) => observe?.(...values)
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null, hmr: false },
  plugins: [
    {
      name: 'observe-collected-output-lifetime',
      enforce: 'pre',
      async transform(code, id) {
        const path = id.replaceAll('\\', '/')
        const root = `${resolve('.').replaceAll('\\', '/')}/`
        if (path.startsWith(root) && /\.[cm]?[jt]sx?$/.test(path)) {
          const relative = path.slice(root.length)
          const sha256 = createHash('sha256').update(code).digest('hex')
          const archive = resolve(output, 'sources', sha256)
          const previous = inputs.get(relative)
          if (previous) assert.equal(previous.sha256, sha256, relative)
          else {
            try {
              await writeFile(archive, code, { flag: 'wx' })
            } catch (error) {
              if (error.code !== 'EEXIST') throw error
              assert.equal(await readFile(archive, 'utf8'), code)
            }
            inputs.set(relative, { path: relative, archive, sha256 })
          }
        }
        const inject = (marker, phase, values) => {
          assert.equal(code.split(marker).length, 2, `Missing unique marker: ${marker}`)
          code = code.replace(
            marker,
            `${marker}; globalThis[Symbol.for('manuslip-collected-output-profile')]?.('${phase}', ${values});`,
          )
        }
        if (path.endsWith('/renderer/src/collected-projection-context.ts')) {
          inject('this.#state = state', 'collection', 'this, state')
          inject('state.borrowing = true', 'borrow', 'state')
          inject('state.summaries[at] = (state.summaries[at] ?? 0) + 1', 'metadata', 'state')
          return code
        }
        if (path.endsWith('/renderer/src/projection-owned-output.ts')) {
          inject(
            'const descriptions: ProjectionDescriptions = new Map()',
            'output',
            'converted, descriptions',
          )
          return code
        }
      },
    },
  ],
})
try {
  const load = (name) => server.ssrLoadModule(`/packages/${name}.ts`)
  const { parseMarkdown } = await load('core/src/parse')
  const { sourceHash } = await load('core/src/contracts')
  const { PackedSource } = await load('core/src/packing-source')
  const { PackedSession } = await load('core/src/packing-session')
  const { packValue } = await load('core/src/packing')
  const { rendererVersion } = await load('renderer/src/index')
  const { collectProjectionContext } = await load('renderer/src/collected-projection-context')
  const { packedProjectionOutputInspectionSteps } = await load(
    'renderer/src/packed-projection-output',
  )
  const MiB = 1024 * 1024
  const limits = { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
  const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
  const text = `${'> > Nested **writing** and a [link][ref].\n\n'.repeat(80)}Call[^a].\n\n[ref]: /first\n\n[^a]: Note with ![picture](/picture.png).\n\n[^unused]: Unused note.\n`
  function probe(phase, action) {
    const document = parseMarkdown(text)
    const source = new PackedSource(
      {
        generation: 1,
        documentId: 'collected-output',
        revision: 0,
        sourceHash: sourceHash(text),
        parserVersion: document.parserVersion,
        rendererVersion,
        options: JSON.stringify(options),
      },
      text,
    )
    const owner = new PackedSession({
      ...limits,
      retained: 64 * MiB,
      bytes: 8 * MiB,
      captures: 8,
      readers: 160,
    })
    owner.commit(
      owner.prepareFull(
        owner.beginPrepared(source),
        source.identity,
        packValue({ document }, 8 * MiB),
      ),
    )
    const capture = owner.capture()
    const baseline = owner.stats
    const references = []
    const seen = new WeakSet()
    const watch = (value) => {
      if (value && typeof value === 'object' && !seen.has(value)) {
        seen.add(value)
        references.push(new WeakRef(value))
      }
    }
    let collection
    let metadata = 0
    let borrowed = false
    let reached = false
    let outputs = 0
    observe = (kind, value, state) => {
      if (kind === 'collection') {
        collection = value
        watch(state)
        watch(state.summaries)
        watch(state.context)
        watch(state.keys)
      } else if (kind === 'metadata') metadata++
      else if (kind === 'borrow') borrowed = true
      else if (kind === 'output') {
        watch(value.root)
        watch(value.hast)
        watch(state)
        outputs++
      }
    }
    const work = capture.work(
      collectProjectionContext(
        capture,
        source,
        ['document', 'root'],
        limits,
        function* (collected) {
          yield* packedProjectionOutputInspectionSteps(
            capture,
            source,
            ['document', 'root'],
            options,
            limits,
            {
              *chunks(event) {
                if (event.kind === 'begin' && phase === (event.footer ? 'footer' : 'body'))
                  reached = true
                yield
              },
            },
            undefined,
            undefined,
            collected,
          )
        },
      ),
    )
    let steps = 0
    try {
      for (;;) {
        const next = work.next()
        steps++
        if (phase === 'metadata' && metadata >= 16) reached = true
        if (phase === 'borrow' && borrowed) reached = true
        if (phase === 'complete' && next.done) reached = true
        if (reached) break
        assert.equal(next.done, false, `Missing ${phase}`)
        assert.ok(steps < 200000, `Unbounded ${phase}`)
      }
      assert.ok(collection)
      assert.ok(references.length >= 4)
      if (action === 'return') work.return()
      else if (action === 'throw')
        assert.throws(() => work.throw(new Error('probe cancellation')), /probe cancellation/)
      else if (action === 'release') capture.release()
      else if (action === 'dispose') owner.dispose()
      else assert.equal(action, 'complete')
      if (action === 'return' || action === 'throw' || action === 'complete')
        assert.deepEqual(owner.stats, baseline)
      else assert.equal(owner.stats.readerStagingBytes, 0)
      assert.throws(
        () => collection.descriptionAbsence(capture, source, ['document', 'root'], 0),
        /closed/,
      )
      return {
        work,
        capture,
        owner,
        collection,
        references,
        report: {
          phase,
          action,
          steps,
          metadata,
          borrowed,
          outputs,
          references: references.length,
        },
      }
    } finally {
      observe = undefined
    }
  }
  const escaped = ['metadata', 'borrow', 'body', 'footer'].flatMap((phase) =>
    ['return', 'throw', 'release', 'dispose'].map((action) => probe(phase, action)),
  )
  escaped.push(probe('complete', 'complete'))
  let collected = false
  for (let attempt = 0; attempt < 40; attempt++) {
    await immediate()
    global.gc()
    await immediate()
    if (escaped.every((entry) => entry.references.every((reference) => !reference.deref()))) {
      collected = true
      break
    }
  }
  assert.ok(
    collected,
    'Closed work and collection objects must release summary/state/output graphs while owners stay alive',
  )
  for (const entry of escaped) {
    assert.equal(entry.work.next().done, true)
    entry.capture.release()
    entry.owner.dispose()
    assert.equal(entry.owner.stats.retainedBytes, 0)
  }
  const result = {
    method:
      'Actual complete document validation and capture-owned chunk output. Seventeen GC probes retain closed handles, captures, collection objects and live/disposed owners after metadata, borrow, body, footer, or completion. Private summary arrays/state/context and constructed native/HAST/description graphs must collect before held work resumes. Return/throw/completion preserve the live owner baseline. This is reachability evidence, not calibrated heap or aggregate physical-memory acceptance.',
    date: new Date().toISOString(),
    runtime: process.versions,
    collected,
    inputs: [...inputs.values()].sort((a, b) => a.path.localeCompare(b.path)),
    probes: escaped.map((entry) => entry.report),
  }
  const path = resolve(output, 'report.json')
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
  console.log(JSON.stringify({ path, collected, probes: result.probes.length }))
} finally {
  delete globalThis[probeKey]
  await server.close()
}
