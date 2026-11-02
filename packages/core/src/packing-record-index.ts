import type { PackedWriter } from './packing-bytes'
import type { PackedEncodingBudget } from './packing-encode-budget'

const stride = 3 // hash, record ID + 1, emitted body offset; zero ID marks an empty slot.
const initialCapacity = 1024
const batch = 256
const small = 16

function initialHash(tag: number, length: number): number {
  return Math.imul(Math.imul(2166136261 ^ tag, 16777619) ^ length, 16777619)
}
/** Keep the bounded arithmetic outside suspended generator frames. */
function hashValues(hash: number, values: readonly number[], from: number, to: number): number {
  for (let index = from; index < to; index++) {
    const value = values[index]
    if (value === undefined || !Number.isInteger(value) || value < 0 || value > 0xffffffff)
      throw new Error('Invalid packed record reference')
    hash = Math.imul(hash ^ value, 16777619)
  }
  return hash
}
function recordReader(body: PackedWriter, offset: number): () => number {
  return () => {
    let value = 0
    for (let shift = 0; shift < 35; shift += 7) {
      const byte = body.byteAt(offset++)
      if (shift === 28 && byte > 15) throw new Error('Invalid emitted packed integer')
      value |= (byte & 127) << shift
      if (!(byte & 128)) return value >>> 0
    }
    throw new Error('Invalid emitted packed integer')
  }
}
function validateEntry(body: PackedWriter, hash: number, id: number, offset: number): void {
  if (
    !Number.isInteger(hash) ||
    hash < 0 ||
    hash > 0xffffffff ||
    !Number.isInteger(id) ||
    id < 0 ||
    id >= 0xffffffff ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset >= body.length ||
    offset > 0xffffffff
  )
    throw new Error('Invalid packed record index entry')
}

/** Internal exact interning over already emitted immutable body bytes. Hashes only
 * select candidates: tags and every uint32 coordinate/reference must compare equal.
 * Callers keep candidate values stable, and insert only fully emitted unique records.
 */
export class PackedRecordIndex {
  #slots = new Uint32Array(0)
  #entries = 0
  #bytes = 0
  constructor(
    readonly body: PackedWriter,
    readonly budget?: PackedEncodingBudget,
  ) {}

  /** Common short rows need no generator. Undefined requests the original cooperative
   * path; callers yield before retrying so even a hostile chain stays bounded. No table
   * state changes during lookup, and hashes still require complete emitted-byte equality.
   */
  lookupSmall(
    tag: number,
    values: readonly number[],
  ): { hash: number; id: number | undefined } | undefined {
    if (values.length > small) return undefined
    const hash = hashValues(initialHash(tag, values.length), values, 0, values.length) >>> 0
    const capacity = this.#slots.length / stride
    if (!capacity) return { hash, id: undefined }
    let slot = hash & (capacity - 1)
    for (let probes = 0; probes < small; probes++) {
      const at = slot * stride,
        stored = this.#slots[at + 1]
      if (!stored) return { hash, id: undefined }
      if (this.#slots[at] === hash && this.#matchesSmall(this.#slots[at + 2] ?? 0, tag, values))
        return { hash, id: stored - 1 }
      slot = (slot + 1) & (capacity - 1)
    }
    return undefined
  }

  #matchesSmall(offset: number, tag: number, values: readonly number[]): boolean {
    const uint = recordReader(this.body, offset)
    if (uint() !== tag || (tag === 6 && uint() !== values.length)) return false
    for (const value of values) if (uint() !== value) return false
    return true
  }

  *lookupSteps(
    tag: number,
    values: readonly number[],
  ): Generator<void, { hash: number; id: number | undefined }, undefined> {
    let hash = initialHash(tag, values.length)
    for (let from = 0; from < values.length; from += batch) {
      const to = Math.min(from + batch, values.length)
      hash = hashValues(hash, values, from, to)
      if (to - from === batch) yield
    }
    hash >>>= 0
    const capacity = this.#slots.length / stride
    if (!capacity) return { hash, id: undefined }
    let slot = hash & (capacity - 1)
    for (let probes = 0; probes < capacity; probes++) {
      this.#probe(probes)
      const at = slot * stride
      const stored = this.#slots[at + 1]
      if (!stored) return { hash, id: undefined }
      if (
        this.#slots[at] === hash &&
        (yield* this.#matchesSteps(this.#slots[at + 2] ?? 0, tag, values))
      )
        return { hash, id: stored - 1 }
      slot = (slot + 1) & (capacity - 1)
      if (probes % batch === batch - 1) yield
    }
    throw new Error('Packed record index is full')
  }

  *#matchesSteps(
    offset: number,
    tag: number,
    values: readonly number[],
  ): Generator<void, boolean, undefined> {
    if (values.length <= small) return this.#matchesSmall(offset, tag, values)
    const uint = recordReader(this.body, offset)
    if (uint() !== tag || (tag === 6 && uint() !== values.length)) return false
    for (let index = 0; index < values.length; index++) {
      if (uint() !== values[index]) return false
      if (index % batch === batch - 1) yield
    }
    return true
  }

  #probe(probes: number): void {
    if (this.budget && probes >= 256) throw new Error('Packed encoding exceeds collision limit')
  }

  /** Allocation-free insertion when neither growth nor a long probe is needed. False
   * leaves the table untouched; the caller yields before the cooperative retry.
   */
  insertSmall(hash: number, id: number, offset: number): boolean {
    validateEntry(this.body, hash, id, offset)
    const capacity = this.#slots.length / stride
    if ((this.#entries + 1) * 2 > capacity) return false
    let slot = hash & (capacity - 1)
    for (let probes = 0; probes < small; probes++) {
      if (!this.#slots[slot * stride + 1]) {
        this.#slots[slot * stride] = hash
        this.#slots[slot * stride + 1] = id + 1
        this.#slots[slot * stride + 2] = offset
        this.#entries++
        return true
      }
      slot = (slot + 1) & (capacity - 1)
    }
    return false
  }

  *insertSteps(hash: number, id: number, offset: number): Generator<void, void, undefined> {
    validateEntry(this.body, hash, id, offset)
    let capacity = this.#slots.length / stride
    if ((this.#entries + 1) * 2 > capacity) {
      const nextCapacity = capacity ? capacity * 2 : initialCapacity
      if (nextCapacity > 0x10000000) throw new Error('Packed record index exceeds capacity')
      const bytes = nextCapacity * stride * 4 + 64
      // Old and new tables overlap throughout cooperative rehashing.
      this.budget?.charge(bytes)
      let committed = false
      try {
        const next = new Uint32Array(nextCapacity * stride)
        for (let old = 0; old < this.#slots.length; old += stride) {
          const stored = this.#slots[old + 1]
          if (stored) {
            let slot = (this.#slots[old] ?? 0) & (nextCapacity - 1)
            let probes = 0
            while (next[slot * stride + 1]) {
              this.#probe(probes++)
              slot = (slot + 1) & (nextCapacity - 1)
              if (probes % batch === 0) yield
            }
            this.#probe(probes)
            next[slot * stride] = this.#slots[old] ?? 0
            next[slot * stride + 1] = stored
            next[slot * stride + 2] = this.#slots[old + 2] ?? 0
          }
          if (old % (batch * stride) === (batch - 1) * stride) yield
        }
        const previousBytes = this.#bytes
        this.#slots = next
        this.#bytes = bytes
        committed = true
        this.budget?.release(previousBytes)
        capacity = nextCapacity
      } finally {
        if (!committed) this.budget?.release(bytes)
      }
    }
    let slot = hash & (capacity - 1)
    let probes = 0
    while (this.#slots[slot * stride + 1]) {
      this.#probe(probes++)
      slot = (slot + 1) & (capacity - 1)
      if (probes % batch === 0) yield
    }
    this.#probe(probes)
    this.#slots[slot * stride] = hash
    this.#slots[slot * stride + 1] = id + 1
    this.#slots[slot * stride + 2] = offset
    this.#entries++
  }

  clear(): void {
    this.#slots = new Uint32Array(0)
    this.#entries = 0
    this.budget?.release(this.#bytes)
    this.#bytes = 0
  }
}
