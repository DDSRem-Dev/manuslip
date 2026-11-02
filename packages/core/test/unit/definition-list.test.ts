import type { Nodes } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'
import { parseMarkdown, parseMarkdownNative } from '../../src/parse'

function nodes(root: Nodes): Nodes[] {
  const result: Nodes[] = [],
    pending = [root]
  while (pending.length) {
    const node = pending.pop()
    if (!node) break
    result.push(node)
    if ('children' in node) pending.push(...[...node.children].reverse())
  }
  return result
}
const gfm = unified().use(remarkParse).use(remarkGfm, { singleTilde: false }).freeze()

describe('positioned definition lists', () => {
  it('keeps terms, descriptions, inline formatting, multiple definitions and original CRLF ranges', () => {
    const source =
      'Term *界* :smile:\r\n: First **description**.\r\n: Second description.\r\n\r\nAnother\r\n: Last.\r\n'
    const document = parseMarkdown(source)
    const list = document.root.children[0]
    expect(list?.type).toBe('defList')
    if (list?.type !== 'defList') throw new Error('Missing definition list')
    expect(list.children.map((node) => node.type)).toEqual([
      'defListTerm',
      'defListDescription',
      'defListDescription',
      'defListTerm',
      'defListDescription',
    ])
    const term = list.children[0]
    expect(source.slice(term?.position?.start.offset, term?.position?.end.offset)).toBe(
      'Term *界* :smile:\r\n',
    )
    expect(nodes(document.root).filter((node) => node.type === 'emoji')).toHaveLength(1)
    expect(nodes(document.root).filter((node) => node.type === 'strong')).toHaveLength(1)
    for (const node of nodes(document.root)) {
      expect(node.position?.start.offset).toBeGreaterThanOrEqual(0)
      expect(node.position?.end.offset).toBeLessThanOrEqual(source.length)
    }
  })
  it.each([
    'head\n| - |\nrow1\n: row2\n',
    'A | B\n:-- | --:\none | two\n: three | four\n',
    'A | B\n:-- | --:\n: one | two\n: three | four\n',
    '> A | B\n> :-- | --:\n> one | two\n> : three | four\n',
    '- head\n  | - |\n  row1\n  : row2\n',
    'head\n| - |\nrow1\n\n: row2\n',
    'head\n| - |\nrow1\nTerm\n: description\n',
    `head\n| - |\n${Array.from({ length: 128 }, (_, i) => `: row ${i}`).join('\n')}\n`,
  ])('preserves the complete existing GFM table tree and positions: %#', (source) => {
    expect(parseMarkdown(source).root).toEqual(gfm.parse(source))
  })
  it.each([
    'head\n| - |\nrow1\n\nTerm\n: description\n',
    '> Term\n> : description with [link][r] and ^2^.\n>\n> [r]: https://example.test\n',
    '- Term\n  : description\n\n    - Nested *item*\n',
    'Term\n: First paragraph.\n\n    Second paragraph.\n\n    | A | B |\n    | - | - |\n    | : one | two |\n\n    ```js\n    : literal\n    ```\n\nAnother\n: $x^2$ and :heart:.\n',
    'First\nSecond\n: Description.\n\nTail.\n',
  ])('matches the complete native parser with nested blocks and references: %#', (source) => {
    const document = parseMarkdown(source)
    expect(nodes(document.root).some((node) => node.type === 'defList')).toBe(true)
    expect(document.root).toEqual(parseMarkdownNative(source).root)
  })
  it('keeps strict CommonMark and literal code unchanged', () => {
    const source = 'Term\n: description\n\n```md\nTerm\n: code\n```\n'
    expect(
      nodes(parseMarkdown(source, 'commonmark').root).some((node) => node.type === 'defList'),
    ).toBe(false)
    const code = nodes(parseMarkdown(source).root).find((node) => node.type === 'code')
    expect(code).toMatchObject({ value: 'Term\n: code' })
  })
})
