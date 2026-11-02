import { semanticLimits } from '@manuslip/core'
import type { ReadingBlock } from '@manuslip/renderer/reading'

const columns = 10
const controlBytes = 512
const kindWorkspaceBytes = 64 * 1024
const maximumInteger = 0xfffffffe
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const hash = /^(0|[1-9][0-9]*):([0-9a-f]{1,8}):([0-9a-f]{1,8})$/
function invalid(): never {
  throw new Error('translation-view-worker')
}
const integer = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0 && value <= maximumInteger

/** Worker-owned lossless block snapshot. UUID/hash words and ranges live in one typed
 * allocation; kind strings are interned. Public records are temporary and never retained.
 * The fixed workspace reservation covers the bounded kind table and construction index.
 */
export class CompactReadingBlocks {
  readonly #rows: Uint32Array
  readonly #kinds: string[] = []
  readonly bytes: number
  readonly count: number

  static reservation(count: number): number {
    if (!Number.isSafeInteger(count) || count < 0 || count > semanticLimits.blocks + 1)
      throw new Error('translation-view-limit')
    return controlBytes + kindWorkspaceBytes + count * columns * Uint32Array.BYTES_PER_ELEMENT
  }

  constructor(blocks: readonly ReadingBlock[], available: number) {
    this.count = blocks.length
    this.bytes = CompactReadingBlocks.reservation(this.count)
    if (!Number.isSafeInteger(available) || available < this.bytes)
      throw new Error('translation-view-limit')
    this.#rows = new Uint32Array(this.count * columns)
    const kinds = new Map<string, number>()
    let kindBytes = 0
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index]
      if (
        !block ||
        !uuid.test(block.id) ||
        !integer(block.from) ||
        !integer(block.to) ||
        block.to < block.from ||
        !block.kind ||
        block.kind.length > 256
      )
        invalid()
      let kind = kinds.get(block.kind)
      if (kind === undefined) {
        kindBytes += 256 + block.kind.length * 4
        if (kindBytes > kindWorkspaceBytes) throw new Error('translation-view-limit')
        kind = this.#kinds.length
        kinds.set(block.kind, kind)
        this.#kinds.push(block.kind)
      }
      const offset = index * columns
      const id = block.id.replaceAll('-', '')
      for (let word = 0; word < 4; word++)
        this.#rows[offset + word] = Number.parseInt(id.slice(word * 8, word * 8 + 8), 16)
      this.#rows[offset + 4] = block.from
      this.#rows[offset + 5] = block.to
      this.#rows[offset + 6] = kind
      if (block.hash === 'footnotes') this.#rows[offset + 7] = 0xffffffff
      else {
        const parts = hash.exec(block.hash)
        if (!parts || !integer(Number(parts[1]))) invalid()
        const first = Number.parseInt(parts[2] ?? '', 16),
          second = Number.parseInt(parts[3] ?? '', 16)
        if (first.toString(16) !== parts[2] || second.toString(16) !== parts[3]) invalid()
        this.#rows[offset + 7] = Number(parts[1])
        this.#rows[offset + 8] = first
        this.#rows[offset + 9] = second
      }
    }
    Object.freeze(this.#kinds)
    Object.freeze(this)
  }

  /** The caller must separately admit these temporary ordinary records before expansion. */
  snapshot(): ReadingBlock[] {
    const blocks: ReadingBlock[] = []
    for (let index = 0; index < this.count; index++) {
      const offset = index * columns
      let id = ''
      for (let word = 0; word < 4; word++)
        id += (this.#rows[offset + word] ?? 0).toString(16).padStart(8, '0')
      const length = this.#rows[offset + 7]
      blocks.push({
        id: `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`,
        kind: this.#kinds[this.#rows[offset + 6] ?? 0] ?? '',
        from: this.#rows[offset + 4] ?? 0,
        to: this.#rows[offset + 5] ?? 0,
        hash:
          length === 0xffffffff
            ? 'footnotes'
            : `${length}:${(this.#rows[offset + 8] ?? 0).toString(16)}:${(this.#rows[offset + 9] ?? 0).toString(16)}`,
      })
    }
    return blocks
  }
}
