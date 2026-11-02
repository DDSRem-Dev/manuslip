import type { PackedWriter } from './packing-bytes'
import type { PackedEncodingBudget } from './packing-encode-budget'
import type { PackedTextReplay } from './packing-input-capture'

const stride = 4 // hash, ID + 1, JSON byte offset, JSON byte length
const batch = 256
const hashByte = (hash: number, byte: number) => Math.imul(hash ^ byte, 16777619) >>> 0

/** Keep bounded byte arithmetic outside suspended generator frames. */
function hashBytes(hash: number, bytes: Uint8Array): number {
  for (let index = 0; index < bytes.length; index++) hash = hashByte(hash, bytes[index] ?? 0)
  return hash
}

/** Canonical JSON pieces, including pairs split across decoder/concatenation edges. */
function* pieces(replay: PackedTextReplay): Generator<Uint8Array | undefined> {
  const encoder = new TextEncoder()
  let pending = ''
  yield new Uint8Array([34])
  for (const chunk of replay()) {
    if (chunk === undefined) {
      yield undefined
      continue
    }
    if (typeof chunk !== 'string' || chunk.length > 4098)
      throw new Error('Invalid packed text input chunk')
    let value = pending + chunk
    pending = ''
    const last = value.charCodeAt(value.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) {
      pending = value.slice(-1)
      value = value.slice(0, -1)
    }
    yield encoder.encode(JSON.stringify(value).slice(1, -1))
  }
  if (pending) yield encoder.encode(JSON.stringify(pending).slice(1, -1))
  yield new Uint8Array([34])
}

/** Shared exact string interning for native and replayed text. Only emitted bytes and
 * a bounded typed index remain live; no complete decoded string is a table key.
 * Hashes select candidates; every canonical JSON byte must match before sharing.
 */
export class PackedStringRecords {
  #slots = new Uint32Array(0)
  #entries = 0
  #bytes = 0
  constructor(
    readonly body: PackedWriter,
    readonly budget: PackedEncodingBudget,
    readonly limit: number,
  ) {}
  /** A unique native string was already emitted by the ordinary scalar fast path.
   * Register its canonical bytes once so later captured text can share its exact ID. */
  *registerSteps(id: number, start: number): Generator<void> {
    let offset = start,
      length = 0,
      shift = 0
    while (true) {
      const byte = this.body.byteAt(offset++)
      length += (byte & 127) * 2 ** shift
      if (byte < 128) break
      shift += 7
      if (shift >= 35) throw new Error('Invalid packed native string')
    }
    if (length > this.limit) throw new Error('Packed value exceeds byte limit')
    const hash = yield* this.body.hashSteps(offset, length)
    yield* this.#insertSteps(hash, id, offset, length)
  }
  *encodeSteps(replay: PackedTextReplay, nextId: () => number): Generator<void, number, undefined> {
    let hash = 2166136261
    let length = 0
    for (const chunk of pieces(replay)) {
      if (chunk) {
        length += chunk.length
        if (length > this.limit) throw new Error('Packed value exceeds byte limit')
        hash = hashBytes(hash, chunk)
      }
      yield
    }
    const capacity = this.#slots.length / stride
    if (capacity) {
      let slot = hash & (capacity - 1)
      for (let probes = 0; probes < capacity; probes++) {
        this.#probe(probes)
        const at = slot * stride
        const stored = this.#slots[at + 1]
        if (!stored) break
        if (
          this.#slots[at] === hash &&
          this.#slots[at + 3] === length &&
          (yield* this.#matchesSteps(this.#slots[at + 2] ?? 0, length, replay))
        )
          return stored - 1
        slot = (slot + 1) & (capacity - 1)
        if (probes % batch === batch - 1) yield
      }
    }
    const id = nextId()
    this.body.uint(5)
    this.body.uint(length)
    const offset = this.body.length
    let actualHash = 2166136261
    let written = 0
    for (const chunk of pieces(replay)) {
      if (chunk) {
        if (chunk.length > length - written) {
          // Preserve the original failure/admission order for an unstable replay.
          for (const byte of chunk) {
            if (++written > length) throw new Error('Unstable packed text input')
            actualHash = hashByte(actualHash, byte)
            this.body.byte(byte)
          }
        } else {
          actualHash = hashBytes(actualHash, chunk)
          this.body.writeBytes(chunk)
          written += chunk.length
        }
      }
      yield
    }
    if (written !== length || actualHash !== hash) throw new Error('Unstable packed text input')
    yield* this.#insertSteps(hash, id, offset, length)
    return id
  }
  *#matchesSteps(
    offset: number,
    length: number,
    replay: PackedTextReplay,
  ): Generator<void, boolean> {
    let compared = 0
    for (const chunk of pieces(replay)) {
      if (chunk) {
        if (chunk.length > length - compared || !this.body.matchesBytes(offset, chunk)) return false
        compared += chunk.length
        offset += chunk.length
      }
      yield
    }
    return compared === length
  }
  #probe(probes: number): void {
    if (probes >= batch) throw new Error('Packed encoding exceeds collision limit')
  }
  *#insertSteps(hash: number, id: number, offset: number, length: number): Generator<void> {
    let capacity = this.#slots.length / stride
    if ((this.#entries + 1) * 2 > capacity) {
      const nextCapacity = capacity ? capacity * 2 : 1024
      if (nextCapacity > 0x10000000) throw new Error('Packed string index exceeds capacity')
      const bytes = nextCapacity * stride * 4 + 64
      this.budget.charge(bytes)
      let committed = false
      try {
        const next = new Uint32Array(nextCapacity * stride)
        for (let old = 0; old < this.#slots.length; old += stride) {
          if (this.#slots[old + 1]) {
            let slot = (this.#slots[old] ?? 0) & (nextCapacity - 1)
            let probes = 0
            while (next[slot * stride + 1]) {
              this.#probe(probes++)
              slot = (slot + 1) & (nextCapacity - 1)
            }
            this.#probe(probes)
            for (let field = 0; field < stride; field++)
              next[slot * stride + field] = this.#slots[old + field] ?? 0
          }
          if (old % (batch * stride) === (batch - 1) * stride) yield
        }
        const previous = this.#bytes
        this.#slots = next
        this.#bytes = bytes
        capacity = nextCapacity
        committed = true
        this.budget.release(previous)
      } finally {
        if (!committed) this.budget.release(bytes)
      }
    }
    let slot = hash & (capacity - 1)
    let probes = 0
    while (this.#slots[slot * stride + 1]) {
      this.#probe(probes++)
      slot = (slot + 1) & (capacity - 1)
    }
    this.#probe(probes)
    const at = slot * stride
    this.#slots[at] = hash
    this.#slots[at + 1] = id + 1
    this.#slots[at + 2] = offset
    this.#slots[at + 3] = length
    this.#entries++
  }
  clear(): void {
    this.#slots = new Uint32Array(0)
    this.#entries = 0
    this.budget.release(this.#bytes)
    this.#bytes = 0
  }
}
