/**
 * Internal accounting handle for independently owned derived data. Release only after all
 * uses of that data end (or its ownership transfers to a separately admitted owner). This
 * handle does not revoke native output values. A released handle never retains its owner.
 */
export class PackedHold {
  #close: (() => void) | null
  constructor(close: () => void) {
    this.#close = close
    Object.freeze(this)
  }
  release(): void {
    const close = this.#close
    this.#close = null
    close?.()
  }
}
