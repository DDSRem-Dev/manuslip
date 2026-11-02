import type { Nodes } from 'mdast'
import { expect, it } from 'vitest'
import { parseMarkdown, parseMarkdownNative } from '../../src/parse'

function inline(source: string, syntax: 'manuslip' | 'commonmark' = 'manuslip') {
  const root = parseMarkdown(source, syntax).root
  const found: Nodes[] = []
  const visit = (node: Nodes): void => {
    found.push(node)
    if ('children' in node) for (const child of node.children) visit(child)
  }
  visit(root)
  return found
}

it('parses scripts and offline emoji with exact original source ranges', () => {
  const source = 'H~2~O x^2^ :smile: :+1:'
  const nodes = inline(source).filter((node) =>
    ['subscript', 'superscript', 'emoji'].includes(node.type),
  )
  expect(nodes.map((node) => node.type)).toEqual(['subscript', 'superscript', 'emoji', 'emoji'])
  expect(
    nodes.map((node) => source.slice(node.position?.start.offset, node.position?.end.offset)),
  ).toEqual(['~2~', '^2^', ':smile:', ':+1:'])
  expect(nodes.filter((node) => node.type === 'emoji').map((node) => node.value)).toEqual([
    '😄',
    '👍',
  ])
})

it('retains double-tilde GFM deletion and nested inline formatting', () => {
  const nodes = inline('~~gone~~ ~*small*~ ^**high**^')
  expect(nodes.filter((node) => node.type === 'delete')).toHaveLength(1)
  expect(nodes.some((node) => node.type === 'subscript')).toBe(true)
  expect(nodes.some((node) => node.type === 'superscript')).toBe(true)
  expect(nodes.some((node) => node.type === 'emphasis')).toBe(true)
  expect(nodes.some((node) => node.type === 'strong')).toBe(true)
})

it('keeps escaped syntax, code, math, frontmatter and link destinations literal', () => {
  const source =
    '---\nemoji: :smile:\n---\n\n\\^literal^ \\~literal~ \\:smile: `^code^ :smile:` $x^2^ + :smile:$ [link](https://example.com/:smile:)\n\n```text\n~code~ :smile:\n```'
  expect(
    inline(source).filter((node) => ['subscript', 'superscript', 'emoji'].includes(node.type)),
  ).toEqual([])
})

it('leaves unknown shortcodes and incomplete or spaced scripts literal', () => {
  const source =
    ':not_a_real_emoji: :constructor: :__proto__: ^unfinished ~unfinished ^two words^ ~two words~'
  expect(
    inline(source).filter((node) => ['subscript', 'superscript', 'emoji'].includes(node.type)),
  ).toEqual([])
})

it('does not enable application extensions in strict CommonMark', () => {
  const source = 'H~2~O x^2^ :smile: ~~gone~~'
  expect(
    inline(source, 'commonmark').filter((node) =>
      ['subscript', 'superscript', 'emoji', 'delete'].includes(node.type),
    ),
  ).toEqual([])
})

it('matches public native compilation including CRLF, escapes, nesting and Unicode positions', () => {
  const source =
    '# 日本語 ^*高い*^ :smile:\r\n\r\n> H~2~O and ^a\\^b^\r\n>\r\n> - :+1: "~小さい~"\r\n\r\n| A | B |\r\n| --- | --- |\r\n| ^2^ | :smile: |'
  expect(parseMarkdown(source).root).toEqual(parseMarkdownNative(source).root)
  expect(inline(source).filter((node) => node.type === 'emoji')).toHaveLength(3)
})
