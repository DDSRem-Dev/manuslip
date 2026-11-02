import { describe, expect, it } from 'vitest'
import { parseMarkdown, parseMarkdownNative, parseMarkdownWithGrammar } from '../../src/parse'
import examples from '../fixtures/commonmark-0.31.2/spec.json'

function value(document: ReturnType<typeof parseMarkdown>) {
  const { timings: _timings, ...result } = document
  return result
}

describe.each(['commonmark', 'manuslip'] as const)('complete %s compiler', (syntax) => {
  it.each(examples)(
    'matches the independent native parser for CommonMark $example',
    ({ markdown }) => {
      expect(value(parseMarkdown(markdown, syntax))).toEqual(
        value(parseMarkdownNative(markdown, syntax)),
      )
    },
  )

  it.each([
    '',
    '\ufeff# Heading\r\n\r\nText 😀 e\u0301\ud800\u0000\n',
    '---\ntitle: 世界\n---\n\n# Heading\n\n+++\nname = "x"\n+++\n',
    '- [x] Done\n- [ ] Pending\n\n| a | b |\n| :- | -: |\n| ~~old~~ | $x$ |\n',
    'Visit https://example.com and www.example.com, or a@example.com.\n',
    'Decoded www&#46;example.com and a&#64;example.com, plus a\\@example.com.\n',
    'Before[^second] and again[^first].\n\n[^first]: **First**\n\n[^second]: Second [ref][r].\n\n[r]: /late\n',
    '> - **Nested [reference][r]**\n>\n>   continuation\n\n[r]: https://example.com "Late"\n',
    '$$\n\\ce{H2O}\n$$\n\n~~~mermaid\ngraph LR\na-->b\n~~~\n',
    '<div>\n\n**middle**\n\n</div>\n\n![alt][asset]\n\n[asset]: ./image.png\n',
    '***a*** **a *b* c** *a **b** c* _a_b_ ~~a **b**~~\n',
    '*a [b **c**](https://example.com) d* and ![x *y*][r]\n\n[r]: /image.png\n',
    '# 東京へ行く\n\nภาษาไทยພາສາລາວ 한국어 العربية עברית e\u0301\n',
  ])('preserves full extension, Unicode and global state for %j', (source) => {
    expect(value(parseMarkdown(source, syntax))).toEqual(value(parseMarkdownNative(source, syntax)))
  })

  it.each(Array.from({ length: 128 }, (_, seed) => seed))(
    'preserves seeded nested delimiter and reference state %i',
    (seed) => {
      let state = seed + 1
      const parts = [
        '**bold**',
        '*emphasis*',
        '***both***',
        '_under_',
        '~~old~~',
        '[ref][r]',
        '[inline](https://example.com)',
        '![alt *x*][r]',
        '`**literal**`',
        '**unclosed',
        '_',
        '*',
        '***',
        '\\*escaped\\*',
        '世界😀',
        '[^note]',
      ]
      const tokens = Array.from({ length: 32 }, () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return parts[state % parts.length]
      })
      const source = `# Case ${seed}\n\n${tokens.join(' ')}\n\n> Nested ${tokens.slice().reverse().join(' ')}\n\n[r]: /late\n\n[^note]: A late **note**.\n`
      expect(value(parseMarkdown(source, syntax))).toEqual(
        value(parseMarkdownNative(source, syntax)),
      )
    },
  )
})

it('preserves the selected whole-document grammar when parsing a fragment', () => {
  const source = '- ordinary\n\nEscaped www&#46;example.com and **bold**.\n'
  for (const gfm of [false, true])
    expect(value(parseMarkdownWithGrammar(source, 'manuslip', gfm))).toEqual(
      value(parseMarkdownWithGrammar(source, 'manuslip', gfm, true)),
    )
})

it('retains every one of 80000 emphasis nodes and all six coordinates', () => {
  const pressure = '**x** ',
    source = `# Inline pressure\n\n${pressure.repeat(80000)}\n\nComplete tail 世界.\n`,
    document = parseMarkdown(source),
    paragraph = document.root.children[1]
  if (paragraph?.type !== 'paragraph') throw new Error('Missing complete pressure paragraph')
  const from = source.indexOf(pressure)
  let count = 0
  for (const node of paragraph.children) {
    if (node.type !== 'strong') {
      expect(node.type === 'text' && node.value).toBe(' ')
      continue
    }
    const offset = from + count * pressure.length,
      column = 1 + count * pressure.length
    expect(node.position).toEqual({
      start: { line: 3, column, offset },
      end: { line: 3, column: column + 5, offset: offset + 5 },
    })
    expect(node.children).toEqual([
      {
        type: 'text',
        value: 'x',
        position: {
          start: { line: 3, column: column + 2, offset: offset + 2 },
          end: { line: 3, column: column + 3, offset: offset + 3 },
        },
      },
    ])
    count++
  }
  expect(count).toBe(80000)
  expect(document.root.children).toHaveLength(3)
  const tail = document.root.children[2]
  expect(
    tail?.type === 'paragraph' && tail.children[0]?.type === 'text' && tail.children[0].value,
  ).toBe('Complete tail 世界.')
  const small = parseMarkdownNative(
    `# Inline pressure\n\n${pressure.repeat(2)}\n\nComplete tail 世界.\n`,
  )
  expect(document.counts.words).toBe(small.counts.words + 79998)
}, 30000)
