import type { Element, Nodes, Root } from 'hast'
import type { ProjectionLimits } from './fragment-projection-context'
import type { RenderedBlock, RenderOptions } from './index'
import { projectionChunkBufferBytes } from './projection-chunk-buffer'
import { ProjectionTraversalBudget } from './projection-traversal-budget'

export type ProjectionDescriptions = Map<string, Pick<RenderedBlock, 'kind' | 'value'>>
export interface ProjectionSerializationPlan {
  nodes: number
  depth: number
  hastBytes: number
  widgetUnits: number
  widgets: number
  htmlUnits: number
  scratchBytes: number
  bytes: number
  /** Complete HAST/description ownership plus shell and bounded text scratch; no joined HTML. */
  streamBytes: number
}

interface SerializationFrame {
  node: Nodes
  children: readonly Nodes[] | undefined
  own: number
  escapes: number
  at: number
  units: number
  childrenUnits: number
  peak: number
}

/** Pinned default HTML options: text escapes < and &, quoted attributes also escape
 * quotes, backticks and NUL. Eight units per escaped character is a conservative bound.
 * Scan without allocating replacement strings. A shared traversal budget yields within
 * 4096 units across adjacent values too; raw strings retain the same lexical progress.
 */
function* stringCost(
  value: string,
  attribute: boolean,
  raw: boolean,
  progress: ProjectionTraversalBudget,
): Generator<void, { units: number; escapes: number }> {
  let escapes = 0
  for (let from = 0; from < value.length; ) {
    const end = Math.min(from + progress.textCapacity, value.length)
    if (!raw)
      for (let index = from; index < end; index++) {
        const code = value.charCodeAt(index)
        if (
          code === 38 ||
          code === 60 ||
          (attribute && (code === 0 || code === 34 || code === 39 || code === 96))
        )
          escapes++
      }
    const pause = progress.text(end - from)
    from = end
    if (pause) yield
  }
  return { units: value.length + escapes * 7, escapes }
}

/** Caller already owns the HAST and planner frames. The complete result is private until
 * measurement finishes. Includes every widget serialization, even intermediate code/pre
 * results overwritten at the same range, plus one complete HTML output. Sibling strings,
 * attribute strings, entity replacement scratch and nested joins coexist in the peak.
 * An optional trusted policy runs on each element before its properties are measured.
 * URL policy calls retain their independent barriers on both sides; all other visits
 * share the planner's existing node/property/text quota. No policy result escapes here.
 */
export function* planProjectionSerialization(
  root: Root,
  descriptions: ProjectionDescriptions,
  options: RenderOptions,
  limits: Pick<ProjectionLimits, 'nodes' | 'depth'>,
  policy?: (element: Element) => void,
): Generator<void, Readonly<ProjectionSerializationPlan>> {
  const plan: ProjectionSerializationPlan = {
    nodes: 0,
    depth: 0,
    hastBytes: 16384,
    widgetUnits: 0,
    widgets: 0,
    htmlUnits: 0,
    scratchBytes: 0,
    bytes: 0,
    streamBytes: 0,
  }
  let shellScratch = 0
  const progress = new ProjectionTraversalBudget()
  const frames: SerializationFrame[] = []
  let depth = 0
  let node: Nodes = root
  let entering = true
  let result: { units: number; peak: number }
  // Caller-admitted depth frames are reused by siblings in this traversal. Every entry,
  // property, lexical and completion checkpoint advances the same traversal budget.
  try {
    while (true) {
      if (entering) {
        if (++plan.nodes > limits.nodes || depth > limits.depth)
          throw new Error('Packed projection HAST traversal limit')
        if (progress.step()) yield
        if (policy && node.type === 'element') {
          const url = node.tagName === 'a' || node.tagName === 'img'
          if (url) {
            progress.reset()
            yield
          }
          policy(node)
          if (url) {
            progress.reset()
            yield
          }
        }
        plan.depth = Math.max(plan.depth, depth)
        plan.hastBytes += 512 + (node.position ? 272 : 0)
        let own = 0
        let escapes = 0
        if (node.type === 'text' || node.type === 'raw') {
          plan.hastBytes += 32 + node.value.length * 2
          const cost = yield* stringCost(
            node.value,
            false,
            node.type === 'raw' && options.rawHtml,
            progress,
          )
          own = cost.units
          escapes = cost.escapes
        } else if (node.type === 'element') {
          own = 5 + node.tagName.length * 2
          for (const key of Object.keys(node.properties)) {
            if (progress.step()) yield
            plan.hastBytes += 128 + key.length * 2
            own += 36 + key.length * 2
            const value = node.properties[key]
            const values = Array.isArray(value) ? value : [value]
            for (const item of values) {
              if (progress.step()) yield
              plan.hastBytes += 32
              if (typeof item === 'string') {
                plan.hastBytes += item.length * 2
                const cost = yield* stringCost(item, true, false, progress)
                own += cost.units + 2
                escapes += cost.escapes
              } else if (typeof item === 'number' || typeof item === 'boolean' || item == null)
                own += 32
              else throw new Error('Unsupported projection property')
            }
          }
        } else if (node.type !== 'root') throw new Error('Unsupported projection HAST node')
        if (node.type === 'element') shellScratch += own * 16 + escapes * 96 + 2048
        const children = 'children' in node ? node.children : undefined
        if (children) plan.hastBytes += 64 + children.length * 16
        const peak = own * (node.type === 'element' ? 8 : 4) + escapes * 96 + 2048
        const frame = frames[depth]
        if (frame) {
          frame.node = node
          frame.children = children
          frame.own = own
          frame.escapes = escapes
          frame.at = 0
          frame.units = own
          frame.childrenUnits = 0
          frame.peak = peak
        } else
          frames.push({
            node,
            children,
            own,
            escapes,
            at: 0,
            units: own,
            childrenUnits: 0,
            peak,
          })
        depth++
      }
      const frame = frames[depth - 1]
      if (!frame) throw new Error('Missing projection serialization frame')
      if (frame.children && frame.at < frame.children.length) {
        node = frame.children[frame.at++] as Nodes
        entering = true
        continue
      }
      if (frame.children)
        frame.peak = Math.max(
          frame.peak,
          frame.units * 6 + frame.escapes * 96 + frame.children.length * 16 + 2048,
        )
      if (descriptions.size) {
        const from = frame.node.position?.start.offset
        const to = frame.node.position?.end.offset
        if (from !== undefined && to !== undefined && descriptions.has(`${from}:${to}`)) {
          plan.widgetUnits += frame.units
          plan.widgets++
          plan.scratchBytes = Math.max(plan.scratchBytes, frame.peak)
        }
      }
      if (progress.step()) yield
      depth--
      const parent = frames[depth - 1]
      if (!parent) {
        result = { units: frame.units, peak: frame.peak }
        break
      }
      parent.peak = Math.max(
        parent.peak,
        parent.own * 8 + parent.childrenUnits * 2 + frame.peak + 2048,
      )
      parent.childrenUnits += frame.units
      parent.units += frame.units
      entering = false
    }
  } finally {
    frames.length = 0
  }
  plan.htmlUnits = result.units
  plan.scratchBytes = Math.max(plan.scratchBytes, result.peak)
  plan.bytes =
    plan.hastBytes +
    (descriptions.size + plan.widgets) * 1024 +
    (plan.htmlUnits + plan.widgetUnits) * 2 +
    plan.scratchBytes +
    (plan.depth + 16) * 1024
  if (!Number.isSafeInteger(plan.bytes)) throw new Error('Invalid projection serialization weight')
  plan.streamBytes =
    plan.hastBytes +
    (descriptions.size + plan.widgets) * 1024 +
    shellScratch +
    projectionChunkBufferBytes +
    (plan.depth + 16) * 2048 +
    256 * 1024
  if (!Number.isSafeInteger(plan.streamBytes)) throw new Error('Invalid projection stream weight')
  return Object.freeze(plan)
}
