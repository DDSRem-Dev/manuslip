import type { Nodes, Root } from 'mdast'
import { parse } from 'micromark'
import type { Construct } from 'micromark-util-types'
import type { Plugin } from 'unified'

declare module 'mdast' {
  interface Data {
    manuslipLiteralHtml?: boolean
  }
}

const disclosure = new Set(['details', 'summary'])
const unsupported: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    let name = ''
    return start
    function start(code: number | null) {
      effects.enter('htmlFlow')
      effects.consume(code)
      return slash
    }
    function slash(code: number | null) {
      if (code === 47) {
        effects.consume(code)
        return tag
      }
      return tag(code)
    }
    function tag(code: number | null) {
      if (code !== null && ((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) {
        if (name.length === 7) return nok(code)
        name += String.fromCharCode(code).toLowerCase()
        effects.consume(code)
        return tag
      }
      if (!disclosure.has(name) || (code !== null && code > 32 && code !== 47 && code !== 62))
        return nok(code)
      effects.exit('htmlFlow')
      return ok(code)
    }
  },
}
const nativeFlow = parse().constructs.flow[60]
const htmlFlow = (Array.isArray(nativeFlow) ? nativeFlow : nativeFlow ? [nativeFlow] : []).find(
  (construct) => construct.name === 'htmlFlow',
)
if (!htmlFlow) throw new Error('Missing HTML flow construct')

/** Disclosure tags cannot consume the surrounding Markdown as an HTML block. */
export const remarkDocumentHtml: Plugin = function () {
  const data = this.data()
  data.micromarkExtensions ??= []
  data.micromarkExtensions.push({
    disable: { null: ['htmlFlow'] },
    flow: {
      60: {
        ...htmlFlow,
        name: 'manuslipHtmlFlow',
        tokenize(effects, ok, nok) {
          const ordinary = htmlFlow.tokenize.call(this, effects, ok, nok)
          return effects.check(unsupported, nok, ordinary)
        },
      },
    },
  })
}

/** Preserve removed markup as source even when sanitized raw HTML is enabled. */
export function removeDisclosureMarkup(root: Root): void {
  const pending: Nodes[] = [root]
  while (pending.length) {
    const parent = pending.pop()
    if (!parent || !('children' in parent)) continue
    for (let index = 0; index < parent.children.length; index++) {
      const node = parent.children[index]
      if (!node) continue
      if (node.type === 'html') {
        const tags = node.value.matchAll(
          /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\?[\s\S]*?(?:\?>|$)|<![a-z][^>]*>|<\/?([a-z][a-z0-9-]*)(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi,
        )
        if ([...tags].some((tag) => disclosure.has(tag[1]?.toLowerCase() ?? ''))) {
          const text = {
            type: 'text' as const,
            value: node.value,
            position: node.position,
            data: { manuslipLiteralHtml: true },
          }
          parent.children[index] = [
            'root',
            'blockquote',
            'listItem',
            'footnoteDefinition',
          ].includes(parent.type)
            ? { type: 'paragraph', children: [text], position: node.position }
            : text
        }
      } else if ('children' in node) pending.push(node)
    }
  }
}
