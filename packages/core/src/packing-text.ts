import type { PackedArena } from './packing-arena'
import { PackedMetadataBudget } from './packing-metadata-budget'
import { copyTextSplice } from './packing-text-splice'
import { type PackedTextPiece, streamPackedText } from './packing-text-stream'

interface TextCursor {
  iterator: Generator<string>
  chunk: string
  offset: number
  position: number
}
export interface ScalarLimits {
  retained: number
  staging: number
}
export function admitScalar(cost: { retained: number; workspace: number }, limits: ScalarLimits) {
  if (
    !Number.isSafeInteger(limits.retained) ||
    limits.retained < 0 ||
    !Number.isSafeInteger(limits.staging) ||
    limits.staging < 0
  )
    throw new Error('Invalid packed scalar limits')
  if (cost.retained > limits.retained) throw new Error('Packed scalar exceeds retained limit')
  if (cost.workspace > limits.staging) throw new Error('Packed scalar exceeds staging limit')
}

/** Preserve the complete independent key-array admission even when validation only borrows
 * an immutable shape for this synchronous call and creates no output array.
 */
export function admitPackedKeys(keys: readonly string[], limits: ScalarLimits): void {
  const retained = 48 + keys.length * 8 + keys.reduce((sum, key) => sum + 32 + key.length * 2, 0)
  admitScalar({ retained, workspace: 0 }, limits)
}

/** Flat immutable UTF-16 slices of owned string records, never a recursive rope or text cache. */
export class PackedText {
  readonly length: number
  readonly #pieces: readonly PackedTextPiece[]
  private constructor(pieces: readonly PackedTextPiece[], length: number, prepared = false) {
    if (!prepared) for (const piece of pieces) Object.freeze(piece)
    this.#pieces = Object.freeze(pieces)
    this.length = length
    Object.freeze(this)
  }
  static from(arena: PackedArena, id: number): PackedText {
    const length = arena.stringLength(id)
    return new PackedText(length ? [{ arena, id, from: 0, length }] : [], length)
  }
  static #fromPreparedPieces(pieces: readonly PackedTextPiece[], length: number): PackedText {
    return new PackedText(pieces, length, true)
  }
  /** Same immutable UTF-16 slices and admission as splice, with shared metadata checkpoints. */
  spliceSteps(
    start: number,
    remove: number,
    arena: PackedArena,
    id: number,
    charge: (bytes: number) => void,
    budget = new PackedMetadataBudget(),
  ) {
    return copyTextSplice(
      {
        pieces: this.#pieces,
        length: this.length,
        arena,
        id,
        charge,
        budget,
        create: PackedText.#fromPreparedPieces,
      },
      start,
      remove,
    )
  }
  #slice(from: number, to: number): PackedTextPiece[] {
    const pieces: PackedTextPiece[] = []
    let offset = 0
    for (const piece of this.#pieces) {
      const start = Math.max(from, offset)
      const end = Math.min(to, offset + piece.length)
      if (end > start)
        pieces.push({ ...piece, from: piece.from + start - offset, length: end - start })
      offset += piece.length
      if (offset >= to) break
    }
    return pieces
  }
  splice(
    start: number,
    remove: number,
    arena: PackedArena,
    id: number,
    charge: (bytes: number) => void,
  ): PackedText {
    const added = arena.stringLength(id)
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(remove) ||
      start < 0 ||
      remove < 0 ||
      start > this.length ||
      remove > this.length - start
    )
      throw new Error('Invalid packed text splice range')
    const length = this.length - remove + added
    if (!Number.isSafeInteger(length) || length > 0xffffffff)
      throw new Error('Invalid packed text length')
    // Output and temporary slice metadata are reserved before either slice is allocated.
    charge(256 + (this.#pieces.length * 2 + 1) * 192)
    const inserted = added ? [{ arena, id, from: 0, length: added }] : []
    return new PackedText(
      [...this.#slice(0, start), ...inserted, ...this.#slice(start + remove, this.length)],
      length,
    )
  }
  scalarCost(): { retained: number; workspace: number } {
    let streams = 0
    // No allocation is required to ask for costs. Equal sources share one decoding cursor.
    for (let index = 0; index < this.#pieces.length; index++) {
      const piece = this.#pieces[index]
      if (!piece) throw new Error('Missing packed text piece')
      let seen = false
      for (let before = 0; before < index; before++) {
        const other = this.#pieces[before]
        if (other?.arena === piece.arena && other.id === piece.id) {
          seen = true
          break
        }
      }
      if (!seen) streams += piece.arena.stringWorkspace(piece.id) + 256
    }
    // Join temporarily retains decoded chunks as well as its returned string. Account chunk
    // metadata, six-byte JSON escapes, and two partially retained 4098-unit boundary chunks
    // per piece. This is an explicit conservative weight, not a portable heap measurement.
    return {
      retained: 32 + this.length * 2,
      workspace:
        512 +
        this.length * 2 +
        Math.ceil((this.length * 6) / 4096) * 96 +
        this.#pieces.length * 16800 +
        streams,
    }
  }
  /** Costs are fixed by packedTextStepCost; no piece-count scan or decoded output cache. */
  steps(): Generator<string | undefined> {
    return streamPackedText(this.#pieces)
  }
  /** Callers admit scalarCost first; bounded public cursor reads enforce it before this call. */
  scalar(): string {
    const cursors = new Map<PackedArena, Map<number, TextCursor>>()
    const parts: string[] = []
    const ensure = (cursor: TextCursor) => {
      if (cursor.offset < cursor.chunk.length) return
      const next = cursor.iterator.next()
      if (next.done) throw new Error('Truncated packed text piece')
      cursor.chunk = next.value
      cursor.offset = 0
    }
    try {
      for (const piece of this.#pieces) {
        let records = cursors.get(piece.arena)
        if (!records) {
          records = new Map()
          cursors.set(piece.arena, records)
        }
        let cursor = records.get(piece.id)
        if (!cursor || cursor.position > piece.from) {
          cursor?.iterator.return(undefined)
          cursor = {
            iterator: piece.arena.stringChunks(piece.id, piece.arena.stringWorkspace(piece.id)),
            chunk: '',
            offset: 0,
            position: 0,
          }
          records.set(piece.id, cursor)
        }
        while (cursor.position < piece.from) {
          ensure(cursor)
          const skipped = Math.min(
            piece.from - cursor.position,
            cursor.chunk.length - cursor.offset,
          )
          cursor.position += skipped
          cursor.offset += skipped
        }
        let remaining = piece.length
        while (remaining) {
          ensure(cursor)
          const taken = Math.min(remaining, cursor.chunk.length - cursor.offset)
          parts.push(cursor.chunk.slice(cursor.offset, cursor.offset + taken))
          cursor.position += taken
          cursor.offset += taken
          remaining -= taken
        }
      }
      return parts.join('')
    } finally {
      for (const records of cursors.values())
        for (const cursor of records.values()) cursor.iterator.return(undefined)
    }
  }
}
