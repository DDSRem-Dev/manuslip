import type { PackedArena } from './packing-arena'
import type { PackedMetadataBudget } from './packing-metadata-budget'
import type { PackedTextPiece } from './packing-text-stream'
import { PackedWork } from './packing-work'

interface TextSpliceInput<T> {
  pieces: readonly PackedTextPiece[]
  length: number
  arena: PackedArena
  id: number
  charge: (bytes: number) => void
  budget: PackedMetadataBudget
  create: (pieces: readonly PackedTextPiece[], length: number) => T
}
interface TextSpliceOwner<T> {
  pieces: readonly PackedTextPiece[] | undefined
  length: number
  arena: PackedArena | undefined
  id: number
  charge: ((bytes: number) => void) | undefined
  budget: PackedMetadataBudget | undefined
  create: ((pieces: readonly PackedTextPiece[], length: number) => T) | undefined
  complete: boolean
}

/** Private immutable piece copies. The factory adopts already frozen pieces without scanning. */
export function copyTextSplice<T>(
  input: TextSpliceInput<T>,
  start: number,
  remove: number,
): PackedWork<T> {
  const owner: TextSpliceOwner<T> = { ...input, complete: false }
  return new PackedWork(splicePieces(owner, start, remove), () => {
    owner.pieces = undefined
    owner.arena = undefined
    owner.charge = undefined
    owner.budget = undefined
    owner.create = undefined
  })
}

function* appendSlice(
  target: PackedTextPiece[],
  pieces: readonly PackedTextPiece[],
  from: number,
  to: number,
  budget: PackedMetadataBudget,
): Generator<void> {
  let offset = 0
  for (let index = 0; index < pieces.length; index++) {
    if (budget.advance()) yield
    const piece = pieces[index]
    if (!piece) throw new Error('Missing packed text piece')
    const start = Math.max(from, offset)
    const end = Math.min(to, offset + piece.length)
    if (end > start)
      target.push(
        Object.freeze({ ...piece, from: piece.from + start - offset, length: end - start }),
      )
    offset += piece.length
    if (offset >= to) break
  }
}

function* splicePieces<T>(
  owner: TextSpliceOwner<T>,
  start: number,
  remove: number,
): Generator<void, T> {
  const pieces = owner.pieces as readonly PackedTextPiece[]
  const arena = owner.arena as PackedArena
  const budget = owner.budget as PackedMetadataBudget
  const charge = owner.charge as (bytes: number) => void
  const create = owner.create as (pieces: readonly PackedTextPiece[], length: number) => T
  const next: PackedTextPiece[] = []
  try {
    const added = arena.stringLength(owner.id)
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(remove) ||
      start < 0 ||
      remove < 0 ||
      start > owner.length ||
      remove > owner.length - start
    )
      throw new Error('Invalid packed text splice range')
    const length = owner.length - remove + added
    if (!Number.isSafeInteger(length) || length > 0xffffffff)
      throw new Error('Invalid packed text length')
    // Preserve the synchronous reservation before either slice is allocated.
    charge(256 + (pieces.length * 2 + 1) * 192)
    yield* appendSlice(next, pieces, 0, start, budget)
    if (added) {
      if (budget.advance()) yield
      next.push(Object.freeze({ arena, id: owner.id, from: 0, length: added }))
    }
    yield* appendSlice(next, pieces, start + remove, owner.length, budget)
    const result = create(Object.freeze(next), length)
    owner.complete = true
    return result
  } finally {
    if (!owner.complete && !Object.isFrozen(next)) next.length = 0
  }
}
