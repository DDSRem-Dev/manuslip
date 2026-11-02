import { replaceAll, SearchQuery, search, setSearchQuery } from '@codemirror/search'
import { ChangeSet, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { prepareReplacements, type ReplaceQuery, replaceLimits } from '../../src/replace'

const defaults: ReplaceQuery = {
  search: 'word',
  replace: 'new',
  caseSensitive: false,
  regexp: false,
  literal: false,
  wholeWord: false,
}
function compare(source: string, options: Partial<ReplaceQuery>, wordChars = '') {
  const query = { ...defaults, ...options }
  let state = EditorState.create({
    doc: source,
    extensions: [search(), EditorState.languageData.of(() => [{ wordChars }])],
  })
  state = state.update({ effects: setSearchQuery.of(new SearchQuery(query)) }).state
  const initial = state
  // Independent public command oracle: replaceAll only requires state and dispatch.
  replaceAll({
    get state() {
      return state
    },
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state
    },
  } as unknown as EditorView)
  const result = prepareReplacements({ sequence: 1, lines: initial.doc.toJSON(), query, wordChars })
  const changes = ChangeSet.of(
    result.changes.map(([from, to, insert]) => ({ from, to, insert })),
    initial.doc.length,
  )
  expect(changes.apply(initial.doc).toString()).toBe(state.doc.toString())
  expect(initial.selection.map(changes).toJSON()).toEqual(state.selection.toJSON())
  return result
}

describe('worker replacement equals the native CodeMirror command', () => {
  it.each([
    ['word WORD words word', {}],
    ['word WORD words word', { caseSensitive: true }],
    ['word words sword word_word word', { wholeWord: true }],
    ['中 中文 中😀中', { search: '中', wholeWord: true }],
    ['i İ I ı İİ', { search: 'i' }],
    ['a\nb\ta\nb', { search: 'a\\nb', replace: 'X\\tY\\n' }],
    ['a\\nb a\nb', { search: 'a\\nb', replace: '\\n', literal: true }],
    ['a1 a2 b3', { search: '([a-z])(\\d)', replace: '$2-$1-$&-$$-$12-$0', regexp: true }],
    ['b ab b', { search: '(a)?b', replace: '$1 / $2 / $&', regexp: true }],
    ['a\nb\na', { search: '^|$', replace: '_', regexp: true }],
    ['abc abc', { search: '(?=b)', replace: '!', regexp: true }],
    ['abc abc', { search: '(?<=a)b', replace: 'B', regexp: true }],
    ['abc\nabc\n', { search: 'b\\nc', replace: '_', regexp: true }],
    ['😀 a 😀', { search: '😀', replace: '中\r\nnew' }],
    ['word', { search: 'absent', replace: 'x' }],
    ['', { search: '^$', replace: 'x', regexp: true }],
    ['aaa', { search: 'a', replace: '' }],
  ] satisfies [string, Partial<ReplaceQuery>][])(
    'preserves matching, text and selection: %s %j',
    (source, options) => {
      compare(source, options)
    },
  )
  it('preserves the current language word characters', () => {
    compare('$word word word$ .word.', { wholeWord: true }, '$')
  })
  it('coalesces adjacent replacements without losing the actual match count', () => {
    const result = compare('a'.repeat(300000), { search: 'a', replace: 'b' })
    expect(result.matches).toBe(300000)
    expect(result.changes).toHaveLength(1)
  })
  it('rejects invalid expressions before executing', () => {
    expect(() =>
      prepareReplacements({
        sequence: 1,
        lines: ['abc'],
        query: { ...defaults, search: '[', regexp: true },
        wordChars: '',
      }),
    ).toThrow('replace-query')
  })
  it('rejects an oversized sparse change index instead of returning a partial result', () => {
    expect(() =>
      prepareReplacements({
        sequence: 1,
        lines: ['a '.repeat(replaceLimits.changes + 1)],
        wordChars: '',
        query: { ...defaults, search: 'a' },
      }),
    ).toThrow('replace-limit')
  })
})
