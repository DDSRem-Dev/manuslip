import type { State } from 'mdast-util-to-hast'
import type { ProjectionChildren } from './index'

/** Substitute inline children through the public handler state, including table cells
 * and footnote bodies. Preserve every other descriptor on the immutable input node.
 */
export function projectChildren(state: State, children: ProjectionChildren): void {
  const all = state.all
  state.all = (node) => {
    const replacement = children(node)
    if (!replacement) return all(node)
    const descriptors = Object.getOwnPropertyDescriptors(node)
    descriptors.children = { value: replacement, enumerable: true, configurable: true }
    return all(Object.create(Object.getPrototypeOf(node), descriptors))
  }
}
