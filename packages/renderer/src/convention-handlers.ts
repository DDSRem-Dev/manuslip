import { defaultHandlers, type Handlers } from 'mdast-util-to-hast'
import type { Element, Nodes } from 'hast'

/** Generated labels follow the currently rendered headings, including translated
 * copies. The generated TOC itself never becomes provider input.
 */
export function refreshTableOfContents(
  element: Element,
  headings: ReadonlyMap<string, string>,
): void {
  if (
    element.tagName !== 'nav' ||
    !Array.isArray(element.properties.className) ||
    !element.properties.className.includes('markdown-toc')
  )
    return
  const pending: Nodes[] = [...element.children]
  while (pending.length) {
    const node = pending.pop()
    if (!node) continue
    if (
      node.type === 'element' &&
      node.tagName === 'a' &&
      typeof node.properties.href === 'string'
    ) {
      let id: string
      try {
        id = decodeURIComponent(node.properties.href.slice(1))
      } catch {
        continue
      }
      const label = headings.get(id)
      if (label !== undefined) node.children = [{ type: 'text', value: label }]
    }
    if ('children' in node) pending.push(...node.children)
  }
}

/** Shared identities for ordinary and cooperative convention rendering. */
export const conventionHandlers: Handlers = {
  blockquote(state, node) {
    const result = defaultHandlers.blockquote(state, node)
    const alert = node.data?.manuslipAlert
    if (alert && result.type === 'element')
      result.children.unshift({
        type: 'element',
        tagName: 'p',
        properties: { className: ['markdown-alert-title'] },
        children: [{ type: 'text', value: alert[0] + alert.slice(1).toLowerCase() }],
      })
    return result
  },
}
