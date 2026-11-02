import type { PackedCapture } from '../../core/src/packing-capture'
import { finishPackedCleanup } from '../../core/src/packing-cleanup'
import type { PackedEncodingLimits } from '../../core/src/packing-encode-budget'
import type { PackedSource } from '../../core/src/packing-source'
import { packedDocumentSteps } from '../../core/src/packing-validate-document'
import type { PackedValue } from '../../core/src/packing-value'
import type { PackedPath } from '../../core/src/packing-view'
import type { PackedWork } from '../../core/src/packing-work'
import {
  type CollectedProjectionContext,
  collectProjectionContext,
  isCollectedProjectionCapacityError,
} from './collected-projection-context'
import type { ProjectionLimits } from './fragment-projection-context'
import type { RenderOptions } from './index'
import {
  createPackedProjectionEncoding,
  type PackedProjectionEncoding,
} from './packed-projection-encode'

/** Complete document validation and projection encoding under one capture-owned task.
 * The root validator also collects global renderer context. Capacity failure discards
 * the collection before retrying the original independent validation and context walk.
 * Rendering starts only after all document, description and exact word checks pass.
 */
export function encodeValidatedPackedProjectionSteps(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  options: RenderOptions,
  limits: ProjectionLimits,
  encoding: PackedEncodingLimits,
  byteLimit: number,
): PackedWork<PackedValue<PackedProjectionEncoding>> {
  capture.reader.at(root)
  if (root.length > 64 || root.at(-1) !== 'root')
    throw new Error('Invalid validated projection path')
  const path = [...root],
    render = { ...options },
    budget = { ...limits },
    encodedBudget = { ...encoding }
  let output: PackedValue<PackedProjectionEncoding> | undefined
  let delivered = false
  function* encode(collected?: CollectedProjectionContext): Generator<void> {
    const work = createPackedProjectionEncoding(
      capture,
      source,
      path,
      render,
      budget,
      encodedBudget,
      byteLimit,
      collected,
    )
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
          yield* collectProjectionContext(capture, source, path, budget, encode)
        } catch (error) {
          output?.release()
          output = undefined
          if (!isCollectedProjectionCapacityError(error)) throw error
          yield* packedDocumentSteps(capture, source, path.slice(0, -1), budget)
          yield* encode()
        }
        if (!output) throw new Error('Incomplete validated projection encoding')
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
              if (!delivered) output?.release()
            },
          ],
          failed,
        )
        output = undefined
      }
    })(),
  )
}
