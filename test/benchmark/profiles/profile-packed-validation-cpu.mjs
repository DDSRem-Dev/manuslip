import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { Session } from 'node:inspector/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const sessionLimits = { ...limits, retained: 64 * MiB, bytes: 8 * MiB, captures: 8, readers: 160 }
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
const measuredCopy = process.argv.includes('--measured-copy')
const unbatchedTraversal = process.argv.includes('--unbatched-traversal')
const arithmeticIntegers = process.argv.includes('--arithmetic-integers')
const integerBaseline = arithmeticIntegers
  ? await readFile('test/artifacts/logs/packed-integer-baseline/packing-bytes.ts', 'utf8')
  : undefined
const archivedTraversal = new Map()
if (unbatchedTraversal)
  for (const name of ['projection-owned-output.ts', 'projection-serialization-plan.ts'])
    archivedTraversal.set(
      name,
      await readFile(`test/artifacts/logs/renderer-traversal-baseline/${name}`, 'utf8'),
    )
const baselineHashes = Object.fromEntries(
  [...archivedTraversal].map(([name, code]) => [
    name,
    createHash('sha256').update(code).digest('hex'),
  ]),
)
const reportName = `packed-validation-cpu${measuredCopy ? '-measured' : ''}${unbatchedTraversal ? '-unbatched' : ''}${arithmeticIntegers ? '-arithmetic' : ''}`
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
  plugins: [
    {
      name: 'compare-validation-traversals',
      enforce: 'pre',
      transform(code, id) {
        const path = id.replaceAll('\\', '/')
        if (integerBaseline && path.endsWith('/core/src/packing-bytes.ts')) return integerBaseline
        for (const [name, archived] of archivedTraversal)
          if (path.endsWith(`/renderer/src/${name}`)) return archived
        if (!measuredCopy || !path.endsWith('/renderer/src/packed-projection-output.ts')) return
        const marker =
          "import { inspectPackedNativeStream } from '../../core/src/packing-native-stream'"
        assert.ok(code.includes(marker))
        return code.replace(
          marker,
          "import { inspectPackedNative as inspectPackedNativeStream } from '../../core/src/packing-native-steps'",
        )
      },
    },
  ],
})
const inspector = new Session()
try {
  const load = (name) => server.ssrLoadModule(`/packages/${name}.ts`)
  const { validatePackedSnapshot } = await load('renderer/src/packing-validate-snapshot')
  const { renderProjectionLayout } = await load('renderer/src/projection-layout')
  const { rendererVersion } = await load('renderer/src/index')
  const { PackedSession } = await load('core/src/packing-session')
  const { PackedSource } = await load('core/src/packing-source')
  const { packValue } = await load('core/src/packing')
  const { sourceHash } = await load('core/src/contracts')
  const { parseMarkdown } = await load('core/src/parse')
  const run = async (text, profile) => {
    const document = parseMarkdown(text)
    const { projection, layout } = renderProjectionLayout(document.root, options, limits.staging)
    const payload = packValue({ document, projection, layout }, limits.staging)
    const payloadBytes = payload.byteLength
    const source = new PackedSource(
      {
        generation: 1,
        documentId: 'validation-cpu',
        revision: 0,
        sourceHash: sourceHash(text),
        parserVersion: document.parserVersion,
        rendererVersion,
        options: JSON.stringify(options),
      },
      text,
    )
    const owner = new PackedSession(sessionLimits)
    owner.commit(owner.prepareFull(owner.beginPrepared(source), source.identity, payload))
    const capture = owner.capture()
    const baseline = owner.stats
    const work = validatePackedSnapshot(capture, source, [], options, limits)
    let steps = 0
    let activeMs = 0
    let largestStepMs = 0
    const started = performance.now()
    let batchStart = started
    if (profile) await inspector.post('Profiler.start')
    try {
      while (true) {
        const before = performance.now()
        const next = work.next()
        const elapsed = performance.now() - before
        steps++
        activeMs += elapsed
        largestStepMs = Math.max(largestStepMs, elapsed)
        if (next.done) break
        if (performance.now() - batchStart >= 1) {
          await immediate()
          batchStart = performance.now()
        }
      }
      assert.deepEqual(owner.stats, baseline)
      const report = {
        nativeCopy: measuredCopy ? 'measured' : 'incremental',
        traversal: unbatchedTraversal ? 'archived before batching' : 'bounded batches',
        integers: arithmeticIntegers ? 'archived arithmetic decoder' : 'bitwise decoder',
        ...(integerBaseline
          ? { integerBaselineSha256: createHash('sha256').update(integerBaseline).digest('hex') }
          : {}),
        ...(unbatchedTraversal ? { baselineHashes } : {}),
        sourceBytes: Buffer.byteLength(text),
        sha256: createHash('sha256').update(text).digest('hex'),
        payloadBytes,
        steps,
        activeMs,
        wallMs: performance.now() - started,
        largestStepMs,
      }
      if (profile) {
        const { profile: cpu } = await inspector.post('Profiler.stop')
        const totals = new Map()
        const nodes = new Map(cpu.nodes.map((node) => [node.id, node]))
        for (let index = 0; index < cpu.samples.length; index++) {
          const frame = nodes.get(cpu.samples[index]).callFrame
          const key = `${frame.functionName || '(anonymous)'} ${frame.url}:${frame.lineNumber + 1}`
          totals.set(key, (totals.get(key) ?? 0) + cpu.timeDeltas[index])
        }
        report.selfTime = [...totals]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 45)
          .map(([frame, us]) => ({ frame, ms: us / 1000 }))
        await mkdir('test/artifacts/logs', { recursive: true })
        await writeFile(`test/artifacts/logs/${reportName}.cpuprofile`, JSON.stringify(cpu))
        await writeFile(
          `test/artifacts/logs/${reportName}.json`,
          `${JSON.stringify({ date: new Date().toISOString(), report }, null, 2)}\n`,
        )
        console.log(JSON.stringify(report, null, 2))
      }
    } finally {
      work.return()
      owner.dispose()
    }
    assert.equal(owner.stats.retainedBytes, 0)
  }
  inspector.connect()
  await inspector.post('Profiler.enable')
  await run('~~~text\na界😀\n~~~\n\nbody[^a]\n\n[^a]: note $x$\n', false)
  const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const nested = `# nested-containers\n\n${chunk.repeat(Math.ceil(MiB / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
  await run(nested, true)
} finally {
  inspector.disconnect()
  await server.close()
}
