import type { PackedTextSteps } from '../../core/src/packing-capture'
import { invalidPackedSemantic } from '../../core/src/packing-validation-read'

/** Forward-only validation cursor. Keeps one admitted decoder chunk; never joins HTML. */
export class PackedHtmlCursor {
  readonly #stream: PackedTextSteps
  #chunk = ''
  #offset = 0
  #at = 0
  constructor(stream: PackedTextSteps) {
    this.#stream = stream
  }
  get position(): number {
    return this.#at
  }
  /** Compare two admitted forward cursors without making a substring or joining chunks. */
  *equalCursor(other: PackedHtmlCursor, length: number): Generator<void> {
    if (other === this || !Number.isSafeInteger(length) || length < 0) invalidPackedSemantic()
    let remaining = length
    while (remaining) {
      if (this.#offset === this.#chunk.length || other.#offset === other.#chunk.length) {
        const cursor = this.#offset === this.#chunk.length ? this : other
        const next = cursor.#stream.next()
        if (next.done) invalidPackedSemantic()
        cursor.#chunk = next.value ?? ''
        cursor.#offset = 0
        yield
      } else {
        const take = Math.min(
          remaining,
          this.#chunk.length - this.#offset,
          other.#chunk.length - other.#offset,
        )
        for (let index = 0; index < take; index++)
          if (
            this.#chunk.charCodeAt(this.#offset + index) !==
            other.#chunk.charCodeAt(other.#offset + index)
          )
            invalidPackedSemantic()
        this.#offset += take
        other.#offset += take
        this.#at += take
        other.#at += take
        remaining -= take
        yield
      }
    }
  }
  /** Compare exact UTF-16 without joining or slicing the packed/native strings. The
   * caller owns the native value throughout suspension; each comparison is <=4098 units.
   */
  *equal(value: string): Generator<void> {
    let at = 0
    while (at < value.length) {
      if (this.#offset === this.#chunk.length) {
        const next = this.#stream.next()
        if (next.done) invalidPackedSemantic()
        this.#chunk = next.value ?? ''
        this.#offset = 0
        yield
      } else {
        const take = Math.min(value.length - at, this.#chunk.length - this.#offset)
        for (let index = 0; index < take; index++)
          if (value.charCodeAt(at + index) !== this.#chunk.charCodeAt(this.#offset + index))
            invalidPackedSemantic()
        this.#offset += take
        this.#at += take
        at += take
        yield
      }
    }
  }
  *skip(to: number): Generator<void> {
    if (!Number.isSafeInteger(to) || to < this.#at) invalidPackedSemantic()
    while (this.#at < to) {
      if (this.#offset === this.#chunk.length) {
        const next = this.#stream.next()
        if (next.done) invalidPackedSemantic()
        this.#chunk = next.value ?? ''
        this.#offset = 0
        yield
      } else {
        const take = Math.min(to - this.#at, this.#chunk.length - this.#offset)
        this.#offset += take
        this.#at += take
        yield
      }
    }
  }
  *newline(at: number): Generator<void> {
    yield* this.skip(at)
    while (this.#offset === this.#chunk.length) {
      const next = this.#stream.next()
      if (next.done) invalidPackedSemantic()
      this.#chunk = next.value ?? ''
      this.#offset = 0
      yield
    }
    if (this.#chunk[this.#offset] !== '\n') invalidPackedSemantic()
    this.#offset++
    this.#at++
    yield
  }
  *finish(length: number): Generator<void> {
    yield* this.skip(length)
    if (this.#offset !== this.#chunk.length) invalidPackedSemantic()
    while (true) {
      const next = this.#stream.next()
      if (next.done) return
      if (next.value !== undefined) invalidPackedSemantic()
      yield
    }
  }
  close(): void {
    this.#chunk = ''
    this.#offset = 0
    this.#stream.return()
  }
}
