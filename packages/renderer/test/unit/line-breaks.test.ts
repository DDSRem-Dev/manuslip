import { parseMarkdown } from '@manuslip/core'
import { describe, expect, it } from 'vitest'
import { parseMarkdownNative } from '../../../core/src/parse'
import { renderMarkdown } from '../../src/index'
import { renderInitialProjectionLayout } from '../../src/projection-initial-layout'

const options = { rawHtml: false, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }

for (const syntax of ['commonmark', 'manuslip'] as const) {
  describe(`${syntax} line-break conventions`, () => {
    for (const ending of ['\n', '\r\n', '\r']) {
      it(`distinguishes soft breaks, hard breaks and paragraphs with ${JSON.stringify(ending)}`, () => {
        const source = [
          'Soft first',
          'second line.',
          '',
          'Two spaces  ',
          'next line.',
          '',
          'Backslash\\',
          'next line.',
          '',
          'One space ',
          'still soft.',
          '',
          'Escaped slash\\\\',
          'still soft.',
          '',
          'Separate paragraph.',
          '',
          'Last paragraph.  ',
        ].join(ending)
        const root = parseMarkdown(source, syntax).root
        expect(root).toEqual(parseMarkdownNative(source, syntax).root)
        const result = renderMarkdown(root, options)
        expect(result.html.replace(/\r\n?/g, '\n')).toBe(
          [
            '<p>Soft first\nsecond line.</p>',
            '<p>Two spaces<br>\nnext line.</p>',
            '<p>Backslash<br>\nnext line.</p>',
            '<p>One space\nstill soft.</p>',
            '<p>Escaped slash\\\nstill soft.</p>',
            '<p>Separate paragraph.</p>',
            '<p>Last paragraph.</p>',
          ].join('\n'),
        )
        const paragraphs = result.blocks.filter((block) => block.kind === 'paragraph')
        // Ordinary multiline prose stays editable without an opaque replacement.
        expect(paragraphs).toHaveLength(0)
        expect(
          root.children.map((node) =>
            source.slice(node.position?.start.offset, node.position?.end.offset),
          ),
        ).toEqual([
          ['Soft first', 'second line.'].join(ending),
          ['Two spaces  ', 'next line.'].join(ending),
          ['Backslash\\', 'next line.'].join(ending),
          ['One space ', 'still soft.'].join(ending),
          ['Escaped slash\\\\', 'still soft.'].join(ending),
          'Separate paragraph.',
          'Last paragraph.  ',
        ])
        const sequenced = renderInitialProjectionLayout(root, options, 1024 * 1024).projection
        expect(sequenced.html).toBe(result.html)
        expect(sequenced.blocks).toEqual(result.blocks)
      })
    }

    it('normalizes prose in nested containers while preserving literal code and escaped syntax', () => {
      const source = [
        '> Quote first',
        '> continues softly.',
        '',
        '- Item first',
        '  continues softly.',
        '',
        'Code ` first',
        'second ` after.',
        '',
        '```text',
        'literal  ',
        'backslash\\',
        '```',
        '',
        '    indented  ',
        '    literal\\',
        '',
        'A **strong',
        'continuation** and escaped \\*literal\\*.',
      ].join('\n')
      const result = renderMarkdown(parseMarkdown(source, syntax).root, options)
      expect(result.html).toContain(
        '<blockquote>\n<p>Quote first\ncontinues softly.</p>\n</blockquote>',
      )
      expect(result.html).toContain('<ul>\n<li>Item first\ncontinues softly.</li>\n</ul>')
      expect(result.blocks.some((block) => ['blockquote', 'list'].includes(block.kind))).toBe(false)
      expect(result.html).toContain('<p>Code <code>first second</code> after.</p>')
      expect(result.html).toContain('<code class="language-text">literal  \nbackslash\\\n</code>')
      expect(result.html).toContain('<pre><code>indented  \nliteral\\\n</code></pre>')
      expect(result.html).toContain('<strong>strong\ncontinuation</strong> and escaped *literal*.')
      expect(result.html).not.toContain('<br>')
    })
  })
}
