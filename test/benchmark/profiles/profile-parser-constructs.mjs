import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { Session } from 'node:inspector/promises'
import { registerHooks } from 'node:module'
import { setImmediate as immediate } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { originalParserSources, withoutParserSpans } from '../helpers/parser-lifetime-sources.mjs'

const modes = ['full', 'email', 'guarded']
const child = process.argv.indexOf('--child')
const wholeEvents = process.argv.includes('--whole-events')
const sourceCountArray = process.argv.includes('--source-count-array')
const prefixArg = process.argv.indexOf('--profile-prefix')
const profilePrefix =
  prefixArg < 0
    ? child < 0
      ? `parser-construct${wholeEvents ? '-whole-events' : ''}`
      : `parser-construct-child${wholeEvents ? '-whole-events' : ''}`
    : process.argv[prefixArg + 1]
assert.match(profilePrefix ?? '', /^[a-z0-9-]{1,100}$/)
await mkdir('test/artifacts/logs', { recursive: true })
if (child < 0) {
  const results = []
  for (const mode of modes) {
    const result = await new Promise((resolve, reject) => {
      const job = spawn(
        process.execPath,
        [
          '--expose-gc',
          fileURLToPath(import.meta.url),
          '--child',
          mode,
          '--profile-prefix',
          profilePrefix,
          ...(wholeEvents ? ['--whole-events'] : []),
          ...(sourceCountArray ? ['--source-count-array'] : []),
        ],
        {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
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
      job.on('close', (code) =>
        code === 0
          ? resolve(JSON.parse(stdout))
          : reject(new Error(`${mode}: ${stderr}\n${stdout}`)),
      )
    })
    results.push(result)
    console.log(
      JSON.stringify({
        mode,
        parses: result.runs.map((run) => run.timings.parse),
        allocated: result.allocations.estimatedBytes,
      }),
    )
  }
  const report = {
    date: new Date().toISOString(),
    profilePrefix,
    wholeEvents,
    sourceCountArray,
    method:
      'Separate fresh Node/Vite child processes, identical whole-document parse/description: full GFM baseline, email-attempt guard alone, and current conservative email/table/WWW/protocol guards. --source-count-array substitutes the original source spread only inside the diagnostic Vite transform; compare the same guarded child with and without that option to isolate counting. Three warmed CPU samples and a separate cumulative allocation sample including collected objects. Complete root SHA-256 and descriptor count match the independent recorded oracle; all semantic fields except timings have one identical digest across runs/modes. Endpoint process memory, sampled allocations and CPU timings are diagnostics, not simultaneous physical peaks, packaged freshness or transport activation.',
    results,
  }
  assert.equal(new Set(results.map((result) => result.semanticSha256)).size, 1)
  await writeFile(
    `test/artifacts/logs/${profilePrefix}-profile.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  )
} else {
  const mode = process.argv[child + 1]
  assert.ok(modes.includes(mode))
  assert.equal(typeof global.gc, 'function')
  const inputs = (await originalParserSources()).filter(
    (entry) => entry.name === 'mdast-util-from-markdown',
  )
  const replacements = new Map(inputs.map((entry) => [entry.url, entry]))
  const loaded = new Set()
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      const entry = replacements.get(url)
      if (!entry) return nextLoad(url, context)
      loaded.add(url)
      return wholeEvents
        ? {
            format: 'module',
            source: withoutParserSpans(entry.patched, entry.file.startsWith('dev/')),
            shortCircuit: true,
          }
        : nextLoad(url, context)
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
    plugins: [
      {
        name: 'full-grammar-baseline',
        enforce: 'pre',
        transform(code, id) {
          if (!id.replaceAll('\\', '/').endsWith('/core/src/parse.ts')) return
          assert.equal(
            code.split('countCodePoints(source)').length,
            2,
            'Source count marker changed',
          )
          if (sourceCountArray) code = code.replace('countCodePoints(source)', '[...source].length')
          if (mode === 'guarded') return code
          const from = code.indexOf('  const selectedGfm =')
          const to = code.indexOf("\n  return syntax === 'commonmark'", from)
          assert.ok(from > 0 && to > from, 'Parser grammar selection changed')
          return (
            code.slice(0, from) +
            `  const selectedGfm = ${mode === 'full' ? 'processor' : 'guardedProcessors[1]'}` +
            code.slice(to)
          )
        },
      },
    ],
  })
  const session = new Session()
  session.connect()
  try {
    const { parseMarkdownNative: parseMarkdown } = await server.ssrLoadModule(
      '/packages/core/src/parse.ts',
    )
    const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
    const source = `# nested-containers\n\n${chunk.repeat(Math.ceil(1048576 / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
    const hash = (value) => createHash('sha256').update(value).digest('hex')
    assert.equal(hash(source), '93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3')
    let semanticSha256
    const check = (document) => {
      assert.equal(document.blocks.length, 31492)
      assert.equal(
        hash(JSON.stringify(document.root)),
        'ae7bf2da554ad8db396e6cfef5677cf7d6d9a21d4f509d678a71e0b2f0d36226',
      )
      assert.equal(document.counts.characters, Array.from(source).length)
      const digest = hash(JSON.stringify({ ...document, timings: undefined }))
      if (semanticSha256) assert.equal(digest, semanticSha256)
      else semanticSha256 = digest
    }
    parseMarkdown(
      'Warm **text** [link][r], note[^n] and | table.\n\n[r]: https://example.invalid/\n\n[^n]: Note.\n',
    )
    await session.post('Profiler.enable')
    await session.post('Profiler.setSamplingInterval', { interval: 1000 })
    const runs = []
    async function cpu(iteration) {
      await immediate()
      global.gc()
      const before = process.memoryUsage()
      await session.post('Profiler.start')
      const document = parseMarkdown(source)
      const { profile } = await session.post('Profiler.stop')
      const after = process.memoryUsage()
      check(document)
      await writeFile(
        `test/artifacts/logs/${profilePrefix}-${mode}-${iteration}.cpuprofile`,
        JSON.stringify(profile),
      )
      return {
        iteration,
        timings: document.timings,
        samples: profile.samples.length,
        before,
        after,
      }
    }
    for (let iteration = 0; iteration < 3; iteration++) runs.push(await cpu(iteration))
    await immediate()
    global.gc()
    await session.post('HeapProfiler.startSampling', {
      samplingInterval: 16384,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    })
    const document = parseMarkdown(source)
    const { profile } = await session.post('HeapProfiler.stopSampling')
    check(document)
    const totals = new Map()
    function visit(node) {
      const frame = node.callFrame
      const key = `${frame.functionName || '(anonymous)'} ${frame.url}:${frame.lineNumber + 1}`
      totals.set(key, (totals.get(key) ?? 0) + node.selfSize)
      for (const nested of node.children) visit(nested)
    }
    visit(profile.head)
    await writeFile(
      `test/artifacts/logs/${profilePrefix}-${mode}.heapprofile`,
      JSON.stringify(profile),
    )
    const allocations = {
      estimatedBytes: [...totals.values()].reduce((a, b) => a + b, 0),
      top: [...totals]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([frame, bytes]) => ({ frame, bytes })),
    }
    const { countCodePoints } = await server.ssrLoadModule('/packages/core/src/text-count.ts')
    const counter = sourceCountArray ? (value) => [...value].length : countCodePoints
    assert.equal(counter(source), document.counts.characters)
    await immediate()
    global.gc()
    await session.post('HeapProfiler.startSampling', {
      samplingInterval: 16384,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    })
    const iterations = 8
    let counted = 0
    for (let iteration = 0; iteration < iterations; iteration++) counted += counter(source)
    const { profile: countProfile } = await session.post('HeapProfiler.stopSampling')
    assert.equal(counted, document.counts.characters * iterations)
    totals.clear()
    visit(countProfile.head)
    const counting = {
      iterations,
      codePoints: document.counts.characters,
      estimatedBytes: [...totals.values()].reduce((a, b) => a + b, 0),
    }
    await writeFile(
      `test/artifacts/logs/${profilePrefix}-${mode}-counts.heapprofile`,
      JSON.stringify(countProfile),
    )
    const development = process.execArgv.includes('--conditions=development')
    assert.deepEqual(
      [...loaded].sort(),
      inputs
        .filter((entry) => entry.file.startsWith('dev/') === development)
        .map((entry) => entry.url)
        .sort(),
    )
    console.log(
      JSON.stringify({
        mode,
        wholeEvents,
        sourceCountArray,
        semanticSha256,
        compilerInputs: inputs.map(({ file, patched }) => ({
          file,
          installedSha256: hash(patched),
          executedSha256: hash(
            wholeEvents ? withoutParserSpans(patched, file.startsWith('dev/')) : patched,
          ),
        })),
        loaded: [...loaded],
        sourceBytes: Buffer.byteLength(source),
        sourceSha256: hash(source),
        runs,
        allocations,
        counting,
      }),
    )
  } finally {
    session.disconnect()
    await server.close()
    hooks.deregister()
  }
}
