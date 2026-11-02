import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'

// A development correctness/capacity diagnostic, not incremental parsing or packaged latency.
if (!global.gc)
  throw new Error(
    'Run with node --expose-gc test/benchmark/profiles/profile-semantic-dependencies.mjs',
  )
const MiB = 1024 * 1024
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
})
try {
  const { parseMarkdown } = await server.ssrLoadModule('/packages/core/src/parse.ts')
  const { renderMarkdown } = await server.ssrLoadModule('/packages/renderer/src/index.ts')
  const { packValue } = await server.ssrLoadModule('/packages/core/src/packing.ts')
  const { PackedSession } = await server.ssrLoadModule('/packages/core/src/packing-session.ts')
  const { SemanticDependencies } = await server.ssrLoadModule(
    '/packages/core/src/semantic-dependencies.ts',
  )
  const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const source = `# nested-containers\n\n${chunk.repeat(Math.ceil(MiB / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
  const sha256 = createHash('sha256').update(source).digest('hex')
  assert.equal(sha256, '93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3')
  const parseStarted = performance.now()
  const document = parseMarkdown(source)
  const projection = renderMarkdown(document.root, {
    rawHtml: false,
    footnotesLabel: 'Footnotes',
    footnoteBackLabel: 'Back',
  })
  const fullOracleMs = performance.now() - parseStarted
  const identity = {
    generation: 1,
    documentId: 'dependency-diagnostic',
    revision: 0,
    sourceHash: document.sourceHash,
    parserVersion: document.parserVersion,
    rendererVersion: projection.rendererVersion,
    options: 'default',
  }
  const build = () => {
    const owner = new PackedSession({
      bytes: 8 * MiB,
      retained: 16 * MiB,
      staging: 8 * MiB,
      captures: 4,
      readers: 64,
    })
    const request = owner.begin(identity, source)
    owner.commit(owner.prepareFull(request, identity, packValue({ document, projection }, 8 * MiB)))
    const capture = owner.capture()
    // The index is a separately admitted caller output. Reserve every allowed live reader
    // in addition to the owner's accepted snapshot; no full outgoing payload is pending.
    const ownerBytes = owner.stats.retainedBytes
    const readerReserve = 64 * 512
    const started = performance.now()
    const index = SemanticDependencies.build(capture, source, ['document', 'root'], {
      retained: 16 * MiB - ownerBytes - readerReserve,
      staging: 8 * MiB,
      nodes: 800000,
      depth: 64,
    })
    const indexMs = performance.now() - started
    assert.equal(owner.stats.readers, 0)
    assert.ok(ownerBytes + readerReserve + index.retainedBytes <= 16 * MiB)
    capture.release()
    owner.dispose()
    assert.equal(owner.stats.retainedBytes, 0)
    return {
      index,
      indexMs,
      ownerBytes,
      readerReserve,
      disposed: owner.stats,
      weak: new WeakRef(owner),
    }
  }
  const result = build()
  assert.deepEqual(
    result.index.blocks.map(({ from, to, type }) => ({ from, to, type })),
    document.root.children.map((node) => ({
      from: node.position.start.offset,
      to: node.position.end.offset,
      type: node.type,
    })),
  )
  assert.equal(result.index.disjointBlocks, true)
  const expected = []
  const pending = [document.root]
  while (pending.length) {
    const node = pending.pop()
    if (['linkReference', 'imageReference', 'footnoteReference'].includes(node.type))
      expected.push({
        from: node.position.start.offset,
        to: node.position.end.offset,
        key: node.identifier.toUpperCase(),
      })
    if ('children' in node)
      for (let index = node.children.length - 1; index >= 0; index--)
        pending.push(node.children[index])
  }
  assert.deepEqual(
    result.index.references.map(({ from, to, key }) => ({ from, to, key })),
    expected,
  )
  assert.equal(result.index.definitions.length, 1)
  assert.equal(result.index.resolve('link', 'R').selected, true)
  for (const reference of result.index.references) assert.equal(reference.definition, 0)
  await new Promise((resolve) => setImmediate(resolve))
  global.gc()
  global.gc()
  assert.equal(
    result.weak.deref(),
    undefined,
    'Caller-owned index must not retain its disposed session',
  )
  result.index.assertBase(identity, source)
  const output = {
    method:
      'Development Node/Vite diagnostic. Exact complete nested fixture is independently parsed/rendered and packed. A separately admitted context index reads the accepted arena without native reconstruction. Combined owner, index (including exact source) and every allowed iterator reserve fit 16 MiB after full outgoing payload release. Every reference range/key matches the native oracle. The independent index survives owner disposal without retaining that owner. This does not prove update-time aggregate ownership, a safe fragment parser, renderer slicing, calibrated heap peaks or packaged acceptance.',
    date: new Date().toISOString(),
    runtime: process.versions,
    sourceBytes: Buffer.byteLength(source),
    sourceSha256: sha256,
    fullOracleMs,
    indexMs: result.indexMs,
    blocks: result.index.blocks.length,
    definitions: result.index.definitions.length,
    references: result.index.references.length,
    nodes: result.index.nodes,
    disjointBlocks: result.index.disjointBlocks,
    retainedBytes: result.index.retainedBytes,
    stagingBytes: result.index.stagingBytes,
    acceptedOwnerBytes: result.ownerBytes,
    readerReserve: result.readerReserve,
    combinedReservedBytes: result.ownerBytes + result.readerReserve + result.index.retainedBytes,
    disposedOwner: result.disposed,
    ownerCollectedWhileIndexAlive: true,
    equivalent: true,
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/semantic-dependency-profile.json',
    `${JSON.stringify(output, null, 2)}\n`,
  )
  console.log(JSON.stringify(output, null, 2))
} finally {
  await server.close()
}
