import { EditorState } from '@codemirror/state'
import { expect, it } from 'vitest'
import { tableCellInput, tableSourceCells } from '../../src/live-table-source'

function table(text: string) {
  const state = EditorState.create({ doc: `Before\n\n${text}\n\nAfter` })
  const block = {
    from: 8,
    to: 8 + text.length,
    kind: 'table',
    id: 'table',
    html: '',
    value: '',
    lines: 3,
  }
  const cells = tableSourceCells(state, block)
  return {
    state,
    block,
    cells,
    text: cells.map((row) => row.map((cell) => state.doc.sliceString(cell.from, cell.to))),
  }
}

it('keeps pasted pipes and line breaks inside their cell and maps the caret through escaping', () => {
  const state = EditorState.create({ extensions: EditorState.transactionFilter.of(tableCellInput) })
  const next = state.update({
    changes: { from: 0, insert: 'a | b\nc \\| d' },
    selection: { anchor: 5 },
  }).state
  expect(next.doc.toString()).toBe('a \\| b c \\| d')
  expect(next.selection.main.head).toBe(6)
})

it('finds authored cell ranges without consuming alignment, spaces, escapes or neighboring text', () => {
  const result = table('| Name | Detail |\n| :-- | --: |\n| a \\| b | **中文** |')
  expect(result.text).toEqual([
    ['Name', 'Detail'],
    ['a \\| b', '**中文**'],
  ])
  const cell = result.cells[1]?.[1]
  if (!cell) throw new Error('Missing cell')
  const next = result.state.update({
    changes: { from: cell.from, to: cell.to, insert: '*Changed*' },
  }).state
  expect(next.doc.toString()).toBe(
    'Before\n\n| Name | Detail |\n| :-- | --: |\n| a \\| b | *Changed* |\n\nAfter',
  )
})

it('supports omitted outer pipes, empty cells and even backslashes before a separator', () => {
  expect(table('Name | Detail | Last\n-- | -- | --\na\\\\ | | c').text).toEqual([
    ['Name', 'Detail', 'Last'],
    ['a\\\\', '', 'c'],
  ])
})

it('gives padded, unauthored cells insertion ranges without rewriting the table on focus', () => {
  const result = table('| First | Second | Third |\n| -- | -- | -- |\n| Sparse |')
  expect(result.text[1]).toEqual(['Sparse', '', ''])
  const cell = result.cells[1]?.[2]
  if (!cell) throw new Error('Missing padded cell')
  const next = result.state.update({
    changes: { from: cell.from, to: cell.to, insert: `${cell.prefix}New${cell.suffix}` },
  }).state
  expect(next.doc.toString()).toBe(
    'Before\n\n| First | Second | Third |\n| -- | -- | -- |\n| Sparse |  | New |\n\nAfter',
  )
})
