import { describe, expect, it } from 'vitest'
import { sourcePositionAtText } from '../../src/live-position'

describe('rendered text to authored source positions', () => {
  it.each([
    { source: '**Quiet**', rendered: 'Quiet', offset: 3, at: 5 },
    { source: '[label](https://label.test)', rendered: 'label', offset: 3, at: 4 },
    { source: '[label][ref]', rendered: 'label', offset: 3, at: 4 },
    { source: 'a \\| b', rendered: 'a | b', offset: 3, at: 4 },
    { source: 'a &amp; b', rendered: 'a & b', offset: 3, at: 7 },
    { source: '&#x1F600;中文', rendered: '😀中文', offset: 2, at: 9 },
    { source: '` a\\|b `', rendered: 'a|b', offset: 2, at: 5 },
    {
      source: '**same** and [same](same) same',
      rendered: 'same and same same',
      offset: 11,
      at: 16,
    },
    { source: '# literal', rendered: '# literal', offset: 4, at: 4 },
    { source: '1. literal', rendered: '1. literal', offset: 5, at: 5 },
    { source: 'a\t  b', rendered: 'a b', offset: 3, at: 5 },
    { source: '**中文😀**', rendered: '中文😀', offset: 4, at: 6 },
    { source: '`a  b`', rendered: 'a  b', offset: 2, at: 3 },
    { source: 'a&nbsp;&nbsp;b', rendered: 'a\u00a0\u00a0b', offset: 2, at: 7 },
  ])('maps $source at rendered offset $offset', ({ source, rendered, offset, at }) => {
    expect(sourcePositionAtText(source, { text: rendered, offset, side: -1 }, 'table')).toBe(at)
  })

  it('distinguishes the two sides of hidden formatting at the same rendered offset', () => {
    const source = '**word** after',
      text = 'word after'
    expect(sourcePositionAtText(source, { text, offset: 4, side: -1 }, 'table')).toBe(6)
    expect(sourcePositionAtText(source, { text, offset: 4, side: 1 }, 'table')).toBe(8)
  })

  it('maps a projected block across heading markers, HTML and line breaks', () => {
    const source = '# A <b>fine</b> day\n\nNext **word**'
    const text = 'A fine day\nNext word'
    expect(sourcePositionAtText(source, { text, offset: text.length, side: -1 })).toBe(
      source.length - 2,
    )
  })

  it('maps terms and repeated definitions without confusing definition markers with text', () => {
    const source = 'Term :smile:\n: Hello **world**\n: Next **world**'
    const text = 'Term :smile:\nHello world\nNext world'
    const offset = text.indexOf('world') + 3
    expect(sourcePositionAtText(source, { text, offset, side: -1 }, 'defList')).toBe(
      source.indexOf('world') + 3,
    )
  })

  it('bounds mapping work and declines ambiguous or empty rendered content', () => {
    expect(
      sourcePositionAtText('x'.repeat(65_537), { text: 'x', offset: 1, side: -1 }),
    ).toBeUndefined()
    expect(sourcePositionAtText('**word**', { text: '', offset: 0, side: 1 })).toBeUndefined()
    expect(sourcePositionAtText(':smile:', { text: '😄', offset: 2, side: -1 })).toBeUndefined()
  })

  it('keeps nested TeX escapes and links literal when mapping table cell positions', () => {
    const expression = String.raw`$\text{[a](b)} + \{x\} + x_1 + x_2$`
    const source = `**Before** ${expression} after`
    const text = `Before ${expression} after`
    for (const part of ['[a]', '\\{', 'x_2', 'after']) {
      const offset = text.indexOf(part) + 1
      expect(
        sourcePositionAtText(source, { text, offset, side: 1, math: [expression] }, 'table'),
      ).toBe(source.indexOf(part) + 1)
    }
  })

  it('maps HTML text across tags, entities and repeated attribute values', () => {
    const source = '<div title="Same"><span>Same</span><b>Sa&amp;me</b></div>'
    const text = 'SameSa&me'
    for (const [offset, at] of [
      [2, source.indexOf('Same</') + 2],
      [6, source.indexOf('&amp;')],
      [7, source.indexOf('&amp;') + 5],
    ] as const) {
      expect(sourcePositionAtText(source, { text, offset, side: -1 })).toBe(at)
    }
  })

  it('does not mistake removed HTML comments, scripts or attributes for visible text', () => {
    const source =
      '<div title="Same"><!-- Same --><script>Same</script><span>Same</span><b>Same</b></div>'
    expect(sourcePositionAtText(source, { text: 'SameSame', offset: 6, side: -1 })).toBe(
      source.lastIndexOf('Same') + 2,
    )
  })
})
