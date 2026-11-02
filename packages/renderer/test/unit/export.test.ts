import { parseMarkdown } from '@manuslip/core'
import { describe, expect, it } from 'vitest'
import { renderExport } from '../../src/export'

describe('shared export projection', () => {
  it('preserves legacy bodies and syntax beside definition lists without converting in the document renderer', () => {
    const result = renderExport(
      parseMarkdown(
        'Term\n: **Description** :smile:\n\n```seq\nA->B: hello\n```\n\n```FLOWCHART\na=>start: 开始\nb=>end: 完成\na->b\n```\n',
      ).root,
      { rawHtml: false, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' },
    )
    expect(result.html).toContain('<dl>')
    expect(result.html).toContain('<dt>Term</dt>')
    expect(result.html).toContain('<dd><strong>Description</strong>')
    expect(result.slots).toEqual([
      { id: 'slot-0', kind: 'diagram', source: 'A->B: hello', display: true, syntax: 'sequence' },
      {
        id: 'slot-1',
        kind: 'diagram',
        source: 'a=>start: 开始\nb=>end: 完成\na->b',
        display: true,
        syntax: 'flowchart',
      },
    ])
  })
  it('retains complete-root references, tables and code while replacing only heavy sinks', () => {
    const result = renderExport(
      parseMarkdown(
        '# 世界\n\n[Link][ref]\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\nInline $x^2$.\n\n$$\nx+y\n$$\n\n```mermaid\nflowchart LR\nA-->B\n```\n\n```js\nconst x = 1\n```\n\n[ref]: https://example.com',
      ).root,
      { rawHtml: false, footnotesLabel: 'Footnotes', footnoteBackLabel: 'Back' },
    )
    expect(result.slots).toEqual([
      { id: 'slot-0', kind: 'math', source: 'x^2', display: false },
      { id: 'slot-1', kind: 'math', source: 'x+y', display: true },
      { id: 'slot-2', kind: 'diagram', source: 'flowchart LR\nA-->B', display: true },
    ])
    expect(result.html).toContain('<table>')
    expect(result.html).toContain('href="https://example.com/"')
    expect(result.html).toContain('const x = 1')
    expect(result.html).toContain('data-export-slot="slot-2"')
    expect(result.html).not.toContain('flowchart LR')
  })
})
