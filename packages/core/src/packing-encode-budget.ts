/** Explicit construction weights, not measured heap bytes or a portable physical bound.
 * Caller-owned stable input remains separately admitted. Live construction tables, frames
 * and transient native spellings are admitted separately; completed scratch is released.
 */
export interface PackedEncodingLimits {
  working: number
  nodes: number
  depth: number
}

export class PackedEncodingBudget {
  readonly #limits: PackedEncodingLimits
  #working = 0
  #nodes = 0
  constructor(limits: PackedEncodingLimits) {
    const copied = { working: limits.working, nodes: limits.nodes, depth: limits.depth }
    for (const value of Object.values(copied))
      if (!Number.isSafeInteger(value) || value < 0)
        throw new Error('Invalid packed encoding limits')
    this.#limits = Object.freeze(copied)
  }
  charge(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.#limits.working - this.#working)
      throw new Error('Packed encoding exceeds working limit')
    this.#working += bytes
  }
  release(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.#working)
      throw new Error('Invalid packed encoding release')
    this.#working -= bytes
  }
  frame(depth: number): void {
    if (++this.#nodes > this.#limits.nodes || depth > this.#limits.depth)
      throw new Error('Packed encoding exceeds node/depth limit')
    this.charge(192)
  }
  /** Enumeration itself is native/atomic. Admit the complete returned key list before
   * filtering, copying child values or constructing a JSON shape key.
   */
  keys(keys: readonly string[]): number {
    let bytes = 192
    for (const key of keys) bytes += 128 + key.length * 16
    this.charge(bytes)
    return bytes
  }
}
