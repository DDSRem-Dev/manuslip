import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { setImmediate as immediate } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { originalParserSources, originalReplaySources } from './parser-lifetime-sources.mjs'

const child = process.argv.indexOf('--child')
const replay = process.argv.includes('--event-copy')
if (child < 0) {
  const results = []
  for (const development of [false, true])
    for (const original of [true, false]) {
      const result = await new Promise((resolve, reject) => {
        const job = spawn(
          process.execPath,
          [
            '--expose-gc',
            ...(development ? ['--conditions=development'] : []),
            fileURLToPath(import.meta.url),
            '--child',
            original ? 'original' : 'patched',
            ...(replay ? ['--event-copy'] : []),
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
      results.push({ development, ...result })
    }
  for (const result of results) {
    assert.deepEqual(result.checks, results[0].checks)
    assert.deepEqual(result.rawEventChecks, results[0].rawEventChecks)
  }
  console.log(
    JSON.stringify({
      processes: results.length,
      checksPerProcess: results[0].checks.length,
      rawEventChecksPerProcess: results[0].rawEventChecks.length,
      equal: true,
      serializers: results.map(({ development, original, serializerKeepsTokenizer }) => ({
        development,
        original,
        serializerKeepsTokenizer,
      })),
    }),
  )
} else {
  const original = process.argv[child + 1] === 'original'
  const exportDevelopment = process.execArgv.includes('--conditions=development')
  const sources = replay ? await originalReplaySources() : await originalParserSources()
  const replacements = new Map(sources.map((source) => [source.url, source.source]))
  const loaded = new Set()
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (replacements.has(url)) {
        loaded.add(url)
        if (original) return { format: 'module', source: replacements.get(url), shortCircuit: true }
      }
      return nextLoad(url, context)
    },
  })
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
  try {
    const parser = await server.ssrLoadModule('/packages/core/src/parse.ts')
    const parseMarkdown = original ? parser.parseMarkdownNative : parser.parseMarkdown
    const { renderMarkdown } = await server.ssrLoadModule('/packages/renderer/src/index.ts')
    const commonmark = JSON.parse(
      await readFile(
        new URL(
          '../../../packages/core/test/fixtures/commonmark-0.31.2/spec.json',
          import.meta.url,
        ),
        'utf8',
      ),
    )
    const cases = commonmark.map((example) => example.markdown)
    const extensions = [
      '---\ntitle: test\n---\n\n$x$ and $$y$$\n',
      '+++\ntitle = "test"\n+++\n\n$$\nx^2\n$$\n',
      '| a | b |\n| :--- | ---: |\n| `a\\|b` | 中文 |\n',
      'Header\n:---:\nCell\n',
      '- [x] Done\n- [ ] Open\n\n> - [x] Quoted\n',
      'a@example.invalid www.example.invalid https://example.invalid/a_(b)\n',
      'a&#64;example.invalid &amp; escaped \\@ then ~strike~ ~~twice~~\n',
      '[label][ref] ![image][ref]\n\n[ref]: /one "title"\n[ref]: /two\n',
      '[^n] again[^n].\n\n[^n]: First\n\n    > Quoted **body**\n\n    - nested\n',
      '<div data-x="a">raw <em>HTML</em></div>\n\n<script>bad()</script>\n',
      '```mermaid\ngraph TD\n A-->B\n```\n\n![alt](file.png)\n',
      '\ufeff# 😀 العربية\r\n\r\nA\tB\rC\n\u0000end\n',
    ]
    for (const source of extensions)
      for (const prefix of ['', '> ', '> > ', '  ']) cases.push(source.replace(/^/gm, prefix))
    const pieces = [
      'prose',
      '**strong**',
      '_em_',
      '~~del~~',
      '[ref][r]',
      '[^n]',
      '`a|b`',
      'www.example.invalid/',
      'a@example.invalid',
      '&amp;',
      '\\*',
      '😀中文',
      '\r\n',
      '\t',
      '\u0000',
    ]
    let seed = 0x182acd
    const random = (size) => {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      return (seed >>> 0) % size
    }
    for (let i = 0; i < 120; i++) {
      const body = Array.from({ length: 14 }, () => pieces[random(pieces.length)]).join(' ')
      cases.push(
        `${i % 2 ? '>' : '- [x] '}${body}\n\n[r]: https://example.invalid/\n\n[^n]: Footnote **body**.\n`,
      )
    }
    const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
    cases.push(
      `# nested-containers\n\n${chunk.repeat(Math.ceil(1048576 / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`,
    )
    const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
    const checks = []
    for (const source of cases)
      for (const syntax of ['manuslip', 'commonmark']) {
        const { timings, ...document } = parseMarkdown(source, syntax)
        const renders = [false, true].map((rawHtml) => {
          const { renderMs, ...result } = renderMarkdown(document.root, {
            rawHtml,
            footnotesLabel: 'Notes 世界',
            footnoteBackLabel: 'Back 返回',
          })
          return result
        })
        checks.push(hash({ document, renders }))
      }
    assert.deepEqual(
      [...loaded].sort(),
      sources
        .filter((source) => source.file.startsWith('dev/') === exportDevelopment)
        .map((source) => source.url)
        .sort(),
      'Both actual files for the requested export condition must be observed by the hook',
    )
    const { parse, preprocess, postprocess } = await import('micromark')
    const rawEventChecks = []
    if (replay) {
      const inputs = [
        '',
        '\n',
        '# Heading\n\nParagraph **strong** and `code`.\n',
        '> > - Nested **list** with [link](/target).\n> >\n> > Tail.\n',
        'A\t😀\r\n\r\nB\rC\n\u0000end\n',
        '[a][r]\n\n[r]: /target "title"\n',
        '```js\n**literal**\n```\n\n    indented\n',
        'A | B\n- | -\nx | y\n',
        '- item **strong**\n'.repeat(1500),
      ]
      for (const source of inputs) {
        const events = parse()
          .document()
          .write(preprocess()(source, undefined, true))
        assert.equal(postprocess(events), events, 'Caller event-array identity')
        const retained = events.slice()
        const snapshot = () =>
          events.map(([kind, token, context]) => {
            assert.equal(typeof context.sliceStream, 'function')
            assert.equal(typeof context.now, 'function')
            assert.equal(typeof context.write, 'function')
            assert.ok(context.parser)
            const fields = Object.fromEntries(
              Object.entries(token).filter(
                ([, value]) =>
                  value === null || ['string', 'number', 'boolean'].includes(typeof value),
              ),
            )
            return {
              kind,
              fields,
              start: token.start,
              end: token.end,
              value: context.sliceSerialize(token),
            }
          })
        const before = hash(snapshot())
        assert.equal(postprocess(events), events)
        assert.equal(events.length, retained.length)
        for (let index = 0; index < events.length; index++)
          assert.equal(events[index], retained[index], 'Completed event identity and order')
        assert.equal(hash(snapshot()), before)
        rawEventChecks.push({ events: events.length, sha256: before })
      }
      assert.ok(rawEventChecks.at(-1).events > 10000, 'Exercise the former chunked replay boundary')
    }
    function retainedSerializer() {
      const tokenizer = parse().text()
      const fn = tokenizer.sliceSerialize
      const prepare = preprocess()
      tokenizer.write(prepare('A\t😀\r', undefined, false))
      const events = tokenizer.write(prepare('\nB', undefined, true))
      assert.equal(
        fn,
        tokenizer.sliceSerialize,
        'Stable serializer identity across streaming writes',
      )
      assert.ok(
        events.every((event) => typeof event[2].sliceStream === 'function' && event[2].parser),
      )
      const range = { start: events[0][1].start, end: events.at(-1)[1].end }
      assert.equal(fn(range), 'A\t😀\r\nB')
      assert.equal(fn(range, true), 'A   😀\r\nB')
      return { fn, range, weak: new WeakRef(tokenizer) }
    }
    const borrowed = retainedSerializer()
    for (let index = 0; index < 8; index++) {
      await immediate()
      global.gc()
    }
    await immediate()
    const serializerKeepsTokenizer = Boolean(borrowed.weak.deref())
    assert.equal(serializerKeepsTokenizer, original && !replay)
    assert.equal(borrowed.fn(borrowed.range), 'A\t😀\r\nB')
    console.log(
      JSON.stringify({
        original,
        checks,
        rawEventChecks,
        loaded: [...loaded],
        serializerKeepsTokenizer,
      }),
    )
  } finally {
    await server.close()
    hooks.deregister()
  }
}
