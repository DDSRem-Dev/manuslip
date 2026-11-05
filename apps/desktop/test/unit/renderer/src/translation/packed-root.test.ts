import { createHash } from 'node:crypto'
import { messageSize, parseMarkdown, sourceHash } from '@manuslip/core'
import { rendererVersion, renderMarkdown } from '@manuslip/renderer'
import { expandReadingIndex, readingProjectionBytes } from '@manuslip/renderer/reading'
import {
  extractTranslation,
  reconstructTranslation,
  type TranslationSettings,
} from '@manuslip/translate'
import { expect, it, vi } from 'vitest'
import { packValue } from '../../../../../../../packages/core/src/packing'
import { PackedSession } from '../../../../../../../packages/core/src/packing-session'
import { PackedSource } from '../../../../../../../packages/core/src/packing-source'
import examples from '../../../../../../../packages/core/test/fixtures/commonmark-0.31.2/spec.json'
import * as cacheHash from '../../../../../../../packages/translate/src/cache-hash'
import type { SliceRuntime } from '../../../../../src/renderer/src/semantics/sliced-work'
import { CompactReadingBlocks } from '../../../../../src/renderer/src/translation/compact-blocks'
import { ReadingProcessor } from '../../../../../src/renderer/src/translation/engine'
import { decodeReadingRoot } from '../../../../../src/renderer/src/translation/packed-root'
import { prepareReading } from '../../../../../src/renderer/src/translation/prepare'
import {
  decodeReadingValue,
  sharedReadingPrepared,
} from '../../../../../src/renderer/src/translation/prepared-wire'
import {
  type ReadingOperation,
  type ReadingValue,
  readingLimits,
} from '../../../../../src/renderer/src/translation/protocol'

const MiB = 1024 * 1024
const options = { rawHtml: true, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
const settings: TranslationSettings = {
  provider: {
    adapter: 'ollama',
    version: '1',
    baseUrl: 'http://localhost:11434/api/chat',
    model: 'fake',
    profile: null,
    options: {},
  },
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  glossary: [],
  formality: 'default',
  promptVersion: 'prose-translation/v1',
}
const source =
  '---\ntitle: Private\n---\n\n# Hello 世界\n\nHello *world*, `PRIVATE_CODE`, $x^2$ and [label][ref].\n\n[ref]: https://private.invalid/ "TITLE"\n\n- [x] Hello task\n\n| Hello | World |\n| - | - |\n| a | b |\n\nHello note[^n].\n\n[^n]: Hello footnote.\n\n<div>PRIVATE_HTML</div>\n\n```mermaid\ngraph LR; A --> B\n```\n'
function operation(
  text = source,
  syntax: 'manuslip' | 'commonmark' = 'manuslip',
): Extract<ReadingOperation, { kind: 'prepare-packed' }> {
  const document = parseMarkdown(text, syntax)
  return {
    kind: 'prepare-packed',
    payload: packValue(document.root, 8 * MiB),
    source: text,
    settings,
    identity: {
      generation: 1,
      documentId: 'reading',
      revision: 2,
      sourceHash: sourceHash(text),
      parserVersion: document.parserVersion,
      rendererVersion,
      options: JSON.stringify(options),
    },
  }
}
function capture(text = source) {
  const op = operation(text)
  const owner = new PackedSession({
    bytes: 8 * MiB,
    retained: 64 * MiB,
    staging: 8 * MiB,
    captures: 8,
    readers: 160,
  })
  const checked = new PackedSource(op.identity, text)
  owner.commit(owner.prepareFull(owner.beginPrepared(checked), checked.identity, op.payload))
  const capture = owner.capture()
  const captured = {
    kind: 'packed' as const,
    capture,
    path: [],
    retainedBytes: capture.retainedBytes,
  }
  owner.evict()
  return { owner, captured }
}
function scheduler() {
  let time = 0
  const queued: (() => void)[] = []
  const runtime: SliceRuntime = { now: () => ++time, defer: (run) => queued.push(run) }
  const drain = () => {
    while (queued.length) queued.shift()?.()
  }
  return { runtime, queued, drain }
}
it.each(['native', 'packed'] as const)(
  'renders a %s source preview without translation settings or request keys',
  async (kind) => {
    const processor = new ReadingProcessor()
    try {
      let wire: unknown
      await processor.respond(
        kind === 'packed'
          ? { ...operation(), settings: null }
          : { kind: 'prepare', root: parseMarkdown(source).root, source, settings: null },
        1,
        (response) => {
          wire = structuredClone(response.value)
        },
      )
      const prepared = decodeReadingValue(wire)
      if (prepared.kind !== 'prepared') throw new Error('Not prepared')
      expect(prepared.units.length).toBeGreaterThan(0)
      expect(prepared.units.every((unit) => unit.key === null)).toBe(true)
      const rendered = await processor.execute({ kind: 'render', outputs: [], options })
      if (rendered.kind !== 'rendered') throw new Error('Not rendered')
      expect(rendered.projection.html).toContain('Hello 世界</h1>')
      expect(rendered.projection.html).toContain('<em>world</em>')
      expect(rendered.projection.html).toContain('<code>PRIVATE_CODE</code>')
      expect(rendered.projection.html).toContain('https://private.invalid/')
      expect(rendered.projection.html).toContain('<table>')
      expect(rendered.projection.html).toContain('Hello footnote.')
      expect(rendered.projection.slots.map((slot) => slot.source)).toEqual([
        'x^2',
        'graph LR; A --> B',
      ])
      expect(rendered.projection.blocks?.find((block) => block.kind === 'heading')?.from).toBe(
        source.indexOf('# Hello'),
      )
    } finally {
      processor.clear()
    }
  },
)
it.each(['manuslip', 'commonmark'] as const)(
  'validates and expands the complete %s root, positions and private bindings in the worker',
  (syntax) => {
    const op = operation(source, syntax)
    const decoded = decodeReadingRoot(op)
    const original = parseMarkdown(source, syntax).root
    expect(JSON.stringify(decoded.root)).toBe(JSON.stringify(original))
    const { renderMs: _, ...actual } = renderMarkdown(decoded.root, options)
    const { renderMs: __, ...expected } = renderMarkdown(original, options)
    expect(actual).toEqual(expected)
    expect(decoded.bytes).toBeGreaterThan(op.payload.byteLength)
    expect(decoded.bytes).toBeLessThan(readingLimits.worker)
    expect(decoded.sourceBytes).toBe(source.length * 2)
    expect(op.payload.byteLength).toBe(0)
  },
)
it('preserves every pinned CommonMark example through worker source validation and decoding', () => {
  for (const example of examples) {
    const decoded = decodeReadingRoot(operation(example.markdown, 'commonmark'))
    expect(JSON.stringify(decoded.root), `CommonMark ${example.example}`).toBe(
      JSON.stringify(parseMarkdown(example.markdown, 'commonmark').root),
    )
  }
})
it.each([
  'hash',
  'source',
  'parser',
  'renderer',
  'options-json',
  'options-schema',
  'geometry',
  'schema',
  'wire',
  'trailing',
  'bytes',
  'envelope',
  'expanded',
] as const)('rejects %s without retaining a previous translation plan', async (failure) => {
  const processor = new ReadingProcessor()
  await processor.execute({
    kind: 'prepare',
    root: parseMarkdown('old').root,
    source: 'old',
    settings,
  })
  const op = operation()
  if (failure === 'hash') op.identity.sourceHash = 'wrong'
  if (failure === 'source') op.source = op.source.replace('Hello', 'Other')
  if (failure === 'parser') op.identity.parserVersion = 'unknown'
  if (failure === 'renderer') op.identity.rendererVersion = 'unknown'
  if (failure === 'options-json') op.identity.options = '{'
  if (failure === 'options-schema')
    op.identity.options = JSON.stringify({ ...options, extra: true })
  if (failure === 'geometry' || failure === 'schema') {
    const root = structuredClone(parseMarkdown(source).root)
    if (failure === 'geometry' && root.position) root.position.end.column++
    if (failure === 'schema') Object.assign(root, { extra: true })
    op.payload = packValue(root, 8 * MiB)
  }
  if (failure === 'wire') new Uint8Array(op.payload)[0] = 0
  if (failure === 'trailing') {
    const bytes = new Uint8Array(op.payload.byteLength + 1)
    bytes.set(new Uint8Array(op.payload))
    op.payload = bytes.buffer
  }
  if (failure === 'bytes') op.payload = new ArrayBuffer(8 * MiB)
  if (failure === 'envelope') op.settings = { ...settings, targetLanguage: 'x'.repeat(8 * MiB) }
  if (failure === 'expanded') {
    // Tiny deduplicated wire, large logical tree: decoding alone is not a capacity proof.
    const text = 'Hello\n\n'.repeat(20000)
    Object.assign(op, operation(text))
  }
  await expect(processor.execute(op)).rejects.toThrow(/translation-(view-limit|view-worker|limit)/)
  await expect(processor.execute({ kind: 'render', outputs: [], options })).rejects.toThrow(
    'translation-view-worker',
  )
})
it('produces the same provider units and final reading copy from packed and native captures', async () => {
  const engines = [new ReadingProcessor(), new ReadingProcessor()]
  const native = { kind: 'prepare' as const, root: parseMarkdown(source).root, source, settings }
  const copies: ReadingValue[] = []
  const allUnits: unknown[] = []
  for (const [index, engine] of engines.entries()) {
    const prepared = await engine.execute(index === 0 ? native : operation())
    if (prepared.kind !== 'prepared') throw new Error('Not prepared')
    allUnits.push(prepared.units.map(({ occurrenceId: _, ...unit }) => unit))
    const payloads = JSON.stringify(prepared.units.map((unit) => unit.payload))
    for (const secret of [
      'PRIVATE_CODE',
      'PRIVATE_HTML',
      'https://private.invalid/',
      'TITLE',
      'x^2',
    ])
      expect(payloads).not.toContain(secret)
    copies.push(
      await engine.execute({
        kind: 'render',
        options,
        outputs: prepared.units
          .filter((unit) => unit.key && unit.payload)
          .map((unit) => ({
            key: unit.key as string,
            output: unit.payload?.text.replaceAll('Hello', '你好') ?? '',
          })),
      }),
    )
  }
  expect(allUnits[1]).toEqual(allUnits[0])
  const normalize = (value: unknown) =>
    JSON.stringify(value).replace(
      /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g,
      'ID',
    )
  expect(normalize(copies[1])).toBe(normalize(copies[0]))
  expect(normalize(copies[1])).toContain('你好')
  expect(JSON.stringify(native.root)).toBe(JSON.stringify(parseMarkdown(source).root))
})
it('prepares and renders a complete packed root whose native AST message exceeds the existing cap', async () => {
  const text = `Prose ${'`PRIVATE` '.repeat(180)}\n\n`.repeat(200)
  const root = parseMarkdown(text).root,
    processor = new ReadingProcessor()
  const native = { kind: 'prepare' as const, root, source: text, settings }
  expect(messageSize(native)).toBeGreaterThan(readingLimits.message)
  await expect(processor.execute(native)).rejects.toThrow('translation-view-limit')
  const prepared = await processor.execute(operation(text))
  if (prepared.kind !== 'prepared') throw new Error('Not prepared')
  expect(prepared.units).toHaveLength(200)
  expect(new Set(prepared.units.map((unit) => unit.payload)).size).toBe(1)
  expect(JSON.stringify(prepared.units.map((unit) => unit.payload))).not.toContain('PRIVATE')
  const rendered = await processor.execute({ kind: 'render', outputs: [], options })
  if (rendered.kind !== 'rendered') throw new Error('Not rendered')
  expect(rendered.projection.html.match(/PRIVATE/g)).toHaveLength(36000)
  expect(rendered.projection.html).toContain('Prose')
  processor.clear()
}, 20_000)
it('prepares and renders every protected occurrence when repeated descriptor JSON exceeds the cap', async () => {
  const text = `Prose ${'`PRIVATE` '.repeat(220)}\n\n`.repeat(240)
  const root = parseMarkdown(text).root,
    processor = new ReadingProcessor()
  const prepared = await processor.execute(operation(text))
  if (prepared.kind !== 'prepared') throw new Error('Not prepared')
  expect((messageSize(prepared.units) + messageSize(prepared.blocks)) * 2).toBeGreaterThan(
    readingLimits.descriptors,
  )
  const wire = sharedReadingPrepared(prepared)
  expect(wire.bytes).toBeLessThan(readingLimits.descriptors)
  expect(wire.value.payloads).toHaveLength(1)
  expect(decodeReadingValue(structuredClone(wire.value))).toEqual(prepared)
  expect(prepared.units).toHaveLength(240)
  const rendered = await processor.execute({ kind: 'render', outputs: [], options })
  if (rendered.kind !== 'rendered') throw new Error('Not rendered')
  expect(rendered.projection.html.match(/PRIVATE/g)).toHaveLength(52800)
  const { renderReading } = await import('@manuslip/renderer/reading')
  const native = renderReading(root, root, options, {
    layout: 'replace',
    blocks: prepared.blocks,
    units: prepared.units,
    translated: new Set(),
    labels: { original: 'Original', translation: 'Translation' },
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage,
  })
  const normalize = (value: unknown) =>
    JSON.stringify(value).replaceAll(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/g, 'ID')
  expect(normalize(rendered.projection)).toBe(normalize(native))
  processor.clear()
}, 20_000)
it('releases prepare-only reservations before rendering without retaining returned unit records', async () => {
  const text = `Prose ${'`PRIVATE` '.repeat(240)}\n\n`.repeat(260),
    processor = new ReadingProcessor()
  const prepared = await processor.execute(operation(text))
  if (prepared.kind !== 'prepared') throw new Error('Not prepared')
  expect(prepared.units).toHaveLength(260)
  expect(Reflect.has(processor, 'units')).toBe(false)
  const packed = Reflect.get(processor, 'packed'),
    plan = Reflect.get(packed, 'plan'),
    records = Reflect.get(packed, 'records'),
    keys = Reflect.get(packed, 'keys') as Map<
      NonNullable<(typeof prepared.units)[number]['payload']>,
      string
    >
  expect(keys.size).toBe(1)
  expect(keys.get(plan.units[0].payload)).toBe(prepared.units[0]?.key)
  expect(Reflect.get(processor, 'plan')).toBeNull()
  expect(Reflect.has(plan, 'root')).toBe(false)
  expect(Reflect.has(packed, 'units')).toBe(false)
  expect(processor.stats.blockStoreBytes).toBeLessThan(prepared.blocks.length * 768)
  expect(records).toBeDefined()
  const rendered = await processor.execute({ kind: 'render', outputs: [], options })
  if (rendered.kind !== 'rendered') throw new Error('Not rendered')
  expect(rendered.projection.html.match(/PRIVATE/g)).toHaveLength(62400)
  const { renderReading } = await import('@manuslip/renderer/reading')
  const root = parseMarkdown(text).root
  const oracle = renderReading(root, root, options, {
    layout: 'replace',
    blocks: prepared.blocks,
    units: prepared.units,
    translated: new Set(),
    labels: { original: 'Original', translation: 'Translation' },
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage,
  })
  const normalize = (value: unknown) =>
    JSON.stringify(value).replaceAll(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/g, 'ID')
  expect(normalize(rendered.projection)).toBe(normalize(oracle))
  expect(Reflect.get(packed, 'records')).toBeUndefined()
  expect(Reflect.get(packed, 'preparedWire')).toBeUndefined()
  expect(Reflect.get(packed, 'output').value).toBe(rendered.projection)
  expect(processor.stats.retainedBytes).toBeLessThan(readingLimits.worker)
  processor.clear()
  expect(keys.size).toBe(0)
  expect(Reflect.get(processor, 'plan')).toBeNull()
  expect(processor.stats.blockStoreBytes).toBe(0)
  expect(processor.stats.retainedBytes).toBe(0)
  expect(() => plan.units).toThrow('released')
}, 20_000)
it('uses caller-mapped blocks directly and preserves independent fallback snapshots in every layout', async () => {
  const text = '# Hello\n\nHello `PRIVATE` and note[^n].\n\n[^n]: Hello footnote.',
    processor = new ReadingProcessor(),
    prepared = await processor.execute(operation(text))
  if (prepared.kind !== 'prepared') throw new Error('Not prepared')
  const blocks = structuredClone(prepared.blocks),
    mapped = blocks.map((block) => ({ ...block, id: crypto.randomUUID() })),
    snapshot = vi.spyOn(CompactReadingBlocks.prototype, 'snapshot')
  try {
    // The public response must not alias the worker's retained fallback values.
    prepared.blocks.length = 0
    for (const layout of ['replace', 'side-by-side', 'interlinear'] as const) {
      snapshot.mockClear()
      const supplied = await processor.execute({
        kind: 'render',
        options,
        outputs: [],
        layout,
        blocks: mapped,
      })
      if (supplied.kind !== 'rendered') throw new Error('Not rendered')
      expect(snapshot).not.toHaveBeenCalled()
      expect(supplied.projection.blocks).toEqual(mapped)
      expect(supplied.projection.html).toContain(`data-reading-block="${mapped[0]?.id}"`)
      const fallback = await processor.execute({ kind: 'render', options, outputs: [], layout })
      if (fallback.kind !== 'rendered') throw new Error('Not rendered')
      expect(snapshot).toHaveBeenCalledTimes(1)
      expect(fallback.projection.blocks).toEqual(blocks)
      const normalize = (value: unknown) =>
        JSON.stringify(value).replaceAll(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/g, 'ID')
      expect(normalize(fallback.projection)).toBe(normalize(supplied.projection))
      expect(fallback.projection.html).toContain('<code>PRIVATE</code>')
      expect(fallback.projection.html).toContain('data-footnote-ref')
    }
  } finally {
    snapshot.mockRestore()
    processor.clear()
  }
})
it('owns preparation, complete output and structured-clone scratch through response publication', async () => {
  const processor = new ReadingProcessor()
  let prepared: ReadingValue | undefined
  try {
    await processor.respond(operation(), 1, (response) => {
      const packed = Reflect.get(processor, 'packed')
      expect(Reflect.get(packed, 'records')).toBeDefined()
      expect(Reflect.get(packed, 'owner').stats.readerStagingBytes).toBeGreaterThan(0)
      prepared = decodeReadingValue(structuredClone(response.value))
    })
    if (prepared?.kind !== 'prepared') throw new Error('Not prepared')
    const packed = Reflect.get(processor, 'packed'),
      owner = Reflect.get(packed, 'owner'),
      before = owner.stats
    expect(Reflect.get(packed, 'records')).toBeUndefined()
    expect(Reflect.get(packed, 'preparedWire')).toBeUndefined()
    let escaped: { value: unknown } | undefined
    const failed = processor.respond({ kind: 'render', outputs: [], options }, 2, () => {
      escaped = Reflect.get(packed, 'output')
      expect(escaped?.value).toBeDefined()
      expect(owner.stats.readerStagingBytes).toBeGreaterThan(0)
      expect(owner.stats.retainedBytes).toBeGreaterThan(before.retainedBytes)
      throw new Error('Clone failed')
    })
    await expect(failed).rejects.toThrow('Clone failed')
    expect(() => escaped?.value).toThrow('released')
    expect(owner.stats).toEqual(before)
    await processor.respond({ kind: 'render', outputs: [], options }, 3, (response) => {
      expect(response.sequence).toBe(3)
      const value = structuredClone(response.value)
      if (value.kind !== 'rendered') throw new Error('Not rendered')
      expect(value.projection.html).toContain('PRIVATE')
    })
    expect(owner.stats).toEqual(before)
  } finally {
    processor.clear()
  }
})

it.each(['prepare', 'prepare-packed'] as const)(
  'cancels asynchronous %s without republishing a cleared plan or allowing overlapping work',
  async (kind) => {
    const processor = new ReadingProcessor()
    let resume = () => {}
    const gate = new Promise<void>((resolve) => {
      resume = resolve
    })
    const digest = cacheHash.murmurHash128
    const spy = vi.spyOn(cacheHash, 'murmurHash128').mockImplementationOnce(async (...args) => {
      await gate
      return digest(...args)
    })
    try {
      const op = operation()
      const pending = processor.execute(
        kind === 'prepare-packed'
          ? op
          : {
              kind,
              root: parseMarkdown(op.source).root,
              source: op.source,
              settings,
            },
      )
      const rejected = expect(pending).rejects.toThrow('translation-view-worker')
      expect(spy).toHaveBeenCalledTimes(1)
      const bytes = processor.stats.retainedBytes
      if (kind === 'prepare-packed') expect(bytes).toBeGreaterThan(0)
      processor.clear()
      if (kind === 'prepare-packed') expect(processor.stats.retainedBytes).toBe(bytes)
      await expect(processor.execute({ kind: 'render', outputs: [], options })).rejects.toThrow(
        'translation-view-worker',
      )
      resume()
      await rejected
      expect(processor.stats.retainedBytes).toBe(0)
      await expect(processor.execute({ kind: 'render', outputs: [], options })).rejects.toThrow(
        'translation-view-worker',
      )
    } finally {
      resume()
      spy.mockRestore()
      processor.clear()
    }
  },
)

it('reprojects changed raw-HTML policy and localized footnotes from the same validated source', async () => {
  const text = '<b>Raw</b>\n\nHello[^n].\n\n[^n]: A note.',
    processor = new ReadingProcessor()
  const prepared = await processor.execute(operation(text))
  if (prepared.kind !== 'prepared') throw new Error('Not prepared')
  const { renderReading } = await import('@manuslip/renderer/reading')
  const root = parseMarkdown(text).root
  try {
    for (const rawHtml of [false, true]) {
      const render = { rawHtml, footnotesLabel: '注释', footnoteBackLabel: '返回' }
      const rendered = await processor.execute({ kind: 'render', outputs: [], options: render })
      if (rendered.kind !== 'rendered') throw new Error('Not rendered')
      const oracle = renderReading(root, root, render, {
        layout: 'replace',
        blocks: prepared.blocks,
        units: prepared.units,
        translated: new Set(),
        labels: { original: 'Original', translation: 'Translation' },
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
      })
      const normalize = (value: unknown) =>
        JSON.stringify(value).replaceAll(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/g, 'ID')
      expect(normalize(rendered.projection)).toBe(normalize(oracle))
    }
  } finally {
    processor.clear()
  }
})

it.each(['replace', 'side-by-side', 'interlinear'] as const)(
  'fully translates 280 compact-bound units and preserves all 67,200 protected occurrences in %s',
  async (layout) => {
    const text = `Prose ${'`PRIVATE` '.repeat(240)}\n\n`.repeat(280),
      processor = new ReadingProcessor()
    const prepared = await processor.execute(operation(text))
    if (prepared.kind !== 'prepared') throw new Error('Not prepared')
    const first = prepared.units[0]
    if (!first?.payload || !first.key) throw new Error('No prose')
    expect(prepared.units).toHaveLength(280)
    expect(new Set(prepared.units.map((unit) => unit.key)).size).toBe(1)
    const output = first.payload.text.replace('Prose', 'Translated')
    expect(JSON.stringify(first.payload)).not.toContain('PRIVATE')
    const rendered = await processor.execute({
      kind: 'render',
      outputs: [{ key: first.key, output }],
      layout,
      options,
    })
    if (rendered.kind !== 'rendered') throw new Error('Not rendered')
    expect(rendered.projection.html.match(/Translated/g)).toHaveLength(280)
    expect(rendered.projection.html.match(/PRIVATE/g)).toHaveLength(
      layout === 'replace' ? 67200 : 134400,
    )
    const root = parseMarkdown(text).root,
      plan = extractTranslation(root, text),
      rebuilt = reconstructTranslation(
        plan,
        new Map(plan.units.map((unit) => [unit.occurrenceId, output])),
      )
    expect(rebuilt.statuses.every((status) => status.status === 'translated')).toBe(true)
    const { renderReading } = await import('@manuslip/renderer/reading')
    const oracle = renderReading(root, rebuilt.root, options, {
      layout,
      blocks: prepared.blocks,
      units: prepared.units,
      translated: new Set(plan.units.map((unit) => `${unit.from}:${unit.to}`)),
      labels: { original: 'Original', translation: 'Translation' },
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
    })
    const normalize = (value: unknown) =>
      JSON.stringify(value).replaceAll(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/g, 'ID')
    expect(normalize(rendered.projection)).toBe(normalize(oracle))
    processor.clear()
  },
  // This includes independent full parsing/reconstruction/rendering of 134,400
  // protected occurrences; worker latency is measured separately in packaged tests.
  20000,
)
it('fully translates the authoritative nested source without retaining reconstructed ancestors', async () => {
  const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const text = `# nested-containers\n\n${chunk.repeat(Math.ceil(1048576 / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
  expect(createHash('sha256').update(text).digest('hex')).toBe(
    '93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3',
  )
  const processor = new ReadingProcessor(),
    prepared = await processor.execute(operation(text))
  if (prepared.kind !== 'prepared') throw new Error('Not prepared')
  expect(prepared.units).toHaveLength(6299)
  const outputs = [
    ...new Map(
      prepared.units.flatMap((unit) =>
        unit.key && unit.payload
          ? [[unit.key, { key: unit.key, output: `Translated ${unit.payload.text}` }] as const]
          : [],
      ),
    ).values(),
  ]
  expect(outputs).toHaveLength(3)
  const rendered = await processor.execute({
    kind: 'render',
    outputs,
    blocks: prepared.blocks,
    options,
  })
  if (rendered.kind !== 'rendered') throw new Error('Not rendered')
  expect(rendered.projection.html.match(/Translated /g)).toHaveLength(6299)
  expect(rendered.projection.html.match(/<code>code<\/code>/g)).toHaveLength(9447)
  const root = parseMarkdown(text).root,
    plan = extractTranslation(root, text)
  const rebuilt = reconstructTranslation(
    plan,
    new Map(plan.units.map((unit) => [unit.occurrenceId, `Translated ${unit.payload?.text}`])),
  )
  expect(rebuilt.statuses.every((status) => status.status === 'translated')).toBe(true)
  const { renderReading } = await import('@manuslip/renderer/reading')
  const oracle = renderReading(root, rebuilt.root, options, {
    layout: 'replace',
    blocks: prepared.blocks,
    units: plan.units,
    translated: new Set(plan.units.map((unit) => `${unit.from}:${unit.to}`)),
    labels: { original: 'Original', translation: 'Translation' },
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage,
  })
  const digest = (value: unknown) =>
    createHash('sha256')
      .update(JSON.stringify(value).replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, 'UUID'))
      .digest('hex')
  expect(digest(rendered.projection)).toBe(digest(oracle))
  expect(messageSize(rendered.projection) * 2).toBe(7941406)
  expect(processor.stats.retainedBytes).toBeLessThan(readingLimits.worker)
  for (const layout of ['side-by-side', 'interlinear'] as const) {
    const result = await processor.execute({
      kind: 'render',
      outputs: [],
      blocks: prepared.blocks,
      layout,
      options,
    })
    if (result.kind !== 'rendered') throw new Error('Not rendered')
    expect(result.projection.indexed?.order).toHaveLength(6299)
    expect(readingProjectionBytes(result.projection)).toBeLessThan(readingLimits.projection)
    const native = renderReading(root, rebuilt.root, options, {
      layout,
      blocks: prepared.blocks,
      units: plan.units,
      translated: new Set(plan.units.map((unit) => `${unit.from}:${unit.to}`)),
      labels: { original: 'Original', translation: 'Translation' },
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
    })
    expect(
      digest({
        ...result.projection,
        html: expandReadingIndex(result.projection),
        indexed: undefined,
      }),
    ).toBe(digest(native))
  }
  const retry = await processor.execute({
    kind: 'render',
    outputs: [],
    blocks: prepared.blocks,
    options,
  })
  if (retry.kind !== 'rendered') throw new Error('Not rendered')
  expect(digest(retry.projection)).toBe(digest(oracle))
  processor.clear()
}, 60_000)
it('serializes cooperatively and transfers only the complete root, with independent worker ownership', async () => {
  const f = capture(),
    queue = scheduler(),
    processor = new ReadingProcessor()
  let received: ReadingOperation | undefined
  const engine = {
    request: vi.fn(async (op: ReadingOperation) => {
      if (op.kind !== 'prepare-packed') throw new Error('Native root crossed renderer')
      const transfer = structuredClone(op, { transfer: [op.payload] })
      expect(op.payload.byteLength).toBe(0)
      received = transfer
      return processor.execute(transfer)
    }),
    dispose: vi.fn(),
  }
  try {
    const pending = prepareReading(
      engine,
      f.captured,
      source,
      settings,
      new AbortController().signal,
      queue.runtime,
    )
    expect(engine.request).not.toHaveBeenCalled()
    expect(queue.queued.length).toBeGreaterThan(0)
    queue.drain()
    await expect(pending).resolves.toMatchObject({ kind: 'prepared' })
    expect(received?.kind).toBe('prepare-packed')
    expect(f.owner.stats).toMatchObject({ captures: 0, holds: 0, readers: 0, retainedBytes: 256 })
  } finally {
    f.owner.dispose()
  }
})
it.each([
  'before',
  'suspended',
  'serialized',
  'worker-failed',
  'changed-source',
  'revoked',
] as const)('releases capture, queued work and output after %s', async (phase) => {
  const f = capture(),
    queue = scheduler(),
    abort = new AbortController()
  const engine = {
    request: vi.fn(async (): Promise<ReadingValue> => {
      throw new Error('worker failed')
    }),
    dispose: vi.fn(),
  }
  try {
    if (phase === 'before') abort.abort()
    const pending = prepareReading(
      engine,
      f.captured,
      phase === 'changed-source' ? `${source}x` : source,
      settings,
      abort.signal,
      queue.runtime,
    )
    const rejected = expect(pending).rejects.toThrow()
    if (phase === 'suspended') abort.abort()
    if (phase === 'revoked') f.captured.capture.release()
    queue.drain()
    if (phase === 'serialized') abort.abort()
    await rejected
    queue.drain()
    expect(engine.request).toHaveBeenCalledTimes(phase === 'worker-failed' ? 1 : 0)
    expect(f.owner.stats).toMatchObject({ captures: 0, holds: 0, readers: 0, retainedBytes: 256 })
  } finally {
    f.owner.dispose()
  }
})
