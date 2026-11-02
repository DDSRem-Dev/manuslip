import type { PositionCoordinates } from './packing-positions'
import type { PackedRecordKey } from './packing-record-key'

/** One validated immutable record, with no arena, buffer, view or owner backlink.
 * References are read through the original revocable scope. Lazy transforms use
 * ordinary readers instead; record numbers never authorize semantic acceptance.
 */
export interface PackedEncodedRecord extends PackedRecordKey {
  readonly tag: number
  readonly next: number
  readonly length: number
  readonly keys: readonly string[] | undefined
  readonly value: null | boolean | number | undefined
  readonly text: string | undefined
  readonly position: PositionCoordinates | undefined
}

export interface PackedEncodedReference {
  readonly reference: number
  readonly next: number
}
