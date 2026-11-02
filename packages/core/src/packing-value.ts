import type { PackedHold } from './packing-hold'

/** Independently admitted native output. Capture closure does not end this lifetime.
 * Trusted consumers must drop borrowed values or retain an independent handle before
 * release, and end every raw borrow before session disposal;
 * ordinary native objects cannot be revoked once a consumer retains them separately.
 * A closed handle retains neither its native value nor the session accounting callback.
 */
export class PackedValue<T extends object> {
  #value: T | undefined
  #hold: PackedHold | undefined
  #fork: ((value: T) => PackedValue<T>) | undefined
  readonly #owner: object
  constructor(value: T, hold: PackedHold, owner: object, fork: (value: T) => PackedValue<T>) {
    this.#value = value
    this.#hold = hold
    this.#owner = owner
    this.#fork = fork
    Object.freeze(this)
  }
  sameOwner<U extends object>(other: PackedValue<U>): boolean {
    this.value
    other.value
    return this.#owner === other.#owner
  }
  get value(): T {
    if (!this.#value) throw new Error('Packed value released')
    return this.#value
  }
  /** An independent hold on the same admitted value. Resource bytes are shared;
   * handle metadata and hold limits still apply, and failure leaves this handle open.
   */
  retain(): PackedValue<T> {
    const value = this.value
    if (!this.#fork) throw new Error('Packed value released')
    return this.#fork(value)
  }
  release(): void {
    this.#value = undefined
    this.#fork = undefined
    const hold = this.#hold
    this.#hold = undefined
    hold?.release()
  }
}
