import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import {
  originalParserSources,
  originalReplaySources,
  withoutParserSpans,
} from '../helpers/parser-lifetime-sources.mjs'

const development = process.argv.includes('--development')
const natural = process.argv.includes('--natural')
const child = process.argv.includes('--child')
const hash = (value) => createHash('sha256').update(value).digest('hex')
if (!child) {
  const report = await new Promise((resolve, reject) => {
    const job = spawn(
      process.execPath,
      [
        '--expose-gc',
        ...(development ? ['--conditions=development'] : []),
        fileURLToPath(import.meta.url),
        '--child',
        ...(development ? ['--development'] : []),
        ...(natural ? ['--natural'] : []),
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = '',
      stderr = ''
    job.stdout.on('data', (value) => {
      stdout += value
    })
    job.stderr.on('data', (value) => {
      stderr += value
    })
    job.on('error', reject)
    job.on('close', (code) => {
      if (code !== 0) return reject(new Error(`${stderr}\n${stdout}`))
      try {
        resolve(JSON.parse(stdout))
      } catch (error) {
        reject(error)
      }
    })
  })
  await mkdir('test/artifacts/logs', { recursive: true })
  const path = `test/artifacts/logs/parser-postprocess-phases-${development ? 'development' : 'default'}${natural ? '-natural' : ''}.json`
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ path, phases: report.phases }))
} else {
  assert.equal(typeof global.gc, 'function')
  assert.equal(process.execArgv.includes('--conditions=development'), development)
  // Reconstruction checks independent original hashes before these installed sources run.
  const inputs = [...(await originalParserSources()), ...(await originalReplaySources())]
    .filter((entry) => entry.file.startsWith('dev/') === development)
    .filter((entry) =>
      ['mdast-util-from-markdown', 'micromark-util-subtokenize'].includes(entry.name),
    )
  const replacements = new Map(inputs.map((entry) => [entry.url, entry]))
  const loaded = new Set()
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      const entry = replacements.get(url)
      if (!entry) return nextLoad(url, context)
      loaded.add(url)
      let source = withoutParserSpans(entry.patched, development)
      const end = development ? '' : ';'
      function replace(before, after) {
        assert.equal(source.split(before).length, 2, `${entry.name}/${entry.file}: probe anchor`)
        source = source.replace(before, after)
      }
      if (entry.name === 'mdast-util-from-markdown') {
        replace(
          `  return compiler(options)(serializationEvents(postprocess(parse(options).document().write(preprocess()(value, encoding, true)))))${end}`,
          `  const events = parse(options).document().write(preprocess()(value, encoding, true))${end}
  globalThis.__manuslipParserPhase?.('document', events)${end}
  postprocess(events)${end}
  serializationEvents(events)${end}
  globalThis.__manuslipParserPhase?.('detached', events)${end}
  const tree = compiler(options)(events)${end}
  globalThis.__manuslipParserPhase?.('compiled', events)${end}
  return tree${end}`,
        )
      } else {
        replace(
          `  const jumps = {}${end}`,
          `  globalThis.__manuslipParserPhase?.('pass-start', eventsArray)${end}\n  const jumps = {}${end}`,
        )
        replace(
          `  return !more${end}`,
          `  globalThis.__manuslipParserPhase?.('pass-end', eventsArray)${end}\n  return !more${end}`,
        )
      }
      return { format: 'module', source, shortCircuit: true }
    },
  })
  const phases = []
  let active = false
  let observedEvents
  const record = (phase, events) => {
    if (!active) return
    if (phase === 'document') observedEvents = events
    // Content resolution also subtokenizes small child arrays during block parsing.
    // Only the complete fromMarkdown event array belongs to these phase samples.
    if (events !== observedEvents) return
    if (!natural) for (let index = 0; index < 3; index++) global.gc()
    const memory = process.memoryUsage()
    const contexts = new Set()
    const pendingContexts = new Set()
    let pendingEvents = 0,
      contextEventSlots = 0
    for (const event of events) {
      const context = event[2]
      if (!contexts.has(context)) {
        contexts.add(context)
        contextEventSlots += context.events?.length ?? 0
      }
      if (event[1].contentType) {
        pendingEvents++
        pendingContexts.add(context)
      }
    }
    phases.push({
      phase,
      events: events.length,
      contexts: contexts.size,
      pendingEvents,
      pendingContexts: pendingContexts.size,
      contextEventSlots,
      ...memory,
    })
  }
  globalThis.__manuslipParserPhase = record
  const server = await createServer({
    configFile: false,
    optimizeDeps: { noDiscovery: true },
    logLevel: 'silent',
    resolve: { conditions: ['node', development ? 'development' : 'production'] },
    ssr: {
      resolve: {
        conditions: ['node', development ? 'development' : 'production'],
        externalConditions: ['node', development ? 'development' : 'production'],
      },
    },
    server: { middlewareMode: true, watch: null, hmr: false },
  })
  try {
    const { parseMarkdownNative: parseMarkdown } = await server.ssrLoadModule(
      '/packages/core/src/parse.ts',
    )
    parseMarkdown('Warm **text** [link][r].\n\n[r]: /target\n')
    const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
    const source = `# nested-containers\n\n${chunk.repeat(Math.ceil(1048576 / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
    const sourceSha256 = hash(source)
    assert.equal(sourceSha256, '93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3')
    for (let index = 0; index < 3; index++) global.gc()
    const baseline = process.memoryUsage()
    active = true
    const document = parseMarkdown(source)
    active = false
    observedEvents = undefined
    assert.equal(document.blocks.length, 31492)
    const rootSha256 = hash(JSON.stringify(document.root))
    assert.equal(rootSha256, 'ae7bf2da554ad8db396e6cfef5677cf7d6d9a21d4f509d678a71e0b2f0d36226')
    assert.deepEqual([...loaded].sort(), [...replacements.keys()].sort())
    assert.equal(phases[0]?.phase, 'document')
    assert.equal(phases.at(-1)?.phase, 'compiled')
    assert.ok(phases.filter((entry) => entry.phase === 'pass-end').length >= 1)
    assert.equal(phases.findLast((entry) => entry.phase === 'pass-end').pendingEvents, 0)
    assert.equal(phases.find((entry) => entry.phase === 'detached').contextEventSlots, 0)
    console.log(
      JSON.stringify({
        date: new Date().toISOString(),
        development,
        natural,
        runtime: process.versions,
        platform: process.platform,
        arch: process.arch,
        method:
          'Fresh Node process with exact hash-verified installed parser sources. Explicitly reconstruct the whole-event compiler path; application event spans are outside this probe. Diagnostic load hooks split private fromMarkdown stages and observe only its complete event array, excluding recursive child content resolution. The complete event array is deliberately retained through compilation. Forced mode collects three times before each sample; natural mode collects only before parsing. Numeric context counts allocate temporary Sets after memory sampling. GC, instrumentation and extended event lifetimes invalidate latency and physical admission claims; endpoints can miss synchronous peaks. No dependency source is written. Full source/root SHA-256 and all descriptors must match the recorded independent oracle.',
        inputs: inputs.map(({ name, file, patched }) => ({ name, file, sha256: hash(patched) })),
        sourceBytes: Buffer.byteLength(source),
        sourceSha256,
        rootSha256,
        descriptors: document.blocks.length,
        baseline,
        phases,
      }),
    )
  } finally {
    active = false
    observedEvents = undefined
    delete globalThis.__manuslipParserPhase
    await server.close()
    hooks.deregister()
  }
}
