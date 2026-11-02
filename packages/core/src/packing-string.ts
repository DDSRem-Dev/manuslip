/** Shared JSON-string lexical state for bounded counting and chunked materialization. */
export class PackedStringScanner {
  length = 0
  #state: 'before' | 'text' | 'after' = 'before'
  #pending = ''
  /** The reader supplies one bounded UTF-8 batch. Only an incomplete JSON escape (at most
   * five units) crosses batches; native decoding never receives an unbounded string.
   */
  consume(chunk: string, materialize = false): string | undefined {
    const text = this.#pending ? this.#pending + chunk : chunk
    this.#pending = ''
    let index = 0
    if (this.#state === 'before') {
      while (index < text.length && whitespace(text.charCodeAt(index))) index++
      if (index === text.length) return
      if (text.charCodeAt(index++) !== 34) throw new Error('Invalid packed string')
      this.#state = 'text'
    }
    const start = index
    let end = index
    let escaped = false
    if (this.#state === 'text') {
      // biome-ignore lint/suspicious/noControlCharactersInRegex: JSON forbids every unescaped unit below U+0020.
      const special = /["\\\u0000-\u001f]/g
      while (index < text.length) {
        special.lastIndex = index
        const next = special.exec(text)?.index ?? text.length
        this.length += next - index
        index = next
        end = index
        if (index === text.length) break
        const unit = text.charCodeAt(index)
        if (unit === 34) {
          this.#state = 'after'
          index++
          break
        }
        if (unit !== 92) throw new Error('Invalid packed string')
        escaped = true
        if (index + 1 === text.length) {
          this.#pending = text.slice(index)
          break
        }
        if (text.charCodeAt(index + 1) === 117) {
          const limit = Math.min(index + 6, text.length)
          for (let at = index + 2; at < limit; at++) {
            const digit = text.charCodeAt(at)
            if (
              !(digit >= 48 && digit <= 57) &&
              !(digit >= 65 && digit <= 70) &&
              !(digit >= 97 && digit <= 102)
            )
              throw new Error('Invalid packed Unicode escape')
          }
          if (limit < index + 6) {
            this.#pending = text.slice(index)
            break
          }
          index += 6
        } else {
          if (!'"\\/bfnrt'.includes(text[index + 1] ?? '')) throw new Error('Invalid packed escape')
          index += 2
        }
        this.length++
        end = index
      }
    }
    if (this.#state === 'after')
      while (index < text.length)
        if (!whitespace(text.charCodeAt(index++))) throw new Error('Invalid packed string')
    if (!materialize || end === start) return
    const raw = text.slice(start, end)
    // Literal runs already have their exact UTF-16 spelling. Escaped runs use one native
    // parse of the completed fragment, preserving lone surrogates without per-unit copying.
    return escaped ? (JSON.parse(`"${raw}"`) as string) : raw
  }
  complete(): void {
    if (this.#state !== 'after' || this.#pending) throw new Error('Invalid packed string')
  }
}

function whitespace(unit: number): boolean {
  return unit === 32 || unit === 9 || unit === 13 || unit === 10
}

// One UTF-8 byte chunk may finish a preceding supplementary code point (two UTF-16 units).
export const packedStringChunkUnits = 4098
export const packedStringWorkspace = 65536 + 512
