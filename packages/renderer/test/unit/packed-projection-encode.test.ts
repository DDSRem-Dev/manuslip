import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../../core/src/contracts'
import { packValue, unpackValue } from '../../../core/src/packing'
import { packMarkdownDocumentSteps } from '../../../core/src/packing-markdown'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { validatePackedDocument } from '../../../core/src/packing-validate-document'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { parseMarkdown } from '../../../core/src/parse'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { type RenderedBlock, rendererVersion } from '../../src/index'
import { encodePackedProjectionSteps } from '../../src/packed-projection-encode'
import { encodePackedSnapshotSteps } from '../../src/packed-snapshot-encode'
import { renderProjectionLayout } from '../../src/projection-layout'
import { ProjectionSequence } from '../../src/projection-sequence'

const MiB = 1024 * 1024
const budget = { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const encoding = { working: 32 * MiB, nodes: 800000, depth: 512 }
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
function fixture(text: string, syntax: 'manuslip' | 'commonmark', readers = 64, render = options) {
  const document = parseMarkdown(text, syntax)
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'spool',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: document.parserVersion,
      rendererVersion,
      options: JSON.stringify(render),
    },
    text,
  )
  const owner = new PackedSession({
    bytes: 8 * MiB,
    retained: 16 * MiB,
    staging: 8 * MiB,
    captures: 8,
    readers,
  })
  const payload = finishPackedSteps(packMarkdownDocumentSteps(text, 8 * MiB, encoding, syntax))
  if (!payload) throw new Error('Missing document packet')
  const ticket = owner.beginPrepared(source)
  const capture = finishPackedSteps(owner.stageFullSteps(ticket, payload))
  if (!capture) throw new Error('Missing staged document')
  return { owner, capture, source, document, ticket }
}
function decode(payload: ArrayBuffer) {
  const value = unpackValue(payload, { bytes: 8 * MiB, retained: 32 * MiB, staging: 8 * MiB })
    .value as {
    events: (
      | { html: string }
      | { widget: Omit<RenderedBlock, 'html'> }
      | { widgetHtml: string }
      | { widgetEnd: true }
    )[]
    layout: ReturnType<typeof renderProjectionLayout>['layout']
    timings: { renderMs: number }
    rendererVersion: string
  }
  const parts: string[] = []
  const widgets = new Map<string, RenderedBlock>()
  let current: Omit<RenderedBlock, 'html'> | undefined
  let widgetParts: string[] = []
  for (const event of value.events) {
    if ('html' in event) {
      expect(event.html.length).toBeLessThanOrEqual(4097)
      parts.push(event.html)
    } else if ('widget' in event) {
      expect(current).toBeUndefined()
      current = event.widget
    } else if ('widgetHtml' in event) {
      expect(current).toBeDefined()
      widgetParts.push(event.widgetHtml)
    } else {
      if (!current) throw new Error('Missing widget metadata')
      widgets.set(`${current.from}:${current.to}`, { ...current, html: widgetParts.join('') })
      current = undefined
      widgetParts = []
    }
  }
  expect(current).toBeUndefined()
  return {
    layout: value.layout,
    projection: {
      html: parts.join(''),
      blocks: [...widgets.values()].sort((a, b) => a.from - b.from || b.to - a.to),
      renderMs: 0,
      rendererVersion: value.rendererVersion,
    },
  }
}
function verify(text: string, syntax: 'manuslip' | 'commonmark', rawHtml: boolean) {
  const render = { ...options, rawHtml }
  const { owner, capture, source, document, ticket } = fixture(text, syntax, 64, render)
  const baseline = owner.stats
  try {
    finishPackedSteps(validatePackedDocument(capture, source, [], budget))
    const result = finishPackedSteps(
      encodePackedProjectionSteps(capture, source, ['root'], render, budget, encoding, 8 * MiB),
    )
    if (!result) throw new Error('Missing encoded projection')
    try {
      const expected = renderProjectionLayout(document.root, render, 64 * MiB)
      expect(decode(result.value.payload)).toEqual({
        layout: expected.layout,
        projection: { ...expected.projection, renderMs: 0 },
      })
      expect(result.value.blocks).toBe(document.root.children.length)
      expect(result.value.bodyEnd).toBe(expected.layout.bodyEnd)
      expect(result.value.htmlLength).toBe(expected.layout.htmlLength)
      const payload = result.value.payload
      result.release()
      const spool = finishPackedSteps(owner.stageFullSteps(ticket, payload))
      if (!spool) throw new Error('Missing staged spool')
      try {
        const output = finishPackedSteps(
          encodePackedSnapshotSteps(capture, spool, 8 * MiB, encoding, budget),
        )
        if (!output) throw new Error('Missing complete snapshot')
        try {
          const actual = unpackValue(output.value.payload, {
            bytes: 8 * MiB,
            retained: 64 * MiB,
            staging: 8 * MiB,
          }).value as { document: typeof document; projection: typeof expected.projection }
          expect(actual).toEqual({
            document: { ...document, timings: expect.any(Object) },
            projection: { ...expected.projection, renderMs: expect.any(Number) },
            layout: expected.layout,
          })
          expect(output.value.payload).toEqual(
            packValue(
              {
                document: { ...document, timings: actual.document.timings },
                projection: { ...expected.projection, renderMs: actual.projection.renderMs },
                layout: expected.layout,
              },
              8 * MiB,
              encoding,
            ),
          )
          capture.release()
          spool.release()
          expect(output.value.payload.byteLength).toBeGreaterThan(0)
        } finally {
          output.release()
        }
      } finally {
        spool.release()
      }
    } finally {
      result.release()
    }
    expect(owner.stats.readers).toBe(0)
    expect(owner.stats.holds).toBe(0)
    expect(owner.stats.retainedBytes).toBeLessThan(baseline.retainedBytes)
  } finally {
    capture.release()
    owner.dispose()
  }
}

describe.each([
  { syntax: 'manuslip', rawHtml: false },
  { syntax: 'manuslip', rawHtml: true },
  { syntax: 'commonmark', rawHtml: false },
  { syntax: 'commonmark', rawHtml: true },
] as const)('complete $syntax render spools (raw HTML: $rawHtml)', ({ syntax, rawHtml }) => {
  for (const example of examples)
    it(`matches full HTML/widgets/layout for CommonMark ${example.example}`, () =>
      verify(example.markdown, syntax, rawHtml))
  it.each([
    '',
    '\ufeff# Heading\r\n\r\n界😀\ud800 \udfff\r\n',
    '---\ntitle: fixture\n---\n\n# Heading\n\n- [x] task\n\n```js title\nconst x = "<&"\n```\n\n$$\nx+y\n$$\n\n| a | b |\n| - | - |\n| one | two |\n',
    '> [r]: /first\n\n[r]: /duplicate\n\n[r] call[^b] and [^a] and [^b]\n\n[^a]: note A with `code`\n\n[^b]: note B with [r]\n',
    '<div>raw</div>\n\n[forward][r]\n\n[r]: /later\n',
  ])('preserves complete boundary and extension output for %j', (text) =>
    verify(text, syntax, rawHtml),
  )
})

it('preserves a complete one-MiB paragraph within the actual 64-slot Worker limit', () => {
  const sentence = 'A long paragraph keeps every word and its complete HTML output. '
  verify(`# Heading\n\n${sentence.repeat(Math.ceil(MiB / sentence.length))}`, 'manuslip', false)
})

it.each(['before', 'body', 'release', 'dispose', 'wire failure'] as const)(
  'closes the render/encoding graph after %s',
  (phase) => {
    const { owner, capture, source } = fixture('# Heading\n\nbody text\n\nnext\n', 'manuslip')
    const baseline = owner.stats
    const converted = vi.spyOn(ProjectionSequence.prototype, 'convertSteps')
    try {
      const work = encodePackedProjectionSteps(
        capture,
        source,
        ['root'],
        options,
        budget,
        encoding,
        phase === 'wire failure' ? 64 : 8 * MiB,
      )
      if (phase !== 'before' && phase !== 'wire failure')
        while (converted.mock.calls.length < 2) expect(work.next().done).toBe(false)
      if (phase === 'release') capture.release()
      else if (phase === 'dispose') owner.dispose()
      else if (phase === 'wire failure') expect(() => finishPackedSteps(work)).toThrow(/limit/)
      else work.return()
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(owner.stats.readers).toBe(0)
      expect(owner.stats.holds).toBe(0)
      if (phase === 'before' || phase === 'body' || phase === 'wire failure')
        expect(owner.stats).toEqual(baseline)
    } finally {
      converted.mockRestore()
      capture.release()
      owner.dispose()
    }
  },
)

it.each([0, 1, 2, 3, 4, 5])(
  'releases every partial factory lease with %i reader slots',
  (readers) => {
    const { owner, capture, source } = fixture('text\n', 'manuslip', readers)
    const baseline = owner.stats
    try {
      expect(() =>
        encodePackedProjectionSteps(capture, source, ['root'], options, budget, encoding, 8 * MiB),
      ).toThrow(/reader/)
      expect(owner.stats).toEqual(baseline)
    } finally {
      capture.release()
      owner.dispose()
    }
  },
)

it.each(['cancel', 'capture', 'dispose'] as const)(
  'closes the complete spool graph after reentrant %s inside native conversion',
  (action) => {
    const { owner, capture, source } = fixture('# Heading\n\nbody text\n\nnext\n', 'manuslip')
    const baseline = owner.stats
    const work = encodePackedProjectionSteps(
      capture,
      source,
      ['root'],
      options,
      budget,
      encoding,
      8 * MiB,
    )
    const convert = ProjectionSequence.prototype.convertSteps
    const converted = vi
      .spyOn(ProjectionSequence.prototype, 'convertSteps')
      .mockImplementation(function* (this: ProjectionSequence, node, limits) {
        const value = yield* convert.call(this, node, limits)
        if (action === 'cancel') work.return()
        else if (action === 'capture') capture.release()
        else owner.dispose()
        return value
      })
    try {
      let failure: unknown
      try {
        for (let advances = 0; advances < 100000 && !converted.mock.calls.length; advances++) {
          const next = work.next()
          if (next.done) break
        }
      } catch (error) {
        failure = error
      }
      expect(converted).toHaveBeenCalledTimes(1)
      if (failure)
        expect(String(failure)).toMatch(/Incomplete|closed|released|expired|disposed|cancelled/)
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(owner.stats.readers).toBe(0)
      expect(owner.stats.holds).toBe(0)
      expect(owner.stats.readerStagingBytes).toBe(0)
      if (action === 'cancel') expect(owner.stats).toEqual(baseline)
    } finally {
      converted.mockRestore()
      work.return()
      capture.release()
      owner.dispose()
      expect(owner.stats.retainedBytes).toBe(0)
    }
  },
)
