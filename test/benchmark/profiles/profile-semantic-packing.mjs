import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'

// Development-Node diagnostic, deliberately separate from packaged acceptance gates.
// Source and all semantic nodes remain complete. This does not enable a runtime protocol.
if (!global.gc)
  throw new Error('Run with node --expose-gc test/benchmark/profiles/profile-semantic-packing.mjs')
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
})
try {
  const { parseMarkdown } = await server.ssrLoadModule('/packages/core/src/parse.ts')
  const { renderMarkdown } = await server.ssrLoadModule('/packages/renderer/src/index.ts')
  const { packValue, unpackValue } = await server.ssrLoadModule('/packages/core/src/packing.ts')
  const { PackedArena } = await server.ssrLoadModule('/packages/core/src/packing-arena.ts')
  const { readPackedSubtree } = await server.ssrLoadModule('/packages/core/src/packing-subtree.ts')
  const { PackedRevision } = await server.ssrLoadModule('/packages/core/src/packing-revision.ts')
  const { sourceHash } = await server.ssrLoadModule('/packages/core/src/contracts.ts')
  const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const body = chunk.repeat(Math.ceil((1024 * 1024) / Buffer.byteLength(chunk)))
  const source = `# nested-containers\n\n${body}\n[r]: https://example.invalid/\n`
  const options = { rawHtml: false, footnotesLabel: 'Footnotes', footnoteBackLabel: 'Back' }
  const parseStarted = performance.now()
  const document = parseMarkdown(source)
  const projection = renderMarkdown(document.root, options)
  const parsedMs = performance.now() - parseStarted
  const original = { document, projection }
  const json = JSON.stringify(original)
  const started = performance.now()
  const payload = packValue(original, 8 * 1024 * 1024 - 1024)
  const encodeMs = performance.now() - started
  global.gc()
  global.gc()
  const before = process.memoryUsage()
  const decodeStarted = performance.now()
  const decoded = unpackValue(payload, {
    bytes: 8 * 1024 * 1024 - 1024,
    retained: 32 * 1024 * 1024,
    staging: 8 * 1024 * 1024,
  })
  const decodeMs = performance.now() - decodeStarted
  global.gc()
  global.gc()
  const after = process.memoryUsage()
  assert.deepEqual(decoded.value, original)
  assert.deepEqual(structuredClone(decoded.value), original)
  const decodedProjection = renderMarkdown(decoded.value.document.root, options)
  assert.equal(decodedProjection.html, projection.html)
  assert.deepEqual(decodedProjection.blocks, projection.blocks)
  const arenaInput = payload.slice(0)
  const arenaBytes = arenaInput.byteLength
  global.gc()
  global.gc()
  const beforeArena = process.memoryUsage()
  const arenaStarted = performance.now()
  const arena = PackedArena.open(arenaInput, {
    bytes: 8 * 1024 * 1024 - 1024,
    retained: 16 * 1024 * 1024,
    staging: 8 * 1024 * 1024,
  })
  const arenaMs = performance.now() - arenaStarted
  global.gc()
  global.gc()
  const afterArena = process.memoryUsage()
  assert.equal(arenaInput.byteLength, 0)
  const compareArena = (reference, value) => {
    const kind = arena.kind(reference)
    if (kind === 'scalar') assert.equal(arena.scalar(reference), value)
    else if (kind === 'position') assert.deepEqual(arena.position(reference), value)
    else if (kind === 'array') {
      assert.equal(arena.length(reference), value.length)
      let index = 0
      for (const child of arena.elements(reference)) compareArena(child, value[index++])
    } else {
      assert.deepEqual(arena.keys(reference), Object.keys(value))
      for (const key of arena.keys(reference)) compareArena(arena.field(reference, key), value[key])
    }
  }
  compareArena(arena.root, original)
  const documentRef = arena.field(arena.root, 'document')
  const blocksRef = arena.field(documentRef, 'blocks')
  const blocksStarted = performance.now()
  let rangeSum = 0
  let blockCount = 0
  for (const reference of arena.elements(blocksRef)) {
    rangeSum +=
      arena.scalar(arena.field(reference, 'from')) + arena.scalar(arena.field(reference, 'to'))
    blockCount++
  }
  const blockReadMs = performance.now() - blocksStarted
  assert.equal(blockCount, document.blocks.length)
  assert.equal(
    rangeSum,
    document.blocks.reduce((sum, block) => sum + block.from + block.to, 0),
  )
  const rootRef = arena.field(documentRef, 'root')
  const childrenRef = arena.field(rootRef, 'children')
  let selectedRef
  for (const reference of arena.elements(childrenRef)) {
    if (arena.scalar(arena.field(reference, 'type')) === 'blockquote') {
      selectedRef = reference
      break
    }
  }
  assert.notEqual(selectedRef, undefined)
  const selectedStarted = performance.now()
  const selected = readPackedSubtree(arena, selectedRef, { retained: 65536, staging: 65536 })
  const selectedMs = performance.now() - selectedStarted
  assert.deepEqual(
    selected.value,
    document.root.children.find((node) => node.type === 'blockquote'),
  )
  // This diagnostic obtains changes from independent full parses. It does not claim incremental
  // Markdown parsing: full-tree diff/oracle costs are reported separately from delta admission.
  const revisionLimits = { retained: 16 * 1024 * 1024, staging: 8 * 1024 * 1024 }
  const makeIdentity = (text, revision) => ({
    generation: 1,
    documentId: 'nested-diagnostic',
    revision,
    sourceHash: sourceHash(text),
    parserVersion: document.parserVersion,
    rendererVersion: projection.rendererVersion,
    options: JSON.stringify(options),
  })
  const base = PackedRevision.full(arena, source, makeIdentity(source, 0), revisionLimits)
  const editedSource = source.replace('Nested writing', 'Nested editing')
  assert.notEqual(editedSource, source)
  const oracleStarted = performance.now()
  const editedDocument = parseMarkdown(editedSource)
  const editedProjection = renderMarkdown(editedDocument.root, options)
  const edited = { document: editedDocument, projection: editedProjection }
  const editOracleMs = performance.now() - oracleStarted
  const changes = []
  const diff = (before, after, path = []) => {
    if (Object.is(before, after)) return
    if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
      for (let index = 0; index < before.length; index++)
        diff(before[index], after[index], [...path, index])
    } else if (
      before &&
      after &&
      typeof before === 'object' &&
      typeof after === 'object' &&
      !Array.isArray(before) &&
      !Array.isArray(after) &&
      JSON.stringify(Object.keys(before)) === JSON.stringify(Object.keys(after))
    ) {
      for (const key of Object.keys(after)) diff(before[key], after[key], [...path, key])
    } else changes.push({ path, value: after })
  }
  const diffStarted = performance.now()
  diff(original, edited)
  const editDiffMs = performance.now() - diffStarted
  const deltaStarted = performance.now()
  const deltaPayload = packValue(
    changes.map(({ value }) => value),
    8 * 1024 * 1024 - 1024,
  )
  const deltaBytes = deltaPayload.byteLength
  const deltaArena = PackedArena.open(deltaPayload, {
    bytes: 8 * 1024 * 1024 - 1024,
    ...revisionLimits,
  })
  const deltaEncodeIndexMs = performance.now() - deltaStarted
  const deltaRecords = [...deltaArena.elements(deltaArena.root)]
  const update = {
    base: base.identity,
    baseSource: source,
    result: makeIdentity(editedSource, 1),
    source: editedSource,
    arena: deltaArena,
    operations: changes.map(({ path }, index) => ({
      kind: 'replace',
      path,
      record: deltaRecords[index],
    })),
  }
  const applyStarted = performance.now()
  const updated = base.apply(update, {
    ...revisionLimits,
    retained: revisionLimits.retained - deltaBytes,
  })
  const deltaApplyMs = performance.now() - applyStarted
  const compareView = (view, value) => {
    if (view.kind() === 'scalar') assert.equal(view.scalar(), value)
    else if (view.kind() === 'position') assert.deepEqual(view.position(), value)
    else if (view.kind() === 'array') {
      assert.equal(view.length(), value.length)
      let index = 0
      for (const child of view.elements()) compareView(child, value[index++])
    } else {
      assert.deepEqual(view.keys(), Object.keys(value))
      for (const key of view.keys()) compareView(view.at([key]), value[key])
    }
  }
  compareView(updated.root, edited)
  compareView(base.root, original)
  assert.throws(() => updated.apply(update, revisionLimits), /base mismatch/)
  // Whole HTML replacement remains expensive even when graph/path storage is persistent.
  // Demonstrate bounded refusal on a subsequent edit, including one outgoing delta reserve.
  const reversePayload = packValue(
    changes.map(({ path }) => path.reduce((value, part) => value[part], original)),
    8 * 1024 * 1024 - 1024,
  )
  const reverseBytes = reversePayload.byteLength
  const reverseArena = PackedArena.open(reversePayload, {
    bytes: 8 * 1024 * 1024 - 1024,
    ...revisionLimits,
  })
  const reverseRecords = [...reverseArena.elements(reverseArena.root)]
  assert.throws(
    () =>
      updated.apply(
        {
          base: updated.identity,
          baseSource: editedSource,
          result: makeIdentity(source, 2),
          source,
          arena: reverseArena,
          operations: changes.map(({ path }, index) => ({
            kind: 'replace',
            path,
            record: reverseRecords[index],
          })),
        },
        { ...revisionLimits, retained: revisionLimits.retained - reverseBytes },
      ),
    /retained limit/,
  )
  compareView(updated.root, edited)
  const result = {
    method:
      'Development Node/Vite diagnostic, complete packaged corpus fixture. Full native semantic document/projection vs immutable packed value DAG; full deep equality, native structured-clone equality and rendered HTML/block equality. Forced GC delta observes decoded graph only while original, encoded bytes and Vite modules remain alive; it is neither total application RSS nor a portable heap bound. Application protocol is unchanged.',
    runtime: process.versions,
    date: new Date().toISOString(),
    sourceBytes: Buffer.byteLength(source),
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    jsonBytes: Buffer.byteLength(json),
    packedBytes: payload.byteLength,
    parsedMs,
    encodeMs,
    decodeMs,
    retainedAccounting: decoded.retainedBytes,
    stagingAccounting: decoded.stagingBytes,
    records: decoded.records,
    heapDelta: after.heapUsed - before.heapUsed,
    externalDelta: after.external - before.external,
    arrayBufferDelta: after.arrayBuffers - before.arrayBuffers,
    observedDecodedBytes:
      after.heapUsed - before.heapUsed + Math.max(0, after.arrayBuffers - before.arrayBuffers),
    equivalent: true,
    withinCurrentTransport: payload.byteLength + 1024 <= 8 * 1024 * 1024,
    withinCurrentAccountingLimit: decoded.retainedBytes <= 32 * 1024 * 1024,
    arena: {
      method:
        'Validate and index the same complete MSP2 payload, then consume its buffer by native transfer. Large strings validate in chunks and stay uncached; short strings at most 4096 encoded bytes are cached. Heap/ArrayBuffer deltas are sampled after two GCs, before reading the graph; owned incoming payload bytes are added because they existed before the baseline. Every field of the full document/projection is compared by direct indexed reads without expanding the graph. No facade or full-tree cache is retained. Selected subtree extraction separately accounts its output and workspace.',
      indexMs: arenaMs,
      blockReadMs,
      blockCount,
      retainedAccounting: arena.retainedBytes,
      stagingAccounting: arena.stagingBytes,
      heapDelta: afterArena.heapUsed - beforeArena.heapUsed,
      arrayBufferDelta: afterArena.arrayBuffers - beforeArena.arrayBuffers,
      observedOwnedBytes:
        arenaBytes +
        Math.max(0, afterArena.heapUsed - beforeArena.heapUsed) +
        Math.max(0, afterArena.arrayBuffers - beforeArena.arrayBuffers),
      withSourceAccounting: arena.retainedBytes + source.length * 2,
      withinWorkerCacheWithSource: arena.retainedBytes + source.length * 2 <= 16 * 1024 * 1024,
      withSourceAndTransferReserveAccounting: arena.retainedBytes + source.length * 2 + arenaBytes,
      withinWorkerCacheWithTransferReserve:
        arena.retainedBytes + source.length * 2 + arenaBytes <= 16 * 1024 * 1024,
      selected: {
        milliseconds: selectedMs,
        records: selected.records,
        retainedAccounting: selected.retainedBytes,
        stagingAccounting: selected.stagingBytes,
        equivalent: true,
      },
      equivalent: true,
    },
    delta: {
      method:
        'One same-length prose edit; independent complete parse/render oracle and whole-tree diff generate path replacements. Delta encoding/indexing/admission measured separately. Every field of updated document/projection equals the full oracle, and every field of the old captured graph stays unchanged. This measures persistent storage/admission, not incremental parse, packaged freshness or session-wide capture ownership.',
      operationCount: changes.length,
      bytes: deltaBytes,
      oracleMs: editOracleMs,
      fullDiffMs: editDiffMs,
      encodeIndexMs: deltaEncodeIndexMs,
      applyMs: deltaApplyMs,
      baseRetainedAccounting: base.retainedBytes,
      retainedAccounting: updated.retainedBytes,
      preparationAccounting: updated.preparationBytes,
      stagingAccounting: updated.stagingBytes,
      preparationWithDeltaTransferReserve: updated.preparationBytes + deltaBytes,
      withinWorkerCacheWithDeltaTransferReserve:
        updated.preparationBytes + deltaBytes <= 16 * 1024 * 1024,
      equivalent: true,
      oldCaptureEquivalent: true,
      staleBaseRejected: true,
      nextFullHtmlDeltaRejectedAtCacheCapWithTransferReserve: true,
    },
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/semantic-packing-profile.json',
    `${JSON.stringify(result, null, 2)}\n`,
  )
  console.log(JSON.stringify(result, null, 2))
} finally {
  await server.close()
}
