import { semanticLimits } from '../../core/src/contracts'
import type { PackedCapture } from '../../core/src/packing-capture'
import {
  copyPackedNative,
  measurePackedNative,
  type PackedNativePlan,
} from '../../core/src/packing-native-copy'
import type { PackedRecordKey } from '../../core/src/packing-record-key'
import { type PackedSource, sameIdentity } from '../../core/src/packing-source'
import { packedTextStepCost } from '../../core/src/packing-text-stream'
import { invalidPackedSemantic } from '../../core/src/packing-validation-read'
import type { PackedPath } from '../../core/src/packing-view'
import { PackedWordBuffer } from '../../core/src/packing-word-buffer'
import type { PackedWork } from '../../core/src/packing-work'
import { readingBudgets } from '../../core/src/reading-limits'
import type { CollectedProjectionContext } from './collected-projection-context'
import type { ProjectionLimits } from './fragment-projection-context'
import {
  type PackedProjectionPrune,
  type ProjectionContextWalk,
  packedProjectionDefinitions,
} from './packed-projection-definitions'
import type { ProjectionDefinition } from './projection-sequence'

export interface PackedProjectionContextCost {
  readonly recordKeys: readonly (PackedRecordKey | undefined)[]
  readonly retainedBytes: number
  readonly stagingBytes: number
  readonly nativeBytes: number
  readonly nodes: number
  readonly definitions: number
  readonly bodyReferences: number
  readonly bodyReferenceUnits: number
}

/** Capture-owned transient native definition context, including complete footnote bodies.
 * One document walk admits each complete definition before copying it. Earlier private
 * copies remain charged while later definitions are measured. The trusted inspector
 * may suspend; context ownership remains charged throughout. Native values/sequences must
 * not escape that inspector without separate ownership. Compose full root schema first.
 * A trusted prune hook may reuse proved definition/footnote absence, with the full logical
 * subtree node/depth costs. It never replaces document/schema/source validation.
 */
export function inspectPackedProjectionContext(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  limits: ProjectionLimits,
  inspect: (
    context: readonly ProjectionDefinition[],
    cost: PackedProjectionContextCost,
  ) => Generator<void>,
  prune?: PackedProjectionPrune,
): PackedWork<void> {
  return capture.work(packedProjectionContextSteps(capture, source, root, limits, inspect, prune))
}

/** Internal composition under an enclosing capture-owned work item. Keep the complete
 * guarded context lifetime in its delegation chain instead of registering a child handle.
 */
export function packedProjectionContextSteps(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  limits: ProjectionLimits,
  inspect: (
    context: readonly ProjectionDefinition[],
    cost: PackedProjectionContextCost,
  ) => Generator<void>,
  prune?: PackedProjectionPrune,
  collected?: CollectedProjectionContext,
): Generator<void> {
  capture.reader.at(root)
  if (root.length > 64 || typeof inspect !== 'function')
    throw new Error('Invalid packed projection context request')
  if (collected) return collected.borrow(capture, source, root, limits, inspect)
  const work = contextSteps(capture, source, [...root], { ...limits }, inspect, prune)
  return (function* () {
    try {
      while (true) {
        capture.identity
        const next = work.next()
        capture.identity
        if (next.done) return
        yield
      }
    } finally {
      work.return(undefined)
    }
  })()
}

function* contextSteps(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  limits: ProjectionLimits,
  inspect: (
    context: readonly ProjectionDefinition[],
    cost: PackedProjectionContextCost,
  ) => Generator<void>,
  prune?: PackedProjectionPrune,
): Generator<void> {
  for (const key of ['retained', 'staging', 'nodes', 'depth'] as const)
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0)
      throw new Error('Invalid packed projection context limits')
  if (
    limits.retained > semanticLimits.rendererBytes ||
    limits.staging > readingBudgets.workspace ||
    limits.nodes > semanticLimits.blocks * 16 ||
    limits.depth < 1 ||
    limits.depth > 128
  )
    throw new Error('Invalid packed projection context limits')
  if (capture.sourceResource !== source || !sameIdentity(capture.identity, source.identity))
    invalidPackedSemantic()
  const nativeDepth = Math.min(512, limits.depth * 4 + 16)
  const fixed = 16384 + (nativeDepth + limits.depth) * 1024
  const plan: PackedNativePlan = { retained: 0, longest: 0, nodes: 0 }
  const walk: ProjectionContextWalk = { nodes: 0, definitions: 0, references: 0, referenceUnits: 0 }
  const bytes = () =>
    fixed +
    plan.retained +
    64 +
    walk.definitions * 640 +
    (plan.longest ? PackedWordBuffer.collectionBytes(plan.longest, plan.longest + 1) : 0)
  const admit = () => {
    const stream = plan.longest ? packedTextStepCost : { retained: 0, workspace: 0 }
    if (
      bytes() + stream.retained + stream.workspace + (nativeDepth + limits.depth + 12) * 512 >
        limits.retained ||
      bytes() + stream.workspace > limits.staging
    )
      throw new Error('Packed projection context exceeds workspace limit')
    if (plan.nodes + walk.nodes > limits.nodes || walk.definitions > semanticLimits.blocks)
      throw new Error('Packed projection context node limit')
  }
  admit()
  const workspace = capture.reserveWorkspace(fixed, fixed)
  const context: ProjectionDefinition[] = []
  const recordKeys: (PackedRecordKey | undefined)[] = []
  try {
    const selected = capture.reader.at(root)
    for (const node of packedProjectionDefinitions(selected, limits, walk, prune)) {
      if (node !== undefined) {
        yield* measurePackedNative(node, { nodes: limits.nodes, depth: nativeDepth }, plan, admit)
        // The selected item stays borrowed until its complete copy finishes. Admit all
        // native values/collector scratch for this definition before allocating any of it;
        // previous copies and their metadata stay included in the same reservation.
        const reservation = bytes()
        workspace.resize(reservation, reservation)
        yield
        recordKeys.push(node.recordKey())
        context.push((yield* copyPackedNative(node)) as ProjectionDefinition)
      }
      admit()
      yield
    }
    const reservation = bytes()
    workspace.resize(reservation, reservation)
    yield
    yield* inspect(
      Object.freeze(context),
      Object.freeze({
        recordKeys: Object.freeze(recordKeys),
        retainedBytes: reservation,
        stagingBytes: reservation,
        nativeBytes: plan.retained,
        nodes: plan.nodes + walk.nodes,
        definitions: walk.definitions,
        bodyReferences: walk.references,
        bodyReferenceUnits: walk.referenceUnits,
      }),
    )
  } finally {
    workspace.release()
  }
}
