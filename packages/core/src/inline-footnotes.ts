import type { FootnoteDefinition, Nodes, Root } from 'mdast'
import type { Extension } from 'mdast-util-from-markdown'
import type { Construct, State } from 'micromark-util-types'
import type { Plugin } from 'unified'

declare module 'mdast' {
  interface Data {
    manuslipInlineFootnote?: boolean
  }
}

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    manuslipInlineFootnote: 'manuslipInlineFootnote'
    manuslipInlineFootnoteMarker: 'manuslipInlineFootnoteMarker'
    manuslipInlineFootnoteData: 'manuslipInlineFootnoteData'
  }
}

const literalSpans = new Set(['codeText', 'mathText', 'manuslipLatex', 'htmlText', 'autolink'])

const inlineFootnote: Construct = {
  name: 'manuslipInlineFootnote',
  tokenize(effects, ok, nok) {
    const context = this
    let brackets = 0
    let escaped = false
    let content = false
    let spanEnd = 0
    return start
    function start(value: number | null) {
      effects.enter('manuslipInlineFootnote')
      effects.enter('manuslipInlineFootnoteMarker')
      effects.consume(value)
      return open
    }
    function open(value: number | null) {
      if (value !== 91) return nok(value)
      effects.consume(value)
      effects.exit('manuslipInlineFootnoteMarker')
      effects.enter('manuslipInlineFootnoteData', { contentType: 'text' })
      return body
    }
    function body(value: number | null): State | undefined {
      if (value === null) return nok(value)
      // A bracket inside a complete code, math or HTML span cannot end the note.
      if (!escaped && [36, 60, 92, 96].includes(value)) {
        const available = context.parser.constructs.text[value]
        const constructs = (Array.isArray(available) ? available : available ? [available] : [])
          .filter(
            (construct) =>
              literalSpans.has(construct.name ?? '') &&
              (!construct.previous || construct.previous.call(context, context.previous)),
          )
          .map(
            (construct): Construct => ({
              ...construct,
              tokenize(effects, ok, nok) {
                return construct.tokenize.call(
                  this,
                  effects,
                  (value) => {
                    spanEnd = this.now().offset
                    return ok(value)
                  },
                  nok,
                )
              },
            }),
          )
        if (constructs.length) return effects.check(constructs, span, consume)(value)
      }
      if (!escaped && value === 91) brackets++
      if (!escaped && value === 93) {
        if (brackets) brackets--
        else {
          if (!content) return nok(value)
          effects.exit('manuslipInlineFootnoteData')
          effects.enter('manuslipInlineFootnoteMarker')
          effects.consume(value)
          effects.exit('manuslipInlineFootnoteMarker')
          effects.exit('manuslipInlineFootnote')
          return ok
        }
      }
      return consume(value)
    }
    function consume(value: number | null) {
      content ||= value !== null && value > 32
      effects.consume(value)
      if (escaped) escaped = false
      else escaped = value === 92
      return body
    }
    function span(value: number | null): State | undefined {
      if (context.now().offset >= spanEnd) return body(value)
      if (value === null) return nok(value)
      content = true
      effects.consume(value)
      return span
    }
  },
}

const fromMarkdown: Extension = {
  enter: {
    manuslipInlineFootnote(token) {
      // Reuse a phrasing parent during compilation; normalization removes it
      // before any renderer, translation plan or semantic snapshot sees the root.
      this.enter(
        { type: 'link', url: '', children: [], data: { manuslipInlineFootnote: true } },
        token,
      )
    },
  },
  exit: {
    manuslipInlineFootnote(token) {
      this.exit(token)
    },
  },
}

export const remarkInlineFootnotes: Plugin = function () {
  const data = this.data()
  data.micromarkExtensions ??= []
  data.fromMarkdownExtensions ??= []
  data.micromarkExtensions.push({ text: { 94: inlineFootnote } })
  data.fromMarkdownExtensions.push(fromMarkdown)
}

/** Give inline and named notes one numbering, rendering and translation path. */
export function normalizeInlineFootnotes(root: Root): void {
  const used = new Set<string>()
  const pending: Nodes[] = [root]
  while (pending.length) {
    const node = pending.pop()
    if (!node) continue
    if (node.type === 'footnoteDefinition' || node.type === 'footnoteReference')
      used.add(node.identifier.toUpperCase())
    if ('children' in node) for (const child of node.children) pending.push(child)
  }
  let sequence = 0
  const definitions: FootnoteDefinition[] = []
  const parents: { parent: Nodes; index: number }[] = [{ parent: root, index: 0 }]
  while (parents.length) {
    const frame = parents[parents.length - 1]
    if (!frame) break
    const { parent } = frame
    if (!('children' in parent) || frame.index >= parent.children.length) {
      parents.pop()
      continue
    }
    const index = frame.index++
    const node = parent.children[index]
    if (node) {
      if (node.type === 'link' && node.data?.manuslipInlineFootnote) {
        const position = node.position
        if (!position || position.start.offset === undefined || position.end.offset === undefined)
          throw new Error('Missing inline footnote position')
        let identifier: string
        do identifier = `inline-note-${++sequence}`
        while (used.has(identifier.toUpperCase()))
        used.add(identifier.toUpperCase())
        const definition: FootnoteDefinition = {
          type: 'footnoteDefinition',
          identifier,
          data: { manuslipInlineFootnote: true },
          // Distinct nested ranges keep the definition, body and reference projections separate.
          position: {
            start: {
              ...position.start,
              offset: position.start.offset + 1,
              column: position.start.column + 1,
            },
            end: { ...position.end },
          },
          children: [
            {
              type: 'paragraph',
              children: node.children,
              position: {
                start: {
                  ...position.start,
                  offset: position.start.offset + 2,
                  column: position.start.column + 2,
                },
                end: {
                  ...position.end,
                  offset: position.end.offset - 1,
                  column: position.end.column - 1,
                },
              },
            },
          ],
        }
        parent.children[index] = { type: 'footnoteReference', identifier, position }
        definitions.push(definition)
        parents.push({ parent: definition, index: 0 })
      } else if ('children' in node) parents.push({ parent: node, index: 0 })
    }
  }
  root.children.push(...definitions)
}
