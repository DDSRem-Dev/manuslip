import { semanticLimits } from './contracts'
import type { PackedCapture } from './packing-capture'
import type { PackedSerializedValue } from './packing-serialize'
import type { PackedValue } from './packing-value'
import type { PackedView } from './packing-view'

/** Copy already validated wire bytes. This preserves all records, including unreachable
 * ones; selected values and overlays must use the measured serializer instead.
 */
export function* copyPackedEncoding(
  capture: PackedCapture,
  view: PackedView,
  byteLimit: number,
): Generator<void, PackedValue<PackedSerializedValue>, undefined> {
  if (!Number.isSafeInteger(byteLimit) || byteLimit < 4 || byteLimit > semanticLimits.messageBytes)
    throw new Error('Invalid packed copy byte limit')
  const encoding = view.encoding()
  if (!encoding || encoding.bytes > byteLimit)
    throw new Error('Packed encoding exceeds copy limit or is unavailable')
  const workspace = capture.workspace(4096, 4096)
  let owned: PackedValue<PackedSerializedValue> | undefined
  let delivered = false
  try {
    const allocation = capture.workspace(encoding.bytes + 256, 0)
    let payload: ArrayBuffer
    try {
      payload = new ArrayBuffer(encoding.bytes)
    } finally {
      allocation.release()
    }
    owned = capture.own<PackedSerializedValue>(
      Object.freeze({ payload, records: encoding.records, workspaceBytes: 4096 }),
      encoding.bytes + 256,
    )
    yield
    yield* view.copyEncoding(payload)
    delivered = true
    return owned
  } finally {
    if (!delivered) owned?.release()
    workspace.release()
  }
}
