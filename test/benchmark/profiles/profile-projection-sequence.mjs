import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error(
    'Run with node --expose-gc test/benchmark/profiles/profile-projection-sequence.mjs',
  )
const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const sessionLimits = { ...limits, retained: 64 * MiB, bytes: 8 * MiB, captures: 8, readers: 160 }
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
})
try {
  const load = (name) => server.ssrLoadModule(`/packages/${name}.ts`)
  const { ProjectionSequence } = await load('renderer/src/projection-sequence')
  const { parseMarkdown } = await load('core/src/parse')
  const { renderProjectionLayout } = await load('renderer/src/projection-layout')
  const { inspectPackedNative } = await load('core/src/packing-native-steps')
  const { PackedWordBuffer } = await load('core/src/packing-word-buffer')
  const { PackedArena } = await load('core/src/packing-arena')
  const { PackedSession } = await load('core/src/packing-session')
  const { packValue } = await load('core/src/packing')
  const { sourceHash } = await load('core/src/contracts')
  const context = (root) => {
    const result = []
    const pending = [...root.children].reverse()
    while (pending.length) {
      const node = pending.pop()
      if (node.type === 'definition' || node.type === 'footnoteDefinition') result.push(node)
      else if ('children' in node) pending.push(...[...node.children].reverse())
    }
    return result
  }
  const nativeProbe = (phase, keepOwner) => {
    const references = []
    let appendedUnits = 0
    const originalCreate = PackedWordBuffer.create
    const originalAppend = PackedWordBuffer.prototype.append
    const originalOpen = PackedArena.open
    PackedWordBuffer.create = function (...args) {
      const buffer = originalCreate.apply(this, args)
      references.push(new WeakRef(buffer))
      return buffer
    }
    PackedWordBuffer.prototype.append = function (value) {
      originalAppend.call(this, value)
      appendedUnits += value.length
    }
    PackedArena.open = function (...args) {
      const arena = originalOpen.apply(this, args)
      references.push(new WeakRef(arena))
      return arena
    }
    const owner = new PackedSession(sessionLimits)
    try {
      const identity = {
        generation: 1,
        documentId: 'native-inspection-gc',
        revision: 0,
        sourceHash: sourceHash('source'),
        parserVersion: 'test',
        rendererVersion: 'test',
        options: 'test',
      }
      owner.commit(
        owner.prepareFull(
          owner.begin(identity, 'source'),
          identity,
          packValue({ values: [{ text: 'a界😀'.repeat(10000) }] }, 8 * MiB),
        ),
      )
      const capture = owner.capture()
      references.push(new WeakRef(capture.sourceResource))
      if (!keepOwner) references.push(new WeakRef(owner))
      let inspected = false
      const work = inspectPackedNative(capture, capture.reader, limits, function* (value) {
        const watch = (node) => {
          if (!node || typeof node !== 'object') return
          references.push(new WeakRef(node))
          for (const child of Object.values(node)) watch(child)
        }
        watch(value)
        inspected = true
        yield
      })
      let steps = 0
      if (phase !== 'unstarted') {
        while (true) {
          const step = work.next()
          steps++
          assert.ok(steps < 10000)
          if (phase === 'completed' && step.done) break
          assert.equal(step.done, false)
          if (phase === 'scan') break
          if (phase === 'decoded' && appendedUnits > 0) break
          if (phase === 'inspect' && inspected) break
        }
      }
      const report = { phase, keepOwner, steps, appendedUnits, inspected }
      capture.release()
      owner.dispose()
      assert.equal(owner.stats.retainedBytes, 0)
      assert.equal(owner.stats.readerStagingBytes, 0)
      assert.equal(owner.stats.readers, 0)
      return { work, capture, owner: keepOwner ? owner : undefined, references, report }
    } finally {
      owner.dispose()
      PackedWordBuffer.create = originalCreate
      PackedWordBuffer.prototype.append = originalAppend
      PackedArena.open = originalOpen
    }
  }
  const sequenceProbe = (phase) => {
    const root = parseMarkdown('[r]: /url\n\nText[^a] [r][r]\n\n[^a]: note with ![image][r]\n').root
    const definitions = context(root)
    const references = definitions.map((node) => new WeakRef(node))
    const sequence = new ProjectionSequence(definitions, options)
    let result
    if (phase !== 'unstarted') for (const node of root.children) result = sequence.render(node)
    if (phase === 'finished') result = sequence.finish()
    else sequence.close()
    return { sequence, result, references, report: { phase } }
  }
  const native = ['unstarted', 'scan', 'decoded', 'inspect', 'completed'].flatMap((phase) =>
    [false, true].map((keepOwner) => nativeProbe(phase, keepOwner)),
  )
  const sequences = ['unstarted', 'body', 'finished'].map(sequenceProbe)
  let collected = false
  for (let attempt = 0; attempt < 40; attempt++) {
    await immediate()
    global.gc()
    await immediate()
    if (
      [...native, ...sequences].every((entry) =>
        entry.references.every((reference) => !reference.deref()),
      )
    ) {
      collected = true
      break
    }
  }
  assert.ok(
    collected,
    'Closed inspection handles and sequences must release contexts, native copies, collectors, arenas, sources and owners',
  )
  const nativeProbes = native.map(({ work, capture, owner, report }) => {
    assert.equal(work.next().done, true)
    assert.throws(() => capture.reader.kind(), /released/)
    if (owner) assert.equal(owner.stats.retainedBytes, 0)
    return report
  })
  const sequenceProbes = sequences.map(({ sequence, result, report }) => {
    assert.throws(() => sequence.finish(), /closed/)
    assert.ok(result || report.phase === 'unstarted')
    return report
  })
  const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const nested = `# nested-containers\n\n${chunk.repeat(Math.ceil(MiB / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
  const reports = []
  for (const [name, text] of [
    ['nested', nested],
    ['widget', `~~~plain\n${'a界😀'.repeat(100000)}\n~~~\n`],
  ]) {
    const sha256 = createHash('sha256').update(text).digest('hex')
    if (name === 'nested')
      assert.equal(sha256, '93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3')
    const root = parseMarkdown(text).root
    const expected = renderProjectionLayout(root, options, 8 * MiB)
    const expectedBlocks = new Map(
      expected.projection.blocks.map((block) => [`${block.from}:${block.to}`, block]),
    )
    const seen = new Set()
    const contextStarted = performance.now()
    const definitions = context(root)
    const contextScanMs = performance.now() - contextStarted
    const started = performance.now()
    let batchStart = started
    const sequence = new ProjectionSequence(definitions, options)
    const constructorMs = performance.now() - started
    let activeMs = constructorMs
    let largestBlockMs = 0
    let largestBatchMs = constructorMs
    let largestHtmlUnits = 0
    let at = 0
    let visible = false
    const compare = (projection) => {
      assert.equal(projection.html, expected.projection.html.slice(at, at + projection.html.length))
      at += projection.html.length
      largestHtmlUnits = Math.max(largestHtmlUnits, projection.html.length)
      for (const block of projection.blocks) {
        const key = `${block.from}:${block.to}`
        assert.deepEqual(block, expectedBlocks.get(key))
        seen.add(key)
      }
    }
    let footerMs
    try {
      for (const [index, node] of root.children.entries()) {
        const before = performance.now()
        const chunk = sequence.render(node)
        const elapsed = performance.now() - before
        activeMs += elapsed
        largestBlockMs = Math.max(largestBlockMs, elapsed)
        const from = at + Number(visible && chunk.visible)
        if (visible && chunk.visible) {
          assert.equal(expected.projection.html[at], '\n')
          at++
        }
        compare(chunk.projection)
        assert.deepEqual({ from, to: at, visible: chunk.visible }, expected.layout.blocks[index])
        if (chunk.visible) visible = true
        largestBatchMs = Math.max(largestBatchMs, performance.now() - batchStart)
        if (performance.now() - batchStart >= 1) {
          await immediate()
          batchStart = performance.now()
        }
      }
      assert.equal(at, expected.layout.bodyEnd)
      const before = performance.now()
      const footer = sequence.finish()
      footerMs = performance.now() - before
      activeMs += footerMs
      compare(footer)
      largestBatchMs = Math.max(largestBatchMs, performance.now() - batchStart)
      assert.equal(at, expected.layout.htmlLength)
      assert.equal(seen.size, expectedBlocks.size)
    } finally {
      sequence.close()
    }
    reports.push({
      name,
      sourceBytes: Buffer.byteLength(text),
      sha256,
      blocks: root.children.length,
      contextScanMs,
      constructorMs,
      largestBlockMs,
      footerMs,
      activeMs,
      wallMs: performance.now() - started,
      largestBatchMs,
      largestHtmlUnits,
    })
  }
  const output = {
    method:
      'Development Node/Vite functional/ownership diagnostic. Sequenced public-handler rendering matches full HTML, all widget fields and exact layout spans for independent native roots. The diagnostic retains a complete fresh native root and full oracle outside application budgets: it is not a packed renderer, heap calibration or packaged timing proof. Native context/one-block input and generated HAST/output admission must be composed before production use. Native rendering and footer calls are synchronous; a 1 ms target scheduler reports actual block/batch maxima. Ten native-inspection probes retain unadvanced closed handles/captures with and without disposed owners. Actual appended units prove partial decoding. Inspectors hold immutable native copies across a yield; all nested native objects must collect on close. Three closed sequences and their native result strings/metadata remain retained while definition objects must collect. No renderer equivalence validator or application integration is activated.',
    date: new Date().toISOString(),
    runtime: process.versions,
    collected,
    nativeProbes,
    sequenceProbes,
    reports,
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/projection-sequence-profile.json',
    `${JSON.stringify(output, null, 2)}\n`,
  )
  console.log(JSON.stringify(output, null, 2))
} finally {
  await server.close()
}
