import type { PackedCapture, PackedReadScope } from './packing-capture'
import type { PackedHold } from './packing-hold'
import { copyPackedNative, measurePackedNative, type PackedNativePlan } from './packing-native-copy'
import { packedTextStepCost } from './packing-text-stream'
import { PackedWordBuffer } from './packing-word-buffer'
import type { PackedWork } from './packing-work'

export interface PackedNativeLimits {
  retained: number
  staging: number
  nodes: number
  depth: number
}
export interface PackedNativeCost {
  retainedBytes: number
  stagingBytes: number
  /** Copy/collector reservation before decoder scratch, released before inspection. */
  copyStagingBytes: number
  nodes: number
}
/** Transient immutable native copy, owned through a cooperative inspector's entire lifetime.
 * Preflight precedes allocation, strings and array-prefix scans yield, and no native output
 * may escape the trusted inspector without separate ownership. This is not an export API.
 */
export function inspectPackedNative(
  capture: PackedCapture,
  scope: PackedReadScope,
  limits: PackedNativeLimits,
  inspect: (value: unknown, cost: Readonly<PackedNativeCost>) => Generator<void>,
): PackedWork<void> {
  scope.kind()
  if (typeof inspect !== 'function') throw new Error('Invalid packed native inspector')
  return capture.work(
    guardSteps(capture, scope, inspectSteps(capture, scope, { ...limits }, inspect)),
  )
}

function* guardSteps(
  capture: PackedCapture,
  scope: PackedReadScope,
  steps: Generator<void>,
): Generator<void> {
  try {
    while (true) {
      capture.identity
      scope.assertOpen()
      const next = steps.next()
      capture.identity
      scope.assertOpen()
      if (next.done) return
      yield
    }
  } finally {
    steps.return(undefined)
  }
}

function* inspectSteps(
  capture: PackedCapture,
  scope: PackedReadScope,
  limits: PackedNativeLimits,
  inspect: (value: unknown, cost: Readonly<PackedNativeCost>) => Generator<void>,
): Generator<void> {
  for (const key of ['retained', 'staging', 'nodes', 'depth'] as const)
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0)
      throw new Error('Invalid packed native limits')
  if (limits.depth > 512) throw new Error('Invalid packed native limits')
  const fixed = 16384 + limits.depth * 1024
  const plan: PackedNativePlan = { retained: 0, longest: 0, nodes: 0 }
  const cost = () =>
    fixed +
    plan.retained +
    (plan.longest ? PackedWordBuffer.collectionBytes(plan.longest, plan.longest + 1) : 0)
  const admit = () => {
    const stream = plan.longest ? packedTextStepCost : { retained: 0, workspace: 0 }
    if (
      cost() + stream.retained + stream.workspace + (limits.depth + 8) * 512 > limits.retained ||
      cost() + stream.workspace > limits.staging
    )
      throw new Error('Packed native copy exceeds workspace limit')
  }
  admit()
  let workspace: PackedHold | undefined = capture.workspace(fixed, fixed)
  try {
    yield* measurePackedNative(scope, limits, plan, admit)
    const bytes = cost()
    workspace.release()
    workspace = undefined
    workspace = capture.workspace(bytes, bytes)
    yield
    const value = yield* copyPackedNative(scope)
    // Collector chunks and copy frames are gone. Keep only immutable output
    // and fixed inspector bookkeeping charged while downstream consumers suspend.
    workspace.release()
    workspace = undefined
    const inspectionBytes = 16384 + plan.retained
    workspace = capture.workspace(inspectionBytes, inspectionBytes)
    yield
    yield* inspect(
      value,
      Object.freeze({
        retainedBytes: plan.retained,
        stagingBytes: inspectionBytes,
        copyStagingBytes: bytes,
        nodes: plan.nodes,
      }),
    )
  } finally {
    workspace?.release()
  }
}
