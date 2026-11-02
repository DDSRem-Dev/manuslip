/** Exact-size output, or the same byte-counting pass without an allocation. */
export class PackedOutput {
  #used = 0
  readonly #view: Uint8Array | undefined
  readonly #numbers: DataView | undefined
  constructor(
    readonly limit: number,
    buffer?: ArrayBuffer,
  ) {
    if (buffer) {
      if (buffer.byteLength !== limit) throw new Error('Invalid packed output buffer')
      this.#view = new Uint8Array(buffer)
      this.#numbers = new DataView(buffer)
    }
  }
  get length() {
    return this.#used
  }
  get writing() {
    return this.#view !== undefined
  }
  skip(length: number): number {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.limit - this.#used)
      throw new Error('Packed serialization exceeds byte limit')
    const start = this.#used
    this.#used += length
    return start
  }
  byte(value: number): void {
    const start = this.skip(1)
    if (this.#view) this.#view[start] = value
  }
  bytes(value: Uint8Array): void {
    const start = this.skip(value.length)
    this.#view?.set(value, start)
  }
  uint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
      throw new Error('Invalid packed integer')
    do {
      const rest = Math.floor(value / 128)
      this.byte((value % 128) | (rest ? 128 : 0))
      value = rest
    } while (value)
  }
  number(value: number): void {
    const start = this.skip(8)
    this.#numbers?.setFloat64(start, value, true)
  }
  string(value: string): void {
    const bytes = new TextEncoder().encode(JSON.stringify(value))
    this.uint(bytes.length)
    this.bytes(bytes)
  }
}
