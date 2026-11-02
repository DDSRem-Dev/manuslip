const pieceLimit = 256
const chunkTarget = 4096
const chunkLimit = 4098

/** Caller admits prose/join/Intl workspace before constructing or growing this buffer.
 * Joins are bounded during collection; finish deliberately constructs one complete string.
 */
export class PackedWordBuffer {
  #expected: number
  readonly #chunks: string[] = []
  #pieces: string[] = []
  #pieceLength = 0
  #units = 0
  private constructor(expected: number) {
    this.#expected = expected
  }
  static create(expected: number): PackedWordBuffer {
    return new PackedWordBuffer(expected)
  }
  /** Increase the admitted total before appending the next complete text leaf. */
  grow(expected: number): void {
    if (!Number.isSafeInteger(expected) || expected < this.#expected)
      throw new Error('Invalid packed prose growth')
    this.#expected = expected
  }
  static bytes(units: number, texts: number, depth: number): number {
    // At collection/join: chunks + joined prose; at segmentation: prose + ICU copy +
    // largest segment. Drop chunk references before entering Intl. Account piece/chunk
    // metadata, bounded flush temporaries and traversal frames independently of streams.
    return (
      16384 +
      pieceLimit * 96 +
      (chunkTarget + chunkLimit) * 4 +
      depth * 1024 +
      units * 6 +
      (Math.ceil(units / chunkTarget) + Math.ceil((units ? texts * 2 : 0) / pieceLimit) + 1) * 96
    )
  }
  /** Collector scratch when the caller separately reserves the joined output.
   * Chunks coexist with that output during finish; no ICU/segment storage is needed.
   */
  static collectionBytes(units: number, pieces: number): number {
    return PackedWordBuffer.bytes(units, pieces, 0) - units * 4
  }
  append(value: string): void {
    if (value.length > chunkLimit || this.#units + value.length > this.#expected)
      throw new Error('Invalid packed prose chunk')
    if (!value.length) return
    this.#units += value.length
    this.#pieces.push(value)
    this.#pieceLength += value.length
    if (this.#pieceLength >= chunkTarget || this.#pieces.length >= pieceLimit) this.#flush()
  }
  #flush(): void {
    if (!this.#pieces.length) return
    this.#chunks.push(this.#pieces.join(''))
    this.#pieces = []
    this.#pieceLength = 0
  }
  finish(): string {
    if (this.#units !== this.#expected) throw new Error('Incomplete packed prose')
    this.#flush()
    const result = this.#chunks.join('')
    this.close()
    return result
  }
  /** Internal admitted immutable cache output. A chunk can include a final append past
   * the target; consumers split it into <=4098-unit inputs before collecting again.
   */
  finishChunks(): readonly string[] {
    if (this.#units !== this.#expected) throw new Error('Incomplete packed prose')
    this.#flush()
    const result = Object.freeze([...this.#chunks])
    this.close()
    return result
  }
  close(): void {
    this.#chunks.length = 0
    this.#pieces.length = 0
    this.#pieceLength = 0
  }
}
