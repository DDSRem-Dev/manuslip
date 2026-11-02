import { parseMarkdown, plainText } from '@manuslip/core'
import { describe, expect, it } from 'vitest'
import {
  readTableAt,
  serializeTable,
  tableEditLimits,
  validateTableDraft,
} from '../../../../src/renderer/src/table-model'

const samples = [
  '| A | B |\r\n| :--- | ---: |\r\n| x\\|y | `a\\|b` |',
  'A | B\n--- | ---\nx',
  '| A | B |\n| --- | --- |\n|  | \\| |',
  '> | A | B |\n> | --- | --- |\n> | x | y |',
  '- | A | B |\n  | --- | --- |\n  | x | y |',
  '10. | A | B |\n    | --- | --- |\n    | x | y |',
  '> - | A | B |\n>   | --- | --- |\n>   | x | y |',
  '| **A** | [B][ref] |\n| --- | --- |\n| :smile: | ~x~ 中文 |',
  '| A | B |\n| --- | --- |\n| \u00a0x\u00a0 | ^2^ |',
]
describe('positioned source table editing', () => {
  it.each(samples)('retains source spelling and container structure: %s', (table) => {
    const before = 'Before :heart:.\n\n',
      after = '\n\n[ref]: https://example.invalid\n\nAfter.\n'
    const source = before + table + after,
      root = parseMarkdown(source).root
    const target = readTableAt(root, source, source.indexOf('A', before.length))
    expect(target.from).toBe(before.length)
    expect(serializeTable(target, target.draft)).toBe(table)
    const draft = structuredClone(target.draft)
    if (!draft.rows[1]) throw new Error('Missing row')
    draft.rows[1][0] = 'new | `code\\|pipe` 中文'
    draft.align[1] = 'center'
    const insert = serializeTable(target, draft)
    const changed = source.slice(0, target.from) + insert + source.slice(target.to)
    expect(changed.startsWith(before)).toBe(true)
    expect(changed.endsWith(after)).toBe(true)
    const reread = readTableAt(
      parseMarkdown(changed).root,
      changed,
      changed.indexOf('A', before.length),
    )
    expect(reread.firstPrefix).toBe(target.firstPrefix)
    expect(reread.continuationPrefix).toBe(target.continuationPrefix)
    expect(reread.draft.rows[0]).toEqual(target.draft.rows[0])
    expect(reread.draft.rows[1]).toEqual(['new \\| `code\\|pipe` 中文', target.draft.rows[1]?.[1]])
    expect(reread.draft.align).toEqual([target.draft.align[0], 'center'])
    if (table.includes('\r\n')) expect(insert.replaceAll('\r\n', '')).not.toContain('\n')
  })
  it('preserves non-ASCII whitespace, code, reference names and emoji spellings when another cell changes', () => {
    const source = '| A | B |\n| --- | --- |\n| \u00a0x\u00a0 | [name][REF] `raw` :smile: |'
    const target = readTableAt(parseMarkdown(source).root, source, 2),
      draft = structuredClone(target.draft)
    draft.rows[0] = ['Changed', 'B']
    const output = serializeTable(target, draft)
    expect(output).toContain('\u00a0x\u00a0')
    expect(output).toContain('[name][REF] `raw` :smile:')
  })
  it.each([
    ['a|b', 'a|b'],
    ['a\\|b', 'a|b'],
    ['a\\\\|b', 'a\\|b'],
    ['`a|b`', 'a|b'],
    ['尾\\', '尾\\'],
  ])('escapes structural pipes without losing intended text: %s', (value, expected) => {
    const source = '| A |\n| --- |\n| x |',
      target = readTableAt(parseMarkdown(source).root, source, 2)
    const draft = { ...target.draft, rows: [['A'], [value]] },
      output = serializeTable(target, draft)
    const table = parseMarkdown(output).root.children[0]
    expect(table?.type).toBe('table')
    if (table?.type !== 'table') throw new Error('Missing table')
    expect(table.children[1]?.children).toHaveLength(1)
    expect(plainText(table.children[1]?.children[0] ?? table)).toBe(expected)
  })
  it('does not discard excess cells or normalize an ambiguous quote prefix', () => {
    for (const source of ['A | B\n--- | ---\nx | y | hidden', '> A | B\n> --- | ---\n>x | y']) {
      expect(() => readTableAt(parseMarkdown(source).root, source, source.indexOf('A'))).toThrow(
        'table-unsupported',
      )
    }
  })
  it('finds a nested table without treating code fences as tables', () => {
    const source = '```md\n| A |\n| --- |\n```\n\n| B |\n| --- |'
    expect(() => readTableAt(parseMarkdown(source).root, source, 9)).toThrow('table-not-found')
    expect(readTableAt(parseMarkdown(source).root, source, source.indexOf('B')).draft.rows).toEqual(
      [['B']],
    )
  })
  it('rejects matrix, cell and source bounds before an editable model is returned', () => {
    expect(() =>
      validateTableDraft({ align: [null], rows: Array.from({ length: 201 }, () => ['']) }),
    ).toThrow('table-limit')
    expect(() =>
      validateTableDraft({ align: Array(33).fill(null), rows: [Array(33).fill('')] }),
    ).toThrow('table-limit')
    expect(() =>
      validateTableDraft({
        align: Array(32).fill(null),
        rows: Array.from({ length: 65 }, () => Array(32).fill('')),
      }),
    ).toThrow('table-limit')
    for (const cell of ['a\nb', 'a\0b', 'x'.repeat(tableEditLimits.cellUnits + 1)])
      expect(() => validateTableDraft({ align: [null], rows: [[cell]] })).toThrow('table-limit')
    const source = `| A |\n| --- |\n| ${'x'.repeat(tableEditLimits.sourceBytes)} |`
    expect(() => readTableAt(parseMarkdown(source).root, source, 2)).toThrow('table-limit')
  })
  it('bounds generated output after staged edits', () => {
    const source = '| A |\n| --- |',
      target = readTableAt(parseMarkdown(source).root, source, 2)
    const draft = {
      align: Array(32).fill(null),
      rows: Array.from({ length: 64 }, () => Array(32).fill('x'.repeat(300))),
    }
    expect(() => serializeTable(target, draft)).toThrow('table-limit')
  })
})
