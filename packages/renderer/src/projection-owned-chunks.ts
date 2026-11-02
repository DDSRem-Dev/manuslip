import type { Nodes as HastNode } from 'hast'
import type { ProjectionLimits } from './fragment-projection-context'
import type { RenderedBlock, RenderOptions } from './index'
import { bufferProjectionChunks } from './projection-chunk-buffer'
import { projectionHtmlChunks } from './projection-html-chunks'
import {
  prepareOwnedProjection,
  type ProjectionDescriptionAbsence,
} from './projection-owned-output'
import type { ProjectionConversion } from './projection-sequence'
import type { ProjectionSerializationPlan } from './projection-serialization-plan'
import { ProjectionTraversalBudget } from './projection-traversal-budget'
import type { ProjectionWorkspace } from './projection-workspace'

export type ProjectionChunkEvent =
  | { kind: 'begin'; index: number; footer: boolean; visible: boolean }
  | { kind: 'html' | 'widget-html'; value: string }
  | { kind: 'widget'; block: Omit<RenderedBlock, 'html'> }
  | { kind: 'widget-end' | 'end' }

/** Trusted transient inspector. Events contain admitted text/metadata, never a HAST,
 * generator or raw revision. Borrowed values end before the callback advances/returns.
 * The stream keeps the complete policy/description plan and last widget per source range,
 * matching native Map overwrite semantics without retaining intermediate widget HTML.
 */
export function* projectOwnedChunks(
  converted: ProjectionConversion,
  options: RenderOptions,
  limits: Pick<ProjectionLimits, 'nodes' | 'depth'>,
  workspace: ProjectionWorkspace,
  index: number,
  footer: boolean,
  inspect: (
    event: ProjectionChunkEvent,
    cost: Readonly<ProjectionSerializationPlan>,
  ) => Generator<void>,
  absence?: ProjectionDescriptionAbsence,
): Generator<void> {
  const { descriptions, cost } = yield* prepareOwnedProjection(
    converted,
    options,
    limits,
    workspace,
    absence,
  )
  workspace.set(cost.streamBytes)
  yield
  const widgets = new Map<string, HastNode>()
  const progress = new ProjectionTraversalBudget()
  function* collect(node: HastNode): Generator<void> {
    if (progress.step()) yield
    if ('children' in node) for (const child of node.children) yield* collect(child)
    const from = node.position?.start.offset
    const to = node.position?.end.offset
    if (from !== undefined && to !== undefined) {
      const key = `${from}:${to}`
      if (descriptions.has(key)) widgets.set(key, node)
    }
    if (progress.step()) yield
  }
  try {
    if (descriptions.size) yield* collect(converted.hast)
    yield* inspect({ kind: 'begin', index, footer, visible: converted.visible }, cost)
    for (const value of bufferProjectionChunks(
      projectionHtmlChunks(converted.hast, options, limits),
    )) {
      if (value === undefined) yield
      else {
        yield* inspect({ kind: 'html', value }, cost)
        yield
      }
    }
    for (const [key, node] of widgets) {
      const description = descriptions.get(key)
      const from = node.position?.start.offset
      const to = node.position?.end.offset
      if (!description || from === undefined || to === undefined)
        throw new Error('Missing projection stream widget')
      yield* inspect({ kind: 'widget', block: { ...description, from, to } }, cost)
      for (const value of bufferProjectionChunks(projectionHtmlChunks(node, options, limits))) {
        if (value === undefined) yield
        else {
          yield* inspect({ kind: 'widget-html', value }, cost)
          yield
        }
      }
      yield* inspect({ kind: 'widget-end' }, cost)
    }
    yield* inspect({ kind: 'end' }, cost)
  } finally {
    widgets.clear()
  }
}
