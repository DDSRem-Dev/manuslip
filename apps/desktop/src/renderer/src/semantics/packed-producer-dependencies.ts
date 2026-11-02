import type { PackedCapture } from '../../../../../../packages/core/src/packing-capture'
import type { PackedHold } from '../../../../../../packages/core/src/packing-hold'
import type {
  PackedSession,
  PackedSessionLimits,
} from '../../../../../../packages/core/src/packing-session'
import type { PackedWork } from '../../../../../../packages/core/src/packing-work'
import { SemanticDependencies } from '../../../../../../packages/core/src/semantic-dependencies'

export interface ProducerDependencies {
  readonly index: SemanticDependencies
  readonly hold: PackedHold
}

/** Caller owns the borrowed capture. Metadata and scratch grow in the same session
 * before allocation; a completed immutable index receives an independent resource hold.
 */
export function buildProducerDependencies(
  owner: PackedSession,
  limits: PackedSessionLimits,
  capture: PackedCapture,
): PackedWork<ProducerDependencies> {
  const budget = { ...limits, nodes: 800000, depth: 64 }
  return capture.work(
    (function* () {
      const source = capture.sourceResource
      const workspace = capture.reserveWorkspace(4096, 0)
      let child: ReturnType<typeof SemanticDependencies.buildSteps> | undefined
      let retained = -1,
        staging = -1
      try {
        child = SemanticDependencies.buildSteps(
          capture,
          source.text,
          ['document', 'root'],
          budget,
          (bytes, scratch) => {
            const metadata = Math.max(1024, bytes - source.retainedBytes)
            if (metadata === retained && scratch === staging) return
            workspace.resize(4096 + metadata + scratch, scratch)
            retained = metadata
            staging = scratch
          },
        )
        const index = yield* child
        if (!index) throw new Error('Incomplete producer dependencies')
        // Synchronous transfer: the source is already owned, metadata becomes an exact
        // resource union before any yield or subsequent native work can occur.
        workspace.release()
        const hold = owner.retain(index)
        return Object.freeze({ index, hold })
      } finally {
        try {
          child?.return()
        } finally {
          workspace.release()
        }
      }
    })(),
  )
}
