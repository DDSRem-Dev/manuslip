import { parseDocumentMarkdown } from '@manuslip/core'
import { extractTranslation, reconstructSharedTranslation } from '@manuslip/translate'
import { describe, expect, it } from 'vitest'
import { renderExport } from '../../src/export'
import { renderMarkdown } from '../../src/index'

const options = { rawHtml: false, footnotesLabel: 'Footnotes', footnoteBackLabel: 'Back' }

describe('document inline footnote rendering', () => {
  it('keeps named definition numbers in first-reference order without inline notes', () => {
    const source = 'First[^b], next[^a], and repeated[^b].\n\n[^a]: Alpha\n\n[^b]: Bravo'
    const root = parseDocumentMarkdown(source).root
    const preview = renderMarkdown(root, options)
    const definitions = preview.blocks.filter((block) => block.kind === 'footnoteDefinition')
    expect(definitions[0]?.html).toContain('value="2"')
    expect(definitions[1]?.html).toContain('value="1"')
    for (const html of [preview.html, renderExport(root, options).html]) {
      expect(html).toContain('aria-label="Footnotes 1" role="doc-noteref"')
      expect(html).toContain('aria-label="Back 1-2"')
      expect(html).toContain('class="markdown-icon markdown-icon-backref" aria-hidden="true"')
      expect(html).not.toContain('aria-describedby="footnote-label"')
      for (const [, href] of html.matchAll(/href="#([^"]+)"/g))
        expect(html).toContain(`id="${href}"`)
    }
  })

  it('numbers inline and named notes together with distinct, editable projections', () => {
    const source = 'Start^[**First** $x^2$] and named[^n], then^[Second].\n\n[^n]: Named'
    const root = parseDocumentMarkdown(source).root
    const preview = renderMarkdown(root, options)
    const exported = renderExport(root, options)
    for (const html of [preview.html, exported.html]) {
      expect(html).toContain('data-footnote-ref')
      expect(html).toContain('<strong>First</strong>')
      expect(html).toContain('>1</a></sup>')
      expect(html).toContain('>2</a></sup>')
      expect(html).toContain('>3</a></sup>')
      for (const [, href] of html.matchAll(/href="#([^"]+)"/g))
        expect(html).toContain(`id="${href}"`)
    }
    const definitions = preview.blocks.filter((block) => block.kind === 'footnoteDefinition')
    expect(definitions.map((block) => block.listStart)).toEqual([1, 3, 2])
    expect(definitions.filter((block) => block.placement === 'after-document')).toHaveLength(2)
    expect(preview.blocks.filter((block) => block.kind === 'footnoteReference')).toHaveLength(3)
    expect(
      definitions
        .filter((block) => block.placement)
        .map((block) => source.slice(block.from - 1, block.to)),
    ).toEqual(['^[**First** $x^2$]', '^[Second]'])
    expect(exported.slots).toMatchObject([{ kind: 'math', source: 'x^2', display: false }])
  })

  it('translates note prose separately while protecting code, math and destinations', () => {
    const source =
      'Hello^[Hello **note** `Hello code` $x_2$ [Hello link](https://example.invalid/Hello)].'
    const root = parseDocumentMarkdown(source).root
    const original = JSON.stringify(root)
    const plan = extractTranslation(root, source)
    expect(plan.units.filter((unit) => unit.payload)).toHaveLength(2)
    const outputs = new Map(
      plan.units.flatMap((unit) =>
        unit.payload
          ? [[unit.occurrenceId, unit.payload.text.replaceAll('Hello', '你好')] as const]
          : [],
      ),
    )
    const reading = reconstructSharedTranslation(plan, outputs, {
      retained: 4 * 1024 * 1024,
      staging: 4 * 1024 * 1024,
    })
    for (const html of [
      renderMarkdown(reading.root, options).html,
      renderExport(reading.root, options).html,
    ]) {
      expect(html).toContain('你好')
      expect(html).toContain('<code>Hello code</code>')
      expect(html).toContain('href="https://example.invalid/Hello"')
      expect(html).toContain('你好 link')
      expect(html).toContain('data-footnote-ref')
    }
    expect(renderExport(reading.root, options).slots[0]?.source).toBe('x_2')
    expect(JSON.stringify(root)).toBe(original)
    const definition = reading.root.children.find((node) => node.type === 'footnoteDefinition')
    expect(definition?.data?.manuslipInlineFootnote).toBe(true)
  })
})

describe('literal disclosure markup in preview and export', () => {
  it.each([false, true])('ignores disclosure HTML even with raw HTML set to %s', (rawHtml) => {
    const source =
      '<details open title="-- plain">\n<summary>Title</summary>\n\n**Body**\n\n</details>\n\nText <summary>inline</summary>.'
    const root = parseDocumentMarkdown(source).root
    for (const html of [
      renderMarkdown(root, { ...options, rawHtml }).html,
      renderExport(root, { ...options, rawHtml }).html,
    ]) {
      expect(html).not.toMatch(/<\/?(?:details|summary)(?=[\s>])/i)
      expect(html).toContain('&#x3C;details open title="-- plain">')
      expect(html).toContain('<strong>Body</strong>')
      expect(html).toContain('&#x3C;summary>inline&#x3C;/summary>')
    }
  })

  it('does not suppress unrelated raw HTML', () => {
    const root = parseDocumentMarkdown('<span>allowed</span>').root
    expect(renderMarkdown(root, { ...options, rawHtml: true }).html).toContain(
      '<span>allowed</span>',
    )
  })
})
