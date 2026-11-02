import type { Root } from 'mdast'
import { assertFragmentProof } from '../../core/src/fragment-proof'
import type { MarkdownFragment } from '../../core/src/markdown-fragment'
import type { PackedCapture } from '../../core/src/packing-capture'
import type { PackedPath } from '../../core/src/packing-view'
import type { SemanticDependencies } from '../../core/src/semantic-dependencies'
import { fragmentProjectionContext, type ProjectionLimits } from './fragment-projection-context'
import { type RenderOptions, rendererVersion } from './index'
import { projectWithHandlers } from './projection-engine'
import { measureProjectionLayout, type ProjectionLayout } from './projection-layout'

/** Local body plus a fully regenerated global footnote footer, under shared renderer policy. */
export function renderFragmentProjection(
  capture: PackedCapture,
  index: SemanticDependencies,
  fragment: MarkdownFragment,
  root: PackedPath,
  options: RenderOptions,
  limits: ProjectionLimits,
) {
  assertFragmentProof(index, fragment)
  index.assertBase(capture.identity, fragment.baseSource)
  if (
    fragment.source.identity.rendererVersion !== rendererVersion ||
    fragment.source.identity.options !== JSON.stringify(options)
  )
    throw new Error('Projection options/version mismatch; full rendering required')
  const context = fragmentProjectionContext(capture, root, index, fragment, limits)
  const fragmentWeight =
    fragment.retainedBytes - fragment.source.retainedBytes - fragment.baseSource.length * 2
  const stagingBytes = Math.max(
    context.stagingBytes,
    16384 + fragmentWeight * 6 + context.retainedBytes * 8,
  )
  if (stagingBytes > limits.staging) throw new Error('Fragment projection exceeds staging limit')
  const selected: Root = { type: 'root', children: [...fragment.children] }
  const input: Root = { type: 'root', children: [...fragment.children, ...context.contextNodes] }
  let layout: ProjectionLayout | undefined
  const projection = projectWithHandlers(
    input,
    options,
    undefined,
    (hast) => {
      layout = measureProjectionLayout(selected, hast, options)
    },
    context.handlers,
  )
  if (!layout || layout.htmlLength !== projection.html.length)
    throw new Error('Invalid fragment projection layout')
  const retainedBytes =
    2048 +
    projection.html.length * 2 +
    projection.blocks.reduce(
      (sum, block) => sum + 384 + (block.html.length + block.value.length) * 2,
      0,
    ) +
    layout.blocks.length * 192
  if (retainedBytes > limits.retained) throw new Error('Fragment projection exceeds retained limit')
  for (const block of projection.blocks) Object.freeze(block)
  Object.freeze(projection.blocks)
  Object.freeze(projection)
  return { projection, layout, retainedBytes, stagingBytes }
}
