import { SearchQuery } from '@codemirror/search'
import { ChangeSet, EditorState } from '@codemirror/state'
import { utf8Bytes } from '@manuslip/core/text'
import { maxDocumentBytes, textByteLength } from './limits'

export const replaceLimits = { message: 8 * 1024 * 1024, changes: 262144, watchdog: 5000 } as const
export interface ReplaceQuery {
  search: string
  replace: string
  caseSensitive: boolean
  literal: boolean
  regexp: boolean
  wholeWord: boolean
}
export interface ReplaceInput {
  sequence: number
  lines: string[]
  query: ReplaceQuery
  wordChars: string
}
export type Replacement = [from: number, to: number, insert: string]
export interface ReplaceOutput {
  changes: Replacement[]
  matches: number
}

function unquote(value: string, literal: boolean): string {
  return literal
    ? value
    : value.replace(/\\([nrt\\])/g, (_, char: string) =>
        char === 'n' ? '\n' : char === 'r' ? '\r' : char === 't' ? '\t' : '\\',
      )
}

/** Public CodeMirror cursor semantics; replacement expansion is checked against replaceAll. */
export function prepareReplacements(input: ReplaceInput): ReplaceOutput {
  const query = new SearchQuery(input.query)
  if (!query.valid) throw new Error('replace-query')
  const state = EditorState.create({
    doc: input.lines.join('\n'),
    extensions: EditorState.languageData.of(() => [{ wordChars: input.wordChars }]),
  })
  if (textByteLength(state.doc) > maxDocumentBytes) throw new Error('file-large')
  const changes: Replacement[] = []
  const replacement = unquote(query.replace, query.literal)
  let matches = 0
  let inserted = 0
  const cursor = query.getCursor(state)
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    const value = next.value
    if ('precise' in value && value.precise === false) continue
    let insert = replacement
    if (query.regexp) {
      const match = 'match' in value && Array.isArray(value.match) ? value.match : null
      if (!match) throw new Error('replace-failed')
      insert = replacement.replace(/\$([$&]|\d+)/g, (original, index: string) => {
        if (index === '&') return match[0]
        if (index === '$') return '$'
        for (let length = index.length; length > 0; length--) {
          const number = Number(index.slice(0, length))
          if (number > 0 && number < match.length) return match[number] + index.slice(length)
        }
        return original
      })
    }
    // Native transactions normalize replacement line separators.
    insert = insert.replace(/\r\n?/g, '\n')
    inserted += utf8Bytes(insert)
    if (inserted > maxDocumentBytes) throw new Error('replace-limit')
    const previous = changes.at(-1)
    if (previous && previous[1] === value.from) {
      previous[1] = value.to
      previous[2] += insert
    } else changes.push([value.from, value.to, insert])
    if (changes.length > replaceLimits.changes) throw new Error('replace-limit')
    matches++
  }
  const result = ChangeSet.of(
    changes.map(([from, to, insert]) => ({ from, to, insert })),
    state.doc.length,
  ).apply(state.doc)
  if (textByteLength(result) > maxDocumentBytes) throw new Error('file-large')
  return { changes, matches }
}
