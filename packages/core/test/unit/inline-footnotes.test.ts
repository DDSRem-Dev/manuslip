import type { Nodes } from 'mdast'
import { describe, expect, it } from 'vitest'
import { parseDocumentMarkdown } from '../../src/document-markdown'
import { plainText } from '../../src/semantic-description'

function nodes(source: string) {
  const root = parseDocumentMarkdown(source).root
  const result: Nodes[] = []
  const pending: Nodes[] = [root]
  while (pending.length) {
    const node = pending.pop()
    if (!node) continue
    result.push(node)
    if ('children' in node) pending.push(...[...node.children].reverse())
  }
  return { root, result }
}

describe('inline document footnotes', () => {
  it('shares standard footnotes while avoiding named identifiers in source order', () => {
    const source =
      'First^[One].\n\nSecond^[Two] and named[^INLINE-NOTE-1].\n\n[^INLINE-NOTE-1]: Named'
    const { result, root } = nodes(source)
    expect(
      result.filter((node) => node.type === 'footnoteReference').map((node) => node.identifier),
    ).toEqual(['inline-note-2', 'inline-note-3', 'inline-note-1'])
    expect(
      root.children.filter((node) => node.type === 'footnoteDefinition').map(plainText),
    ).toEqual(['Named', 'One', 'Two'])
    expect(result.some((node) => node.type === 'link' && node.data?.manuslipInlineFootnote)).toBe(
      false,
    )
  })

  it('preserves exact UTF-16 and CRLF source ranges with rich, multiline bodies', () => {
    const note = '^[注 **bold** [link](https://example.invalid/a) $x_2$\r\nsecond]'
    const source = `😀 start ${note} end.`
    const { result } = nodes(source)
    const reference = result.find((node) => node.type === 'footnoteReference')
    const definition = result.find((node) => node.type === 'footnoteDefinition')
    expect(reference?.position).toMatchObject({
      start: { line: 1, column: 10, offset: 9 },
      end: { line: 2 },
    })
    const slice = (node: Nodes | undefined) =>
      source.slice(node?.position?.start.offset, node?.position?.end.offset)
    expect(slice(reference)).toBe(note)
    expect(slice(definition)).toBe(note.slice(1))
    expect(definition?.type === 'footnoteDefinition' && slice(definition.children[0])).toBe(
      note.slice(2, -1),
    )
    for (const type of ['strong', 'link', 'inlineMath'])
      expect(result.some((node) => node.type === type)).toBe(true)
  })

  it.each([
    ['Note^[escaped \\] bracket] end', 'escaped ] bracket'],
    ['Note^[`a]b` and [label](https://example.invalid)] end', 'a]b and label'],
    ['Note^[``a` ] b`` plus [balanced]] end', 'a` ] b plus [balanced]'],
    ['Note^[unmatched ` tick] end', 'unmatched ` tick'],
    ['Note^[interval $x]$ and \\(y]\\)] end', 'interval x] and y]'],
    ['Note^[a <span title="x]">label</span> after] end', 'a <span title="x]">label</span> after'],
    ['Note^[See <https://example.invalid/a]> here] end', 'See https://example.invalid/a] here'],
  ])('finds the closing bracket around code and escaped content: %s', (source, body) => {
    const { result } = nodes(source)
    const definition = result.find((node) => node.type === 'footnoteDefinition')
    expect(definition && plainText(definition)).toBe(body)
  })

  it.each(['^[', '^[unclosed', '^[]', '^[   ]', '\\^[literal]', '`^[code]`', '~~~\n^[code]\n~~~'])(
    'keeps incomplete, escaped, empty and code notes literal: %s',
    (source) => {
      const { result } = nodes(source)
      expect(
        result.some(
          (node) => node.type === 'footnoteReference' || node.type === 'footnoteDefinition',
        ),
      ).toBe(false)
    },
  )

  it('retains superscripts and supports notes with all optional plugins disabled', () => {
    const document = parseDocumentMarkdown('x^2^ and note^[body]', {
      opt: false,
      latex: false,
      mermaid: false,
      github: false,
      typora: false,
    })
    expect(document.blocks.filter((block) => block.kind === 'footnoteReference')).toHaveLength(1)
    expect(document.blocks.some((block) => block.kind === 'superscript')).toBe(true)
  })
})

describe('removed document disclosure markup', () => {
  it.each(['<details', '</details', '<summary\n title="unfinished'])(
    'keeps incomplete disclosure tags out of HTML blocks: %s',
    (source) => {
      const { result } = nodes(source)
      expect(result.some((node) => node.type === 'html')).toBe(false)
    },
  )
  it.each([
    '<details open>\n<summary>Title</summary>\n**Body**\n</details>',
    '<details\nopen>\n<summary\nclass="literal">Title</summary>\n**Body**\n</details>',
    '<DETAILS title="-- text">\n<SUMMARY>Title</SUMMARY>\n**Body**\n</DETAILS>',
    '> <details>\n> <summary>Title</summary>\n> **Body**\n> </details>',
    '- <details>\n  <summary>Title</summary>\n  **Body**\n  </details>',
  ])('treats tags literally without consuming their Markdown contents: %s', (source) => {
    const { root, result } = nodes(source)
    expect(result.some((node) => node.type === 'html')).toBe(false)
    expect(result.some((node) => node.type === 'strong')).toBe(true)
    expect(plainText(root)).toContain('Body')
    expect(plainText(root)).toMatch(/<\/?details/i)
    expect(plainText(root)).not.toContain('“')
  })

  it('preserves other HTML, attributes, comments and fenced code', () => {
    const { result } = nodes(
      '<span title="<details>">text</span>\n\n<div>ordinary</div>\n\n<!-- <summary> -->\n\n```html\n<details>code</details>\n```',
    )
    expect(result.filter((node) => node.type === 'html').map((node) => node.value)).toEqual([
      '<span title="<details>">',
      '</span>',
      '<div>ordinary</div>',
      '<!-- <summary> -->',
    ])
    expect(result.find((node) => node.type === 'code')).toMatchObject({
      value: '<details>code</details>',
    })
  })
})
