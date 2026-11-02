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
const child = process.argv.indexOf('--child')
const lifetime = process.argv.includes('--lifetime')
if (child < 0) {
  await mkdir('test/artifacts/logs', { recursive: true })
  const output = await mkdtemp(resolve('test/artifacts/logs/markdown-block-stream-'))
  await copyFile(fileURLToPath(import.meta.url), resolve(output, 'driver.mjs'))
  const results = []
  for (const development of [false, true]) {
    const result = await new Promise((resolveChild, reject) => {
      const processChild = spawn(
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
      let stdout = '',
        stderr = ''
      processChild.stdout.on('data', (data) => {
        stdout += data
      })
      processChild.stderr.on('data', (data) => {
        stderr += data
      })
      processChild.on('error', reject)
      processChild.on('close', (code) =>
        code === 0 ? resolveChild(JSON.parse(stdout)) : reject(new Error(stderr + stdout)),
      )
    })
    results.push(result)
  }
  assert.deepEqual(results[0].checks, results[1].checks)
  const report = {
    status: 'verified',
    method: lifetime
      ? 'Separate forced-GC diagnostics over actual application block streams. Hold active and closed handles while observing handed-off nodes; verify full ordered child and metadata hashes separately from lifetime. Not a physical peak or throughput measurement.'
      : 'Separate default/development Node processes; actual application block API versus independent whole-tree parse and full projection/layout under both grammars/HTML policies. No dependency substitution, GC or timing acceptance claim.',
    lifetime,
    results,
  }
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    JSON.stringify({ output, ...report, results: results.map(({ checks, ...row }) => row) }),
  )
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
        name: 'markdown-block-source-binding',
        enforce: 'pre',
        async transform(code, id) {
          const full = id.replaceAll('\\', '/').split('?')[0]
          if (!full.startsWith(base)) return
          const path = full.slice(base.length)
          if (!path.startsWith('packages/') || !path.endsWith('.ts')) return
          assert.equal(sha(code), sha(await readFile(path)), path)
          const hash = sha(code)
          evaluated.set(path, hash)
          await writeFile(resolve(output, `${label}-${path.replaceAll('/', '__')}.txt`), code)
          return {
            code: `${code}\n;(globalThis.__manuslipBlockBindings ??= {})[${JSON.stringify(path)}]=${JSON.stringify(hash)};\n`,
            map: null,
          }
        },
      },
    ],
  })
  try {
    const { markdownBlockSteps, markdownBlockPause } = await server.ssrLoadModule(
      '/packages/core/src/markdown-block-stream.ts',
    )
    const { parseMarkdown } = await server.ssrLoadModule('/packages/core/src/parse.ts')
    const checks = []
    const observations = []
    const nextBlock = (stream) => {
      let step
      do step = stream.next()
      while (!step.done && step.value === markdownBlockPause)
      return step
    }
    const metadata = ({ timings: _timings, root, ...rest }) => {
      const { children: _children, ...rootMetadata } = root
      return { ...rest, root: rootMetadata }
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
        '界😀\ud800\twords\rnext\n',
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
          const stream = markdownBlockSteps(text, syntax)
          const children = []
          let step = nextBlock(stream)
          while (!step.done) {
            children.push(step.value)
            step = nextBlock(stream)
          }
          assert.ok(step.value, name)
          const actual = {
            ...step.value,
            root: Object.assign({ type: 'root', children }, step.value.root),
          }
          assert.deepEqual(metadata(actual), metadata(expected), `${name} ${syntax} metadata`)
          assert.deepEqual(actual.root, expected.root, `${name} ${syntax} root`)
          const digests = []
          for (const rawHtml of [false, true]) {
            const options = {
              rawHtml,
              footnotesLabel: 'Notes 世界',
              footnoteBackLabel: 'Back 返回',
            }
            const before = renderProjectionLayout(expected.root, options, 64 * 1024 * 1024)
            const after = renderProjectionLayout(actual.root, options, 64 * 1024 * 1024)
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
            sha256: sha(JSON.stringify({ ...metadata(actual), children })),
            digests,
          })
        }
    } else {
      assert.equal(typeof global.gc, 'function')
      const collect = async (witnesses) => {
        for (let round = 0; round < 8; round++) {
          await immediate()
          global.gc()
        }
        return witnesses.filter((reference) => reference.deref() !== undefined).length
      }
      const witnessTree = (node, references) => {
        const pending = [node]
        while (pending.length) {
          const current = pending.pop()
          references.push(new WeakRef(current))
          if (current.children) for (const child of current.children) pending.push(child)
        }
      }
      const held = []
      for (const [name, body] of semanticCorpus) {
        const source = `# ${name}\n\n${body}`
        let expected = parseMarkdown(source)
        const rootChildren = expected.root.children.length
        const expectedChildren = createHash('sha256')
        for (const node of expected.root.children)
          expectedChildren.update(JSON.stringify(node)).update('\n')
        const expectedHash = expectedChildren.digest('hex')
        const expectedMetadata = sha(JSON.stringify(metadata(expected)))
        expected = undefined
        const stream = markdownBlockSteps(source)
        held.push(stream)
        const references = []
        const activeReferences = []
        const received = createHash('sha256')
        let count = 0
        let summary
        const advance = () => {
          const step = nextBlock(stream)
          if (step.done) {
            summary = step.value
            return false
          }
          count++
          received.update(JSON.stringify(step.value)).update('\n')
          if (count <= Math.min(32, rootChildren - 1)) {
            witnessTree(step.value, references)
            witnessTree(step.value, activeReferences)
          } else if (count === rootChildren) witnessTree(step.value, references)
          return true
        }
        const observed = Math.min(32, rootChildren - 1)
        for (let index = 0; index < observed + 1; index++) assert.equal(advance(), true)
        const activeSurvivors = await collect(activeReferences)
        assert.equal(activeSurvivors, 0, `${name}: earlier handed-off nodes retained while active`)
        while (advance()) {}
        assert.equal(count, rootChildren)
        assert.equal(received.digest('hex'), expectedHash)
        assert.equal(sha(JSON.stringify(metadata(summary))), expectedMetadata)
        stream.return()
        const closedSurvivors = await collect(references)
        assert.equal(closedSurvivors, 0, `${name}: completed handle retained nodes`)
        checks.push({ name, childrenSha256: expectedHash, metadataSha256: expectedMetadata })
        observations.push({
          name,
          rootChildren,
          activeWitnesses: activeReferences.length,
          activeSurvivors,
          closedWitnesses: references.length,
          closedSurvivors,
        })
        for (const phase of ['before', 'preprocessing', 'suspended', 'throw']) {
          const cancelled = markdownBlockSteps(source)
          held.push(cancelled)
          const witnesses = []
          const advanceCancelled = () => {
            const step = nextBlock(cancelled)
            assert.equal(step.done, false)
            witnessTree(step.value, witnesses)
          }
          if (phase === 'preprocessing') {
            assert.deepEqual(cancelled.next(), { done: false, value: markdownBlockPause })
          } else if (phase !== 'before') {
            advanceCancelled()
            advanceCancelled()
          }
          if (phase === 'throw') {
            const failure = new Error('consumer cancellation')
            assert.throws(
              () => cancelled.throw(failure),
              (error) => error === failure,
            )
          } else cancelled.return()
          assert.deepEqual(cancelled.next(), { done: true, value: undefined })
          const survivors = await collect(witnesses)
          assert.equal(survivors, 0, `${name} ${phase}: cancelled handle retained nodes`)
          observations.push({ name, phase, witnesses: witnesses.length, survivors })
        }
      }
      assert.equal(held.length, semanticCorpus.length * 5)
    }
    assert.ok(bindings.length > 0)
    assert.equal(new Set(bindings.map(({ url }) => url)).size, 1, JSON.stringify(bindings))
    assert.ok(bindings[0].url.endsWith(`/${development ? 'dev/' : ''}lib/index.js`))
    assert.equal(bindings[0].sha256, sha(await readFile(new URL(bindings[0].url))))
    for (const [path, hash] of evaluated)
      assert.equal(globalThis.__manuslipBlockBindings[path], hash, `${path} evaluation`)
    const result = { development, checks, observations, bindings, evaluated: [...evaluated] }
    const path = resolve(output, `${label}.json`)
    await writeFile(path, `${JSON.stringify(result, null, 2)}\n`)
    console.log(JSON.stringify({ path, sha256: sha(await readFile(path)), checks, observations }))
  } finally {
    await server.close()
    hooks.deregister()
  }
}
