import type { PackedCapture, PackedReadScope } from './packing-capture'
import { copyPackedNative } from './packing-native-copy'
import type { PackedNativeCost, PackedNativeLimits } from './packing-native-steps'
import { packedTextStepCost } from './packing-text-stream'
import { PackedWordBuffer } from './packing-word-buffer'
import type { PackedWork } from './packing-work'
import type { PackedWorkspace } from './packing-workspace'

/** Complete immutable native copy in one traversal. Every value is admitted before its
 * allocation; partial output stays private and revokes with the work. The inspector starts
 * only after the entire copy succeeds. Full preflight callers retain inspectPackedNative.
 */
export function inspectPackedNativeStream(
  capture: PackedCapture,
  scope: PackedReadScope,
  limits: PackedNativeLimits,
  inspect: (value: unknown, cost: Readonly<PackedNativeCost>) => Generator<void>,
  records = false,
): PackedWork<void> {
  return capture.work(packedNativeStreamSteps(capture, scope, limits, inspect, records))
}

/** Internal composition: the caller must own these steps in a capture-owned parent
 * work item. Parent cancellation closes this complete delegation chain; every native
 * allocation, scope/capture guard and inspector suspension retains its existing checks.
 */
export function packedNativeStreamSteps(
  capture: PackedCapture,
  scope: PackedReadScope,
  limits: PackedNativeLimits,
  inspect: (value: unknown, cost: Readonly<PackedNativeCost>) => Generator<void>,
  records = false,
): Generator<void> {
  scope.kind()
  if (typeof inspect !== 'function') throw new Error('Invalid packed native inspector')
  const budget = { ...limits }
  return guard(capture, scope, build(capture, scope, budget, inspect, records))
}

function* guard(capture: PackedCapture, scope: PackedReadScope, work: Generator<void>) {
  try {
    while (true) {
      capture.identity
      scope.assertOpen()
      const next = work.next()
      capture.identity
      scope.assertOpen()
      if (next.done) return
      yield
    }
  } finally {
    work.return(undefined)
  }
}

function resizeCopyWorkspace(workspace: PackedWorkspace, bytes: number, collector: number): void {
  if (collector > 0) {
    // Probe the live decoder and its reader slot before releasing that unused headroom.
    workspace.resize(
      bytes + packedTextStepCost.retained + packedTextStepCost.workspace + 512,
      bytes + packedTextStepCost.workspace,
    )
  }
  workspace.resize(bytes, bytes)
}

function* build(
  capture: PackedCapture,
  scope: PackedReadScope,
  limits: PackedNativeLimits,
  inspect: (value: unknown, cost: Readonly<PackedNativeCost>) => Generator<void>,
  records: boolean,
): Generator<void> {
  for (const key of ['retained', 'staging', 'nodes', 'depth'] as const)
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0)
      throw new Error('Invalid packed native limits')
  if (limits.depth > 512) throw new Error('Invalid packed native limits')
  const fixed = 16384 + limits.depth * 1024
  if (fixed + (limits.depth + 8) * 512 > limits.retained || fixed > limits.staging)
    throw new Error('Packed native copy exceeds workspace limit')
  const workspace = capture.reserveWorkspace(fixed, fixed)
  let reserved = fixed,
    peak = fixed,
    retained = 0,
    longest = 0,
    nodes = 0
  try {
    const value = yield* copyPackedNative(
      scope,
      undefined,
      (bytes, collector, depth) => {
        if (++nodes > limits.nodes || depth > limits.depth)
          throw new Error('Packed native node/depth limit')
        retained += bytes
        longest = Math.max(longest, collector)
        const needed =
          fixed + retained + (longest ? PackedWordBuffer.collectionBytes(longest, longest + 1) : 0)
        const streamRetained = longest ? packedTextStepCost.retained : 0
        const streamWorkspace = longest ? packedTextStepCost.workspace : 0
        const ceiling = Math.min(
          limits.retained - streamRetained - streamWorkspace - (limits.depth + 8) * 512,
          limits.staging - streamWorkspace,
        )
        if (needed > ceiling) throw new Error('Packed native copy exceeds workspace limit')
        if (needed > reserved || collector > 0) {
          // Amortize ledger updates without extra reader slots. Tight local/session budgets
          // can use the exact required bytes; a rejected growth leaves its old charge intact.
          const next = Math.min(Math.max(reserved, Math.ceil(needed / 65536) * 65536), ceiling)
          try {
            resizeCopyWorkspace(workspace, next, collector)
            reserved = next
          } catch (error) {
            if (next === needed) throw error
            resizeCopyWorkspace(workspace, needed, collector)
            reserved = needed
          }
          peak = Math.max(peak, reserved)
        }
      },
      records,
    )
    const inspection = 16384 + retained
    workspace.resize(inspection, inspection)
    yield
    yield* inspect(
      value,
      Object.freeze({
        retainedBytes: retained,
        stagingBytes: inspection,
        copyStagingBytes: peak,
        nodes,
      }),
    )
  } finally {
    workspace.release()
  }
}
