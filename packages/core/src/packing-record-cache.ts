import type { PackedRecordKey } from './packing-record-key'

export interface PackedRecordSlot {
  readonly chunk: Uint32Array
  readonly index: number
}

/** Source-free identities of completed immutable records. Each page is admitted before
 * allocation. Lazy transforms have independent tables; scalar spelling ignores position
 * transforms. Tokens never retain an arena, revision, capture, native tree or source.
 */
export class PackedRecordCache {
  readonly #arenas = new Map<object, Map<string, Map<number, Uint32Array>>>()
  constructor(private readonly admit: (bytes: number) => void) {}
  /** Existing untransformed aliases only. The caller must still validate the edge,
   * recheck its scope and admit the same logical visit/working cost before using it.
   * No table allocation or source-bearing identity is introduced by a cache hit.
   */
  untransformed(token: object, record: number): number | undefined {
    const chunk = this.#arenas
      .get(token)
      ?.get('0:0')
      ?.get(Math.floor(record / 1024))
    const stored = chunk?.[record % 1024]
    return stored ? stored - 1 : undefined
  }
  slot(key: PackedRecordKey, scalar: boolean): PackedRecordSlot {
    let arena = this.#arenas.get(key.token)
    if (!arena) {
      this.admit(256)
      arena = new Map()
      this.#arenas.set(key.token, arena)
    }
    const transform = scalar || (!key.offset && !key.range) ? '0:0' : `${key.offset}:${key.range}`
    let chunks = arena.get(transform)
    if (!chunks) {
      this.admit(256 + transform.length * 2)
      chunks = new Map()
      arena.set(transform, chunks)
    }
    const index = Math.floor(key.record / 1024)
    let chunk = chunks.get(index)
    if (!chunk) {
      this.admit(4096 + 256)
      chunk = new Uint32Array(1024)
      chunks.set(index, chunk)
    }
    return { chunk, index: key.record % 1024 }
  }
  clear(): void {
    this.#arenas.clear()
  }
}
