import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { setImmediate as immediate } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { semanticCorpus } from '../fixtures/semantic-corpus.mjs'

const sha = (value) => createHash('sha256').update(value).digest('hex')
const MiB = 1024 * 1024
const limits = { working: 32 * MiB, nodes: 800000, depth: 512 }
const lifetime = process.argv.includes('--lifetime')
const child = process.argv.indexOf('--child')
if (child < 0) {
  await mkdir('test/artifacts/logs', { recursive: true })
  const output = await mkdtemp(resolve('test/artifacts/logs/packed-markdown-'))
  await copyFile(fileURLToPath(import.meta.url), resolve(output, 'driver.mjs'))
  const results = []
  for (const development of [false, true]) {
    const result = await new Promise((accept, reject) => {
      const worker = spawn(
        process.execPath,
        [
          ...(lifetime ? ['--expose-gc'] : []),
          ...(development ? ['--conditions=development'] : []),
          fileURLToPath(import.meta.url),
          '--child',
          output,
          ...(lifetime ? ['--lifetime'] : []),
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      let stdout = ''
      let stderr = ''
      worker.stdout.on('data', (data) => {
        stdout += data
      })
      worker.stderr.on('data', (data) => {
        stderr += data
      })
      worker.on('error', reject)
      worker.on('close', (code) =>
        code === 0 ? accept(JSON.parse(stdout)) : reject(new Error(stderr + stdout)),
      )
    })
    results.push(result)
  }
  // Actual parse/description timings can intern as one scalar in only one run.
  // Each child checks exact bytes against its timing-matched independent oracle;
  // cross-process equality concerns all semantic fields and render/layout output.
  const comparable = (checks) =>
    lifetime ? checks : checks.map(({ bytes: _bytes, ...check }) => check)
  assert.deepEqual(comparable(results[0].checks), comparable(results[1].checks))
  const report = {
    status: 'verified',
    method: lifetime
      ? 'Separate forced-GC diagnostics. Witness native nodes/positions at the actual owned-array handoff, hold active/completed/cancelled encoder and input handles, compare complete packet bytes against independent ordinary encoding. Freeze the diagnostic clock for exact packet hashes; never decode a complete root in this mode. Reachability only, not physical peak or throughput.'
      : 'Separate default/development processes. Actual streamed Markdown packets versus independent whole-tree parse/ordinary encoding; complete decoded roots and metadata, exact packet bytes with matched timing values, and full projection/layout under both grammars and HTML policies. No GC, dependency substitution or timing acceptance claim.',
    lifetime,
    results,
  }
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ output, ...report }))
} else {
  const output = process.argv[child + 1]
  const development = process.execArgv.includes('--conditions=development')
  const label = `${lifetime ? 'lifetime' : 'fidelity'}-${development ? 'development' : 'default'}`
  const bindings = []
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context)
      if (
        url.endsWith('/mdast-util-from-markdown/lib/index.js') ||
        url.endsWith('/mdast-util-from-markdown/dev/lib/index.js')
      ) {
        const source =
          typeof result.source === 'string'
            ? result.source
            : Buffer.from(result.source).toString('utf8')
        bindings.push({ url, sha256: sha(source) })
      }
      return result
    },
  })
  const base = `${resolve('.').replaceAll('\\', '/')}/`
  const evaluated = new Map()
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
    plugins: [
      {
        name: 'packed-markdown-source-binding',
        enforce: 'pre',
        async transform(code, id) {
          const full = id.replaceAll('\\', '/').split('?')[0]
          if (!full.startsWith(base)) return
          const path = full.slice(base.length)
          if (!path.startsWith('packages/') || !path.endsWith('.ts')) return
          const hash = sha(code)
          assert.equal(hash, sha(await readFile(path)), path)
          evaluated.set(path, hash)
          await writeFile(resolve(output, `${label}-${path.replaceAll('/', '__')}.txt`), code)
          return {
            code: `${code}\n;(globalThis.__manuslipPackedMarkdownBindings ??= {})[${JSON.stringify(path)}]=${JSON.stringify(hash)};\n`,
            map: null,
          }
        },
      },
    ],
  })
  try {
    const { packMarkdownDocumentSteps } = await server.ssrLoadModule(
      '/packages/core/src/packing-markdown.ts',
    )
    const { PackedArrayInput } = await server.ssrLoadModule(
      '/packages/core/src/packing-input-array.ts',
    )
    const { packValue, unpackValue } = await server.ssrLoadModule('/packages/core/src/packing.ts')
    const { finishPackedSteps } = await server.ssrLoadModule('/packages/core/src/packing-work.ts')
    const { parseMarkdown } = await server.ssrLoadModule('/packages/core/src/parse.ts')
    const checks = []
    const observations = []
    const held = []
    const normalizeDocument = ({ timings: _timings, ...document }) => document
    const encode = (source, syntax) => {
      const work = packMarkdownDocumentSteps(source, 8 * MiB, limits, syntax)
      const packet = finishPackedSteps(work)
      assert.ok(packet instanceof ArrayBuffer)
      return packet
    }
    if (!lifetime) {
      const { renderProjectionLayout } = await server.ssrLoadModule(
        '/packages/renderer/src/projection-layout.ts',
      )
      const examples = JSON.parse(
        await readFile('packages/core/test/fixtures/commonmark-0.31.2/spec.json', 'utf8'),
      )
      const cases = examples.map((example) => ({
        name: `commonmark-${example.example}`,
        text: example.markdown,
      }))
      for (const [name, body] of semanticCorpus) cases.push({ name, text: `# ${name}\n\n${body}` })
      const extension =
        '---\ntitle: fixture\n---\n\n# heading\n\n> > nested **words** *em* ~~del~~ [link][r] ![alt](/image "title")\n\n1. first\n2. second\n\n- [x] task\n\n| left | right |\n| :--- | ---: |\n| a | b |\n\n~~~js title\ncode\n~~~\n\n$x+y$\n\n$$\nx+y\n$$\n\n<div>html</div>\n\n---\n\n[r]: /target "title"\n\ncall[^a]\n\n[^a]: footnote\n'
      for (const [index, text] of [
        extension,
        extension.replaceAll('\n', '\r\n'),
        `\ufeff${extension}`,
        '界😀\ud800\twords\rnext\n\udfff',
        '',
      ].entries())
        cases.push({ name: `extension-${index}`, text })
      const fragments = [
        'plain words',
        '> quoted',
        '> > nested **strong**',
        '- [x] task',
        '1. numbered',
        '[link][r]',
        '[r]: /url "title"',
        'call[^n]',
        '[^n]: footnote',
        '| a | b |\n| --- | --- |\n| c | d |',
        '```js\ncode\n```',
        '---',
        '$$\nx+y\n$$',
        '*em* ~~strike~~',
        'a\ncontinued',
        '<div>html</div>',
        'www.example.invalid',
        '[label](/url)',
        'word  \nbreak',
        '\tindented',
        '```\nunterminated',
        '&amp; \\*escaped*',
      ]
      let seed = 0x91a24b53
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return seed
      }
      for (let index = 0; index < 1024; index++)
        cases.push({
          name: `generated-${index}`,
          text: Array.from(
            { length: 2 + (random() % 12) },
            () => fragments[random() % fragments.length],
          ).join(index % 3 ? '\n\n' : '\r\n\r\n'),
        })
      for (const { name, text } of cases)
        for (const syntax of ['commonmark', 'manuslip']) {
          const expected = parseMarkdown(text, syntax)
          const packet = encode(text, syntax)
          const actual = unpackValue(packet, {
            bytes: 8 * MiB,
            retained: 32 * MiB,
            staging: 8 * MiB,
          }).value
          assert.deepEqual(
            normalizeDocument(actual),
            normalizeDocument(expected),
            `${name} ${syntax}`,
          )
          const oraclePacket = packValue({ ...expected, timings: actual.timings }, 8 * MiB, limits)
          assert.deepEqual(
            new Uint8Array(packet),
            new Uint8Array(oraclePacket),
            `${name} ${syntax} bytes`,
          )
          assert.ok(actual.timings.parse >= 0 && actual.timings.describe >= 0)
          const digests = []
          for (const rawHtml of [false, true]) {
            const options = {
              rawHtml,
              footnotesLabel: 'Notes 世界',
              footnoteBackLabel: 'Back 返回',
            }
            const before = renderProjectionLayout(expected.root, options, 64 * MiB)
            const after = renderProjectionLayout(actual.root, options, 64 * MiB)
            const normalize = (value) => ({
              ...value,
              projection: { ...value.projection, renderMs: 0 },
            })
            assert.deepEqual(normalize(after), normalize(before), `${name} ${syntax} layout`)
            digests.push(sha(JSON.stringify(normalize(after))))
          }
          checks.push({
            name,
            syntax,
            sha256: sha(JSON.stringify(normalizeDocument(actual))),
            bytes: packet.byteLength,
            digests,
          })
        }
    } else {
      assert.equal(typeof global.gc, 'function')
      // This mode makes no timing claims. A frozen clock permits exact packet hashes
      // without materializing any decoded root while native lifetime is observed.
      Object.defineProperty(performance, 'now', { configurable: true, value: () => 0 })
      const collect = async (references) => {
        for (let round = 0; round < 8; round++) {
          await immediate()
          global.gc()
        }
        return references.filter((reference) => reference.deref() !== undefined).length
      }
      const witness = (node, references) => {
        const pending = [node]
        while (pending.length) {
          const current = pending.pop()
          references.push(new WeakRef(current))
          for (const value of Object.values(current))
            if (value && typeof value === 'object') pending.push(value)
        }
      }
      const oracle = (source) => {
        const document = parseMarkdown(source)
        const packet = packValue(document, 8 * MiB, limits)
        return {
          rootChildren: document.root.children.length,
          sha256: sha(new Uint8Array(packet)),
          bytes: packet.byteLength,
        }
      }
      const originalOwn = PackedArrayInput.own
      let observing
      PackedArrayInput.own = (...args) => {
        const owned = originalOwn(...args)
        const children = args[0][0]
        held.push(...args[0])
        return {
          ...owned,
          next(record) {
            const step = owned.next(record)
            if (record.input === children && !step.done) {
              observing.count++
              if (
                observing.phase ||
                observing.count <= observing.observed ||
                observing.count === observing.rootChildren
              )
                witness(step.value, observing.references)
              if (!observing.phase && observing.count <= observing.observed)
                witness(step.value, observing.active)
            }
            return step
          },
        }
      }
      try {
        for (const [name, body] of semanticCorpus) {
          const source = `# ${name}\n\n${body}`
          const expected = oracle(source)
          observing = {
            ...expected,
            observed: Math.min(32, expected.rootChildren - 1),
            count: 0,
            references: [],
            active: [],
          }
          const work = packMarkdownDocumentSteps(source, 8 * MiB, limits)
          held.push(work)
          while (observing.count <= observing.observed) assert.equal(work.next().done, false)
          const activeSurvivors = await collect(observing.active)
          assert.equal(
            activeSurvivors,
            0,
            `${name}: earlier native nodes retained by active encoding`,
          )
          const packet = finishPackedSteps(work)
          assert.ok(packet instanceof ArrayBuffer)
          assert.equal(sha(new Uint8Array(packet)), expected.sha256, `${name} complete packet`)
          assert.equal(packet.byteLength, expected.bytes)
          assert.equal(observing.count, expected.rootChildren)
          const closedSurvivors = await collect(observing.references)
          assert.equal(
            closedSurvivors,
            0,
            `${name}: completed work/input handles retain native nodes`,
          )
          observations.push({
            name,
            activeWitnesses: observing.active.length,
            activeSurvivors,
            closedWitnesses: observing.references.length,
            closedSurvivors,
          })
          checks.push({ name, ...expected })
          for (const phase of ['before', 'suspended', 'throw', 'wire failure']) {
            observing = { phase, count: 0, references: [] }
            const cancelled = packMarkdownDocumentSteps(
              source,
              phase === 'wire failure' ? 64 : 8 * MiB,
              limits,
            )
            held.push(cancelled)
            if (phase === 'wire failure') assert.throws(() => finishPackedSteps(cancelled), /limit/)
            else {
              if (phase !== 'before')
                while (observing.count < 2) assert.equal(cancelled.next().done, false)
              if (phase === 'throw') {
                const failure = new Error('consumer cancelled')
                assert.throws(
                  () => cancelled.throw(failure),
                  (error) => error === failure,
                )
              } else cancelled.return()
            }
            assert.deepEqual(cancelled.next(), { done: true, value: undefined })
            const survivors = await collect(observing.references)
            assert.equal(survivors, 0, `${name} ${phase}: closed handles retain native nodes`)
            observations.push({ name, phase, witnesses: observing.references.length, survivors })
          }
        }
      } finally {
        PackedArrayInput.own = originalOwn
      }
      assert.equal(held.length, semanticCorpus.length * 5 * 4)
    }
    assert.equal(new Set(bindings.map(({ url }) => url)).size, 1, JSON.stringify(bindings))
    assert.ok(bindings[0].url.endsWith(`/${development ? 'dev/' : ''}lib/index.js`))
    assert.equal(bindings[0].sha256, sha(await readFile(new URL(bindings[0].url))))
    for (const [path, hash] of evaluated)
      assert.equal(globalThis.__manuslipPackedMarkdownBindings[path], hash, `${path} evaluation`)
    for (const path of [
      'packing.ts',
      'packing-markdown.ts',
      'packing-input-array.ts',
      'markdown-block-stream.ts',
      'packing-work.ts',
    ])
      assert.ok(evaluated.has(`packages/core/src/${path}`), path)
    const result = {
      development,
      checks,
      observations,
      heldHandles: held.length,
      bindings,
      evaluated: [...evaluated],
    }
    const path = resolve(output, `${label}.json`)
    await writeFile(path, `${JSON.stringify(result, null, 2)}\n`)
    console.log(
      JSON.stringify({
        path,
        sha256: sha(await readFile(path)),
        checks,
        observations,
        heldHandles: held.length,
      }),
    )
  } finally {
    await server.close()
    hooks.deregister()
  }
}
