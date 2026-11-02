import { describe, expect, it } from 'vitest'
import { sourceHash } from '../../../core/src/contracts'
import {
  describeDocumentFragment,
  documentFragmentOperations,
} from '../../../core/src/document-metadata'
import {
  type FragmentChange,
  type MarkdownFragment,
  reparseMarkdownFragment,
} from '../../../core/src/markdown-fragment'
import { packValue } from '../../../core/src/packing'
import { PackedArena } from '../../../core/src/packing-arena'
import { readPackedNative } from '../../../core/src/packing-native'
import { PackedPublisher } from '../../../core/src/packing-publisher'
import { PackedReceiver } from '../../../core/src/packing-receiver'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { newPackedToken } from '../../../core/src/packing-token'
import { packedWireVersion, readPackedWire } from '../../../core/src/packing-wire'
import { parseMarkdown } from '../../../core/src/parse'
import { SemanticDependencies } from '../../../core/src/semantic-dependencies'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { type RenderOptions, renderMarkdown } from '../../src/index'
import {
  projectionFragmentOperations,
  projectMarkdownFragment,
} from '../../src/projection-fragment'
import { renderProjectionLayout } from '../../src/projection-layout'

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 64 }
const sessionLimits = { ...limits, retained: 16 * MiB, bytes: 8 * MiB, captures: 8, readers: 128 }
const options: RenderOptions = {
  rawHtml: false,
  footnotesLabel: 'Notes 世界',
  footnoteBackLabel: 'Back 返回',
}
function fixture(
  source: string,
  syntax: 'manuslip' | 'commonmark' = 'manuslip',
  changedOptions = options,
) {
  const document = parseMarkdown(source, syntax)
  const rendered = renderProjectionLayout(document.root, changedOptions, 8 * MiB)
  const initial = { document, projection: rendered.projection, layout: rendered.layout }
  const identity = {
    generation: 1,
    documentId: 'projection-tests',
    revision: 0,
    sourceHash: sourceHash(source),
    parserVersion: document.parserVersion,
    rendererVersion: rendered.projection.rendererVersion,
    options: JSON.stringify(changedOptions),
  }
  const owner = new PackedSession(sessionLimits)
  const publisher = new PackedPublisher(owner)
  const initialSource = new PackedSource(identity, source)
  let receiverExpected = initial
  let wireSequence = 0
  const receiver = new PackedReceiver(sessionLimits, (inspection, source) => {
    expect(inspection.identity).toEqual(source.identity)
    expect(readPackedNative(inspection.reader, [], sessionLimits).value).toEqual(receiverExpected)
  })
  const initialPayload = packValue(initial, 8 * MiB)
  const initialTicket = receiver.begin(0, initialSource)
  const initialWire = readPackedWire(
    {
      protocol: packedWireVersion,
      kind: 'full',
      sequence: 0,
      result: identity,
      sentAt: 0,
      requestToken: initialTicket.requestToken,
      resultToken: newPackedToken(),
      payload: initialPayload.slice(0),
      metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
    },
    { sequence: 0, result: identity, requestToken: initialTicket.requestToken },
  )
  const initialPrepared = owner.prepareFull(
    owner.beginPrepared(initialSource),
    identity,
    initialPayload,
    initialWire.bytes + initialWire.retainedBytes,
  )
  const initialOffer = publisher.offer(
    structuredClone(initialTicket),
    initialSource,
    initialPrepared,
    initialWire.message,
  )
  const initialReceived = receiver.receive(
    initialTicket,
    structuredClone(initialOffer, {
      transfer: [
        initialWire.message.kind === 'full' ? initialWire.message.payload : initialPayload,
      ],
    }),
  )
  if (initialReceived.kind !== 'accepted') throw new Error('Expected initial wire snapshot')
  publisher.acknowledge(structuredClone(initialReceived.acknowledgement))
  const receivedOriginal = initialReceived.capture
  let capture = owner.capture()
  let index = SemanticDependencies.build(capture, source, ['document', 'root'], limits)
  let indexHold = owner.retain(index)
  const oldCapture = owner.capture()
  function candidate(change: FragmentChange) {
    const before = index.sourceResource.text
    const after = before.slice(0, change.from) + change.insert + before.slice(change.to)
    const checked = new PackedSource(
      { ...index.identity, revision: index.identity.revision + 1, sourceHash: sourceHash(after) },
      after,
    )
    return reparseMarkdownFragment(
      {
        capture,
        dependencies: index,
        baseSource: before,
        source: checked,
        change,
        root: ['document', 'root'],
        syntax,
      },
      { ...limits, bytes: 64 * 1024, nodes: 8192 },
    )
  }
  function publish(change: FragmentChange, allowFallback = false) {
    const fragment = candidate(change)
    if (fragment.kind !== 'fragment') {
      if (allowFallback) return fragment
      throw new Error(`Unexpected fallback: ${fragment.reason}`)
    }
    const fragmentHold = owner.retain(fragment)
    const metadata = describeDocumentFragment(
      { capture, dependencies: index, fragment, document: ['document'], parseMs: 1 },
      limits,
    )
    const metadataHold = owner.retain(metadata)
    const projection = projectMarkdownFragment(
      {
        capture,
        dependencies: index,
        fragment,
        root: ['document', 'root'],
        projection: ['projection'],
        layout: ['layout'],
        options: changedOptions,
      },
      limits,
    )
    const projectionHold = owner.retain(projection)
    const payload = packValue(
      {
        children: fragment.children,
        position: fragment.position,
        blocks: metadata.blocks.values,
        outline: metadata.outline.values,
        counts: metadata.counts,
        sourceHash: fragment.source.identity.sourceHash,
        parserVersion: fragment.source.identity.parserVersion,
        timings: metadata.timings,
        ...projection.fields,
      },
      8 * MiB,
    )
    const records = PackedArena.open(payload.slice(0), sessionLimits)
    const outgoing = payload.slice(0)
    const operations = [
      ...documentFragmentOperations(fragment, metadata, records, ['document']),
      ...projectionFragmentOperations(fragment, projection, records),
    ]
    const sequence = ++wireSequence
    const receiveTicket = receiver.begin(sequence, fragment.source)
    expect(publisher.base(structuredClone(receiveTicket), fragment.source)).toBe(
      capture.sourceResource,
    )
    const wire = readPackedWire(
      {
        protocol: packedWireVersion,
        kind: 'delta',
        sequence,
        base: fragment.base,
        baseToken: receiveTicket.base?.token,
        result: fragment.source.identity,
        requestToken: receiveTicket.requestToken,
        resultToken: newPackedToken(),
        sentAt: 0,
        payload: outgoing,
        operations,
        metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
      },
      { sequence, result: fragment.source.identity, requestToken: receiveTicket.requestToken },
    )
    const previous = readPackedNative(capture.reader, [], sessionLimits).value
    const prepared = owner.prepareDelta(
      owner.beginPrepared(fragment.source),
      {
        base: fragment.base,
        baseSource: fragment.baseSource,
        result: fragment.source.identity,
        payload,
        operations,
      },
      wire.bytes + wire.retainedBytes + 16384,
    )
    const inspection = owner.capturePrepared(prepared)
    const fresh = parseMarkdown(fragment.source.text, syntax)
    const expectedProjection = renderMarkdown(fresh.root, changedOptions)
    const expected = {
      document: { ...fresh, timings: metadata.timings },
      projection: { ...expectedProjection, renderMs: projection.renderMs },
    }
    const actual = readPackedNative(inspection.reader, [], sessionLimits).value as typeof initial
    expect(actual.document).toEqual(expected.document)
    expect(actual.projection).toEqual(expected.projection)
    const expectedLayout = renderProjectionLayout(fresh.root, changedOptions, 8 * MiB).layout
    expect(actual.layout).toEqual(expectedLayout)
    receiverExpected = { ...expected, layout: expectedLayout }
    const offered = publisher.offer(
      structuredClone(receiveTicket),
      fragment.source,
      prepared,
      wire.message,
    )
    const received = receiver.receive(
      receiveTicket,
      structuredClone(offered, { transfer: [outgoing] }),
    )
    if (received.kind !== 'accepted') throw new Error('Unexpected wire resync')
    expect(readPackedNative(received.capture.reader, [], sessionLimits).value).toEqual(
      receiverExpected,
    )
    expect(readPackedNative(receivedOriginal.reader, [], sessionLimits).value).toEqual(initial)
    received.capture.release()
    expect(receiver.stats).toMatchObject({ holds: 1, readers: 0, requested: null, prepared: null })
    expect(receiver.stats.retainedBytes).toBeLessThanOrEqual(sessionLimits.retained)
    const updated = index.advance(fragment, limits)
    const updatedHold = owner.retain(updated)
    inspection.release()
    publisher.acknowledge(structuredClone(received.acknowledgement))
    expect(readPackedNative(capture.reader, [], sessionLimits).value).toEqual(previous)
    capture.release()
    capture = owner.capture()
    expect(readPackedNative(capture.reader, ['projection'], sessionLimits).value).toEqual(
      expected.projection,
    )
    expect(readPackedNative(oldCapture.reader, [], sessionLimits).value).toEqual(initial)
    indexHold.release()
    index = updated
    indexHold = updatedHold
    fragmentHold.release()
    metadataHold.release()
    projectionHold.release()
    expect(owner.stats.readers).toBe(0)
    expect(owner.stats.retainedBytes).toBeLessThanOrEqual(sessionLimits.retained)
    return fragment
  }
  return {
    owner,
    initial,
    candidate,
    publish,
    get capture() {
      return capture
    },
    get index() {
      return index
    },
    close() {
      receivedOriginal.release()
      receiver.dispose()
      expect(receiver.stats.retainedBytes).toBe(0)
      capture.release()
      oldCapture.release()
      indexHold.release()
      publisher.dispose()
      owner.dispose()
      expect(owner.stats).toMatchObject({
        retainedBytes: 0,
        captures: 0,
        readers: 0,
        resources: 0,
        holds: 0,
      })
    },
  }
}
const replace = (source: string, word: string, insert: string) => ({
  from: source.indexOf(word),
  to: source.indexOf(word) + word.length,
  insert,
})
const projectionRequest = (context: ReturnType<typeof fixture>, fragment: MarkdownFragment) => ({
  capture: context.capture,
  dependencies: context.index,
  fragment,
  root: ['document', 'root'],
  projection: ['projection'],
  layout: ['layout'],
  options,
})

describe('complete local parser and rendered projection transactions', () => {
  it.each([
    'Before.\n\nOrdinary writing.\n\nAfter.\n',
    'Same.\n\nSame writing.\n\nSame.\n',
    'First[^b].\n\nOrdinary writing [^a] and [^b].\n\nLast[^a].\n\n[^a]: Footer A.\n[^b]: Footer B.\n',
    'First[^b].\n\n> > Nested writing ![local][r] and [^a].\n>\n> [r]: assets/a.png\n\nLast[^b].\n\n[^a]: Footer [^c] and ![foot][image].\n[^b]: B [^c].\n[^c]: C [^a].\n[image]: https://example.invalid/a.png\n',
    '> Nested writing [r].\n>\n> [r]: /first\n\n[r]: /ignored\n\nAfter [r].\n',
    'Call[^a].\n\nOrdinary writing.\n\n[^a]: ```mermaid\n    graph TD; A-->B\n    ```\n\n[^unused]: ![hidden](a.png)\n',
    '---\ntitle: suppress\n---\n\n## Heading writing [r]\n\n- [x] Other\n\n[r]: https://example.invalid/\n',
    'Before.\r\n\r\n- Task writing 😀 ![local](assets/a.png)\r\n- [x] Other $x$\r\n\r\n| A | B |\r\n| - | - |\r\n| c | d |\r\n',
    '<div>raw block</div>\n\nOrdinary writing <em>raw inline</em>.\n\n```js\na\n```\n',
    'Writing[^a].\n\nOrdinary writing.\n\n[^a]: Uses [^b] and [^a].\n[^b]: Body ![x](a.png).\n[^a]: Duplicate.\n',
  ])('matches complete rendering while preserving all old captures: %j', (source) => {
    for (const rawHtml of [false, true]) {
      const context = fixture(source, 'manuslip', { ...options, rawHtml })
      try {
        let word = 'writing'
        for (const insert of ['longer written words', '中文𐐀', 'e\u0301 prose', 'writing']) {
          context.publish(replace(context.index.sourceResource.text, word, insert))
          word = insert
        }
      } finally {
        context.close()
      }
    }
  })
  it.each([
    '',
    ' ',
    '\n\n',
    '[r]: /r\n\n',
    'Call[^a].\n\n[^a]: Body\n\n',
    'Ordinary writing\n\n',
    '# Heading\n\n',
  ])('keeps exact separators, suppressed nodes and footer placement at EOF: %j', (source) => {
    const context = fixture(source)
    try {
      context.publish({ from: source.length, to: source.length, insert: 'word' })
      const after = context.index.sourceResource.text
      context.publish({ from: after.length, to: after.length, insert: ' longer' })
    } finally {
      context.close()
    }
  })
  it('preserves global footnote/widget semantics over a longer history of immutable transactions', () => {
    const source =
      '[^a]: Footer ![a](a.png) and [^b].\n\n![prefix](p.png) [^b].\n\n> Nested writing [r] [^a].\n>\n> [r]: /first\n> [r]: /ignored\n\n![suffix](s.png) [^a].\n\n[^b]: Footer $x$ and [^a].\n'
    const context = fixture(source)
    try {
      let word = 'writing'
      for (let step = 0; step < 24; step++) {
        const insert = ['longer written words', '中文𐐀', 'e\u0301 prose', 'writing'][step % 4]
        if (insert === undefined) throw new Error('Missing test word')
        context.publish(replace(context.index.sourceResource.text, word, insert))
        word = insert
      }
    } finally {
      context.close()
    }
  })
  it('admits exact output/scratch budgets and closes readers after failure in external context', () => {
    const context = fixture('Call[^a].\n\nOrdinary writing.\n\n[^a]: > > Footer ![x](a.png).\n')
    try {
      const fragment = context.candidate(
        replace(context.index.sourceResource.text, 'writing', 'longer prose'),
      )
      if (fragment.kind !== 'fragment') throw new Error(fragment.reason)
      const request = projectionRequest(context, fragment)
      const patch = projectMarkdownFragment(request, limits)
      const admitted = projectMarkdownFragment(request, {
        ...limits,
        retained: patch.retainedBytes,
        staging: patch.stagingBytes,
      })
      expect(admitted.fields.projectionBody).toBe(patch.fields.projectionBody)
      const before = context.owner.stats
      for (const changed of [
        { retained: patch.retainedBytes - 1 },
        { staging: patch.stagingBytes - 1 },
        { nodes: 1 },
        { depth: 0 },
      ]) {
        expect(() => projectMarkdownFragment(request, { ...limits, ...changed })).toThrow('limit')
        expect(context.owner.stats).toEqual(before)
      }
      expect(projectMarkdownFragment(request, limits).fields.projectionBody).toBe(
        patch.fields.projectionBody,
      )
    } finally {
      context.close()
    }
  })
  it('binds operation generation to the original fragment and patch and requires every payload field', () => {
    const context = fixture('Ordinary writing.\n\nAfter.\n')
    try {
      const change = replace(context.index.sourceResource.text, 'writing', 'longer prose')
      const fragment = context.candidate(change)
      const other = context.candidate(change)
      if (fragment.kind !== 'fragment' || other.kind !== 'fragment')
        throw new Error('Expected fragment')
      const patch = projectMarkdownFragment(projectionRequest(context, fragment), limits)
      const payload = PackedArena.open(packValue(patch.fields, 8 * MiB), sessionLimits)
      expect(projectionFragmentOperations(fragment, patch, payload).length).toBeGreaterThanOrEqual(
        9,
      )
      for (const invalid of [other, { ...fragment }])
        expect(() => projectionFragmentOperations(invalid, patch, payload)).toThrow('provenance')
      expect(() => projectionFragmentOperations(fragment, { ...patch }, payload)).toThrow(
        'provenance',
      )
      expect(() =>
        projectMarkdownFragment(projectionRequest(context, { ...fragment }), limits),
      ).toThrow('provenance')
      for (const field of Object.keys(patch.fields)) {
        const missing = { ...patch.fields }
        delete missing[field]
        const incomplete = PackedArena.open(packValue(missing, 8 * MiB), sessionLimits)
        expect(() => projectionFragmentOperations(fragment, patch, incomplete)).toThrow('Missing')
      }
    } finally {
      context.close()
    }
  })
  it('rejects invalid limits, paths, options and released captures without changing ownership', () => {
    const context = fixture('Ordinary writing.\n\nAfter.\n')
    try {
      const fragment = context.candidate(
        replace(context.index.sourceResource.text, 'writing', 'longer prose'),
      )
      if (fragment.kind !== 'fragment') throw new Error(fragment.reason)
      const request = projectionRequest(context, fragment)
      const before = context.owner.stats
      for (const key of ['retained', 'staging', 'nodes', 'depth'] as const)
        for (const value of [-1, NaN, Infinity, 0.5, undefined])
          expect(() =>
            projectMarkdownFragment(request, { ...limits, [key]: value } as typeof limits),
          ).toThrow('limits')
      for (const changed of [
        { retained: 17 * MiB },
        { staging: 9 * MiB },
        { nodes: 800001 },
        { depth: 65 },
      ])
        expect(() => projectMarkdownFragment(request, { ...limits, ...changed })).toThrow('limits')
      for (const key of ['root', 'projection', 'layout'] as const)
        for (const path of [[-1], ['x'.repeat(257)], Array(65).fill('x')])
          expect(() => projectMarkdownFragment({ ...request, [key]: path }, limits)).toThrow('path')
      expect(() =>
        projectMarkdownFragment({ ...request, options: { ...options, rawHtml: true } }, limits),
      ).toThrow('options/version')
      expect(context.owner.stats).toEqual(before)
      context.capture.release()
      expect(() => projectMarkdownFragment(request, limits)).toThrow('released')
    } finally {
      context.close()
    }
  })
  it('rejects stale projection/layout/ranges before publication and leaves all old snapshots intact', () => {
    const context = fixture('![before](b.png).\n\nOrdinary writing.\n\nAfter.\n')
    try {
      const fragment = context.candidate(
        replace(context.index.sourceResource.text, 'writing', 'longer prose'),
      )
      if (fragment.kind !== 'fragment') throw new Error(fragment.reason)
      const request = projectionRequest(context, fragment)
      const initial = context.initial
      const layout = initial.layout
      for (const malformed of [
        { ...initial, projection: { ...initial.projection, rendererVersion: 'stale' } },
        { ...initial, layout: { ...layout, bodyEnd: layout.htmlLength + 1 } },
        { ...initial, layout: { ...layout, htmlLength: layout.htmlLength + 1 } },
        { ...initial, layout: { ...layout, blocks: layout.blocks.slice(1) } },
        {
          ...initial,
          layout: {
            ...layout,
            blocks: [{ from: -1, to: 0, visible: true }, ...layout.blocks.slice(1)],
          },
        },
        {
          ...initial,
          layout: {
            ...layout,
            blocks: [{ from: 0, to: 1, visible: false }, ...layout.blocks.slice(1)],
          },
        },
        {
          ...initial,
          projection: {
            ...initial.projection,
            blocks: initial.projection.blocks.map((block) => ({ ...block, from: -1 })),
          },
        },
      ]) {
        const owner = new PackedSession(sessionLimits)
        try {
          const source = context.capture.sourceResource
          owner.commit(
            owner.prepareFull(
              owner.beginPrepared(source),
              source.identity,
              packValue(malformed, 8 * MiB),
            ),
          )
          const capture = owner.capture()
          const before = owner.stats
          expect(() => projectMarkdownFragment({ ...request, capture }, limits)).toThrow(
            /projection|Projection/,
          )
          expect(owner.stats).toEqual(before)
          expect(readPackedNative(capture.reader, [], limits).value).toEqual(malformed)
        } finally {
          owner.dispose()
        }
      }
      expect(readPackedNative(context.capture.reader, [], limits).value).toEqual(initial)
    } finally {
      context.close()
    }
  })
  it('keeps caller-owned output immutable and accounted through invalidation and eviction', () => {
    const context = fixture('Call[^a].\n\nOrdinary writing $x$.\n\n[^a]: Footer ![x](a.png).\n')
    try {
      const fragment = context.candidate(
        replace(context.index.sourceResource.text, 'writing', 'longer prose'),
      )
      if (fragment.kind !== 'fragment') throw new Error(fragment.reason)
      const patch = projectMarkdownFragment(projectionRequest(context, fragment), limits)
      const hold = context.owner.retain(patch)
      const fields = structuredClone(patch.fields)
      const resources = [...patch.resources()]
      expect(resources.reduce((sum, resource) => sum + resource.bytes, 0)).toBe(patch.retainedBytes)
      const immutable = (value: unknown) => {
        if (value === null || typeof value !== 'object') return
        expect(Object.isFrozen(value)).toBe(true)
        for (const child of Object.values(value)) immutable(child)
      }
      immutable(patch.fields)
      context.owner.invalidate()
      context.owner.evict()
      expect(context.owner.stats.holds).toBe(4)
      expect(patch.fields).toEqual(fields)
      hold.release()
      expect(patch.fields).toEqual(fields)
    } finally {
      context.close()
    }
  })
  for (const example of examples.filter((example) => example.markdown.includes('foo')))
    it(`matches a fresh complete projection or requires full parsing: CommonMark ${example.example}`, () => {
      const context = fixture(example.markdown, 'commonmark')
      try {
        context.publish(replace(example.markdown, 'foo', 'longerprose'), true)
      } finally {
        context.close()
      }
    })
})
