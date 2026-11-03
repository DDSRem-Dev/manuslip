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
    defineNodes: ['UnparsedInline', 'LiteralHTML'],
    parseBlock: [
      {
        name: 'LiteralDisclosure',
        before: 'HTMLBlock',
        parse(context, line) {
          if (!/^<\/?(?:details|summary)(?=[\s/>]|$)/i.test(line.text.slice(line.pos))) return false
          const from = context.lineStart + line.pos
          const text = line.text.slice(line.pos)
          context.addElement(
            context.elt(
              'Paragraph',
              from,
              from + text.length,
              context.parser.parseInline(text, from),
            ),
          )
          context.nextLine()
          return true
        },
      },
    ],
    parseInline: [
      {
        name: 'LiteralDisclosure',
        before: 'HTMLTag',
        parse(context, next, position) {
          if (next !== 60) return -1
          const tag = /^<\/?(?:details|summary)(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/i.exec(
            context.slice(position, context.end),
          )
          return tag
            ? context.addElement(context.elt('LiteralHTML', position, position + tag[0].length))
            : -1
        },
      },
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
