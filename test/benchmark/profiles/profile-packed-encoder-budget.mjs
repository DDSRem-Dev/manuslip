import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'

const MiB = 1024 * 1024
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
})
try {
  const load = (name) => server.ssrLoadModule(`/packages/${name}.ts`)
  const { packValue, unpackValue } = await load('core/src/packing')
  const baseline = process.argv.includes('--baseline')
  const legacyPack = baseline
    ? (await server.ssrLoadModule('/test/artifacts/logs/packed-position-key-baseline/packing.ts'))
        .packValue
    : packValue
  const wireOracleSha256 = createHash('sha256')
    .update(
      await readFile(
        baseline
          ? 'test/artifacts/logs/packed-position-key-baseline/packing.ts'
          : 'packages/core/src/packing.ts',
      ),
    )
    .digest('hex')
  const { PackedEncodingBudget } = await load('core/src/packing-encode-budget')
  const { parseMarkdown } = await load('core/src/parse')
  const { renderProjectionLayout } = await load('renderer/src/projection-layout')
  let commonmarkComparisons = 0
  if (baseline) {
    const examples = JSON.parse(
      await readFile('packages/core/test/fixtures/commonmark-0.31.2/spec.json'),
    )
    for (const syntax of ['commonmark', 'manuslip']) {
      for (const example of examples) {
        const document = parseMarkdown(example.markdown, syntax)
        const input = { root: document.root, counts: document.counts }
        assert.deepEqual(
          new Uint8Array(packValue(input, 8 * MiB)),
          new Uint8Array(legacyPack(input, 8 * MiB)),
        )
        commonmarkComparisons++
      }
    }
  }
  const originalCharge = PackedEncodingBudget.prototype.charge
  const originalRelease = PackedEncodingBudget.prototype.release
  let charged = 0,
    peak = 0
  PackedEncodingBudget.prototype.charge = function (bytes) {
    originalCharge.call(this, bytes)
    charged += bytes
    peak = Math.max(peak, charged)
  }
  PackedEncodingBudget.prototype.release = function (bytes) {
    originalRelease.call(this, bytes)
    charged -= bytes
    assert.ok(charged >= 0)
  }
  const nestedChunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const cases = [
    ['bounded-preview', `# Heading\n\n${'Same paragraph.\n\n'.repeat(160)}`],
    ['inline-construction-pressure', '**x** '.repeat(8000)],
    [
      'inline-capacity-fallback',
      `# Inline pressure\n\n${'**x** '.repeat(12000)}\n\nComplete tail 世界.\n`,
    ],
    [
      'inline-capacity-fallback-16000',
      `# Inline pressure\n\n${'**x** '.repeat(16000)}\n\nComplete tail 世界.\n`,
    ],
    [
      'inline-encoder-pressure-24000',
      `# Inline pressure\n\n${'**x** '.repeat(24000)}\n\nComplete tail 世界.\n`,
    ],
    [
      'nested-complete',
      `# nested-containers\n\n${nestedChunk.repeat(Math.ceil(MiB / Buffer.byteLength(nestedChunk)))}\n[r]: https://example.invalid/\n`,
    ],
  ]
  const results = []
  try {
    for (const [name, text] of cases) {
      const document = parseMarkdown(text)
      const { projection, layout } = renderProjectionLayout(document.root, options, 64 * MiB)
      const input = { snapshot: { document, projection, layout } }
      const nativeSnapshotBytes = Buffer.byteLength(JSON.stringify(input.snapshot)) + 1024
      const legacy = legacyPack(input, 8 * MiB)
      charged = 0
      peak = 0
      // Diagnostic-only large budget quantifies the complete model. It is not a product cap.
      const payload = packValue(input, 8 * MiB, { working: 256 * MiB, nodes: 4000000, depth: 512 })
      const peakWorkingCharge = peak
      const finalWorkingCharge = charged
      assert.deepEqual(new Uint8Array(payload), new Uint8Array(legacy))
      const decoded = unpackValue(payload, { bytes: 8 * MiB, retained: 64 * MiB, staging: 8 * MiB })
      assert.deepEqual(decoded.value, input)
      charged = 0
      peak = 0
      let bounded
      try {
        const result = packValue(input, 8 * MiB, { working: 32 * MiB, nodes: 800000, depth: 512 })
        assert.deepEqual(new Uint8Array(result), new Uint8Array(legacy))
        bounded = { accepted: true, charged, peak }
      } catch (error) {
        assert.match(error.message, /Packed encoding exceeds (working|node\/depth) limit/)
        bounded = { accepted: false, charged, peak, error: error.message }
      }
      const result = {
        name,
        sourceBytes: Buffer.byteLength(text),
        sourceSha256: createHash('sha256').update(text).digest('hex'),
        payloadBytes: payload.byteLength,
        payloadSha256: createHash('sha256').update(new Uint8Array(payload)).digest('hex'),
        nativeSnapshotBytes,
        peakWorkingCharge,
        finalWorkingCharge,
        bounded,
      }
      results.push(result)
      console.log(JSON.stringify(result))
    }
  } finally {
    PackedEncodingBudget.prototype.charge = originalCharge
    PackedEncodingBudget.prototype.release = originalRelease
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/packed-encoder-budget.json',
    `${JSON.stringify(
      {
        date: new Date().toISOString(),
        wireOracle: baseline ? 'Archived pre-position-key encoder' : 'Current byte-only encoder',
        wireOracleSha256,
        commonmarkComparisons,
        runtime: process.versions,
        method:
          'Node/Vite diagnostic of explicit live encoder construction weights. Input graph and legacy oracle remain live. These weights are not measured process/heap memory. A diagnostic-only 256 MiB / 4M-node budget compares exact legacy wire bytes and complete decoded values; the separate 32 MiB / 800k-node attempt uses the product preview limits and reports capacity rejection. Records emit directly into bounded body chunks. Completed scratch is released; intern tables are dropped after resolving the root, before header/final output allocation. Shape lists, body/header chunks and output remain charged. Native snapshot bytes include the 1,024-byte JSON message reserve. No production limit or semantic transport activation changes.',
        results,
      },
      null,
      2,
    )}\n`,
  )
} finally {
  await server.close()
}
