import { parseMarkdown } from '@manuslip/core'
import { extractTranslation } from '@manuslip/translate'
import { expect, it } from 'vitest'
import { renderCapturedReading } from '../../../../src/main/exports/reading'
import type { ReadingExport } from '../../../../src/shared/reading-export'

const options = { rawHtml: false, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
const source = 'Hello `PRIVATE` $x$ [link](https://private.invalid).\n\nMissing paragraph.'
function capture(): ReadingExport {
  const plan = extractTranslation(parseMarkdown(source).root, source)
  return {
    schema: 'mdast-reading/v1',
    layout: 'side-by-side',
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    units: [{ index: 0, output: plan.units[0]?.payload?.text.replace('Hello', '你好') ?? '' }],
    missing: 'source',
    stale: true,
    confirmed: true,
  }
}
it('revalidates indexed prose outputs and produces an explicit immutable partial export', () => {
  const root = parseMarkdown(source).root
  const before = JSON.stringify(root)
  const result = renderCapturedReading(root, source, capture(), options, 'en')
  expect(result.html).toContain('1 of 2 prose units translated')
  expect(result.html).toContain('Untranslated units retain their source text.')
  expect(result.html).toContain('This copy excludes later source edits.')
  expect(result.html).toContain('你好')
  expect(result.html.match(/<code>PRIVATE<\/code>/g)).toHaveLength(2)
  expect(result.slots.map((slot) => slot.source)).toEqual(['x', 'x'])
  expect(JSON.stringify(root)).toBe(before)
  expect(() =>
    renderCapturedReading(
      root,
      source,
      { ...capture(), stale: false, missing: 'reject' },
      options,
      'en',
    ),
  ).toThrow('export-incomplete')
  expect(() =>
    renderCapturedReading(
      root,
      source,
      { ...capture(), units: [{ index: 0, output: 'Lost placeholders' }] },
      options,
      'en',
    ),
  ).toThrow()
  expect(() =>
    renderCapturedReading(
      root,
      source,
      { ...capture(), units: [{ index: 999, output: 'Unknown' }] },
      options,
      'en',
    ),
  ).toThrow('export-invalid')
})
