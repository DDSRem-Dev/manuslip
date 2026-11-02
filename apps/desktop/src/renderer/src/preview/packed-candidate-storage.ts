import type { PackedCapture } from '../../../../../../packages/core/src/packing-capture'
import type { PackedValue } from '../../../../../../packages/core/src/packing-value'

/** A fork retains the old immutable occurrence ranges until commit replaces them.
 * Controller and read-only leases share this reservation. An abandoned, uncommitted
 * fork stays charged through its last lease; commit ends the old-range lifetime for
 * every view at once. This does not change the source/descriptor admission weights.
 */
export class PackedCandidateStorage {
  #references = 1
  #value: PackedValue<{ readonly bytes: number }> | undefined
  constructor(capture: PackedCapture, bytes: number) {
    this.#value = capture.own(Object.freeze({ bytes }), bytes)
  }
  get bytes(): number {
    return this.#value?.value.bytes ?? 0
  }
  retain(): PackedCandidateStorage {
    if (!this.#references) throw new Error('Packed candidate storage released')
    // If the session has disposed an uncommitted reservation, it cannot be borrowed.
    if (this.#value) this.#value.value
    this.#references++
    return this
  }
  commit(): void {
    const value = this.#value
    this.#value = undefined
    value?.release()
  }
  release(): void {
    if (!this.#references) throw new Error('Packed candidate storage released')
    if (--this.#references === 0) this.commit()
  }
}
