import { messageSize, type Root } from '@manuslip/core'
import { rendererVersion } from '@manuslip/renderer'
import { unpackValue } from '../../../../../../packages/core/src/packing'
import { PackedSession } from '../../../../../../packages/core/src/packing-session'
import { PackedSource } from '../../../../../../packages/core/src/packing-source'
import { validatePackedRoot } from '../../../../../../packages/core/src/packing-validate-root'
import { finishPackedSteps } from '../../../../../../packages/core/src/packing-work'
import { type ReadingOperation, readingLimits, readingOperationBytes } from './protocol'

/** Native expansion comparator for decoder tests/diagnostics. Production packed reading
 * uses PackedReadingProcessor and never materializes this complete root. Validate the
 * complete source-bound mdast before expansion; admit decoder staging and input envelope.
 */
export function decodeReadingRoot(
  operation: Extract<ReadingOperation, { kind: 'prepare-packed' }>,
): {
  root: Root
  bytes: number
  sourceBytes: number
} {
  let owner: PackedSession | undefined
  try {
    if (readingOperationBytes(operation) > readingLimits.message)
      throw new Error('translation-view-limit')
    const inputBytes =
      operation.payload.byteLength + messageSize({ ...operation, payload: undefined }) * 2 + 65536
    const available = readingLimits.worker - inputBytes - readingLimits.message
    if (available < 256) throw new Error('translation-view-limit')
    if (operation.identity.rendererVersion !== rendererVersion)
      throw new Error('translation-view-worker')
    owner = new PackedSession({
      bytes: readingLimits.message,
      retained: available,
      staging: readingLimits.message,
      captures: 2,
      readers: 160,
    })
    const source = new PackedSource(operation.identity, operation.source)
    const ticket = owner.beginPrepared(source)
    // Arena admission consumes its buffer. Charge a separate validation copy before
    // allocation, then synchronously exchange its reservation for the arena's charge.
    const key = {}
    const reservation = owner.retain({
      resources: () => [{ key, bytes: operation.payload.byteLength + 256 }],
    })
    let copy: ArrayBuffer
    try {
      copy = operation.payload.slice(0)
    } finally {
      reservation.release()
    }
    const prepared = owner.prepareFull(ticket, source.identity, copy)
    const capture = owner.capturePrepared(prepared)
    finishPackedSteps(
      validatePackedRoot(capture, source, [], {
        retained: available,
        staging: readingLimits.message,
        nodes: 800000,
        depth: 128,
      }),
    )
    owner.dispose()
    owner = undefined
    const decoded = unpackValue(operation.payload, {
      bytes: readingLimits.message,
      retained: available,
      staging: readingLimits.message,
    })
    const payloadBytes = operation.payload.byteLength
    // The worker owns this input exclusively. Revoke the incoming allocation before
    // building a plan; no native AST, source or output is transferred away here.
    structuredClone(operation.payload, { transfer: [operation.payload] })
    return {
      root: decoded.value as Root,
      bytes: inputBytes - payloadBytes + decoded.retainedBytes,
      sourceBytes: operation.source.length * 2,
    }
  } catch (error) {
    if (error instanceof Error && /limit|exceeds/.test(error.message))
      throw new Error('translation-view-limit')
    throw new Error('translation-view-worker')
  } finally {
    owner?.dispose()
  }
}
