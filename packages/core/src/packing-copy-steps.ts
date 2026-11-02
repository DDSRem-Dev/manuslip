import type { PackedArena } from './packing-arena'
import { PackedMetadataBudget } from './packing-metadata-budget'
import {
  appendSegmentSliceSteps,
  segmentEntrySteps,
  segmentGeometrySteps,
} from './packing-segment-steps'
import { PackedText } from './packing-text'
import { fieldEntries } from './packing-traversal'
import { kind, type PackedNode, type PackedSegment } from './packing-view'
import { PackedWork } from './packing-work'

interface CopyOwner {
  node: PackedNode | undefined
  insert: PackedNode | undefined
  charge: ((bytes: number) => void) | undefined
  budget: PackedMetadataBudget | undefined
  complete: boolean
}

function work(owner: CopyOwner, steps: Generator<void, PackedNode>): PackedWork<PackedNode> {
  return new PackedWork(steps, () => {
    owner.node = undefined
    owner.insert = undefined
    owner.charge = undefined
    owner.budget = undefined
  })
}

/** Position wrappers do not alter scalar spelling or replacement semantics. */
export function spliceTextSteps(
  node: PackedNode,
  start: number,
  remove: number,
  arena: PackedArena,
  id: number,
  charge: (bytes: number) => void,
  budget = new PackedMetadataBudget(),
): PackedWork<PackedNode> {
  const owner: CopyOwner = { node, insert: { arena, id }, charge, budget, complete: false }
  return work(owner, replaceText(owner, start, remove))
}

function* replaceText(
  owner: CopyOwner,
  start: number,
  remove: number,
): Generator<void, PackedNode> {
  let node = owner.node as PackedNode
  const replacement = owner.insert as { arena: PackedArena; id: number }
  const charge = owner.charge as (bytes: number) => void
  const budget = owner.budget as PackedMetadataBudget
  while ('shifted' in node) {
    if (budget.advance()) yield
    node = node.shifted
  }
  const text =
    'text' in node ? node.text : 'arena' in node ? PackedText.from(node.arena, node.id) : undefined
  if (!text) throw new Error('Packed value is not a string')
  const next = yield* text.spliceSteps(
    start,
    remove,
    replacement.arena,
    replacement.id,
    charge,
    budget,
  )
  if (!next) throw new Error('Incomplete packed text copy')
  owner.complete = true
  return Object.freeze({ text: next })
}

/** The caller owns the immutable nodes; only private replacement metadata is constructed. */
export function replaceChildSteps(
  node: PackedNode,
  part: string | number,
  value: PackedNode,
  charge: (bytes: number) => void,
  budget = new PackedMetadataBudget(),
): PackedWork<PackedNode> {
  if (typeof part === 'number') return spliceSteps(node, part, 1, value, true, charge, budget)
  const owner: CopyOwner = { node, insert: value, charge, budget, complete: false }
  return work(owner, replaceFields(owner, part))
}

function* replaceFields(owner: CopyOwner, part: string): Generator<void, PackedNode> {
  const node = owner.node as PackedNode
  const value = owner.insert as PackedNode
  const budget = owner.budget as PackedMetadataBudget
  const charge = owner.charge as (bytes: number) => void
  const next: (readonly [string, PackedNode])[] = []
  try {
    let base = node
    while ('shifted' in base || 'ranged' in base) {
      if (budget.advance()) yield
      base = 'shifted' in base ? base.shifted : base.ranged
    }
    if (kind(base) !== 'object') throw new Error('Packed path requires object')
    let bytes = 96
    if ('arena' in base) {
      for (const key of base.arena.keys(base.id)) {
        if (budget.advance()) yield
        bytes += 256 + key.length * 2
      }
    } else if ('fields' in base) {
      for (const [key] of base.fields) {
        if (budget.advance()) yield
        bytes += 256 + key.length * 2
      }
    }
    // Keep the preceding charge, including its conservative tuple/key weights.
    // No full key/field array is materialized merely to calculate admission.
    charge(bytes)
    for (const [key, old] of fieldEntries(node)) {
      if (budget.advance()) yield
      next.push(Object.freeze([key, key === part ? value : old] as const))
    }
    const result = Object.freeze({ fields: Object.freeze(next) })
    owner.complete = true
    return result
  } finally {
    if (!owner.complete) next.length = 0
  }
}

/** Copy segment ranges in bounded groups; unchanged array records stay in their arenas. */
export function spliceSteps(
  node: PackedNode,
  start: number,
  remove: number,
  insert: PackedNode | undefined,
  singleton: boolean,
  charge: (bytes: number) => void,
  budget = new PackedMetadataBudget(),
): PackedWork<PackedNode> {
  const owner: CopyOwner = { node, insert, charge, budget, complete: false }
  return work(owner, spliceSegments(owner, start, remove, singleton))
}

function* spliceSegments(
  owner: CopyOwner,
  start: number,
  remove: number,
  singleton: boolean,
): Generator<void, PackedNode> {
  const node = owner.node as PackedNode
  const budget = owner.budget as PackedMetadataBudget
  const insert = owner.insert
  const charge = owner.charge as (bytes: number) => void
  const next: PackedSegment[] = []
  try {
    const geometry = yield* segmentGeometrySteps(node, budget)
    if (!geometry) throw new Error('Incomplete packed array geometry')
    const { size, count } = geometry
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(remove) ||
      start < 0 ||
      remove < 0 ||
      start > size ||
      remove > size - start
    )
      throw new Error('Invalid packed splice range')
    const incoming = insert && !singleton ? yield* segmentGeometrySteps(insert, budget) : undefined
    if (insert && !singleton && !incoming) throw new Error('Incomplete packed insertion geometry')
    charge(
      96 +
        (count * 2 + (insert ? (singleton ? 1 : (incoming as { count: number }).count) : 0)) * 80,
    )
    if (!(yield* appendSegmentSliceSteps(next, node, 0, start, budget)))
      throw new Error('Incomplete packed prefix copy')
    if (insert) {
      if (singleton) {
        if (budget.advance()) yield
        next.push(Object.freeze({ value: insert, length: 1 }))
      } else {
        for (const segment of segmentEntrySteps(insert, budget)) {
          if (segment === undefined) yield
          else {
            if (budget.advance()) yield
            next.push(Object.freeze(segment))
          }
        }
      }
    }
    if (!(yield* appendSegmentSliceSteps(next, node, start + remove, size, budget)))
      throw new Error('Incomplete packed suffix copy')
    const total =
      size - remove + (insert ? (singleton ? 1 : (incoming as { size: number }).size) : 0)
    if (!Number.isSafeInteger(total) || total > 0xffffffff)
      throw new Error('Invalid packed array length')
    const result = Object.freeze({ segments: Object.freeze(next), length: total })
    owner.complete = true
    return result
  } finally {
    if (!owner.complete) next.length = 0
  }
}
