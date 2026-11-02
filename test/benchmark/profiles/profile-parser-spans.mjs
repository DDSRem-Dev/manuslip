import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { originalParserSources, withoutParserSpans } from '../helpers/parser-lifetime-sources.mjs'

const hash = (value) => createHash('sha256').update(value).digest('hex')
const development = process.argv.includes('--development')
const natural = process.argv.includes('--natural')
const child = process.argv.indexOf('--child')
const fixtureNames = ['nested', 'quote', 'list', 'paragraph']
const fixtureArg = process.argv.indexOf('--fixture')
const fixtures = fixtureArg < 0 ? fixtureNames : [process.argv[fixtureArg + 1]]
assert.ok(
  fixtures.every((name) => fixtureNames.includes(name)),
  'Unknown parser span fixture',
)

if (child < 0) {
  const cases = []
  for (const fixture of fixtures) {
    const results = []
    for (const mode of ['whole', 'spans']) {
      const result = await new Promise((resolve, reject) => {
        const job = spawn(
          process.execPath,
          [
            '--expose-gc',
            ...(development ? ['--conditions=development'] : []),
            fileURLToPath(import.meta.url),
            '--child',
            mode,
            '--fixture',
            fixture,
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
          if (code !== 0) return reject(new Error(`${fixture}/${mode}: ${stderr}\n${stdout}`))
          try {
            resolve(JSON.parse(stdout))
          } catch (error) {
            reject(error)
          }
        })
      })
      results.push(result)
    }
    assert.deepEqual(results[0].output, results[1].output, `${fixture}: complete output differs`)
    assert.equal(results[0].rawEvents, results[1].rawEvents)
    cases.push({ fixture, results })
    console.log(
      JSON.stringify({
        fixture,
        equal: true,
        rawEvents: results[1].rawEvents,
        spans: results[1].spans,
        maximum: results[1].maximum,
      }),
    )
  }
  const report = {
    date: new Date().toISOString(),
    development,
    natural,
    method:
      'Fresh Node processes per complete source shape and whole/span compiler. Exact installed sources are independently reconstructed/hash checked before load hooks instrument private stages; no dependency is written. All document fields except timings and both raw-HTML policy renders must hash equally. Span counters conserve every raw event, include resolved and list-prepared events, and verify master-array release. Samples retain no event/context/tree references. The whole-event observer deliberately keeps its input through compilation, imposing retention at that stage. Forced mode collects three times at endpoints and each strictly larger phase event count; natural mode collects only before parsing. Instrumentation, GC and endpoint selection invalidate latency and physical-peak/admission claims. A single container or linked flow may occupy the whole source; observed span maxima are not configured bounds.',
    cases,
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  const path = `test/artifacts/logs/parser-span-shapes-${development ? 'development' : 'default'}${natural ? '-natural' : ''}${fixtureArg < 0 ? '' : `-${fixtures[0]}`}.json`
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ path, cases: cases.length, equal: true }))
} else {
  assert.equal(typeof global.gc, 'function')
  assert.equal(process.execArgv.includes('--conditions=development'), development)
  assert.equal(fixtures.length, 1)
  const mode = process.argv[child + 1]
  assert.ok(mode === 'whole' || mode === 'spans')
  const fixture = fixtures[0]
  const verified = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('../../../scripts/patch-parser-lifetimes.mjs', import.meta.url)),
      '--check',
    ],
    { windowsHide: true, encoding: 'utf8' },
  )
  assert.equal(verified.status, 0, `${verified.stderr}\n${verified.stdout}`)
  const inputs = (await originalParserSources()).filter(
    (entry) => entry.name === 'mdast-util-from-markdown',
  )
  const replacements = new Map(inputs.map((entry) => [entry.url, entry]))
  const loaded = new Set()
  const executed = []
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      const entry = replacements.get(url)
      if (!entry) return nextLoad(url, context)
      loaded.add(url)
      const end = entry.file.startsWith('dev/') ? '' : ';'
      let source = mode === 'whole' ? withoutParserSpans(entry.patched, development) : entry.patched
      executed.push({
        file: entry.file,
        installedSha256: hash(entry.patched),
        executedSha256: hash(source),
      })
      const observe = (phase, events) =>
        `globalThis.__manuslipSpanPhase?.('${phase}', ${events})${end}`
      function replace(before, after) {
        assert.equal(source.split(before).length, 2, `${entry.file}: ${before}`)
        source = source.replace(before, after)
      }
      if (mode === 'whole') {
        const call = `  return compiler(options)(serializationEvents(postprocess(parse(options).document().write(preprocess()(value, encoding, true)))))${end}`
        replace(
          call,
          `  const events = parse(options).document().write(preprocess()(value, encoding, true))${end}
  ${observe('document', 'events')}
  postprocess(events)${end}
  ${observe('resolved', 'events')}
  serializationEvents(events)${end}
  ${observe('compact', 'events')}
  const tree = compiler(options)(events)${end}
  ${observe('compiled', 'events')}
  return tree${end}`,
        )
      } else {
        // Select the original span helpers explicitly: the later cooperative block-stream
        // helpers contain similar anchors and are outside this diagnostic's scope.
        function instrument(fromMarker, toMarker, edits) {
          const from = source.indexOf(fromMarker)
          const to = source.indexOf(toMarker, from)
          assert.ok(from > 0 && to > from)
          let code = source.slice(from, to)
          for (const [before, after] of edits) {
            assert.equal(code.split(before).length, 2, `${entry.file}: ${before}`)
            code = code.replace(before, after)
          }
          source = source.slice(0, from) + code + source.slice(to)
        }
        const prepared = `    events = prepared${end}`
        const clear = `      events.length = 0${end}`
        instrument('\n  // Manuslip span compiler.\n', '  // Manuslip block-stream compiler.\n', [
          [
            `      let events = serializationEvents(postprocess(input))${end}`,
            `      postprocess(input)${end}
      ${observe('resolved', 'input')}
      let events = serializationEvents(input)${end}
      ${observe('compact', 'events')}`,
          ],
          [prepared, `${prepared}\n    ${observe('prepared', 'events')}`],
          [clear, `      ${observe('compiled', 'events')}\n${clear}`],
        ])
        instrument('\nfunction* eventSpans(events) {', '// Manuslip cooperative preprocessing.\n', [
          [
            'function* eventSpans(events) {',
            `function* eventSpans(events) {\n  ${observe('document', 'events')}`,
          ],
          [
            `        yield batch${end}`,
            `        ${observe('raw-span', 'batch')}\n        yield batch${end}`,
          ],
          [
            `    linked.clear()${end}`,
            `    linked.clear()${end}\n    ${observe('released', 'events')}`,
          ],
        ])
      }
      return { format: 'module', source, shortCircuit: true }
    },
  })
  let active = false,
    rawEvents = 0,
    spans = 0,
    rawTotal = 0
  const maximum = { raw: 0, resolved: 0, prepared: 0 }
  const totals = { resolved: 0, prepared: 0 }
  const samples = []
  const seen = new Map()
  let released = false
  const observe = (phase, events) => {
    if (!active) return
    const count = events.length
    if (phase === 'document') rawEvents = count
    if (phase === 'raw-span') {
      spans++
      rawTotal += count
      maximum.raw = Math.max(maximum.raw, count)
    }
    if (phase === 'resolved' || phase === 'prepared') {
      maximum[phase] = Math.max(maximum[phase], count)
      totals[phase] += count
    }
    if (phase === 'released') {
      assert.equal(count, 0)
      released = true
    }
    // Only numeric observations survive the callback, including at suspension boundaries.
    if (seen.has(phase) && count <= seen.get(phase)) return
    seen.set(phase, count)
    if (!natural) for (let index = 0; index < 3; index++) global.gc()
    samples.push({ phase, events: count, span: spans, ...process.memoryUsage() })
  }
  globalThis.__manuslipSpanPhase = observe
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
    const { renderMarkdown } = await server.ssrLoadModule('/packages/renderer/src/index.ts')
    parseMarkdown('Warm **text** [link][r].\n\n[r]: /target\n')
    const inline = 'Writing **strong**, `code`, [link][r] and enough prose to continue. '
    const nested = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
    const chunk =
      fixture === 'nested'
        ? nested
        : fixture === 'quote'
          ? `> ${inline}\n>\n`
          : fixture === 'list'
            ? `- ${inline}\n`
            : inline
    const source = `${fixture === 'nested' ? '# nested-containers\n\n' : ''}${chunk.repeat(Math.ceil(1048576 / Buffer.byteLength(chunk)))}\n\n[r]: https://example.invalid/\n`
    // Preserve the established corpus byte for byte, including its definition separator.
    const text = fixture === 'nested' ? source.replace('\n\n\n[r]:', '\n\n[r]:') : source
    if (fixture === 'nested')
      assert.equal(hash(text), '93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3')
    for (let index = 0; index < 3; index++) global.gc()
    const baseline = process.memoryUsage()
    active = true
    const { timings, ...document } = parseMarkdown(text)
    observe('described', [])
    active = false
    if (mode === 'spans') {
      assert.equal(rawTotal, rawEvents, 'Every block event must belong to exactly one span')
      assert.ok(spans > 0)
      assert.ok(totals.resolved > 0)
      assert.ok(totals.prepared >= totals.resolved)
      assert.equal(released, true, 'The consumed master event array must be cleared')
      if (fixture === 'nested') {
        assert.ok(spans > 1)
        assert.ok(maximum.raw < rawEvents)
      } else {
        assert.equal(spans, 1, 'The adversarial fixture must still occupy a single span')
        assert.equal(maximum.raw, rawEvents)
      }
    }
    const renders = [false, true].map((rawHtml) => {
      const { renderMs, ...projection } = renderMarkdown(document.root, {
        rawHtml,
        footnotesLabel: 'Notes 世界',
        footnoteBackLabel: 'Back 返回',
      })
      return hash(JSON.stringify(projection))
    })
    const rootSha256 = hash(JSON.stringify(document.root))
    if (fixture === 'nested') {
      assert.equal(document.blocks.length, 31492)
      assert.equal(rootSha256, 'ae7bf2da554ad8db396e6cfef5677cf7d6d9a21d4f509d678a71e0b2f0d36226')
    }
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
        fixture,
        runtime: process.versions,
        platform: process.platform,
        arch: process.arch,
        inputs: executed,
        loaded: [...loaded],
        rawEvents,
        spans,
        maximum,
        totals,
        released,
        baseline,
        samples,
        output: {
          sourceBytes: Buffer.byteLength(text),
          sourceSha256: hash(text),
          rootSha256,
          documentSha256: hash(JSON.stringify(document)),
          renders,
          descriptors: document.blocks.length,
        },
      }),
    )
  } finally {
    active = false
    delete globalThis.__manuslipSpanPhase
    await server.close()
    hooks.deregister()
  }
}
