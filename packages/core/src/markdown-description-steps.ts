import type { Nodes } from 'mdast'
import { type Heading, type SemanticBlock, SemanticLimitError, semanticLimits } from './contracts'
import { PackedWork } from './packing-work'
import { describesBlock } from './semantic-description'

export interface MarkdownDescriptionState {
  blocks: SemanticBlock[]
  outline: Heading[]
  text: string[]
  /** Includes the document root, as in the ordinary whole-tree visitor. */
  nodes: number
}

interface Budget {
  units: number
  visits: number
}

/** One cursor advance enters a node, opens its children, reads one child, or closes
 * one parent. Wide child arrays never become an equally wide pending-node stack.
 */
class NodeCursor {
  #node: Nodes | undefined
  #entered = false
  #parents: { children: Nodes[]; index: number }[] = []
  constructor(node: Nodes) {
    this.#node = node
  }
  get done(): boolean {
    return !this.#node && this.#parents.length === 0
  }
  next(): Nodes | undefined {
    const node = this.#node
    if (node) {
      if (!this.#entered) {
        this.#entered = true
        return node
      }
      this.#node = undefined
      this.#entered = false
      if ('children' in node) this.#parents.push({ children: node.children, index: 0 })
    } else {
      const parent = this.#parents[this.#parents.length - 1]
      if (parent) {
        if (parent.index < parent.children.length) this.#node = parent.children[parent.index++]
        else this.#parents.pop()
      }
    }
    return undefined
  }
}

function sliceIndex(offset: number, length: number): number {
  const integer = Math.trunc(offset) || 0
  return integer < 0 ? Math.max(length + integer, 0) : Math.min(integer, length)
}

function* rangeHash(source: string, from: number, to: number, budget: Budget) {
  const start = sliceIndex(from, source.length)
  const end = sliceIndex(to, source.length)
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  for (let index = start; index < end; index++) {
    const unit = source.charCodeAt(index)
    a = Math.imul(a ^ unit, 0x01000193)
    b = Math.imul(b ^ unit, 0x85ebca6b)
    if (++budget.units === 4096) {
      budget.units = budget.visits = 0
      yield
    }
  }
  return `${Math.max(0, end - start)}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`
}

function* headingText(root: Nodes, budget: Budget) {
  const cursor = new NodeCursor(root)
  const parts: string[] = []
  try {
    while (!cursor.done) {
      const node = cursor.next()
      if (node && !('children' in node)) {
        if ('value' in node) parts.push(node.value)
        else if (node.type === 'image' || node.type === 'imageReference') parts.push(node.alt || '')
      }
      if (++budget.visits === 256) {
        budget.units = budget.visits = 0
        yield
      }
    }
    // A complete heading still needs one native string join; this is not physical admission.
    return parts.join('')
  } finally {
    parts.length = 0
  }
}

/** Private complete-block metadata work. Hash reads share a 4,096-unit budget across
 * ranges, and both traversals share a 256-advance cursor budget. Either checkpoint resets
 * both budgets. Output remains private until the enclosing complete document succeeds.
 */
export function markdownDescriptionSteps(
  root: Nodes,
  source: string,
  normalizeLists: boolean,
  target: MarkdownDescriptionState,
): PackedWork<true> {
  const work = new PackedWork(
    (function* () {
      const budget: Budget = { units: 0, visits: 0 }
      const cursor = new NodeCursor(root)
      while (!cursor.done) {
        const node = cursor.next()
        if (node) {
          if (normalizeLists && node.type === 'listItem') node.checked = null
          if (++target.nodes > semanticLimits.blocks * 16)
            throw new SemanticLimitError('Document syntax exceeds semantic limits')
          const from = node.position?.start.offset
          const to = node.position?.end.offset
          if (from !== undefined && to !== undefined && describesBlock(node.type)) {
            const hash = yield* rangeHash(source, from, to, budget)
            if (target.blocks.length >= semanticLimits.blocks)
              throw new SemanticLimitError('Document exceeds Live Preview block limit')
            target.blocks.push({
              kind: node.type,
              from,
              to,
              hash,
              lines: (node.position?.end.line || 1) - (node.position?.start.line || 1) + 1,
            })
          }
          if (node.type === 'heading' && from !== undefined && to !== undefined)
            target.outline.push({
              from,
              to,
              depth: node.depth,
              text: yield* headingText(node, budget),
            })
          if (node.type === 'text') target.text.push(node.value)
        }
        if (++budget.visits === 256) {
          budget.units = budget.visits = 0
          yield
        }
      }
      return true as const
    })(),
    () => {},
  )
  return work
}
