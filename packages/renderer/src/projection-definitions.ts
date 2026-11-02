import type { Nodes } from 'mdast'
import type { State } from 'mdast-util-to-hast'

/** Index the original complete tree before any handler runs. Keep the public converter's
 * preorder/first-definition policy without allocating an ancestor array for each parent.
 * Frames retain only the active path; footnote bodies and nested definitions participate.
 */
export function indexProjectionDefinitions(root: Nodes, state: State): void {
  const stack = [{ node: root, index: 0 }]
  while (stack.length) {
    const frame = stack[stack.length - 1]
    if (!frame) break
    const { node } = frame
    if (frame.index === 0 && (node.type === 'definition' || node.type === 'footnoteDefinition')) {
      const id = String(node.identifier).toUpperCase()
      if (node.type === 'definition') {
        if (!state.definitionById.has(id)) state.definitionById.set(id, node)
      } else if (!state.footnoteById.has(id)) state.footnoteById.set(id, node)
    }
    if ('children' in node && frame.index < node.children.length) {
      const child = node.children[frame.index++]
      if (child) stack.push({ node: child, index: 0 })
    } else stack.pop()
  }
}
