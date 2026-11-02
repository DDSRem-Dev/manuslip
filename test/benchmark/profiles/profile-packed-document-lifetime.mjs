import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error(
    'Run with node --expose-gc test/benchmark/profiles/profile-packed-document-lifetime.mjs',
  )
const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const sessionLimits = { ...limits, retained: 64 * MiB, bytes: 8 * MiB, readers: 160, captures: 8 }
const words = process.argv.includes('--words')
const fromDocument = process.argv.includes('--from-document')
if (fromDocument && !words) throw new Error('--from-document requires --words')
const key = Symbol.for('manuslip-document-lifetime-profile')
let observe
globalThis[key] = (phase, value) => observe?.(phase, value)
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
  plugins: [
    {
      name: 'observe-document-reuse-lifetimes',
      enforce: 'pre',
      transform(code, id) {
        const path = id.replaceAll('\\', '/')
        const inject = (marker, phase, value) => {
          assert.ok(code.includes(marker), `Missing marker ${path}: ${marker}`)
          return code.replace(
            marker,
            `${marker}; globalThis[Symbol.for('manuslip-document-lifetime-profile')]?.('${phase}', ${value});`,
          )
        }
        if (words && path.endsWith('/core/src/packing-word-baseline.ts')) {
          code = inject('this.#data = data', 'data', 'data')
          code = inject(
            'const metadata = new Uint32Array(size * fields)',
            'word-metadata',
            'metadata',
          )
          code = inject('const chunks = buffer.finishChunks()', 'cache-copy', 'chunks')
          assert.ok(code.includes('table.set('))
          return code.replace(
            'table.set(',
            "globalThis[Symbol.for('manuslip-document-lifetime-profile')]?.('metadata', records); table.set(",
          )
        }
        if (words && path.endsWith('/core/src/packing-validate-words.ts'))
          return inject(
            'buffer.append(chunk.slice(offset, offset + 4098))',
            'cached-collection',
            'Math.min(chunk.length - offset, 4098)',
          )
        if (words && path.endsWith('/core/src/fragment-counts.ts')) {
          code = inject('const chunks: string[] = []', 'producer-buffer', 'chunks')
          code = inject('stage(value.length * 2 + 256)', 'producer-collection', 'value.length')
          const marker = 'const complete = finishPackedSteps(inspection)'
          assert.ok(code.includes(marker))
          return code.replace(
            marker,
            `globalThis[Symbol.for('manuslip-document-lifetime-profile')]?.('producer-work', inspection); ${marker}`,
          )
        }
        if ((!words || fromDocument) && path.endsWith('/core/src/packing-document-baseline.ts')) {
          code = inject('this.#data = data', 'data', 'data')
          code = inject(
            'const metadata = new Uint32Array((size + 1) * 2)',
            'metadata-prefixes',
            'metadata',
          )
          code = inject('if (index % 4096 === 4095) {', 'source-comparison', 'index + 1')
          assert.ok(code.includes('table.set('))
          return code.replace(
            'table.set(',
            "globalThis[Symbol.for('manuslip-document-lifetime-profile')]?.('metadata', records); table.set(",
          )
        }
        if (path.endsWith('/core/src/packing-description-reuse.ts')) {
          code = inject('this.#source = source', 'reuse', 'this')
          return inject(
            'const current = yield* this.#next(blocks)',
            'descriptor-comparison',
            'current',
          )
        }
        if (path.endsWith('/core/src/packing-source-points.ts'))
          return inject('this.#text = text', 'source-points', 'this')
      },
    },
  ],
})
try {
  const load = (name) => server.ssrLoadModule(`/packages/core/src/${name}.ts`)
  const { PackedDocumentBaseline } = await load('packing-document-baseline')
  const { PackedWordBaseline } = await load('packing-word-baseline')
  const { validatePackedWords } = await load('packing-validate-words')
  const { countFragmentDocument } = await load('fragment-counts')
  const Baseline = words ? PackedWordBaseline : PackedDocumentBaseline
  const { validatePackedDocument } = await load('packing-validate-document')
  const { PackedArena } = await load('packing-arena')
  const { PackedSession } = await load('packing-session')
  const { PackedSource } = await load('packing-source')
  const { packValue } = await load('packing')
  const { sourceHash } = await load('contracts')
  const { parseMarkdown } = await load('parse')
  const finish = (work) => {
    while (true) {
      const next = work.next()
      if (next.done) return next.value
    }
  }
  const watch = (value, refs, seen = new WeakSet()) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    refs.push(new WeakRef(value))
    if (ArrayBuffer.isView(value)) watch(value.buffer, refs, seen)
    else if (value instanceof Map) for (const item of value.values()) watch(item, refs, seen)
    else
      for (const [name, item] of Object.entries(value))
        if (name !== 'capture' && name !== 'token') watch(item, refs, seen)
  }
  const fixture = () => {
    const text = `# Head\n\n> > ${'a界😀 '.repeat(5000)}\n\n## Tail\n`
    const document = parseMarkdown(text)
    const source = new PackedSource(
      {
        generation: 1,
        revision: 0,
        documentId: 'document-lifetime',
        sourceHash: sourceHash(text),
        parserVersion: document.parserVersion,
        rendererVersion: 'test',
        options: 'test',
      },
      text,
    )
    const owner = new PackedSession(sessionLimits)
    owner.commit(
      owner.prepareFull(
        owner.beginPrepared(source),
        source.identity,
        packValue({ document }, limits.staging),
      ),
    )
    return { owner, source, capture: owner.capture() }
  }
  const probe = (phase, keepOwner) => {
    const refs = [],
      reached = new Set()
    let compared = 0
    let prefixTables = 0
    let producerInspection
    observe = (kind, value) => {
      if (kind === 'metadata' && !(value.size ?? value.length)) return
      if (words && kind === 'cache-copy' && !value.some((chunk) => chunk.length >= 4096)) {
        watch(value, refs)
        return
      }
      if (words && kind === 'cached-collection' && value < 4096) return
      reached.add(kind)
      if (kind === 'metadata-prefixes') {
        assert.ok(value instanceof Uint32Array)
        assert.equal(value.byteLength, 32)
        prefixTables++
      }
      if (kind === 'producer-work') producerInspection = value
      else if (kind === 'producer-collection') {
        compared += value
        if (phase === 'producer-cancel' && value >= 4096) baseline.close()
      } else if (kind === 'source-comparison' || kind === 'cached-collection') compared += value
      else watch(value, refs)
    }
    const original = PackedArena.open
    PackedArena.open = function (...args) {
      const arena = original.apply(this, args)
      refs.push(new WeakRef(arena))
      return arena
    }
    const context = fixture()
    refs.push(new WeakRef(context.source))
    if (!keepOwner) refs.push(new WeakRef(context.owner))
    const documentBaseline = fromDocument
      ? finish(PackedDocumentBaseline.create(context.capture, context.source, ['document'], limits))
      : undefined
    reached.clear()
    compared = 0
    const create = Baseline.create(
      context.capture,
      context.source,
      ['document'],
      limits,
      documentBaseline,
    )
    let baseline, work, inspection, source
    let steps = 0
    try {
      if (phase !== 'create-queued')
        while (true) {
          const next = create.next()
          assert.ok(++steps < 500000)
          if (next.done) {
            baseline = next.value
            break
          }
          if (
            ['metadata', 'metadata-prefixes', 'word-metadata', 'cache-copy'].includes(phase) &&
            reached.has(phase)
          )
            break
        }
      if (phase.startsWith('producer-')) {
        assert.ok(words && baseline)
        const count = () =>
          countFragmentDocument(
            context.capture,
            ['document', 'root'],
            { start: 0, remove: 0, children: [], source: context.source },
            limits,
            baseline,
          )
        if (phase === 'producer-cancel') assert.throws(count, /closed/)
        else assert.ok(count().words > 0)
        assert.ok(compared >= 4096)
        assert.ok(producerInspection)
      } else if (
        ![
          'create-queued',
          'metadata',
          'metadata-prefixes',
          'word-metadata',
          'cache-copy',
          'ready',
          'range-close',
          'range-release',
        ].includes(phase)
      ) {
        assert.ok(baseline)
        source = new PackedSource({ ...context.source.identity, revision: 1 }, context.source.text)
        refs.push(new WeakRef(source))
        const prepared = context.owner.prepareDelta(context.owner.beginPrepared(source), {
          base: context.source.identity,
          baseSource: context.source.text,
          result: source.identity,
          payload: packValue({}, limits.staging),
          operations: [],
        })
        inspection = context.owner.capturePrepared(prepared)
        work = words
          ? validatePackedWords(inspection, source, ['document'], limits, undefined, baseline)
          : validatePackedDocument(inspection, source, ['document'], limits, undefined, baseline)
        if (phase !== 'validation-queued')
          while (true) {
            const next = work.next()
            assert.ok(++steps < 500000)
            if (phase === 'complete' && next.done) break
            assert.equal(next.done, false, `Unreached ${phase}`)
            if (reached.has(phase)) break
          }
      }
      const escapedKey = context.capture.reader.recordKey(['document', 'root', 'children', 1])
      const escapedCache =
        words && baseline && phase !== 'producer-cancel'
          ? baseline.find(context.capture.reader.at(['document', 'root', 'children', 1]))
          : undefined
      const escapedChunks = escapedCache?.chunks[Symbol.iterator]()
      if (escapedChunks) assert.equal(escapedChunks.next().done, false)
      const escapedRange =
        !words && baseline ? baseline.metadataRange(context.capture, ['document'], 1, 1) : undefined
      if (escapedRange) {
        assert.deepEqual(escapedRange.blocks, { start: 1, remove: 3, total: 5 })
        assert.deepEqual(escapedRange.outline, { start: 1, remove: 0, total: 2 })
      }
      if (phase === 'range-close') baseline.close()
      if (phase === 'range-release') context.capture.release()
      if (phase.startsWith('range-'))
        assert.equal(baseline.metadataRange(context.capture, ['document'], 1, 1), undefined)
      if ((!words || fromDocument) && phase !== 'create-queued') assert.equal(prefixTables, 1)
      const report = { phase, keepOwner, steps, compared, prefixTables, references: refs.length }
      context.owner.dispose()
      assert.equal(context.owner.stats.retainedBytes, 0)
      assert.equal(context.owner.stats.readers, 0)
      assert.equal(context.owner.stats.readerStagingBytes, 0)
      return {
        create,
        baseline,
        documentBaseline,
        work,
        capture: context.capture,
        inspection,
        escapedKey,
        escapedCache,
        escapedChunks,
        escapedRange,
        producerInspection,
        owner: keepOwner ? context.owner : undefined,
        refs,
        report,
      }
    } finally {
      context.owner.dispose()
      PackedArena.open = original
      observe = undefined
    }
  }
  const escaped = [
    'create-queued',
    'metadata',
    'ready',
    'validation-queued',
    ...(words
      ? ['word-metadata', 'cache-copy', 'cached-collection', 'producer-complete', 'producer-cancel']
      : [
          'metadata-prefixes',
          'source-comparison',
          'descriptor-comparison',
          'range-close',
          'range-release',
        ]),
    'complete',
  ].flatMap((phase) => [false, true].map((keep) => probe(phase, keep)))
  const unreachable = () => {
    const context = fixture()
    const refs = [
      new WeakRef(context.owner),
      new WeakRef(context.capture),
      new WeakRef(context.source),
    ]
    observe = (_, value) => watch(value, refs)
    try {
      const documentBaseline = fromDocument
        ? finish(
            PackedDocumentBaseline.create(context.capture, context.source, ['document'], limits),
          )
        : undefined
      const create = Baseline.create(
        context.capture,
        context.source,
        ['document'],
        limits,
        documentBaseline,
      )
      const baseline = finish(create)
      const escapedKey = context.capture.reader.recordKey(['document', 'root', 'children', 1])
      const escapedCache = words
        ? baseline.find(context.capture.reader.at(['document', 'root', 'children', 1]))
        : undefined
      const escapedChunks = escapedCache?.chunks[Symbol.iterator]()
      if (escapedChunks) assert.equal(escapedChunks.next().done, false)
      const escapedRange = !words
        ? baseline.metadataRange(context.capture, ['document'], 1, 1)
        : undefined
      baseline.close()
      documentBaseline?.close()
      assert.equal(context.owner.stats.readers, 0)
      return {
        create,
        baseline,
        documentBaseline,
        escapedKey,
        escapedCache,
        escapedChunks,
        escapedRange,
        refs,
        report: { phase: 'closed-baseline-unreachable-live-owner', references: refs.length },
      }
    } finally {
      observe = undefined
    }
  }
  escaped.push(unreachable())
  let collected = false
  for (let attempt = 0; attempt < 40; attempt++) {
    await immediate()
    global.gc()
    await immediate()
    if (escaped.every((entry) => entry.refs.every((ref) => !ref.deref()))) {
      collected = true
      break
    }
  }
  if (!collected)
    console.log(
      'Uncollected:',
      escaped.filter((entry) => entry.refs.some((ref) => ref.deref())).map((entry) => entry.report),
    )
  assert.ok(
    collected,
    'Closed document baseline/work/key handles must not retain watched resources',
  )
  const probes = escaped.map((entry) => {
    assert.equal(entry.create.next().done, true)
    if (entry.work) assert.equal(entry.work.next().done, true)
    if (entry.producerInspection) assert.equal(entry.producerInspection.next().done, true)
    if (entry.baseline) assert.throws(() => entry.baseline.assertOpen(), /closed/)
    if (entry.documentBaseline) assert.throws(() => entry.documentBaseline.assertOpen(), /closed/)
    if (entry.escapedCache) assert.throws(() => entry.escapedCache.chunks, /closed/)
    if (entry.escapedChunks) assert.throws(() => entry.escapedChunks.next(), /closed/)
    if (entry.escapedRange) assert.equal(entry.escapedRange.blocks.total, 5)
    return entry.report
  })
  const result = {
    date: new Date().toISOString(),
    fromDocument,
    collected,
    probes,
    method: words
      ? 'Development Vite instrumentation watches typed cache plans and backing buffers, temporary copied chunk arrays, the retained flat chunk list, cached collection, completed cache records, source-point indexes, arenas and otherwise unreachable owners. Synchronous fragment producer collection also completes or revokes during an actual >=4096-unit borrowed chunk, retaining the closed inspection handle through GC. Closed work/capture/baseline, cache capabilities and already-advanced escaped chunk iterators remain unadvanced throughout GC. Escaped getters and iterator advances revoke; actual native cache storage must collect. This does not calibrate heap weights or establish parser equivalence/packaged performance.'
      : 'Development Vite instrumentation watches actual partial/complete source proof, descriptor comparison, metadata maps, summary objects, prefix typed arrays and their actual ArrayBuffer backing, source-point indexes, arenas and otherwise unreachable owners. Closed handles, source-free keys and escaped numeric metadata ranges remain unadvanced throughout GC, including explicit baseline close and borrowed capture release. This does not calibrate heap weights or establish parser equivalence/packaged performance.',
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    words
      ? fromDocument
        ? 'test/artifacts/logs/packed-word-from-document-lifetime.json'
        : 'test/artifacts/logs/packed-word-lifetime.json'
      : 'test/artifacts/logs/packed-document-lifetime.json',
    `${JSON.stringify(result, null, 2)}\n`,
  )
  console.log(JSON.stringify(result, null, 2))
} finally {
  delete globalThis[key]
  await server.close()
}
