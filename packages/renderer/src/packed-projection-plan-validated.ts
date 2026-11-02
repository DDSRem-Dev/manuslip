import type { PackedCapture } from '../../core/src/packing-capture'
import { finishPackedCleanup } from '../../core/src/packing-cleanup'
import type { PackedSource } from '../../core/src/packing-source'
import { packedDocumentSteps } from '../../core/src/packing-validate-document'
import type { PackedPath } from '../../core/src/packing-view'
import type { PackedWork } from '../../core/src/packing-work'
import {
  type CollectedProjectionContext,
  collectProjectionContext,
  isCollectedProjectionCapacityError,
} from './collected-projection-context'
import type { ProjectionLimits } from './fragment-projection-context'
import type { RenderOptions } from './index'
import { createPackedProjectionPlan, type PackedProjectionPlan } from './packed-projection-plan'

/** Complete validation precedes rendering, including exact descriptions and counts.
 * Collection capacity failure releases the journal before the independent fallback.
 * This plan changes private construction only; the complete final packet is unchanged.
 */
export function prepareValidatedPackedProjectionPlan(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  options: RenderOptions,
  limits: ProjectionLimits,
): PackedWork<PackedProjectionPlan> {
  capture.reader.at(root)
  if (root.length > 64 || root.at(-1) !== 'root')
    throw new Error('Invalid validated projection path')
  const path = [...root],
    render = { ...options },
    budget = { ...limits }
  let output: PackedProjectionPlan | undefined
  let delivered = false
  function* prepare(collected?: CollectedProjectionContext): Generator<void> {
    const work = createPackedProjectionPlan(capture, source, path, render, budget, collected)
    let failed = false
    try {
      output = yield* work.steps
    } catch (error) {
      failed = true
      throw error
    } finally {
      finishPackedCleanup([work.close], failed)
    }
  }
  return capture.work(
    (function* () {
      let failed = false
      try {
        try {
          yield* collectProjectionContext(capture, source, path, budget, prepare)
        } catch (error) {
          output?.close()
          output = undefined
          if (!isCollectedProjectionCapacityError(error)) throw error
          yield* packedDocumentSteps(capture, source, path.slice(0, -1), budget)
          yield* prepare()
        }
        if (!output) throw new Error('Incomplete validated projection plan')
        capture.identity
        delivered = true
        return output
      } catch (error) {
        failed = true
        throw error
      } finally {
        finishPackedCleanup(
          [
            () => {
              if (!delivered) output?.close()
            },
          ],
          failed,
        )
        output = undefined
      }
    })(),
  )
}
