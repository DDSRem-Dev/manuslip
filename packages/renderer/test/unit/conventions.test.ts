import { defaultMarkdownPlugins, parseDocumentMarkdown } from '@manuslip/core'
import { extractTranslation, reconstructSharedTranslation } from '@manuslip/translate'
import { describe, expect, it } from 'vitest'
import { renderExport } from '../../src/export'
import { type RenderOptions, renderMarkdown } from '../../src/index'

const options: RenderOptions = {
  rawHtml: false,
  footnotesLabel: 'Footnotes',
  footnoteBackLabel: 'Back',
}
const render = (source: string, plugins = defaultMarkdownPlugins) =>
  renderMarkdown(parseDocumentMarkdown(source, plugins).root, { ...options, plugins })

describe('configured Markdown rendering', () => {
  it('renders the basic extensions with every plugin disabled', () => {
    const source =
      '| Name | Count |\n| :--- | ---: |\n| ~~old~~ | 2 |\n\n- [x] done\n- [ ] next\n\nH~2~O x^2^ note[^one].\n\n[^one]: Footnote body\n\n```js\nconst x = 1\n```'
    const { html } = render(source, {
      opt: false,
      latex: false,
      mermaid: false,
      github: false,
      typora: false,
    })
    for (const fragment of [
      '<table>',
      '<del>old</del>',
      'align="right"',
      'type="checkbox" checked disabled',
      '<sub>2</sub>',
      '<sup>2</sup>',
      'data-footnote-ref',
      'Footnote body',
      'language-js',
    ])
      expect(html).toContain(fragment)
  })
  it('renders highlights and typography with exact source ranges', () => {
    const source = '==**Hello** and `a==b`==\n\n"Quoted" -- isn\'t it...'
    const result = render(source)
    expect(result.html).toContain('<mark><strong>Hello</strong> and <code>a==b</code></mark>')
    expect(result.html).toContain('“Quoted” — isn’t it…')
    expect(
      result.blocks
        .filter((block) => block.kind === 'paragraph')
        .map((block) => source.slice(block.from, block.to)),
    ).toEqual(source.split('\n\n'))
    expect(render('==marked==', { ...defaultMarkdownPlugins, opt: false }).html).toBe(
      '<p>==marked==</p>',
    )
  })
  it.each(['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'])(
    'renders the %s GitHub alert with block contents intact',
    (name) => {
      const source = `> [!${name}]\n> **Hello**\n>\n> - body\n>\n> ~~~js\n> const answer = 42\n> ~~~`
      const result = render(source, { ...defaultMarkdownPlugins, github: true })
      expect(result.html).toContain(`class="markdown-alert markdown-alert-${name.toLowerCase()}"`)
      expect(result.html).toContain('markdown-alert-title')
      expect(result.html).toContain('<strong>Hello</strong>')
      expect(result.html).toContain('<li>body</li>')
      expect(result.html).toContain('const answer = 42')
      expect(result.html).not.toContain(`[!${name}]`)
      expect(
        result.blocks.some(
          (block) => block.kind === 'blockquote' && block.from === 0 && block.to === source.length,
        ),
      ).toBe(true)
      expect(render(source).html).toContain(`[!${name}]`)
    },
  )
  it('keeps malformed alerts, escaped attributes and TOC markers literal', () => {
    const result = render(
      '> [!UNKNOWN]\n> body\n\n> \\[!TIP]\n> escaped\n\n# Hello \\{#literal}\n\n\\[TOC]',
      { ...defaultMarkdownPlugins, github: true, typora: true },
    )
    expect(result.html).toContain('[!UNKNOWN]')
    expect(result.html).toContain('Hello {#literal}')
    expect(result.html).not.toContain('markdown-toc')
    expect(result.html).not.toContain('markdown-alert')
  })
  it('links the TOC to stable Unicode headings, skipped levels and explicit IDs', () => {
    const source =
      '[TOC]\n\n# Guide {#start .wide}\n\n### Details\n\n## More\n\n# 中文标题\n\n# Guide\n\n# Guide'
    const result = render(source, { ...defaultMarkdownPlugins, typora: true })
    expect(result.html).toContain('<nav class="markdown-toc" aria-label="Table of contents">')
    for (const id of ['start', 'details', 'more', '中文标题', 'guide', 'guide-1']) {
      expect(result.html).toContain(`id="${id}"`)
      expect(result.html).toContain(`href="#${encodeURIComponent(id)}"`)
    }
    expect(result.html).toContain('class="wide"')
    expect(result.blocks.find((block) => block.from === 0)?.html).toContain('<nav')
    expect(render('[TOC]\n\n# Heading').html).not.toContain('markdown-toc')
  })
  it('uses the same plugin policy for export slots and nested widgets', () => {
    const source = '> $x^2$\n>\n> ```mermaid\n> graph LR\n> A-->B\n> ```'
    const document = parseDocumentMarkdown(source)
    expect(renderExport(document.root, options).slots.map((slot) => slot.kind)).toEqual([
      'math',
      'diagram',
    ])
    const disabled = { ...defaultMarkdownPlugins, mermaid: false, latex: false }
    const off = renderExport(parseDocumentMarkdown(source, disabled).root, {
      ...options,
      plugins: disabled,
    })
    expect(off.slots).toEqual([])
    expect(off.html).toContain('language-mermaid')
    expect(off.html).toContain('$x^2$')
  })
  it('preserves headings, highlights, alerts and protected math in translated reading', () => {
    const source = '[TOC]\n\n# Hello {#intro}\n\n> [!TIP]\n> Hello ==world== $x^2$'
    const root = parseDocumentMarkdown(source, {
      ...defaultMarkdownPlugins,
      github: true,
      typora: true,
    }).root
    const plan = extractTranslation(root, source)
    const outputs = new Map(
      plan.units.flatMap((unit) =>
        unit.payload
          ? [
              [
                unit.occurrenceId,
                unit.payload.text.replace(/Hello/g, '你好').replace(/world/g, '世界'),
              ] as const,
            ]
          : [],
      ),
    )
    const result = reconstructSharedTranslation(plan, outputs, {
      retained: 4 * 1024 * 1024,
      staging: 4 * 1024 * 1024,
    })
    const html = renderMarkdown(result.root, options).html
    expect(html).toContain('id="intro"')
    expect(html).toContain('你好')
    expect(html).toContain('<mark>世界</mark>')
    expect(html).toContain('markdown-alert-tip')
    expect(html).toContain('x^2')
    expect(html).toContain('href="#intro">你好</a>')
    expect(plan.units.some((unit) => unit.from === 0)).toBe(false)
  })
})
