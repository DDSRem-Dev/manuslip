import type {
  PackedCapture,
  PackedItemSteps,
  PackedReadScope,
} from '../../core/src/packing-capture'
import type {
  PackedDocumentBaseline,
  PackedDocumentContextSubtree,
} from '../../core/src/packing-document-baseline'
import type { PackedSource } from '../../core/src/packing-source'
import { invalidPackedSemantic, packedSmall } from '../../core/src/packing-validation-read'
import type { PackedPath } from '../../core/src/packing-view'
import type { ProjectionLimits } from './fragment-projection-context'

export interface ProjectionContextWalk {
  nodes: number
  definitions: number
  references: number
  referenceUnits: number
}
export interface PackedProjectionSubtree {
  readonly nodes: number
  readonly depth: number
}
/** Trusted internal proof that this exact immutable subtree contains no definitions or
 * footnote calls. Only a sealed validated baseline supplies this to snapshot validation.
 */
export type PackedProjectionPrune = (node: PackedReadScope) => PackedProjectionSubtree | undefined
export type PackedDocumentContextPrune = (
  node: PackedReadScope,
) => PackedDocumentContextSubtree | undefined

/** Borrow absence metadata only after exact document validation provenance matches. The
 * callback retains the revocable handle, never its map; closing it restores full walks.
 */
export function packedDocumentContextPrune(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  limits: ProjectionLimits,
  baseline?: PackedDocumentBaseline,
): PackedDocumentContextPrune | undefined {
  if (
    root.at(-1) !== 'root' ||
    !baseline?.validatesDocument(capture, source, root.slice(0, -1), limits)
  )
    return undefined
  return (node) => baseline.contextFree(node)
}

/** Outermost definition/footnote roots in parser preorder. Whole copied footnotes retain
 * definitions nested in their bodies; descend into ordinary containers, never duplicate
 * a nested definition already owned by a selected footnote subtree. Geometry/schema of
 * complete selected subtrees is checked by the composed document validator.
 */
export function* packedProjectionDefinitions(
  root: PackedReadScope,
  limits: Pick<ProjectionLimits, 'nodes' | 'depth'>,
  walk: ProjectionContextWalk,
  prune?: PackedProjectionPrune,
): Generator<PackedReadScope | undefined> {
  const frames: PackedItemSteps[] = []
  const visit = (node: PackedReadScope): PackedReadScope | undefined => {
    if (++walk.nodes > limits.nodes || frames.length + 1 > limits.depth)
      throw new Error('Packed projection context traversal limit')
    // Exact sealed absence metadata already checked this record's shape/type. Preserve
    // complete logical bounds here; new records and definitions still take the full walk.
    const skipped = prune?.(node)
    if (skipped) {
      if (
        !Number.isSafeInteger(skipped.nodes) ||
        skipped.nodes < 1 ||
        !Number.isSafeInteger(skipped.depth) ||
        skipped.depth < 1 ||
        frames.length + skipped.depth > limits.depth
      )
        throw new Error('Packed projection context traversal limit')
      walk.nodes += skipped.nodes - 1
      if (walk.nodes > limits.nodes) throw new Error('Packed projection context traversal limit')
      return undefined
    }
    if (node.kind() !== 'object' || node.keyCount() > 10) invalidPackedSemantic()
    const type = packedSmall(node, ['type'])
    if (typeof type !== 'string') invalidPackedSemantic()
    if (type === 'definition' || type === 'footnoteDefinition') {
      walk.definitions++
      return node
    }
    if (type === 'footnoteReference') {
      walk.references++
      walk.referenceUnits += node.textLength(['identifier'])
    }
    if (node.hasField('children')) frames.push(node.elementSteps(['children']))
    return undefined
  }
  try {
    if (packedSmall(root, ['type']) !== 'root') invalidPackedSemantic()
    yield visit(root)
    while (frames.length) {
      const frame = frames.at(-1)
      if (!frame) throw new Error('Missing packed context frame')
      const step = frame.next()
      if (step.done) {
        frames.pop()
        yield undefined
      } else yield step.value === undefined ? undefined : visit(step.value)
    }
  } finally {
    for (const frame of frames) frame.return()
  }
}
