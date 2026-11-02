import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { semanticLimits } from '@manuslip/core'

// Lezer finishes an entire inline leaf in one non-interruptible parse step. Keep
// pathological paragraphs out of that main-thread loop. The semantic worker
// still parses the complete original text, including inline code and links.
export const maxEditorInlineLength = semanticLimits.editorInlineUnits
export const editorSyntax = markdown({
  base: markdownLanguage,
  codeLanguages: languages,
  addKeymap: false,
  completeHTMLTags: false,
  pasteURLAsLink: false,
  extensions: {
    defineNodes: ['UnparsedInline'],
    parseInline: [
      {
        name: 'BoundedInline',
        before: 'Escape',
        parse(context, _next, position) {
          if (position !== context.offset || context.text.length <= maxEditorInlineLength) return -1
          return context.addElement(context.elt('UnparsedInline', position, context.end))
        },
      },
    ],
  },
})
