import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { arch, platform, release } from 'node:os'
import { resolve, sep } from 'node:path'
import { _electron as electron } from '@playwright/test'
import { build, createServer, preview } from 'vite'
import { semanticCorpus } from '../fixtures/semantic-corpus.mjs'
import { observeNativeWorker } from '../helpers/semantic-native-debugger.mjs'

const caseArgument = process.argv.indexOf('--case')
const selected = caseArgument < 0 ? undefined : process.argv[caseArgument + 1]
assert.ok(caseArgument < 0 || (selected && !selected.startsWith('--')), '--case requires a name')
const cases = selected ? semanticCorpus.filter(([name]) => name === selected) : semanticCorpus
const sampleAllocations = process.argv.includes('--sample-allocations')
assert.ok(cases.length, 'Unknown complete semantic corpus case')
await mkdir('test/artifacts/logs', { recursive: true })
const output = await mkdtemp(resolve('test/artifacts/logs/semantic-native-construction-'))
const prefix = resolve(output, 'native-construction')
console.log(`Native construction diagnostic artifacts: ${output}`)
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const count = (key, amount = 1) =>
  `globalThis.__manuslipNativeCount?.(${JSON.stringify(key)},${amount});`
const maximum = (key, value) =>
  `globalThis.__manuslipNativeMaximum?.(${JSON.stringify(key)},${value});`
const checkpoint = (phase, values = '{}') =>
  `globalThis.__manuslipNativeCheckpoint?.(${JSON.stringify(phase)},${values});`
const bootstrap = `
globalThis.__manuslipNativeActive=false;
globalThis.__manuslipNativeCompleted=false;
globalThis.__manuslipNativeCounters={};
globalThis.__manuslipNativeCount=(key,amount)=>{if(globalThis.__manuslipNativeActive)globalThis.__manuslipNativeCounters[key]=(globalThis.__manuslipNativeCounters[key]??0)+amount};
globalThis.__manuslipNativeMaximum=(key,value)=>{if(globalThis.__manuslipNativeActive)globalThis.__manuslipNativeCounters[key]=Math.max(globalThis.__manuslipNativeCounters[key]??0,value)};
globalThis.__manuslipNativeCheckpoint=(phase,extra)=>{
 if(!globalThis.__manuslipNativeActive && phase!=='worker-idle')return;
 globalThis.__manuslipNativePhase={phase,elapsed:performance.now(),counters:{...globalThis.__manuslipNativeCounters},...extra};
 debugger;
};
globalThis.__manuslipNativeBegin=()=>{
 if(globalThis.__manuslipNativeCompleted)return;
 globalThis.__manuslipNativeActive=true;
 globalThis.__manuslipNativeCounters={};
 globalThis.__manuslipNativeFirstSpan=false;
 globalThis.__manuslipNativeFirstBlock=false;
 globalThis.__manuslipNativeFirstTokenFeed=false;
 globalThis.__manuslipNativeFirstPreprocess=false;
 globalThis.__manuslipNativeFirstWordCount=false;
globalThis.__manuslipNativeFirstSourceMetrics=false;
globalThis.__manuslipNativeFirstGrammar=false;
globalThis.__manuslipNativeFirstDescription=false;
 globalThis.__manuslipNativeFirstBodyHast=false;
};
globalThis.__manuslipNativeHast=(hast,root)=>{
 if(!globalThis.__manuslipNativeActive)return;
 let nodes=0;
 const pending=[hast];
 while(pending.length){
  const node=pending.pop();nodes++;
  if('children' in node)for(const child of node.children)pending.push(child);
 }
 globalThis.__manuslipNativeCount('hastGraphs',1);
 globalThis.__manuslipNativeCount('hastNodes',nodes);
 globalThis.__manuslipNativeMaximum('hastGraphNodes',nodes);
 const block=root.children[0];
 if(!globalThis.__manuslipNativeFirstBodyHast && block && block.type!=='heading'){
  globalThis.__manuslipNativeFirstBodyHast=true;
  globalThis.__manuslipNativeCheckpoint('first-body-hast',{
   hastNodes:nodes,hastChildren:hast.children.length,
   blockFrom:block.position?.start.offset,blockTo:block.position?.end.offset
  });
 }
};
globalThis.__manuslipNativeCheckpoint('worker-idle',{});
`
const paths = [
  'apps/desktop/src/renderer/src/semantics/packed-semantic.worker.ts',
  'apps/desktop/src/renderer/src/semantics/packed-producer-full.ts',
  'packages/core/src/markdown-block-stream.ts',
  'node_modules/micromark/lib/create-tokenizer.js',
  'node_modules/mdast-util-from-markdown/lib/index.js',
  'packages/renderer/src/projection-owned-output.ts',
  'packages/renderer/src/packed-projection-encode.ts',
  'packages/renderer/src/projection-sequence.ts',
  'packages/core/src/packing-markdown.ts',
  'packages/renderer/src/packed-snapshot-encode.ts',
  'packages/core/src/packing-validate-descriptions.ts',
  'packages/core/src/packing.ts',
  'packages/core/src/packing-view.ts',
  'node_modules/micromark/lib/preprocess.js',
  'packages/core/src/parse.ts',
  'packages/core/src/markdown-description-steps.ts',
  'packages/core/src/packing-source.ts',
  'apps/desktop/src/renderer/src/semantics/packed-producer-source.ts',
  'apps/desktop/src/renderer/src/semantics/packed-producer.ts',
  'apps/desktop/src/renderer/src/semantics/packed-producer-host.ts',
  'apps/desktop/src/renderer/src/semantics/packed-worker-endpoint.ts',
  'packages/core/src/packing-exchange.ts',
  'apps/desktop/src/renderer/src/semantics/packed-request-source.ts',
  'apps/desktop/src/renderer/src/semantics/packed-port.ts',
  'apps/desktop/src/renderer/src/semantics/service.ts',
  'packages/core/src/packing-input-capture.ts',
  'packages/core/src/packing-capture.ts',
  'packages/core/src/packing-native-copy.ts',
  'packages/core/src/packing-native-stream.ts',
  'packages/renderer/src/projection-html-chunks.ts',
  'packages/renderer/src/projection-serialization-plan.ts',
]
const rendererOnlyPaths = new Set([
  'apps/desktop/src/renderer/src/semantics/packed-port.ts',
  'apps/desktop/src/renderer/src/semantics/service.ts',
])
function replace(code, from, to) {
  assert.equal(code.split(from).length, 2, `Unique marker: ${from}`)
  return code.replace(from, to)
}
const sources = await Promise.all(
  paths.map(async (path, index) => {
    const original = await readFile(path, 'utf8')
    let code = original
    if (index === 0)
      code = replace(
        code,
        'const tasks = new MessageChannel()',
        `${bootstrap}\nconst tasks = new MessageChannel()`,
      )
    if (index === 1) {
      code = replace(
        code,
        "phase('parse')",
        `globalThis.__manuslipNativeBegin?.();${checkpoint('before-native-parse', '{sourceUnits:source.text.length}')}\nphase('parse')`,
      )
      code = replace(
        code,
        'document = yield* run(owner.stageFullSteps(ticket, payload))',
        `document = yield* run(owner.stageFullSteps(ticket, payload))\n${checkpoint('document-packed', '{sessionRetainedBytes:owner.stats.retainedBytes}')}`,
      )
      code = replace(
        code,
        'const chunks = output.value.payload',
        `const chunks = output.value.payload\n${checkpoint('projection-spooled', '{spoolBytes:chunks.byteLength,htmlUnits:output.value.htmlLength,layoutSpans:output.value.blocks,sessionRetainedBytes:owner.stats.retainedBytes}')}`,
      )
      code = replace(
        code,
        'const result = output.value.payload',
        `const result = output.value.payload\n${checkpoint('packed-complete', '{payloadBytes:result.byteLength,sessionRetainedBytes:owner.stats.retainedBytes}')}\nglobalThis.__manuslipNativeActive=false;globalThis.__manuslipNativeCompleted=true;`,
      )
    }
    if (index === 2) {
      code = replace(
        code,
        "const prose = text.join(' ')",
        `${checkpoint('before-prose-join', '{nodes:descriptions.nodes,descriptors:blocks.length,texts:text.length}')}\nconst prose = text.join(' ')`,
      )
      code = replace(
        code,
        '              if (++wordBatch === 16) {',
        `              if (++wordBatch === 16) {${count('wordCountPauses')}${count('wordCountSegments', 'wordBatch')}${maximum('wordCountBatch', 'wordBatch')}if(globalThis.__manuslipNativeActive && !globalThis.__manuslipNativeFirstWordCount){globalThis.__manuslipNativeFirstWordCount=true;${checkpoint('first-word-count', '{words,wordBatch,proseUnits:prose.length}')}}`,
      )
      code = replace(
        code,
        'const counts = { words, characters }',
        `${count('wordCountSegments', 'wordBatch')}${maximum('wordCountBatch', 'wordBatch')}${count('sourceMetricUnits', 'sourceBatch')}${maximum('sourceMetricBatch', 'sourceBatch')}const counts = { words, characters }`,
      )
      code = replace(
        code,
        '              if (++sourceBatch === 4096) {',
        `              if (++sourceBatch === 4096) {${count('sourceMetricPauses')}${count('sourceMetricUnits', 'sourceBatch')}${maximum('sourceMetricBatch', 'sourceBatch')}if(globalThis.__manuslipNativeActive && !globalThis.__manuslipNativeFirstSourceMetrics){globalThis.__manuslipNativeFirstSourceMetrics=true;${checkpoint('first-source-metrics', '{sourceBatch,sourceUnits:index+1}')}}`,
      )
    }
    if (index === 15) {
      code = replace(
        code,
        '  return work\n}',
        `  ${count('metadataWorks')}if(globalThis.__manuslipNativeActive && root.type!=='heading' && !globalThis.__manuslipNativeFirstDescription){globalThis.__manuslipNativeFirstDescription=true;${checkpoint('before-block-description', '{blockFrom:root.position?.start.offset,blockTo:root.position?.end.offset,nodes:target.nodes,descriptors:target.blocks.length}')}}\n  return work\n}`,
      )
      code = replace(code, '        if (node) {', `        if (node) {${count('metadataNodes')}`)
      code = replace(
        code,
        '            target.blocks.push({',
        `            ${count('metadataDescriptors')}target.blocks.push({`,
      )
      code = replace(
        code,
        "    return parts.join('')",
        `    ${count('metadataHeadings')}return parts.join('')`,
      )
      code = replace(
        code,
        '    if (++budget.units === 4096) {',
        `    if (++budget.units === 4096) {${count('metadataHashPauses')}`,
      )
      code = replace(
        code,
        '\n      if (++budget.visits === 256) {',
        `\n      if (++budget.visits === 256) {${count('metadataHeadingPauses')}`,
      )
      code = replace(
        code,
        '\n        if (++budget.visits === 256) {',
        `\n        if (++budget.visits === 256) {${count('metadataTraversalPauses')}`,
      )
      const remainder = `${count('metadataHashUnits', 'budget.units')}${count('metadataCursorAdvances', 'budget.visits')}${maximum('metadataHashBatch', 'budget.units')}${maximum('metadataCursorBatch', 'budget.visits')}`
      assert.equal(code.split('budget.units = budget.visits = 0').length, 4)
      code = code.replaceAll(
        'budget.units = budget.visits = 0',
        `${remainder}budget.units = budget.visits = 0`,
      )
      code = replace(code, '      return true as const', `${remainder}return true as const`)
    }
    if (index === 14) {
      code = replace(
        code,
        '        const chunk = source.slice(Math.max(0, at - grammarOverlapUnits), end)',
        `        const chunk = source.slice(Math.max(0, at - grammarOverlapUnits), end)\n${count('grammarChunks')}${count('grammarNewUnits', 'end-at')}${count('grammarSliceUnits', 'chunk.length')}${maximum('grammarRegexInputUnits', 'chunk.length')}`,
      )
      code = replace(
        code,
        '        if (end - at === grammarChunkUnits) yield',
        `        if (end - at === grammarChunkUnits) {${count('grammarPauses')}if(globalThis.__manuslipNativeActive && !globalThis.__manuslipNativeFirstGrammar){globalThis.__manuslipNativeFirstGrammar=true;${checkpoint('first-grammar-chunk', '{sourceUnits:end,contextUnits:chunk.length,gfm,mask}')}}yield;}`,
      )
      code = replace(
        code,
        '      return { gfm, processor: gfm ? (guardedProcessors[mask] ?? processor) : withoutGfm }',
        `${count('grammarCompleted')}${maximum('grammarMask', 'mask')}return { gfm, processor: gfm ? (guardedProcessors[mask] ?? processor) : withoutGfm }`,
      )
    }
    if (index === 3) {
      code = replace(
        code,
        '    function mainSteps() {',
        `    function mainSteps() {${count('blockTokenFeeds')}`,
      )
      const guard = 'if (++steps > 4096) return false;'
      assert.equal(code.split(guard).length, 3)
      code = code.replaceAll(
        guard,
        `if (++steps > 4096) {${maximum('blockTokenFeedUnits', 'steps - 1')}return false;}`,
      )
      code = replace(
        code,
        '      return true;\n    }\n\n  }\n  // End Manuslip cooperative document tokenizer.',
        `      ${maximum('blockTokenFeedUnits', 'steps')}return true;\n    }\n\n  }\n  // End Manuslip cooperative document tokenizer.`,
      )
      code = replace(
        code,
        'while (!mainSteps()) yield;',
        `while (!mainSteps()) {${count('blockTokenPauses')}if(globalThis.__manuslipNativeActive && !globalThis.__manuslipNativeFirstTokenFeed){globalThis.__manuslipNativeFirstTokenFeed=true;${checkpoint('first-token-feed', '{sourceUnitsConsumed:point.offset}')}}yield;}`,
      )
      code = replace(
        code,
        'export function createTokenizer(parser, initialize, from) {',
        `export function createTokenizer(parser, initialize, from) {${count('tokenizersCreated')}`,
      )
      code = replace(
        code,
        'function enter(type, fields) {',
        `function enter(type, fields) {${count('tokensEntered')}`,
      )
      code = replace(
        code,
        "context.events.push(['enter', token, context]);",
        `${count('enterEvents')}context.events.push(['enter', token, context]);`,
      )
      code = replace(
        code,
        "context.events.push(['exit', token, context]);",
        `${count('exitEvents')}context.events.push(['exit', token, context]);`,
      )
      code = replace(code, 'function now() {', `function now() {${count('tokenizerPointCopies')}`)
    }
    if (index === 4) {
      code = replace(
        code,
        '        if (scanned === 4096) {',
        `        if (scanned === 4096) {${count('blockPreprocessPauses')}${maximum('blockPreprocessScanUnits', 'scanned')}if(globalThis.__manuslipNativeActive && !globalThis.__manuslipNativeFirstPreprocess){globalThis.__manuslipNativeFirstPreprocess=true;${checkpoint('first-preprocess', '{sourceUnitsScanned:endPosition,preprocessedChunks:chunks.length}')}}`,
      )
      code = replace(
        code,
        '    completed = true;',
        `    ${maximum('blockPreprocessScanUnits', 'scanned')}${count('blockPreprocessSourceUnits', 'value.length')}completed = true;`,
      )
      code = replace(
        code,
        'return yield* compile(eventSpans(events));',
        `${checkpoint('block-tokenized', '{blockEvents:events.length}')}\nreturn yield* compile(eventSpans(events));`,
      )
      code = replace(
        code,
        'return yield* compiler(options)(eventSpans(parse(options).document().write(preprocess()(value, encoding, true))));',
        `const nativeEvents = parse(options).document().write(preprocess()(value, encoding, true));\n${checkpoint('block-tokenized', '{blockEvents:nativeEvents.length}')}\nreturn yield* compiler(options)(eventSpans(nativeEvents));`,
      )
      code = replace(
        code,
        'let streamEvents = serializationEvents(postprocess(input));',
        `let streamEvents = serializationEvents(postprocess(input));\n${maximum('spanEvents', 'streamEvents.length')}\nif(globalThis.__manuslipNativeActive && !globalThis.__manuslipNativeFirstSpan){globalThis.__manuslipNativeFirstSpan=true;${checkpoint('first-span-resolved', '{spanEvents:streamEvents.length}')}}`,
      )
      code = replace(
        code,
        'const completed = tree.children;',
        `${maximum('mdastRootChildren', 'tree.children.length')}const completed = tree.children;`,
      )
      code = replace(
        code,
        'completed[index] = undefined;',
        `completed[index] = undefined;${count('mdastBlockHandoffs')}\nif(globalThis.__manuslipNativeActive && !globalThis.__manuslipNativeFirstBlock){globalThis.__manuslipNativeFirstBlock=true;${checkpoint('first-block-handoff', '{rootChildren:tree.children.length,spanChildren:completed.length,blockFrom:child.position?.start.offset,blockTo:child.position?.end.offset}')}}`,
      )
      code = replace(
        code,
        'function enter(node, token, errorHandler) {',
        'function enter(node, token, errorHandler) {' +
          count('mdastNodesEntered') +
          maximum('mdastStackDepth', 'this.stack.length+1'),
      )
      code = replace(code, 'function point(d) {', `function point(d) {${count('mdastPointCopies')}`)
    }
    if (index === 5)
      code = replace(
        code,
        '  const descriptions: ProjectionDescriptions = new Map()',
        '  globalThis.__manuslipNativeHast?.(converted.hast,converted.root)\n  const descriptions: ProjectionDescriptions = new Map()',
      )
    code += `\nglobalThis.__manuslipNativeAdmissionSource${index}=true;\n`
    return { path, index, originalSha256: hash(original), injectedSha256: hash(code), code }
  }),
)
const matched = { main: new Set(), worker: new Set() }
const parserIds = new Set()
const plugin = (label) => ({
  name: `native-admission-${label}`,
  enforce: 'pre',
  transform(code, id) {
    const path = id.replaceAll('\\', '/')
    if (path.includes('create-tokenizer') || path.includes('mdast-util-from-markdown'))
      parserIds.add(path)
    const input = sources.find((source) => path.endsWith(`/${source.path}`))
    if (!input) return
    assert.equal(hash(code), input.originalSha256, `Actual source before injection: ${input.path}`)
    matched[label].add(input.index)
    return { code: input.code, map: null }
  },
})
const config = {
  configFile: false,
  root: resolve('test/e2e/fixtures/semantic-service'),
  clearScreen: false,
  logLevel: 'silent',
  base: './',
  // The separate SSR oracle sets NODE_ENV=development. Pin the diagnostic bundle
  // to production parser exports explicitly instead of inheriting that setting.
  resolve: { conditions: ['worker', 'module', 'browser', 'production'] },
  build: { outDir: resolve(`${prefix}-build`), emptyOutDir: false, minify: false },
  plugins: [plugin('main')],
  worker: { format: 'es', plugins: () => [plugin('worker')] },
}
const profile = await mkdtemp(resolve(`${prefix}-profile-`))
const oracle = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  logLevel: 'silent',
  server: { middlewareMode: true, watch: null, hmr: false },
})
let server, application, observation
const reports = []
const allocationFiles = new Map()
let electronVersions
try {
  const { parseMarkdown, needsGfm } = await oracle.ssrLoadModule('/packages/core/src/parse.ts')
  const { renderProjectionLayout } = await oracle.ssrLoadModule(
    '/packages/renderer/src/projection-layout.ts',
  )
  await build(config)
  await writeFile(`${prefix}-parser-ids.json`, `${JSON.stringify([...parserIds], null, 2)}\n`)
  assert.deepEqual(
    [...matched.worker].sort((a, b) => a - b),
    paths.flatMap((path, index) => (rendererOnlyPaths.has(path) ? [] : [index])),
  )
  for (const index of [3, 4, 7]) assert.ok(matched.main.has(index), paths[index])
  for (const path of [
    ...rendererOnlyPaths,
    'apps/desktop/src/renderer/src/semantics/packed-request-source.ts',
  ])
    assert.ok(matched.main.has(paths.indexOf(path)), `Actual renderer source: ${path}`)
  assert.ok(!matched.main.has(0), 'Worker endpoint is not evaluated in the renderer')
  const assets = resolve(config.build.outDir, 'assets'),
    names = await readdir(assets)
  const mainFile = names.filter((name) => name.startsWith('index-') && name.endsWith('.js'))
  const workerFile = names.filter(
    (name) => name.startsWith('packed-semantic.worker-') && name.endsWith('.js'),
  )
  assert.equal(mainFile.length, 1)
  assert.equal(workerFile.length, 1)
  const bundles = []
  for (const [label, name] of [
    ['main', mainFile[0]],
    ['worker', workerFile[0]],
  ]) {
    const bytes = await readFile(resolve(assets, name)),
      code = bytes.toString('utf8')
    for (const source of sources)
      assert.equal(
        new RegExp(`__manuslipNativeAdmissionSource${source.index}\\s*=\\s*true`).test(code),
        matched[label].has(source.index),
        `${label}/${source.path}`,
      )
    assert.equal(code.includes('debugger;'), label === 'worker')
    bundles.push({ label, path: resolve(assets, name), sha256: hash(bytes) })
  }
  const driver = await readFile(new URL(import.meta.url)),
    observer = await readFile(new URL('../helpers/semantic-native-debugger.mjs', import.meta.url))
  await writeFile(resolve(output, 'driver.mjs'), driver)
  await writeFile(resolve(output, 'observer.mjs'), observer)
  for (const source of sources) {
    await writeFile(resolve(output, `${source.index}-original.txt`), await readFile(source.path))
    await writeFile(resolve(output, `${source.index}-injected.txt`), source.code)
  }
  await writeFile(
    `${prefix}-build-proof.json`,
    `${JSON.stringify(
      {
        environment: {
          node: process.version,
          platform: platform(),
          arch: arch(),
          release: release(),
          conditions: config.resolve.conditions,
        },
        driverSha256: hash(driver),
        observerSha256: hash(observer),
        sources: sources.map(({ code, ...source }) => source),
        matched: { main: [...matched.main].sort(), worker: [...matched.worker].sort() },
        bundles,
      },
      null,
      2,
    )}\n`,
  )
  server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0, strictPort: false } })
  application = await electron.launch({
    args: [resolve('test/benchmark/fixtures/packed-memory/main.cjs')],
    env: {
      ...process.env,
      MANUSLIP_PACKED_MEMORY_PROFILE: profile,
      MANUSLIP_PACKED_MEMORY_URL: server.resolvedUrls.local[0],
    },
  })
  electronVersions = await application.evaluate(() => process.versions)
  const page = await application.firstWindow()
  page.setDefaultTimeout(120000)
  await page.waitForFunction(() => typeof window.runSemanticServiceProbe === 'function')
  observation = await observeNativeWorker(
    application,
    page,
    sampleAllocations
      ? async (name, phase, allocation) => {
          assert.match(name, /^[a-z-]+$/)
          assert.match(phase, /^[a-z-]+$/)
          assert.ok(Array.isArray(allocation.samples), 'Missing native allocation samples')
          let nodes = 0,
            sampledBytes = 0
          const pending = [allocation.head]
          while (pending.length) {
            const node = pending.pop()
            assert.ok(Number.isFinite(node.selfSize) && node.selfSize >= 0)
            nodes++
            sampledBytes += node.selfSize
            for (const child of node.children ?? []) pending.push(child)
          }
          const key = `${name}-${phase}`
          const occurrence = (allocationFiles.get(key) ?? 0) + 1
          allocationFiles.set(key, occurrence)
          const suffix = occurrence === 1 ? '' : `-attempt-${occurrence}`
          const path = resolve(output, `${key}${suffix}-allocation.heapprofile`)
          const body = `${JSON.stringify(allocation)}\n`
          await writeFile(path, body)
          return {
            path,
            sha256: hash(body),
            sampledBytes,
            samples: allocation.samples.length,
            nodes,
          }
        }
      : undefined,
  )
  for (const [name, body] of cases) {
    observation.select(name)
    const source = `# ${name}\n\n${body}`,
      texts = [source, source.replace(name, `${name} extended`)]
    const result = await page.evaluate(async (texts) => {
      const result = await window.runSemanticServiceProbe(texts)
      // The fixture clears measures at each revision. Completed rounds retain their
      // own entries; global measures cover only a rejected, unfinished final round.
      const failureMetrics = result.rounds.flatMap((round) =>
        round.metrics
          .filter((entry) => entry.name === 'manuslip:semantic-failure')
          .map((entry) => ({
            revision: round.revision,
            startMs: entry.startMs,
            timeOrigin: 'revision',
            detail: entry.detail,
          })),
      )
      if (result.kind !== 'accepted')
        failureMetrics.push(
          ...performance.getEntriesByName('manuslip:semantic-failure', 'measure').map((entry) => ({
            revision: result.rounds.length,
            startMs: entry.startTime,
            timeOrigin: 'page',
            detail: entry.detail,
          })),
        )
      return { ...result, failureMetrics }
    }, texts)
    await observation.flush()
    const report = { name, sourceSha256: hash(source), ...result }
    reports.push(report)
    assert.equal(
      result.kind,
      'accepted',
      JSON.stringify({
        name,
        error: result.error,
        failureMetrics: result.failureMetrics,
        failures: observation.failures,
      }),
    )
    assert.equal(result.workers, 1)
    assert.deepEqual(result.workerFailures, [])
    assert.deepEqual(result.failureMetrics, [])
    assert.equal(result.rounds.length, 2)
    for (const [revision, round] of result.rounds.entries()) {
      const document = parseMarkdown(texts[revision]),
        { projection, layout } = renderProjectionLayout(
          document.root,
          result.options,
          64 * 1024 * 1024,
        )
      const normalized = JSON.stringify({
        document: { ...document, timings: null },
        projection: { ...projection, renderMs: null },
        layout,
      })
      assert.equal(round.semanticSha256, hash(normalized))
      assert.equal(round.words, document.counts.words)
      assert.equal(round.characters, document.counts.characters)
      assert.deepEqual(round.outline, document.outline)
      assert.equal(round.messages.length, 1)
      assert.equal(round.messages[0].kind, revision ? 'delta' : 'full')
    }
    assert.deepEqual(observation.failures, [])
    const phases = observation.rows.filter((row) => row.name === name)
    assert.deepEqual(
      phases.map((row) => row.phase),
      [
        'worker-idle',
        'before-native-parse',
        'first-grammar-chunk',
        'first-preprocess',
        'first-token-feed',
        'block-tokenized',
        'first-span-resolved',
        'first-block-handoff',
        'before-block-description',
        'before-prose-join',
        'first-word-count',
        'first-source-metrics',
        'document-packed',
        'first-body-hast',
        'projection-spooled',
        'packed-complete',
      ],
    )
    for (const row of phases) {
      assert.ok(row.target.url.includes('packed-semantic.worker-'))
      assert.ok(Number.isSafeInteger(row.workerHeap.usedSize) && row.workerHeap.usedSize > 0)
      for (const value of Object.values(row.counters))
        assert.ok(Number.isSafeInteger(value) && value >= 0)
    }
    assert.equal(phases[1].sourceUnits, source.length)
    assert.ok(phases.at(-1).payloadBytes > 0)
    const initial = parseMarkdown(source),
      firstBody = initial.root.children[1],
      bodySample = phases.find((row) => row.phase === 'first-body-hast'),
      firstPreprocess = phases.find((row) => row.phase === 'first-preprocess'),
      firstTokenFeed = phases.find((row) => row.phase === 'first-token-feed'),
      firstBlock = phases.find((row) => row.phase === 'first-block-handoff'),
      firstDescription = phases.find((row) => row.phase === 'before-block-description'),
      firstWord = phases.find((row) => row.phase === 'first-word-count'),
      firstMetrics = phases.find((row) => row.phase === 'first-source-metrics'),
      firstGrammar = phases.find((row) => row.phase === 'first-grammar-chunk'),
      finalCounters = phases.at(-1).counters
    assert.equal(firstPreprocess.sourceUnitsScanned, 4096)
    assert.equal(firstPreprocess.counters.blockPreprocessScanUnits, 4096)
    assert.equal(firstPreprocess.counters.blockTokenFeeds ?? 0, 0)
    assert.equal(firstPreprocess.counters.tokensEntered ?? 0, 0)
    assert.equal(firstPreprocess.counters.mdastNodesEntered ?? 0, 0)
    assert.equal(finalCounters.blockPreprocessScanUnits, 4096)
    assert.equal(finalCounters.blockPreprocessSourceUnits, source.length)
    assert.equal(finalCounters.blockPreprocessPauses, Math.floor((source.length - 1) / 4096))
    assert.equal(firstTokenFeed.counters.blockTokenFeeds, 1)
    assert.equal(firstTokenFeed.counters.mdastNodesEntered ?? 0, 0)
    assert.equal(firstWord.wordBatch, 16)
    assert.equal(firstWord.counters.wordCountSegments, 16)
    assert.equal(firstWord.counters.wordCountPauses, 1)
    assert.equal(finalCounters.wordCountBatch, 16)
    assert.ok(finalCounters.wordCountSegments >= initial.counts.words)
    assert.equal(firstMetrics.sourceBatch, 4096)
    assert.equal(firstMetrics.sourceUnits, 4096)
    assert.equal(firstMetrics.counters.sourceMetricUnits, 4096)
    assert.equal(firstMetrics.counters.sourceMetricPauses, 1)
    assert.equal(finalCounters.sourceMetricBatch, 4096)
    assert.equal(finalCounters.sourceMetricUnits, source.length)
    assert.equal(finalCounters.sourceMetricPauses, Math.floor(source.length / 4096))
    assert.equal(firstGrammar.sourceUnits, 4089)
    assert.equal(firstGrammar.contextUnits, 4089)
    assert.equal(firstGrammar.counters.grammarChunks, 1)
    assert.equal(firstGrammar.counters.grammarNewUnits, 4089)
    assert.equal(firstGrammar.counters.grammarPauses, 1)
    assert.equal(firstGrammar.gfm, needsGfm(source.slice(0, 4089)))
    assert.equal(firstGrammar.counters.tokenizersCreated ?? 0, 0)
    assert.equal(firstGrammar.counters.tokensEntered ?? 0, 0)
    assert.equal(firstGrammar.counters.mdastNodesEntered ?? 0, 0)
    assert.equal(finalCounters.grammarNewUnits, source.length)
    assert.equal(finalCounters.grammarChunks, Math.ceil(source.length / 4089))
    assert.equal(finalCounters.grammarPauses, Math.floor(source.length / 4089))
    assert.equal(finalCounters.grammarRegexInputUnits, 4096)
    assert.equal(
      finalCounters.grammarSliceUnits,
      source.length + (finalCounters.grammarChunks - 1) * 7,
    )
    assert.equal(finalCounters.grammarCompleted, 1)
    const expectedGrammarMask = [
      /[@&\\]/,
      /[|&\\]|:-|-:/,
      /[&\\]|www\./i,
      /[&\\]|https?:\/\//i,
    ].reduce((mask, rule, index) => mask + (rule.test(source) ? 0 : 1 << index), 0)
    assert.equal(finalCounters.grammarMask, expectedGrammarMask)
    assert.equal(firstDescription.blockFrom, firstBody.position.start.offset)
    assert.equal(firstDescription.blockTo, firstBody.position.end.offset)
    assert.equal(firstDescription.counters.metadataWorks, 2)
    assert.equal(firstDescription.descriptors, 1)
    assert.equal(finalCounters.metadataWorks, initial.root.children.length)
    assert.equal(finalCounters.metadataDescriptors, initial.blocks.length)
    assert.equal(finalCounters.metadataHeadings, initial.outline.length)
    assert.equal(
      finalCounters.metadataHashUnits,
      initial.blocks.reduce((sum, block) => sum + block.to - block.from, 0),
    )
    let metadataNodes = 0,
      cursorAdvances = 0
    function cursorWork(root) {
      let nodes = 0,
        parents = 0
      const pending = [root]
      while (pending.length) {
        const node = pending.pop()
        nodes++
        if ('children' in node) {
          parents++
          for (const child of node.children) pending.push(child)
        }
      }
      return { nodes, advances: 3 * nodes - 1 + parents }
    }
    for (const block of initial.root.children) {
      const counted = cursorWork(block)
      metadataNodes += counted.nodes
      cursorAdvances += counted.advances
    }
    const pending = [...initial.root.children]
    while (pending.length) {
      const node = pending.pop()
      if (node.type === 'heading') cursorAdvances += cursorWork(node).advances
      if ('children' in node) for (const child of node.children) pending.push(child)
    }
    assert.equal(finalCounters.metadataNodes, metadataNodes)
    assert.equal(finalCounters.metadataCursorAdvances, cursorAdvances)
    assert.ok(finalCounters.metadataHashBatch <= 4096)
    assert.ok(finalCounters.metadataCursorBatch <= 256)
    assert.equal(finalCounters.blockTokenFeedUnits, 4096)
    assert.ok(finalCounters.blockTokenPauses > 0)
    assert.ok(firstBody && firstBody.type !== 'heading')
    assert.equal(firstBlock.rootChildren, 0)
    assert.equal(firstBlock.blockFrom, initial.root.children[0].position.start.offset)
    assert.equal(firstBlock.blockTo, initial.root.children[0].position.end.offset)
    assert.equal(finalCounters.mdastBlockHandoffs, initial.root.children.length)
    assert.ok(finalCounters.mdastRootChildren > 0)
    assert.equal(bodySample.blockFrom, firstBody.position.start.offset)
    assert.equal(bodySample.blockTo, firstBody.position.end.offset)
    assert.ok(Number.isSafeInteger(bodySample.hastNodes) && bodySample.hastNodes > 0)
    assert.equal(bodySample.counters.hastGraphs, 2)
    assert.equal(finalCounters.hastGraphs, initial.root.children.length + 1)
    assert.ok(finalCounters.hastNodes >= finalCounters.hastGraphs)
    assert.equal(finalCounters.hastGraphNodes, bodySample.hastNodes)
    if (sampleAllocations) {
      assert.equal(phases.filter((row) => row.allocations).length, 15)
      assert.ok(phases.at(-1).allocations.samples > 0, 'Native allocation profile is empty')
    } else assert.ok(phases.every((row) => row.allocations === undefined))
    console.log(
      JSON.stringify({
        name,
        completeNativeRevisions: 2,
        phases: observation.rows
          .filter((row) => row.name === name)
          .map((row) => ({ phase: row.phase, workerHeap: row.workerHeap, counters: row.counters })),
      }),
    )
  }
} finally {
  try {
    await observation?.close()
  } finally {
    try {
      await writeFile(
        `${prefix + (selected ? `-${selected}` : '')}-profile.json`,
        `${JSON.stringify(
          {
            date: new Date().toISOString(),
            electronVersions,
            allocationSampling: sampleAllocations
              ? {
                  interval: 32768,
                  includeObjectsCollectedByMajorGC: true,
                  includeObjectsCollectedByMinorGC: true,
                  start: 'before-native-parse',
                  stop: 'packed-complete',
                  method:
                    'Cumulative V8 statistical allocation profiles at fifteen paused Worker boundaries, including sampled objects collected since sampling began. Captured profiles are serialized and written after the service probe finishes; pending observations drain before assertions and final reporting. Repeated boundaries keep distinct raw files. diagnosticAttempts retain numeric markers before commands, their individual durations and statuses, and captured profiles even when later heap collection fails. observerMs records host elapsed time from the pause event to resume acknowledgement; it is diagnostic overhead rather than application latency. Profiles describe allocation stacks and estimated sampled bytes, not live retained size, an exact allocation census, physical peak, calibrated portable admission weights or acceptance timing. Debugger evaluation and diagnostic hooks can also allocate. No explicit GC is requested. Raw stack URLs/names/locations and sizes are saved; heap object contents and document values are not.',
                }
              : false,
            method:
              'Actual mounted Electron application and persistent experimental packed semantic Worker. Thirty-one actual sources bind the endpoint, complete producer coordinator, block parser, tokenizer/compiler, complete descriptor validator, shared value encoder, direct document encoder, chunk spool, snapshot assembly and sequence/policy renderer. Immutable source capabilities bind both renderer and Worker bundles. Both isolates independently schedule one combined UTF-8, JSON-spelling and digest scan, and the complete encoder reuses authentic Worker source facts. One latest candidate shares the existing Worker callback with the active offer; promotion follows full validation and admission. Only bounded request metadata is JSON-sized synchronously; source JSON spelling shares the 4,096-unit preflight before this native diagnostic begins. Legacy synchronous APIs remain available, while the actual Worker entry uses cooperative preparation. Numeric structural counters and debugger boundaries observe first construction only. first-grammar-chunk observes 4,089 new units with bounded context before any tokenizer construction; first-preprocess pauses after 4,096 scanned UTF-16 units with no tokenizer input dispatched; first-word-count pauses after sixteen actual whole-prose segments; first-source-metrics pauses after 4,096 UTF-16 reads in the combined final character/hash scan; before-block-description observes the first body block owned by a revocable metadata handle before its first range read; cumulative range reads and cursor advances are checked against complete ordinary metadata, with maxima of 4,096 reads and 256 advances between metadata checkpoints. Heading joins remain native and unadmitted. first-block-handoff pauses after detaching the first completed compiler child; document-packed observes its complete staged packet, not a full native root. first-body-hast pauses with the first non-heading body HAST at the owned policy entry; it is not a complete-document HAST boundary. All body/footer policy graphs are counted, including heading and invisible blocks; this diagnostic traversal allocates scratch and affects GC. projection-spooled observes encoded chunks, not joined HTML. At each paused Worker boundary, query its V8 heap, then renderer-isolate heap and Electron process metrics successively without explicit GC. Extra hooks and debugger pauses change timing and allocation; these are boundary observations and cumulative constructor counters, not acceptance latency, all-allocation coverage, proven peaks, calibrated physical admission or a portable memory bound. No source/document/parser/renderer graph is saved in counters or debugger expressions. The separate native oracle verifies both complete revisions. Final fixture cleanup asserts zero receiver ownership.',
            reports,
            observations: observation?.rows ?? [],
            diagnosticAttempts: observation?.attempts ?? [],
            diagnosticFailures: observation?.failures ?? [],
          },
          null,
          2,
        )}\n`,
      )
    } finally {
      try {
        await application?.close()
      } finally {
        await server?.httpServer.close()
        await oracle.close()
        assert.ok(profile.startsWith(resolve('test/artifacts/logs') + sep))
        await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      }
    }
  }
}
assert.equal(reports.length, cases.length)
