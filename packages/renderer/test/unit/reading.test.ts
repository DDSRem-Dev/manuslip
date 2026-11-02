import { parseMarkdown } from '@manuslip/core'
import { extractTranslation, reconstructTranslation } from '@manuslip/translate'
import { fromHtml } from 'hast-util-from-html'
import { expect, it } from 'vitest'
import { readingBlocks, renderReading } from '../../src/reading'

const options = { rawHtml: true, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
it('pairs logical blocks from whole roots, retaining references, bindings and source fallbacks', () => {
  const source =
    '# Hello\n\nHello `ONE` $x$.\n\n- Hello list\n  - Hello nested\n\n| Hello | Value |\n| - | - |\n| Cell | 2 |\n\n[Hello link][ref] and note[^n].\n\nUntouched paragraph.\n\n[^n]: Hello note.\n\n[ref]: https://private.invalid/'
  const root = parseMarkdown(source).root
  const before = JSON.stringify(root)
  const plan = extractTranslation(root, source)
  const outputs = new Map(
    plan.units
      .filter((unit) => unit.payload?.text.includes('Hello'))
      .map((unit) => [unit.occurrenceId, unit.payload?.text.replaceAll('Hello', '你好') ?? '']),
  )
  const translated = new Set(
    plan.units
      .filter((unit) => outputs.has(unit.occurrenceId))
      .map((unit) => `${unit.from}:${unit.to}`),
  )
  const blocks = readingBlocks(root, source)
  const rebuilt = reconstructTranslation(plan, outputs)
  for (const layout of ['replace', 'side-by-side', 'interlinear'] as const) {
    const projection = renderReading(root, rebuilt.root, options, {
      layout,
      blocks,
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      labels: { original: 'Original', translation: 'Translation' },
      translated,
      units: plan.units,
    })
    expect(projection.html).toContain('href="https://private.invalid/"')
    expect(projection.html).toContain('lang="en">Untouched paragraph.')
    expect(projection.html).toContain('data-footnote-ref')
    expect(projection.html).toContain('<code>ONE</code>')
    expect(projection.blocks).toEqual(blocks)
    const tree = fromHtml(projection.html, { fragment: true })
    if (layout === 'replace') {
      const group = tree.children[0]
      if (group?.type !== 'element') throw new Error('No replacement group')
      expect(group.properties).toMatchObject({
        className: ['reading-replace'],
        lang: 'zh-CN',
        dir: 'auto',
        ariaLabel: 'Translation',
        role: 'group',
      })
      const cells = group.children.filter((node) => node.type === 'element')
      expect(cells.length).toBeGreaterThan(0)
      for (const cell of cells) {
        expect(cell.properties.dir).toBe('auto')
        expect(cell.properties.role).toBeUndefined()
        expect(cell.properties.ariaLabel).toBeUndefined()
      }
      expect(projection.html.match(/aria-label="Translation"/g)).toHaveLength(1)
    }
    const pairs: import('hast').Element[] = []
    const visit = (node: import('hast').Nodes) => {
      if (
        node.type === 'element' &&
        Array.isArray(node.properties.className) &&
        node.properties.className.includes('reading-pair')
      )
        pairs.push(node)
      if ('children' in node) node.children.forEach(visit)
    }
    visit(tree)
    expect(pairs.length).toBe(layout === 'replace' ? 0 : 7)
    for (const pair of pairs) {
      expect(pair.children).toHaveLength(2)
      expect(blocks.some((block) => block.id === pair.properties.dataReadingBlock)).toBe(true)
    }
    expect(projection.slots).toHaveLength(layout === 'replace' ? 1 : 2)
    expect(new Set(projection.slots.map((slot) => slot.id)).size).toBe(projection.slots.length)
    expect(projection.slots.every((slot) => slot.source === 'x')).toBe(true)
  }
  expect(JSON.stringify(root)).toBe(before)
})
it('keeps per-block direction and per-unit source fallback language inside the replacement group', () => {
  const source = 'مرحبا بالعالم.\n\nEnglish fallback.',
    root = parseMarkdown(source).root,
    plan = extractTranslation(root, source),
    unit = plan.units[0]
  if (!unit) throw new Error('No paragraph')
  const rebuilt = reconstructTranslation(plan, new Map([[unit.occurrenceId, 'こんにちは。']]))
  const projection = renderReading(root, rebuilt.root, options, {
    layout: 'replace',
    blocks: readingBlocks(root, source),
    sourceLanguage: 'auto',
    targetLanguage: 'ja',
    labels: { original: '原文', translation: '翻訳' },
    translated: new Set([`${unit.from}:${unit.to}`]),
    units: plan.units,
  })
  const tree = fromHtml(projection.html, { fragment: true }),
    group = tree.children[0]
  if (group?.type !== 'element') throw new Error('No group')
  expect(group.properties).toMatchObject({ lang: 'ja', role: 'group', ariaLabel: '翻訳' })
  const cells = group.children.filter((node) => node.type === 'element')
  expect(cells).toHaveLength(2)
  expect(cells.map((cell) => cell.properties.dir)).toEqual(['auto', 'auto'])
  expect(projection.html).toContain('<p lang="ja">こんにちは。</p>')
  expect(projection.html).toContain('<p lang="">English fallback.</p>')
})
