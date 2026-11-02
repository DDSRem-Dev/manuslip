import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { setImmediate as immediate } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { semanticCorpus } from '../fixtures/semantic-corpus.mjs'

const MiB = 1024 * 1024
const sha = (value) => createHash('sha256').update(value).digest('hex')
const lifetime = process.argv.includes('--lifetime')
const activeClock = process.argv.includes('--active-clock')
const child = process.argv.indexOf('--child')
if (child < 0) {
  await mkdir('test/artifacts/logs', { recursive: true })
  const output = await mkdtemp(resolve('test/artifacts/logs/packed-producer-full-'))
  await copyFile(fileURLToPath(import.meta.url), resolve(output, 'driver.mjs'))
  const children = []
  for (const development of [false, true]) {
    children.push(
      await new Promise((accept, reject) => {
        const worker = spawn(
          process.execPath,
          [
            ...(lifetime ? ['--expose-gc'] : []),
            ...(development ? ['--conditions=development'] : []),
            fileURLToPath(import.meta.url),
            '--child',
            output,
            ...(lifetime ? ['--lifetime'] : []),
            ...(activeClock ? ['--active-clock'] : []),
          ],
          { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
        )
        let stdout = '',
          stderr = ''
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
      }),
    )
  }
  const reports = await Promise.all(
    children.map(async (row) => {
      const body = await readFile(row.path)
      assert.equal(sha(body), row.sha256)
      return JSON.parse(body)
    }),
  )
  const comparable = (rows) => rows.map(({ bytes: _bytes, peak: _peak, ...row }) => row)
  assert.deepEqual(comparable(reports[0].checks), comparable(reports[1].checks))
  const report = {
    status: 'verified',
    lifetime,
    activeClock,
    children,
    method: lifetime
      ? 'Separate forced-GC processes with frozen diagnostic clocks. Actual application producer, held native array/capture inputs and completed/cancelled outer handles. Witness native MDAST nodes/arrays/positions at the handoff while parser and packed assembly remain active, then after closure. Exact complete snapshot hashes against the ordinary whole-tree parser/renderer/encoder. Grammar cancellation holds the actual classifier work and observes its first bounded slice before any tokenizer is constructed. Metadata cancellation holds actual child work and witnesses the complete first body block and accumulating metadata owner; the single-paragraph case also closes after exactly 4,096 range reads. Metrics cancellation observes the first authenticated cached character count after whole-prose EOF, with no source reads. Those owners must be live while work is suspended and collected after parent closure. No actual packet decoding during lifetime observation. Reachability only; no physical peak or throughput claim.'
      : 'Separate production/development parser exports. Actual application full producer under unchanged 16 MiB owner, 8 MiB wire/staging and 32 MiB encoder working limits. Complete documents, HTML/widgets/layout and exact timing-matched canonical packets against independent native whole-tree APIs. The synchronous application compiler must separately match each complete native document. All CommonMark examples, six full corpora, extensions, 1,024 seeded combinations, 20,000 widgets and a large escaped-code widget, in both HTML policies. Oracle expansion is outside application ledgers. No GC or performance acceptance claim.',
    checks: reports.reduce((sum, row) => sum + row.checks.length, 0),
    wholeRootComparisons: reports.reduce(
      (sum, row) => sum + row.checks.filter((check) => check.wholeRootEqual).length,
      0,
    ),
    observations: reports.reduce((sum, row) => sum + row.observations.length, 0),
  }
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ output, ...report }))
} else {
  const output = process.argv[child + 1]
  const development = process.execArgv.includes('--conditions=development')
  const label = `${lifetime ? 'lifetime' : 'fidelity'}-${development ? 'development' : 'production'}`
  const bindings = []
  const hooks = registerHooks({
    load(url, context, next) {
      const result = next(url, context)
      const tokenizer = /\/micromark\/(dev\/)?lib\/create-tokenizer\.js$/.test(url)
      const preprocessor = /\/micromark\/(dev\/)?lib\/preprocess\.js$/.test(url)
      const textResolver = /\/micromark\/(dev\/)?lib\/initialize\/text\.js$/.test(url)
      const inlineResolver =
        /\/(micromark-core-commonmark|micromark-extension-gfm-strikethrough)\/(dev\/)?lib\/(attention|syntax|label-end)\.js$/.test(
          url,
        )
      if (
        tokenizer ||
        preprocessor ||
        textResolver ||
        inlineResolver ||
        /\/mdast-util-from-markdown\/(dev\/)?lib\/index\.js$/.test(url)
      ) {
        const code =
          typeof result.source === 'string'
            ? result.source
            : Buffer.from(result.source).toString('utf8')
        const binding = { url, sha256: sha(code) }
        bindings.push(binding)
        if (lifetime && !preprocessor && !textResolver && !inlineResolver) {
          const end = development ? '' : ';'
          let injected = code
          if (tokenizer) {
            const marker = '  return context;'
            const devMarker = '  return context\n'
            const before = development ? devMarker : marker
            assert.equal(code.split(before).length, 2, 'Missing tokenizer witness hook')
            injected = injected.replace(
              before,
              `  globalThis.__manuslipTokenFeedWitness?.(context)${development ? '' : ';'}\n${before}`,
            )
            const pause = `        if (done) break${end}\n        yield${end}`
            assert.equal(injected.split(pause).length, 2, 'Missing tokenizer pause hook')
            injected = injected.replace(
              pause,
              `        if (done) break${end}\n        globalThis.__manuslipTokenFeedPause?.()${end}\n        yield${end}`,
            )
          } else {
            const from = injected.indexOf('\n// Manuslip cooperative preprocessing.\n')
            assert.ok(from > 0, 'Missing private preprocessing helper')
            let helper = injected.slice(from)
            const chunks = `  const chunks = []${end}\n`
            assert.equal(helper.split(chunks).length, 2, 'Missing preprocessing chunk witness')
            helper = helper.replace(
              chunks,
              `${chunks}  globalThis.__manuslipPreprocessWitness?.(chunks)${end}\n`,
            )
            const pause = `          scanned = 0${end}\n          yield${end}`
            assert.equal(helper.split(pause).length, 2, 'Missing preprocessing pause hook')
            helper = helper.replace(
              pause,
              `          scanned = 0${end}\n          globalThis.__manuslipPreprocessPause?.()${end}\n          yield${end}`,
            )
            injected = injected.slice(0, from) + helper
          }
          binding.injectedPath = resolve(
            output,
            `${label}-${tokenizer ? 'tokenizer' : 'compiler'}-injected.js`,
          )
          binding.injectedSha256 = sha(injected)
          writeFileSync(binding.injectedPath, injected)
          return { ...result, source: injected }
        }
      }
      return result
    },
  })
  const evaluated = new Map()
  const injections = []
  const base = `${resolve('.').replaceAll('\\', '/')}/`
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
        name: 'full-producer-source-bindings',
        enforce: 'pre',
        async transform(code, id) {
          const full = id.replaceAll('\\', '/').split('?')[0]
          if (!full.startsWith(base)) return
          const path = full.slice(base.length)
          if (!path.endsWith('.ts') || (!path.startsWith('apps/') && !path.startsWith('packages/')))
            return
          const hash = sha(code)
          assert.equal(hash, sha(await readFile(path)), path)
          evaluated.set(path, hash)
          await writeFile(resolve(output, `${label}-${path.replaceAll('/', '__')}.txt`), code)
          if (
            lifetime &&
            (path === 'packages/core/src/parse.ts' ||
              path === 'packages/core/src/markdown-description-steps.ts')
          ) {
            const replace = (from, to) => {
              assert.equal(code.split(from).length, 2, `Missing owned-work witness: ${from}`)
              code = code.replace(from, to)
            }
            const grammar = path === 'packages/core/src/parse.ts'
            if (grammar) {
              replace(
                '  return work\n}',
                '  globalThis.__manuslipGrammarWork?.(work)\n  return work\n}',
              )
              replace(
                '        if (end - at === grammarChunkUnits) yield',
                '        if (end - at === grammarChunkUnits) {globalThis.__manuslipGrammarPause?.(end);yield}',
              )
            } else
              replace(
                '  return work\n}',
                '  globalThis.__manuslipDescriptionWork?.(work,root,target)\n  return work\n}',
              )
            const injectedPath = resolve(
              output,
              `${label}-${grammar ? 'grammar' : 'description'}-injected.txt`,
            )
            const injectedSha256 = sha(code)
            await writeFile(injectedPath, code)
            injections.push({ path, originalSha256: hash, injectedPath, injectedSha256 })
            code += `\n;(globalThis.__manuslipFullProducerInjections ??= {})[${JSON.stringify(path)}]=${JSON.stringify(injectedSha256)};\n`
          }
          if (lifetime && path === 'packages/core/src/packing-source.ts') {
            const marker =
              "  if (characters === undefined) throw new Error('Invalid prepared packed source')"
            assert.equal(
              code.split(marker).length,
              2,
              'Missing authenticated source metrics witness',
            )
            code = code.replace(
              marker,
              `${marker}\n  globalThis.__manuslipSourceMetadata?.(source, characters)`,
            )
            const injectedPath = resolve(output, `${label}-source-metrics-injected.txt`)
            const injectedSha256 = sha(code)
            await writeFile(injectedPath, code)
            injections.push({ path, originalSha256: hash, injectedPath, injectedSha256 })
            code += `\n;(globalThis.__manuslipFullProducerInjections ??= {})[${JSON.stringify(path)}]=${JSON.stringify(injectedSha256)};\n`
          }
          if (lifetime && path === 'packages/renderer/src/packed-projection-journal.ts') {
            const replace = (from, to) => {
              assert.equal(code.split(from).length, 2, `Missing journal witness: ${from}`)
              code = code.replace(from, to)
            }
            replace(
              '        this.#pages.push(new Uint32Array(pageSize))',
              '        const page = new Uint32Array(pageSize)\n        globalThis.__manuslipProjectionJournalData?.(this.#pages, page)\n        this.#pages.push(page)',
            )
            replace(
              '    this.#strings.push(value)',
              '    globalThis.__manuslipProjectionJournalData?.(this.#strings)\n    this.#strings.push(value)',
            )
            replace(
              '    this.#spans = column(4)',
              '    this.#spans = column(4)\n    globalThis.__manuslipProjectionJournalCreated?.(this)',
            )
            const injectedPath = resolve(output, `${label}-journal-injected.txt`)
            const injectedSha256 = sha(code)
            await writeFile(injectedPath, code)
            injections.push({ path, originalSha256: hash, injectedPath, injectedSha256 })
            code += `\n;(globalThis.__manuslipFullProducerInjections ??= {})[${JSON.stringify(path)}]=${JSON.stringify(injectedSha256)};\n`
          }
          return {
            code: `${code}\n;(globalThis.__manuslipFullProducerBindings ??= {})[${JSON.stringify(path)}]=${JSON.stringify(hash)};\n`,
            map: null,
          }
        },
      },
    ],
  })
  try {
    const load = (path) => server.ssrLoadModule(`/${path}`)
    const { PackedSemanticProducer } = await load(
      'apps/desktop/src/renderer/src/semantics/packed-producer.ts',
    )
    const { PackedReceiver } = await load('packages/core/src/packing-receiver.ts')
    const { PackedSource } = await load('packages/core/src/packing-source.ts')
    const { PackedArrayInput, packedArrayPause } = await load(
      'packages/core/src/packing-input-array.ts',
    )
    const { PackedCaptureInput } = await load('packages/core/src/packing-input-capture.ts')
    const { PackedWork, finishPackedSteps } = await load('packages/core/src/packing-work.ts')
    const { finishPackedCleanup } = await load('packages/core/src/packing-cleanup.ts')
    const { parserVersion, sourceHash } = await load('packages/core/src/contracts.ts')
    const { rendererVersion } = await load('packages/renderer/src/index.ts')
    const { parseMarkdownNative: parseMarkdown, parseMarkdown: parseApplicationMarkdown } =
      await load('packages/core/src/parse.ts')
    const { renderProjectionLayout } = await load('packages/renderer/src/projection-layout.ts')
    const { packValue, unpackValue } = await load('packages/core/src/packing.ts')
    const encoding = { working: 32 * MiB, nodes: 800000, depth: 512 }
    const limits = {
      bytes: 8 * MiB,
      retained: 16 * MiB,
      staging: 8 * MiB,
      captures: 8,
      readers: 64,
    }
    const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
    const checks = [],
      observations = [],
      held = new Set()
    function begin(text, render = options, bytes = limits.bytes) {
      const producer = new PackedSemanticProducer(
        { ...limits, bytes },
        activeClock ? () => performance.now() : undefined,
      )
      // Only issue the exact protocol request here. Actual Worker/ACK/receiver validation
      // is measured by profile-semantic-producer/service; oracle checks below are independent.
      const receiver = new PackedReceiver({ ...limits, retained: 64 * MiB }, () => {})
      let inner, channel
      try {
        // Match the two actual host/endpoint holds as well as their reader-slot limit.
        const host = Object.freeze({})
        const endpoint = Object.freeze({})
        channel = producer.retain({
          resources: () => [
            { key: host, bytes: 4096 },
            { key: endpoint, bytes: 4096 },
          ],
        })
        const source = new PackedSource(
          {
            generation: 1,
            documentId: 'full-producer',
            revision: 0,
            sourceHash: sourceHash(text),
            parserVersion: `${parserVersion}/manuslip`,
            rendererVersion,
            options: JSON.stringify(render),
          },
          text,
        )
        const ticket = receiver.begin(1, source)
        inner = producer.prepare(
          {
            kind: 'parse',
            sequence: 1,
            generation: 1,
            documentId: 'full-producer',
            revision: 0,
            source: text,
            options: render,
            sentAt: performance.timeOrigin + performance.now(),
          },
          ticket,
        )
        let peak = 0
        const work = new PackedWork(
          (function* () {
            while (true) {
              const next = inner.next()
              peak = Math.max(peak, producer.stats.retainedBytes)
              assert.ok(peak <= limits.retained)
              if (next.done) {
                assert.equal(next.value?.kind, 'full')
                // Transfer before disposing the sender: cancellation correctly detaches
                // an untransferred offer, which is not a received diagnostic packet.
                return structuredClone(next.value, { transfer: [next.value.payload] }).payload
              }
              yield
            }
          })(),
          () =>
            finishPackedCleanup([
              () => inner.return(),
              () => channel.release(),
              () => producer.dispose(),
              () => receiver.dispose(),
            ]),
        )
        return { work, producer, peak: () => peak }
      } catch (error) {
        finishPackedCleanup(
          [
            () => inner?.return(),
            () => channel?.release(),
            () => producer.dispose(),
            () => receiver.dispose(),
          ],
          true,
        )
        throw error
      }
    }
    const stress = [
      { name: 'many-widgets', text: `# Widgets\n\n${'~~~js\nx\n~~~\n\n'.repeat(20000)}` },
      { name: 'escaped-widget', text: `# Escaped\n\n~~~html\n${'<&>"'.repeat(180000)}\n~~~\n` },
    ]
    if (!lifetime) {
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
      for (const [i, text] of [
        extension,
        extension.replaceAll('\n', '\r\n'),
        `\ufeff${extension}`,
        '界😀\ud800\twords\rnext\n\udfff',
        '',
      ].entries())
        cases.push({ name: `extension-${i}`, text })
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
      for (let i = 0; i < 1024; i++)
        cases.push({
          name: `generated-${i}`,
          text: Array.from(
            { length: 2 + (random() % 12) },
            () => fragments[random() % fragments.length],
          ).join(i % 3 ? '\n\n' : '\r\n\r\n'),
        })
      cases.push(...stress)
      for (const { name, text } of cases)
        for (const rawHtml of [false, true]) {
          const render = { ...options, rawHtml }
          const document = parseMarkdown(text)
          const applicationDocument = parseApplicationMarkdown(text)
          assert.deepEqual(
            { ...applicationDocument, timings: document.timings },
            document,
            `${name} synchronous whole-root compiler`,
          )
          const { projection, layout } = renderProjectionLayout(document.root, render, 64 * MiB)
          const started = begin(text, render)
          const packet = finishPackedSteps(started.work)
          const actual = unpackValue(packet, {
            bytes: limits.bytes,
            retained: 64 * MiB,
            staging: 32 * MiB,
          }).value
          const expected = {
            document: { ...document, timings: actual.document.timings },
            projection: { ...projection, renderMs: actual.projection.renderMs },
            layout,
          }
          assert.deepEqual(actual, expected, `${name}, raw HTML ${rawHtml}`)
          assert.deepEqual(
            new Uint8Array(packet),
            new Uint8Array(packValue(expected, limits.bytes - 1024, encoding)),
            `${name} canonical bytes`,
          )
          assert.equal(started.producer.stats.retainedBytes, 0)
          checks.push({
            name,
            rawHtml,
            wholeRootEqual: true,
            bytes: packet.byteLength,
            peak: started.peak(),
            sha256: sha(
              JSON.stringify({
                document: { ...actual.document, timings: null },
                projection: { ...actual.projection, renderMs: null },
                layout: actual.layout,
              }),
            ),
          })
        }
    } else {
      assert.equal(typeof global.gc, 'function')
      Object.defineProperty(performance, 'now', { configurable: true, value: () => 0 })
      async function collect(references) {
        for (let i = 0; i < 8; i++) {
          await immediate()
          global.gc()
        }
        return references.filter((reference) => reference.deref() !== undefined).length
      }
      function witness(node, references) {
        const pending = [node]
        while (pending.length) {
          const current = pending.pop()
          references.push(new WeakRef(current))
          for (const value of Object.values(current))
            if (value && typeof value === 'object') pending.push(value)
        }
      }
      let observing
      const countProbe = new Intl.Segmenter(undefined, { granularity: 'word' }).segment('')
      const segmentPrototype = Object.getPrototypeOf(countProbe)
      const originalWordIterator = segmentPrototype[Symbol.iterator]
      const iteratorPrototype = Object.getPrototypeOf(originalWordIterator.call(countProbe))
      const originalWordNext = iteratorPrototype.next
      const originalSourceRead = String.prototype.charCodeAt
      const originalSourceSlice = String.prototype.slice
      segmentPrototype[Symbol.iterator] = function (...args) {
        const iterator = originalWordIterator.apply(this, args)
        if (observing?.phase === 'counting') {
          observing.wordSegments.push(new WeakRef(this))
          observing.wordIterators.push(new WeakRef(iterator))
        }
        return iterator
      }
      iteratorPrototype.next = function (...args) {
        if (observing?.phase === 'counting') observing.wordCalls++
        const step = originalWordNext.apply(this, args)
        if (observing?.phase === 'metrics' && step.done) observing.metricsReady = true
        return step
      }
      const ownArray = PackedArrayInput.own,
        ownCapture = PackedCaptureInput.own
      globalThis.__manuslipProjectionJournalCreated = (journal) => held.add(journal)
      globalThis.__manuslipProjectionJournalData = (...values) => {
        if (!observing) return
        observing.journalData ??= []
        observing.journalSeen ??= new WeakSet()
        for (const value of values)
          if (!observing.journalSeen.has(value)) {
            observing.journalSeen.add(value)
            observing.journalData.push(new WeakRef(value))
          }
      }
      PackedCaptureInput.own = (...args) => {
        for (const input of args[0]) held.add(input)
        const owned = ownCapture(...args)
        return {
          ...owned,
          adopt(inputs) {
            for (const input of inputs) held.add(input)
            return owned.adopt(inputs)
          },
        }
      }
      PackedArrayInput.own = (...args) => {
        for (const input of args[0]) held.add(input)
        const owned = ownArray(...args)
        return {
          ...owned,
          adopt(inputs) {
            for (const input of inputs) held.add(input)
            return owned.adopt(inputs)
          },
          next(record) {
            const next = owned.next(record)
            if (observing && !next.done && next.value === packedArrayPause)
              observing.tokenPauses = (observing.tokenPauses ?? 0) + 1
            if (observing && !next.done && next.value && typeof next.value.type === 'string') {
              observing.count++
              if (observing.count <= 32 || observing.count === observing.rootChildren)
                witness(next.value, observing.references)
              if (observing.count <= observing.observed) witness(next.value, observing.active)
            }
            return next
          },
        }
      }
      try {
        for (const [name, body] of semanticCorpus) {
          const text = `# ${name}\n\n${body}`
          const expected = (() => {
            const document = parseMarkdown(text)
            const { projection, layout } = renderProjectionLayout(document.root, options, 64 * MiB)
            const packet = packValue(
              { document, projection, layout },
              limits.bytes - 1024,
              encoding,
            )
            return {
              rootChildren: document.root.children.length,
              characters: document.counts.characters,
              bytes: packet.byteLength,
              sha256: sha(new Uint8Array(packet)),
            }
          })()
          observing = {
            ...expected,
            observed: Math.min(32, expected.rootChildren - 1),
            count: 0,
            references: [],
            active: [],
          }
          const started = begin(text)
          held.add(started.work)
          while (observing.count <= observing.observed)
            assert.equal(started.work.next().done, false)
          const activeSurvivors = await collect(observing.active)
          assert.equal(activeSurvivors, 0, `${name}: active native encoding`)
          while (started.producer.stats.phase !== 'encode')
            assert.equal(started.work.next().done, false)
          const stagedSurvivors = await collect(observing.references)
          assert.equal(stagedSurvivors, 0, `${name}: active packed assembly retains native nodes`)
          const journalData = observing.journalData ?? []
          const activeJournalSurvivors = await collect(journalData)
          assert.ok(activeJournalSurvivors > 0, `${name}: missing active journal data`)
          const packet = finishPackedSteps(started.work)
          assert.equal(sha(new Uint8Array(packet)), expected.sha256, `${name}: complete snapshot`)
          assert.equal(packet.byteLength, expected.bytes)
          assert.equal(observing.count, expected.rootChildren)
          const closedSurvivors = await collect(observing.references)
          assert.equal(closedSurvivors, 0, `${name}: closed handles`)
          const closedJournalSurvivors = await collect(journalData)
          assert.equal(closedJournalSurvivors, 0, `${name}: closed journal retains data`)
          observations.push({
            name,
            activeWitnesses: observing.active.length,
            activeSurvivors,
            stagedWitnesses: observing.references.length,
            stagedSurvivors,
            closedWitnesses: observing.references.length,
            closedSurvivors,
            journalWitnesses: journalData.length,
            activeJournalSurvivors,
            closedJournalSurvivors,
          })
          checks.push({ name, ...expected })
          for (const phase of [
            'before',
            'grammar',
            'preprocessing',
            'tokenizing',
            'describing',
            ...(name === 'single-paragraph' ? ['hashing'] : []),
            'counting',
            'metrics',
            'journal',
            'assembly',
            'suspended',
            'throw',
            'wire failure',
          ]) {
            observing = {
              phase,
              wordSegments: [],
              wordIterators: [],
              wordCalls: 0,
              sourceReads: 0,
              sourceMetadataReads: 0,
              metricsReady: false,
              grammarReady: false,
              grammarSlices: 0,
              grammarSliceUnits: 0,
              grammarUnits: 0,
              descriptionReads: 0,
              rootChildren: expected.rootChildren,
              count: 0,
              observed: 0,
              references: [],
              active: [],
            }
            const tokenizers = []
            const preprocessed = []
            const grammarWorks = []
            const descriptionWorks = []
            const descriptionOwners = []
            if (phase === 'describing' || phase === 'hashing') {
              globalThis.__manuslipDescriptionWork = (work, root, target) => {
                if (root.type === 'heading' || descriptionWorks.length) return
                descriptionWorks.push(work)
                held.add(work)
                descriptionOwners.push(new WeakRef(root), new WeakRef(target))
                witness(root, observing.references)
                witness(target, observing.references)
              }
              String.prototype.charCodeAt = function (index) {
                if (descriptionWorks.length && this === text) observing.descriptionReads++
                return originalSourceRead.call(this, index)
              }
            }
            if (phase === 'grammar') {
              globalThis.__manuslipGrammarWork = (work) => {
                grammarWorks.push(work)
                held.add(work)
                observing.grammarReady = true
              }
              globalThis.__manuslipGrammarPause = (units) => {
                observing.grammarUnits = units
              }
              String.prototype.slice = function (start, end) {
                if (observing.grammarReady && this === text) {
                  observing.grammarSlices++
                  observing.grammarSliceUnits += end - start
                }
                return originalSourceSlice.call(this, start, end)
              }
            }
            if (phase === 'metrics') {
              globalThis.__manuslipSourceMetadata = (source, characters) => {
                assert.equal(observing.metricsReady, true)
                assert.equal(source.text, text)
                assert.equal(characters, expected.characters)
                observing.sourceMetadataReads++
              }
              String.prototype.charCodeAt = function (index) {
                if (observing.metricsReady && this === text) observing.sourceReads++
                return originalSourceRead.call(this, index)
              }
            }
            if (phase === 'grammar' || phase === 'preprocessing' || phase === 'tokenizing') {
              globalThis.__manuslipTokenFeedWitness = (context) =>
                tokenizers.push(new WeakRef(context))
              globalThis.__manuslipPreprocessWitness = (chunks) =>
                preprocessed.push(new WeakRef(chunks))
              globalThis.__manuslipPreprocessPause = () => {
                observing.preprocessPauses = (observing.preprocessPauses ?? 0) + 1
              }
              globalThis.__manuslipTokenFeedPause = () => {
                observing.tokenFeedPauses = (observing.tokenFeedPauses ?? 0) + 1
              }
            }
            const cancelled = begin(text, options, phase === 'wire failure' ? 64 : limits.bytes)
            held.add(cancelled.work)
            if (phase === 'wire failure')
              assert.throws(() => finishPackedSteps(cancelled.work), /limit/)
            else {
              if (phase === 'grammar') {
                while (!observing.grammarUnits) assert.equal(cancelled.work.next().done, false)
                assert.equal(observing.grammarUnits, 4089)
                assert.equal(observing.grammarSlices, 1)
                assert.equal(observing.grammarSliceUnits, 4089)
                assert.equal(observing.count, 0)
                assert.equal(grammarWorks.length, 1)
                assert.equal(tokenizers.length, 0)
                assert.equal(preprocessed.length, 0)
              } else if (phase === 'describing' || phase === 'hashing') {
                while (!descriptionWorks.length) assert.equal(cancelled.work.next().done, false)
                assert.equal(observing.descriptionReads, 0)
                if (phase === 'hashing') {
                  while (observing.descriptionReads < 4096)
                    assert.equal(cancelled.work.next().done, false)
                  assert.equal(observing.descriptionReads, 4096)
                }
                assert.equal(observing.count, 1, `${name}: incomplete body handed off`)
                assert.equal(descriptionWorks.length, 1)
                assert.equal(
                  await collect(descriptionOwners),
                  2,
                  `${name}: metadata owners missing`,
                )
              } else if (phase === 'metrics') {
                while (!observing.sourceMetadataReads)
                  assert.equal(cancelled.work.next().done, false)
                assert.equal(
                  observing.sourceMetadataReads,
                  1,
                  `${name}: missed source metrics borrow`,
                )
                assert.equal(observing.sourceReads, 0, `${name}: cached metrics reread source`)
                assert.equal(observing.metricsReady, true)
                assert.equal(observing.count, expected.rootChildren)
              } else if (phase === 'counting') {
                while (observing.wordCalls < 16) assert.equal(cancelled.work.next().done, false)
                assert.equal(
                  observing.wordCalls,
                  16,
                  `${name}: word count did not pause at sixteen native calls`,
                )
                assert.equal(
                  observing.count,
                  expected.rootChildren,
                  `${name}: count started before complete block handoff`,
                )
                assert.equal(observing.wordSegments.length, 1)
                assert.equal(observing.wordIterators.length, 1)
                assert.equal(
                  await collect(observing.wordIterators),
                  1,
                  `${name}: paused native iterator not owned`,
                )
              } else if (phase === 'preprocessing' || phase === 'tokenizing') {
                const counter = phase === 'preprocessing' ? 'preprocessPauses' : 'tokenFeedPauses'
                while (!observing[counter]) assert.equal(cancelled.work.next().done, false)
                assert.equal(observing.count, 0, `${name}: token feeding already compiled nodes`)
                assert.ok(tokenizers.length > 0, `${name}: missing actual tokenizer witnesses`)
                assert.equal(preprocessed.length, 1, `${name}: missing actual preprocessing chunks`)
                if (phase === 'preprocessing') assert.equal(observing.tokenFeedPauses ?? 0, 0)
              } else if (phase === 'journal') {
                while (!observing.journalData?.length)
                  assert.equal(cancelled.work.next().done, false)
                assert.ok(
                  await collect(observing.journalData),
                  `${name}: missing paused journal data`,
                )
              } else if (phase === 'assembly') {
                while (cancelled.producer.stats.phase !== 'encode')
                  assert.equal(cancelled.work.next().done, false)
                assert.ok(
                  await collect(observing.journalData ?? []),
                  `${name}: missing assembly journal data`,
                )
              } else if (phase !== 'before')
                while (observing.count < 2) assert.equal(cancelled.work.next().done, false)
              if (phase === 'throw') {
                const failure = new Error('consumer cancelled')
                assert.throws(
                  () => cancelled.work.throw(failure),
                  (error) => error === failure,
                )
              } else cancelled.work.return()
            }
            assert.deepEqual(cancelled.work.next(), { done: true, value: undefined })
            String.prototype.charCodeAt = originalSourceRead
            String.prototype.slice = originalSourceSlice
            if (phase === 'grammar') {
              assert.equal(observing.grammarSlices, 1)
              for (const work of grammarWorks)
                assert.deepEqual(work.next(), { done: true, value: undefined })
            }
            if (phase === 'metrics') {
              assert.equal(observing.sourceMetadataReads, 1)
              assert.equal(observing.sourceReads, 0)
            }
            globalThis.__manuslipSourceMetadata = undefined
            if (phase === 'describing' || phase === 'hashing') {
              for (const work of descriptionWorks)
                assert.deepEqual(work.next(), { done: true, value: undefined })
              assert.equal(observing.descriptionReads, phase === 'hashing' ? 4096 : 0)
            }
            globalThis.__manuslipDescriptionWork = undefined
            assert.equal(cancelled.producer.stats.retainedBytes, 0)
            globalThis.__manuslipTokenFeedWitness = undefined
            globalThis.__manuslipGrammarWork = undefined
            globalThis.__manuslipGrammarPause = undefined
            globalThis.__manuslipPreprocessWitness = undefined
            globalThis.__manuslipPreprocessPause = undefined
            globalThis.__manuslipTokenFeedPause = undefined
            for (const reference of preprocessed) assert.equal(reference.deref()?.length, 0)
            const preprocessSurvivors = preprocessed.length ? await collect(preprocessed) : 0
            assert.equal(
              preprocessSurvivors,
              0,
              `${name} ${phase}: cancelled preprocessing retained`,
            )
            const tokenizerSurvivors = tokenizers.length ? await collect(tokenizers) : 0
            assert.equal(tokenizerSurvivors, 0, `${name} ${phase}: cancelled tokenizers retained`)
            const survivors = await collect(observing.references)
            assert.equal(survivors, 0, `${name} ${phase}`)
            const journalData = observing.journalData ?? []
            const journalSurvivors = await collect(journalData)
            assert.equal(journalSurvivors, 0, `${name} ${phase}: journal data retained`)
            const wordSegmentSurvivors = await collect(observing.wordSegments)
            const wordIteratorSurvivors = await collect(observing.wordIterators)
            const descriptionSurvivors = await collect(descriptionOwners)
            assert.equal(descriptionSurvivors, 0, `${name} ${phase}: metadata owners retained`)
            assert.equal(wordSegmentSurvivors, 0, `${name} ${phase}: closed Segments retained`)
            assert.equal(
              wordIteratorSurvivors,
              0,
              `${name} ${phase}: closed native iterator retained`,
            )
            observations.push({
              name,
              phase,
              witnesses: observing.references.length,
              survivors,
              tokenizerWitnesses: tokenizers.length,
              tokenizerSurvivors,
              preprocessWitnesses: preprocessed.length,
              preprocessSurvivors,
              preprocessPauses: observing.preprocessPauses ?? 0,
              tokenFeedPauses: observing.tokenFeedPauses ?? 0,
              wordSegmentWitnesses: observing.wordSegments.length,
              wordIteratorWitnesses: observing.wordIterators.length,
              wordSegmentSurvivors,
              wordIteratorSurvivors,
              wordCalls: observing.wordCalls,
              sourceReads: observing.sourceReads,
              sourceMetadataReads: observing.sourceMetadataReads,
              metricsReady: observing.metricsReady,
              grammarWorkHandles: grammarWorks.length,
              grammarSlices: observing.grammarSlices,
              grammarSliceUnits: observing.grammarSliceUnits,
              grammarUnits: observing.grammarUnits,
              descriptionWorkHandles: descriptionWorks.length,
              descriptionReads: observing.descriptionReads,
              descriptionOwnerWitnesses: descriptionOwners.length,
              descriptionSurvivors,
              journalWitnesses: journalData.length,
              journalSurvivors,
            })
          }
        }
      } finally {
        segmentPrototype[Symbol.iterator] = originalWordIterator
        iteratorPrototype.next = originalWordNext
        String.prototype.charCodeAt = originalSourceRead
        String.prototype.slice = originalSourceSlice
        globalThis.__manuslipGrammarWork = undefined
        globalThis.__manuslipGrammarPause = undefined
        globalThis.__manuslipDescriptionWork = undefined
        globalThis.__manuslipSourceMetadata = undefined
        globalThis.__manuslipTokenFeedWitness = undefined
        globalThis.__manuslipPreprocessWitness = undefined
        globalThis.__manuslipPreprocessPause = undefined
        globalThis.__manuslipTokenFeedPause = undefined
        PackedArrayInput.own = ownArray
        PackedCaptureInput.own = ownCapture
        globalThis.__manuslipProjectionJournalCreated = undefined
        globalThis.__manuslipProjectionJournalData = undefined
      }
    }
    assert.equal(new Set(bindings.map((row) => row.url)).size, 7)
    for (const [name, file] of [
      ['micromark-core-commonmark', 'label-end'],
      ['micromark-core-commonmark', 'attention'],
      ['micromark-extension-gfm-strikethrough', 'syntax'],
    ])
      assert.ok(
        bindings.some((row) =>
          row.url.endsWith(`/${name}/${development ? 'dev/' : ''}lib/${file}.js`),
        ),
      )
    assert.ok(
      bindings.some((row) =>
        row.url.endsWith(`/mdast-util-from-markdown/${development ? 'dev/' : ''}lib/index.js`),
      ),
    )
    assert.ok(
      bindings.some((row) =>
        row.url.endsWith(`/micromark/${development ? 'dev/' : ''}lib/create-tokenizer.js`),
      ),
    )
    for (const binding of bindings)
      assert.equal(binding.sha256, sha(await readFile(new URL(binding.url))))
    for (const [path, hash] of evaluated)
      assert.equal(globalThis.__manuslipFullProducerBindings[path], hash, path)
    for (const row of injections) {
      assert.equal(sha(await readFile(row.injectedPath)), row.injectedSha256)
      assert.equal(globalThis.__manuslipFullProducerInjections[row.path], row.injectedSha256)
    }
    for (const path of [
      'packages/core/src/markdown-label-resolve-steps.ts',
      'packages/core/src/packing-source.ts',
      'apps/desktop/src/renderer/src/semantics/packed-producer-full.ts',
      'packages/core/src/packing-markdown.ts',
      'packages/core/src/packing-input-capture.ts',
      'packages/core/src/packing-string-records.ts',
      'packages/renderer/src/packed-projection-plan.ts',
      'packages/renderer/src/packed-projection-journal.ts',
      'packages/renderer/src/packed-projection-plan-validated.ts',
      'packages/core/src/packing-sequence.ts',
      'packages/renderer/src/packed-widget-ranges.ts',
    ])
      assert.ok(evaluated.has(path), path)
    const path = resolve(output, `${label}.json`)
    await writeFile(
      path,
      `${JSON.stringify({ development, checks, observations, heldHandles: held.size, bindings, injections, evaluated: [...evaluated] }, null, 2)}\n`,
    )
    console.log(
      JSON.stringify({
        path,
        sha256: sha(await readFile(path)),
        checks: checks.length,
        observations: observations.length,
        heldHandles: held.size,
      }),
    )
  } finally {
    await server.close()
    hooks.deregister()
  }
}
