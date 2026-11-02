import type { Element } from 'hast'
import type { Handlers } from 'mdast-util-to-hast'

/** Fixed application handlers; shared identities also authorize cooperative conversion. */
export const extendedInlineHandlers: Handlers = {
  subscript(state, node) {
    const result: Element = {
      type: 'element',
      tagName: 'sub',
      properties: {},
      children: state.all(node),
    }
    state.patch(node, result)
    return result
  },
  superscript(state, node) {
    const result: Element = {
      type: 'element',
      tagName: 'sup',
      properties: {},
      children: state.all(node),
    }
    state.patch(node, result)
    return result
  },
  emoji(state, node) {
    const result: Element = {
      type: 'element',
      tagName: 'span',
      properties: { className: ['md-emoji'], title: `:${node.name}:` },
      children: [{ type: 'text', value: node.value }],
    }
    state.patch(node, result)
    return result
  },
}
