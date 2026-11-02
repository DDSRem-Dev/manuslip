import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { originalParserSources, withoutParserSpans } from '../helpers/parser-lifetime-sources.mjs'

const child = process.argv.indexOf('--child')
const development = process.argv.includes('--development')
const hash = (value) => createHash('sha256').update(value).digest('hex')
if (child < 0) {
  const results = []
  for (const mode of ['original', 'patched']) {
    results.push(
      await new Promise((resolve, reject) => {
        const job = spawn(
          process.execPath,
          [
            '--expose-gc',
            ...(development ? ['--conditions=development'] : []),
            fileURLToPath(import.meta.url),
            '--child',
            mode,
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
      }),
    )
  }
  assert.equal(results[0].rootSha256, results[1].rootSha256)
  const sources = await originalParserSources()
  const report = {
    date: new Date().toISOString(),
    development,
    method:
      'Fresh original/patched Node processes, exact hash-verified source substitutions through load hooks. Explicitly reconstruct the whole-event compiler path; application event spans are outside this probe. Diagnostic-only callbacks split fromMarkdown at complete postprocessing and before/after context compaction and compilation. Every checkpoint forces three GCs while its entire event array is deliberately kept live. These retained graph samples and artificially extended lifetimes do not measure transient process peaks or valid parse latency. Complete roots and descriptors are checked. No installed source is modified.',
    inputs: sources.map(({ name, file, source, patched }) => ({
      name,
      file,
      originalSha256: hash(source),
      patchedSha256: hash(patched),
    })),
    results,
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  const path = `test/artifacts/logs/parser-lifetime-live-graph${development ? '-development' : ''}.json`
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    JSON.stringify({
      path,
      results: results.map(({ mode, phases }) => ({
        mode,
        phases: phases.map(({ phase, heapUsed, events }) => ({ phase, heapUsed, events })),
      })),
    }),
  )
} else {
  const mode = process.argv[child + 1]
  assert.ok(['original', 'patched'].includes(mode))
  assert.equal(typeof global.gc, 'function')
  const sources = await originalParserSources()
  const replacements = new Map(sources.map((source) => [source.url, source]))
  const loaded = new Set()
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      const entry = replacements.get(url)
      if (!entry) return nextLoad(url, context)
      loaded.add(url)
      let source = mode === 'original' ? entry.source : entry.patched
      if (entry.name === 'mdast-util-from-markdown') {
        source = withoutParserSpans(source, entry.file.startsWith('dev/'))
        const from = source.indexOf('  return compiler(options)(')
        const to = source.indexOf('\n}', from)
        assert.ok(from > 0 && to > from)
        source =
          source.slice(0, from) +
          `  const compile = compiler(options);
  const events = postprocess(parse(options).document().write(preprocess()(value, encoding, true)));
  globalThis.__parserHeapPhase?.('tokenized', events);
  ${mode === 'patched' ? "serializationEvents(events); globalThis.__parserHeapPhase?.('detached', events);" : ''}
  const tree = compile(events);
  globalThis.__parserHeapPhase?.('compiled', events);
  return tree;` +
          source.slice(to)
      }
      return { format: 'module', source, shortCircuit: true }
    },
  })
  const exportDevelopment = process.execArgv.includes('--conditions=development')
  const server = await createServer({
    configFile: false,
    optimizeDeps: { noDiscovery: true },
    logLevel: 'silent',
    resolve: { conditions: ['node', exportDevelopment ? 'development' : 'production'] },
    ssr: {
      resolve: {
        conditions: ['node', exportDevelopment ? 'development' : 'production'],
        externalConditions: ['node', exportDevelopment ? 'development' : 'production'],
      },
    },
    server: { middlewareMode: true, watch: null, hmr: false },
  })
  let phases
  const record = (phase, events) => {
    if (!phases) return
    for (let index = 0; index < 3; index++) global.gc()
    phases.push({ phase, events: events?.length ?? null, ...process.memoryUsage() })
  }
  globalThis.__parserHeapPhase = record
  try {
    const { parseMarkdownNative: parseMarkdown } = await server.ssrLoadModule(
      '/packages/core/src/parse.ts',
    )
    parseMarkdown('Warm [link][r] **text**.\n\n[r]: /target\n')
    phases = []
    record('baseline')
    const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
    const source = `# nested-containers\n\n${chunk.repeat(Math.ceil(1048576 / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
    assert.equal(hash(source), '93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3')
    const document = parseMarkdown(source)
    record('described')
    assert.equal(document.blocks.length, 31492)
    const rootSha256 = hash(JSON.stringify(document.root))
    assert.equal(rootSha256, 'ae7bf2da554ad8db396e6cfef5677cf7d6d9a21d4f509d678a71e0b2f0d36226')
    assert.deepEqual(
      [...loaded].sort(),
      sources
        .filter((source) => source.file.startsWith('dev/') === exportDevelopment)
        .map((source) => source.url)
        .sort(),
    )
    console.log(
      JSON.stringify({
        mode,
        phases,
        rootSha256,
        descriptors: document.blocks.length,
        loaded: [...loaded],
      }),
    )
  } finally {
    delete globalThis.__parserHeapPhase
    await server.close()
    hooks.deregister()
  }
}
