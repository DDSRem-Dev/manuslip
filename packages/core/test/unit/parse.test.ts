import { describe, expect, it } from 'vitest'
import { BoundedCache, parseMarkdown, semanticLimits, sourceHash } from '../../src/index'

describe('whole-document semantic Markdown', () => {
  it('preserves frontmatter, GFM structure, math, code, Unicode and UTF-16 positions', () => {
    const source =
      '---\ntitle: 世界\n---\n\n# Heading 😀\n\n- [x] Task\n\n| A | B |\n| - | - |\n| **bold** | $x$ |\n\n```js\nconst x = 1\n```\n\n$$\nx^2\n$$\n'
    const parsed = parseMarkdown(source)
    expect(parsed.root.children.map((node) => node.type)).toEqual([
      'yaml',
      'heading',
      'list',
      'table',
      'code',
      'math',
    ])
    expect(parsed.outline).toEqual([
      {
        from: source.indexOf('# Heading'),
        to: source.indexOf('\n\n-'),
        depth: 1,
        text: 'Heading 😀',
      },
    ])
    expect(
      parsed.blocks.every((block) => block.hash === sourceHash(source.slice(block.from, block.to))),
    ).toBe(true)
    expect(parsed.counts.words).toBeGreaterThan(3)
    expect(parsed.counts.characters).toBe([...source].length)
  })
  it('resolves references and footnotes with the complete document available', () => {
    const parsed = parseMarkdown(
      'Read [link][ref] and note[^one].\n\n[ref]: https://example.com/a\n\n[^one]: Footnote body\n',
    )
    expect(parsed.root.children.map((node) => node.type)).toEqual([
      'paragraph',
      'definition',
      'footnoteDefinition',
    ])
    const paragraph = parsed.root.children[0]
    expect(paragraph?.type === 'paragraph' && paragraph.children.map((node) => node.type)).toEqual([
      'text',
      'linkReference',
      'text',
      'footnoteReference',
      'text',
    ])
  })
  it.each(['commonmark', 'manuslip'] as const)(
    'counts original source code points independently of parser normalization in %s',
    (syntax) => {
      const source = '\ufeff# 😀 e\u0301\r\n\r\ntext\u0000\ud800x\udfff\n\udbff\udfff\n'
      const document = parseMarkdown(source, syntax)
      expect(document.counts.characters).toBe(Array.from(source).length)
      // The native parser excludes the BOM from coordinates; source counts include it.
      expect(document.root.position?.end.offset).toBe(source.length - 1)
      expect(document.sourceHash).toBe(sourceHash(source))
    },
  )
  it('does not truncate a document that exceeds semantic limits', () => {
    expect(() => parseMarkdown('x'.repeat(semanticLimits.previewBytes + 1))).toThrow('size limit')
  })
})

it('bounds derived LRU data and distinguishes hash hits from source equality', () => {
  const cache = new BoundedCache<string, string>(10)
  cache.set('a', 'first', 5)
  cache.set('b', 'second', 5)
  expect(cache.get('a')).toBe('first')
  cache.set('c', 'third', 5)
  expect(cache.get('b')).toBeUndefined()
  expect(cache.bytes).toBe(10)
  cache.set('too-large', 'large', 11)
  expect(cache.size).toBe(2)
  cache.clear()
  expect(cache.bytes).toBe(0)
})
