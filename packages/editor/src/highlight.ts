import { HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const codeStyles = [
  { tag: [tags.keyword, tags.operator], color: 'var(--syntax-keyword)' },
  { tag: [tags.atom, tags.bool, tags.number], color: 'var(--syntax-number)' },
  { tag: [tags.string, tags.regexp], color: 'var(--syntax-string)' },
  { tag: [tags.typeName, tags.className, tags.tagName], color: 'var(--syntax-type)' },
  { tag: tags.comment, color: 'var(--muted)' },
  { tag: tags.invalid, textDecoration: 'underline wavy', color: 'var(--text)' },
]

// Source is a code view: syntax colors must not change Markdown's typography.
export const sourceHighlightStyle = HighlightStyle.define([
  ...codeStyles,
  { tag: tags.heading, color: 'var(--syntax-keyword)' },
  { tag: tags.emphasis, color: 'var(--syntax-type)' },
  { tag: tags.strong, color: 'var(--text)' },
  { tag: tags.strikethrough, color: 'var(--muted)' },
  { tag: tags.link, color: 'var(--accent)' },
  { tag: [tags.url, tags.meta, tags.punctuation, tags.bracket], color: 'var(--muted)' },
])

// Live decorations own prose formatting. Keep syntax highlighting for exposed code.
export const codeHighlightStyle = HighlightStyle.define(codeStyles)
