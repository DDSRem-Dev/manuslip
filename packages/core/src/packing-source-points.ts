import type { PackedSource } from './packing-source'

const stride = 256

function population(bits: number): number {
  let count = bits - ((bits >>> 1) & 0x55555555)
  count = (count & 0x33333333) + ((count >>> 2) & 0x33333333)
  return Math.imul((count + (count >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24
}

/** Temporary sparse line checkpoints with eight newline masks and compact rank/presence
 * data per checkpoint. Lookup examines at most two words; CRLF is one line ending
 * and columns count source code units, including tabs and lone surrogates.
 * Like the pinned micromark parser, coordinates exclude a single initial BOM.
 */
export class PackedSourcePoints {
  readonly #text: string
  readonly #base: number
  readonly #lines: Uint32Array
  readonly #starts: Uint32Array
  readonly #breaks: Uint32Array
  readonly #prefix: Uint8Array
  private constructor(
    text: string,
    lines: Uint32Array,
    starts: Uint32Array,
    breaks: Uint32Array,
    prefix: Uint8Array,
  ) {
    this.#text = text
    this.#base = text.charCodeAt(0) === 0xfeff ? 1 : 0
    this.#lines = lines
    this.#starts = starts
    this.#breaks = breaks
    this.#prefix = prefix
  }
  get length(): number {
    return this.#text.length - this.#base
  }
  static bytes(source: PackedSource): number {
    const length = source.text.length - (source.text.charCodeAt(0) === 0xfeff ? 1 : 0)
    // Admit the instance, four typed-array headers, checkpoints, masks and rank bytes
    // before construction. This extra index stays within the caller's original caps.
    return 512 + (Math.floor(length / stride) + 1) * 48
  }
  /** The caller reserves bytes(source) before starting, and owns the returned index scope. */
  static *build(source: PackedSource): Generator<void, PackedSourcePoints, undefined> {
    const text = source.text
    const base = text.charCodeAt(0) === 0xfeff ? 1 : 0
    const length = text.length - base
    const count = Math.floor(length / stride) + 1
    const lines = new Uint32Array(count)
    const starts = new Uint32Array(count)
    const breaks = new Uint32Array(count * 8)
    const prefix = new Uint8Array(count * 8)
    let line = 1
    let start = 0
    for (let offset = 0; offset <= length; offset++) {
      if (offset > 0) {
        const previous = text.charCodeAt(offset + base - 1)
        if (previous === 10 || (previous === 13 && text.charCodeAt(offset + base) !== 10)) {
          line++
          start = offset
          // A boundary at the checkpoint itself is already included in its line/start.
          if (offset % stride !== 0) {
            const word = Math.floor(offset / stride) * 8 + ((offset % stride) >>> 5)
            breaks[word] = (breaks[word] ?? 0) | (1 << (offset & 31))
          }
        }
      }
      if (offset % stride === 0) {
        lines[offset / stride] = line
        starts[offset / stride] = start
      }
      if (offset % 4096 === 4095) yield
    }
    for (let checkpoint = 0; checkpoint < count; checkpoint++) {
      const base = checkpoint * 8
      let rank = 0
      let present = 0
      for (let word = 0; word < 8; word++) {
        // A word has at most 224 preceding boundaries. The first word's rank is
        // always zero, so that byte instead records which of the eight masks exist.
        if (word > 0) prefix[base + word] = rank
        const bits = breaks[base + word] ?? 0
        if (bits !== 0) present |= 1 << word
        rank += population(bits)
      }
      prefix[base] = present
      if (checkpoint % 16 === 15) yield
    }
    return new PackedSourcePoints(text, lines, starts, breaks, prefix)
  }
  point(offset: number): { line: number; column: number } {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > this.length)
      throw new Error('Invalid semantic source offset')
    const checkpoint = Math.floor(offset / stride)
    let line = this.#lines[checkpoint]
    let start = this.#starts[checkpoint]
    if (line === undefined || start === undefined) throw new Error('Missing source checkpoint')
    const relative = offset % stride
    let word = relative >>> 5
    const base = checkpoint * 8
    const rank = word === 0 ? 0 : (this.#prefix[base + word] ?? 0)
    let bits = ((this.#breaks[base + word] ?? 0) & (0xffffffff >>> (31 - (relative & 31)))) >>> 0
    line += rank + population(bits)
    if (bits === 0) {
      const previous = (this.#prefix[base] ?? 0) & ((1 << word) - 1)
      if (previous !== 0) {
        word = 31 - Math.clz32(previous)
        bits = this.#breaks[base + word] ?? 0
      }
    }
    if (bits !== 0) start = checkpoint * stride + word * 32 + 31 - Math.clz32(bits)
    return { line, column: offset - start + 1 }
  }
}
