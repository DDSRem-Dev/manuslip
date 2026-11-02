import type { PackedArena } from './packing-arena'
import { packedStringChunkUnits, packedStringWorkspace } from './packing-string'

export interface PackedTextPiece {
  readonly arena: PackedArena
  readonly id: number
  readonly from: number
  readonly length: number
}
interface Cursor {
  readonly arena: PackedArena
  readonly id: number
  readonly iterator: Generator<string | undefined>
  chunk: string
  offset: number
  position: number
}
const cursorLimit = 4
/** Four decoder/last-chunk slots, fixed cursor/continuation metadata, and one emitted chunk.
 * A caller retaining earlier emitted strings must account those independent outputs too.
 */
export const packedTextStepCost = Object.freeze({
  retained: 32 + packedStringChunkUnits * 2,
  workspace: 4096 + cursorLimit * (packedStringWorkspace + packedStringChunkUnits * 2 + 1024),
})

/** Bounded LRU cursors avoid restarting a base stream around ordinary insertions. Backwards
 * or evicted records may rescan, but discarded prefixes yield after every lexical batch.
 * Never join text, cache a whole string, or keep one decoder per arbitrarily many pieces.
 */
export function* streamPackedText(
  pieces: readonly PackedTextPiece[],
): Generator<string | undefined> {
  const cursors: Cursor[] = []
  try {
    for (const piece of pieces) {
      const index = cursors.findIndex(
        (cursor) => cursor.arena === piece.arena && cursor.id === piece.id,
      )
      let cursor = index < 0 ? undefined : cursors.splice(index, 1)[0]
      if (cursor && cursor.position > piece.from) {
        cursor.iterator.return(undefined)
        cursor = undefined
      }
      if (!cursor) {
        if (cursors.length >= cursorLimit) cursors.shift()?.iterator.return(undefined)
        cursor = {
          arena: piece.arena,
          id: piece.id,
          iterator: piece.arena.stringSteps(piece.id, piece.arena.stringWorkspace(piece.id)),
          chunk: '',
          offset: 0,
          position: 0,
        }
      }
      cursors.push(cursor)
      let remaining = piece.length
      while (cursor.position < piece.from || remaining) {
        if (cursor.offset >= cursor.chunk.length) {
          const next = cursor.iterator.next()
          if (next.done) throw new Error('Truncated packed text piece')
          cursor.chunk = next.value ?? ''
          cursor.offset = 0
          if (!cursor.chunk.length) {
            yield
            continue
          }
        }
        if (cursor.position < piece.from) {
          const skipped = Math.min(
            piece.from - cursor.position,
            cursor.chunk.length - cursor.offset,
          )
          cursor.position += skipped
          cursor.offset += skipped
          yield
        } else {
          const taken = Math.min(remaining, cursor.chunk.length - cursor.offset)
          const chunk = cursor.chunk.slice(cursor.offset, cursor.offset + taken)
          cursor.position += taken
          cursor.offset += taken
          remaining -= taken
          yield chunk
        }
      }
      yield // Bound piece transitions too, including empty pieces.
    }
  } finally {
    for (const cursor of cursors) cursor.iterator.return(undefined)
  }
}
