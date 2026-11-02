import { parseMarkdown } from '@manuslip/core'
import { extractTranslation, projectTranslation, reconstructTranslation } from '@manuslip/translate'
import { expect, it } from 'vitest'
import { packValue, unpackValue } from '../../../core/src/packing'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { expandReadingIndex, readingBlocks, renderReading } from '../../src/reading'

const options = { rawHtml: true, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
const limits = { retained: 8 * 1024 * 1024, staging: 8 * 1024 * 1024 }
const normalize = (value: unknown) =>
  JSON.stringify(value).replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, 'UUID')
function compare(source: string, commonmark = false, packed = false) {
  const parsed = parseMarkdown(source, commonmark ? 'commonmark' : 'manuslip').root
  const root = packed
    ? (unpackValue(packValue(parsed, limits.retained), {
        bytes: limits.retained,
        ...limits,
      }).value as typeof parsed)
    : parsed
  const original = JSON.stringify(root),
    plan = extractTranslation(root, source)
  const values = new Map(
    plan.units.map((unit) => [
      unit.occurrenceId,
      unit.payload ? `Changed ${unit.payload.text}` : undefined,
    ]),
  )
  // Missing/invalid cases remain full source, even among otherwise translated siblings.
  if (!commonmark && plan.units[1]) values.delete(plan.units[1].occurrenceId)
  if (!commonmark && plan.units[2]) values.set(plan.units[2].occurrenceId, '⟪broken⟫')
  const projected = projectTranslation(plan, (unit) => values.get(unit.occurrenceId), limits)
  if (!projected) throw new Error('Unexpected aliased prose')
  const rebuilt = reconstructTranslation(plan, values)
  expect(plan.units.map((_, index) => projected.status(index))).toEqual(
    rebuilt.statuses.map((s) => s.status),
  )
  const translated = new Set(
    plan.units
      .filter((_, index) => projected.status(index) === 'translated')
      .map((unit) => `${unit.from}:${unit.to}`),
  )
  const reading = {
    blocks: readingBlocks(root, source),
    units: plan.units,
    translated,
    sourceLanguage: 'en',
    targetLanguage: 'ar',
    labels: { original: 'Original', translation: 'Translation' },
  }
  for (const layout of ['replace', 'side-by-side', 'interlinear'] as const) {
    const expected = renderReading(root, rebuilt.root, options, { ...reading, layout })
    const actual = renderReading(root, root, options, {
      ...reading,
      layout,
      children: projected.children,
    })
    expect(normalize(actual)).toBe(normalize(expected))
    if (layout !== 'replace') {
      const indexed = renderReading(root, root, options, {
        ...reading,
        layout,
        children: projected.children,
        indexAboveBytes: 0,
      })
      expect(normalize({ ...indexed, html: expandReadingIndex(indexed), indexed: undefined })).toBe(
        normalize(expected),
      )
    }
  }
  expect(JSON.stringify(root)).toBe(original)
  expect(projected.peakBytes).toBeLessThanOrEqual(limits.retained)
}

it.each(examples)(
  'projects complete CommonMark $example: $section without a translated mdast root',
  (example) => {
    compare(example.markdown, true)
  },
)
it.each([false, true])(
  'keeps table cells, task/list tightness, footnotes and protected markup with packed=%s',
  (packed) => {
    compare(
      '# Heading\r\n\r\nHello **bold** `PRIVATE`.\r\n\r\nFallback.\r\n\r\nInvalid.\r\n\r\n' +
        '- [x] task\n- second\n\n- loose\n\n  paragraph\n\n| Head | Ref |\n| :-- | --: |\n| Cell | [link][r] |\n\n' +
        '> > Nested *prose* $x^2$ and ![alt](private.png).\n\n' +
        'Foot[^n] and again[^n].\n\n[^n]: Footnote **prose** and [link][r].\n\n' +
        '[r]: https://private.invalid/ "PRIVATE_TITLE"\n\n' +
        'Hello <span title="PRIVATE">hidden <b>body</b></span> and `code`.\n\n~~~mermaid\ngraph LR; A --> B\n~~~',
      false,
      packed,
    )
  },
)
