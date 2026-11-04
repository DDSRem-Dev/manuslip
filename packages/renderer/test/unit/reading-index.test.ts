import { parseMarkdown } from '@manuslip/core'
import { expect, it } from 'vitest'
import {
  expandReadingIndex,
  readingBlocks,
  readingProjectionBytes,
  renderReading,
} from '../../src/reading'

function fixture() {
  const source = '# Heading\n\nRepeated **prose**.\n\nRepeated **prose**.\n\nEnd.',
    root = parseMarkdown(source).root
  return renderReading(
    root,
    root,
    { rawHtml: true, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' },
    {
      layout: 'side-by-side',
      blocks: readingBlocks(root, source),
      sourceLanguage: 'en',
      targetLanguage: 'fr',
      labels: { original: 'Original', translation: 'Translation' },
      units: [],
      translated: new Set(),
      indexAboveBytes: 0,
    },
  )
}
it('preserves whole-fragment raw HTML parsing instead of isolating tags across rows', () => {
  const source = '<div>\n\nFirst paragraph.\n\nSecond paragraph.\n\n</div>',
    root = parseMarkdown(source).root
  const value = renderReading(
    root,
    root,
    { rawHtml: true, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' },
    {
      layout: 'interlinear',
      blocks: readingBlocks(root, source),
      sourceLanguage: 'en',
      targetLanguage: 'fr',
      labels: { original: 'Original', translation: 'Translation' },
      units: [],
      translated: new Set(),
      indexAboveBytes: 0,
    },
  )
  expect(value.indexed).toBeUndefined()
  expect(value.html).toContain('First paragraph.')
})
it('shares exact row values with distinct anchors and preserves complete native expansion', () => {
  const value = fixture()
  expect(value.html).toBe('')
  expect(value.indexed?.order).toHaveLength(4)
  expect(value.indexed?.values).toHaveLength(3)
  expect(value.indexed?.order[1]).toBe(value.indexed?.order[2])
  const expanded = expandReadingIndex(value)
  for (const block of value.blocks ?? [])
    expect(expanded).toContain(`data-reading-block="${block.id}"`)
  expect(expanded.match(/Repeated/g)).toHaveLength(4)
  expect(readingProjectionBytes(value)).toBeGreaterThan(4096)
})
it('counts HTML as retained UTF-16 and still charges unexpected metadata', () => {
  const ascii = { html: 'x'.repeat(1000), slots: [] }
  expect(readingProjectionBytes({ ...ascii, html: '界'.repeat(1000) })).toBe(
    readingProjectionBytes(ascii),
  )
  const extended = { ...ascii, extra: 'x'.repeat(1000) }
  expect(readingProjectionBytes(extended)).toBeGreaterThan(readingProjectionBytes(ascii) + 2000)
})
it.each([
  'reference',
  'anchor',
  'length',
  'pair',
  'unused',
  'unknown',
  'html',
  'layout',
  'duplicate',
  'range',
  'slot',
] as const)('rejects malformed indexed %s before consumption', (corruption) => {
  const value = fixture(),
    index = value.indexed
  if (!index) throw new Error('Missing index')
  if (corruption === 'reference') index.order[0] = 999
  if (corruption === 'anchor') index.anchors[0] = 999
  if (corruption === 'length') index.pairs.pop()
  if (corruption === 'pair') index.anchors[0] = -1
  if (corruption === 'unused') index.values.push('Unused')
  if (corruption === 'unknown') Object.assign(index, { extra: true })
  if (corruption === 'html') value.html = 'Uncharged'
  if (corruption === 'layout') value.layout = 'replace'
  if (corruption === 'duplicate') index.anchors[1] = index.anchors[0] ?? 0
  if (corruption === 'range' && value.blocks?.[0]) value.blocks[0].from = -1
  if (corruption === 'slot') value.slots.push({ id: '', kind: 'math', source: 'x', display: true })
  expect(() => readingProjectionBytes(value)).toThrow('translation-view-worker')
})
