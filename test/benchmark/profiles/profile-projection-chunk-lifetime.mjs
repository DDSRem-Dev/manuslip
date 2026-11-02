import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error(
    'Run with node --expose-gc test/benchmark/profiles/profile-projection-chunk-lifetime.mjs',
  )
const key = Symbol.for('manuslip-projection-chunk-lifetime')
let observe
globalThis[key] = (...values) => observe?.(...values)
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
  plugins: [
    {
      name: 'observe-projection-chunk-graphs',
      enforce: 'pre',
      transform(code, id) {
        const path = id.replaceAll('\\', '/')
        if (path.endsWith('/renderer/src/projection-chunk-buffer.ts')) {
          const marker = 'pieces.push(value)'
          assert.ok(code.includes(marker))
          return code.replace(
            marker,
            `${marker}; globalThis[Symbol.for('manuslip-projection-chunk-lifetime')]?.('buffered-html', pieces)`,
          )
        }
        if (path.endsWith('/renderer/src/projection-html-chunks.ts')) {
          const marker = 'const { node, parent, space, depth } = frame'
          assert.ok(code.includes(marker))
          return code.replace(
            marker,
            `${marker}; if (stack.length >= 8 && openedThrough < stack.length - 1) globalThis[Symbol.for('manuslip-projection-chunk-lifetime')]?.('pending-shells', stack)`,
          )
        }
        if (!path.endsWith('/renderer/src/projection-owned-chunks.ts')) return
        const marker = 'const widgets = new Map<string, HastNode>()'
        assert.ok(code.includes(marker))
        return code.replace(
          marker,
          `${marker}; globalThis[Symbol.for('manuslip-projection-chunk-lifetime')]?.(converted, widgets)`,
        )
      },
    },
  ],
})
const MiB = 1024 * 1024
const limits = { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
const escaped = []
try {
  const load = (path) => server.ssrLoadModule(`/packages/${path}.ts`)
  const { parseMarkdown } = await load('core/src/parse')
  const { packValue } = await load('core/src/packing')
  const { sourceHash } = await load('core/src/contracts')
  const { PackedSource } = await load('core/src/packing-source')
  const { PackedSession } = await load('core/src/packing-session')
  const { rendererVersion } = await load('renderer/src/index')
  const { inspectPackedProjectionOutput } = await load('renderer/src/packed-projection-output')
  const text = `# Title\n\n${'> '.repeat(10)}pending shells\n\n${'Writing < & 界😀 words. '.repeat(15000)}\n\n~~~text\n${'code界😀'.repeat(20000)}\n~~~\n\ncall[^a]\n\n[^a]: note $x$.\n`
  function probe(phase, action) {
    const document = parseMarkdown(text)
    const source = new PackedSource(
      {
        generation: 1,
        documentId: 'chunk-lifetime',
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
      bytes: 8 * MiB,
      retained: 64 * MiB,
      captures: 8,
      readers: 160,
    })
    owner.commit(
      owner.prepareFull(
        owner.beginPrepared(source),
        source.identity,
        packValue({ root: document.root }, 8 * MiB),
      ),
    )
    const capture = owner.capture()
    const baseline = owner.stats
    const refs = []
    const seen = new WeakSet()
    function watch(value) {
      if (!value || typeof value !== 'object' || seen.has(value)) return
      seen.add(value)
      refs.push(new WeakRef(value))
      if (value instanceof Map) for (const item of value.values()) watch(item)
      else for (const item of Object.values(value)) watch(item)
    }
    let reached = false,
      footer = false,
      widget = false,
      steps = 0
    observe = (...values) => {
      if (values[0] === 'buffered-html') {
        if (
          (phase === 'buffered-body' && !footer && !widget) ||
          (phase === 'buffered-widget' && widget) ||
          (phase === 'buffered-footer' && footer)
        ) {
          reached = true
          values.slice(1).forEach(watch)
        }
      } else if (values[0] === 'pending-shells') {
        if (phase !== 'pending-shells') return
        reached = true
        values.slice(1).forEach(watch)
      } else values.forEach(watch)
    }
    const work = inspectPackedProjectionOutput(capture, source, ['root'], options, limits, {
      chunks: function* (event) {
        if (event.kind === 'begin') {
          footer = event.footer
          widget = false
        }
        if (event.kind === 'widget') widget = true
        if (event.kind === 'widget-end') widget = false
        if (phase === 'begin' && event.kind === 'begin') reached = true
        if (phase === 'body' && !footer && event.kind === 'html') reached = true
        if (phase === 'widget' && event.kind === 'widget-html') reached = true
        if (phase === 'footer' && footer && event.kind === 'html') reached = true
        yield
      },
    })
    try {
      while (!reached) {
        assert.ok(++steps < 300000)
        assert.equal(work.next().done, false, `Unreached phase ${phase}/${action}`)
      }
      assert.ok(refs.length > 0)
      if (action === 'return') work.return()
      else if (action === 'release') capture.release()
      else owner.dispose()
      assert.equal(owner.stats.readers, 0)
      assert.equal(owner.stats.readerStagingBytes, 0)
      if (action === 'return') assert.deepEqual(owner.stats, baseline)
      return {
        owner,
        capture,
        work,
        refs,
        report: { phase, action, steps, observedObjects: refs.length },
      }
    } finally {
      observe = undefined
    }
  }
  for (const phase of [
    'begin',
    'pending-shells',
    'buffered-body',
    'body',
    'buffered-widget',
    'widget',
    'buffered-footer',
    'footer',
  ])
    for (const action of ['return', 'release', 'dispose']) escaped.push(probe(phase, action))
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
  const reports = escaped.map((entry) => ({
    ...entry.report,
    survivingObjects: entry.refs.filter((ref) => ref.deref()).length,
  }))
  assert.ok(collected, JSON.stringify(reports.filter((report) => report.survivingObjects)))
  for (const entry of escaped) assert.equal(entry.work.next().done, true)
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/projection-chunk-lifetime.json',
    `${JSON.stringify(
      {
        method:
          'Forced-GC WeakRefs to actual decoded native MDast/HAST/converted objects, pending serializer frames, partially filled body/widget/footer chunk buffers and the transient widget map injected into the current streaming implementation. Closed work/capture/owner handles stay held and unadvanced. Twenty-four probes cover begin/pending-shells/buffered-body/body/buffered-widget/widget/buffered-footer/footer at return, capture release and session disposal. This checks collection of observed graphs, not physical peaks or aggregate admission.',
        reports,
      },
      null,
      2,
    )}\n`,
  )
  console.log(JSON.stringify(reports))
} finally {
  for (const entry of escaped) entry.owner.dispose()
  delete globalThis[key]
  await server.close()
}
