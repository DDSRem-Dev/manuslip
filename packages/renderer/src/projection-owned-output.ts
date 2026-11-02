import type { Nodes as HastNode } from 'hast'
import { toHtml } from 'hast-util-to-html'
import type { Nodes as MarkdownNode } from 'mdast'
import type { ProjectionLimits } from './fragment-projection-context'
import {
  type RenderedBlock,
  type RenderOptions,
  type RenderProjection,
  rendererVersion,
} from './index'
import { applyProjectionPolicy, describeProjectionNode } from './projection-engine'
import type { ProjectionConversion } from './projection-sequence'
import {
  type ProjectionDescriptions,
  type ProjectionSerializationPlan,
  planProjectionSerialization,
} from './projection-serialization-plan'
import { ProjectionTraversalBudget } from './projection-traversal-budget'
import type { ProjectionWorkspace } from './projection-workspace'

/** Trusted counts from the complete root-validation transaction. Its caller binds the
 * exact capture, source, root and immutable body record (or selected footer context).
 */
export interface ProjectionDescriptionAbsence {
  readonly nodes: number
  readonly depth: number
}

interface DescriptionFrame {
  children: readonly MarkdownNode[] | undefined
  at: number
}

/** Consume a caller-admitted native conversion. Construction admission includes policy
 * scratch; replace it only after the mutated HAST and complete serialization have been
 * measured. Outputs remain charged until the owning inspector closes its workspace.
 */
export function* prepareOwnedProjection(
  converted: ProjectionConversion,
  options: RenderOptions,
  limits: Pick<ProjectionLimits, 'nodes' | 'depth'>,
  workspace: ProjectionWorkspace,
  absence?: ProjectionDescriptionAbsence,
): Generator<
  void,
  { descriptions: ProjectionDescriptions; cost: Readonly<ProjectionSerializationPlan> }
> {
  const descriptions: ProjectionDescriptions = new Map()
  if (absence) {
    if (absence.nodes > limits.nodes || absence.depth > limits.depth)
      throw new Error('Packed projection description traversal limit')
    // Preserve the exact construction charge while avoiding a second no-widget walk.
    workspace.add(absence.nodes * 1024)
  } else {
    const progress = new ProjectionTraversalBudget()
    const frames: DescriptionFrame[] = []
    let depth = 0
    let visited = 0
    const descend = (children: readonly MarkdownNode[]) => {
      const frame = frames[depth]
      if (frame) {
        frame.children = children
        frame.at = children.length - 1
      } else frames.push({ children, at: children.length - 1 })
      depth++
    }
    // The full renderer visits children in reverse order. Reuse one admitted frame per
    // active depth, rather than constructing a recursive generator for every node.
    descend(converted.root.children)
    try {
      while (depth) {
        const frame = frames[depth - 1]
        if (!frame) throw new Error('Missing projection description frame')
        if (frame.at < 0) {
          frame.children = undefined
          depth--
          continue
        }
        const node = frame.children?.[frame.at--]
        if (!node) continue
        if (++visited > limits.nodes || depth > limits.depth)
          throw new Error('Packed projection description traversal limit')
        const language = node.type === 'code' && !!node.lang
        if (language || progress.step()) {
          progress.reset()
          yield
        }
        // Admit before the helper creates a map key/description, including unused notes.
        workspace.add(1024)
        if (node.type === 'code' && node.lang) workspace.add(node.lang.length * 4)
        const value = describeProjectionNode(node)
        if (value) descriptions.set(value.key, value.description)
        if (language) {
          progress.reset()
          yield
        }
        if ('children' in node && node.children.length) descend(node.children)
      }
    } finally {
      frames.length = 0
    }
  }
  yield
  const cost = yield* planProjectionSerialization(
    converted.hast,
    descriptions,
    options,
    limits,
    applyProjectionPolicy,
  )
  return { descriptions, cost }
}

export function* projectOwnedOutput(
  converted: ProjectionConversion,
  options: RenderOptions,
  limits: Pick<ProjectionLimits, 'nodes' | 'depth'>,
  workspace: ProjectionWorkspace,
  planned: (cost: Readonly<ProjectionSerializationPlan>) => void,
  absence?: ProjectionDescriptionAbsence,
): Generator<void, RenderProjection> {
  const { descriptions, cost } = yield* prepareOwnedProjection(
    converted,
    options,
    limits,
    workspace,
    absence,
  )
  workspace.set(cost.bytes)
  planned(cost)
  yield
  const progress = new ProjectionTraversalBudget()
  const blocks = new Map<string, RenderedBlock>()
  function* widgets(node: HastNode): Generator<void> {
    if (progress.step()) yield
    if ('children' in node) for (const child of node.children) yield* widgets(child)
    if (progress.step()) yield
    const from = node.position?.start.offset
    const to = node.position?.end.offset
    const description =
      from === undefined || to === undefined ? undefined : descriptions.get(`${from}:${to}`)
    if (description && from !== undefined && to !== undefined) {
      progress.reset()
      yield
      blocks.set(`${from}:${to}`, {
        ...description,
        from,
        to,
        html: toHtml(node, { allowDangerousHtml: options.rawHtml }),
      })
      progress.reset()
      yield
    }
  }
  if (descriptions.size) yield* widgets(converted.hast)
  progress.reset()
  yield
  return {
    html: toHtml(converted.hast, { allowDangerousHtml: options.rawHtml }),
    blocks: [...blocks.values()].sort((a, b) => a.from - b.from || b.to - a.to),
    renderMs: performance.now() - converted.started,
    rendererVersion,
  }
}
