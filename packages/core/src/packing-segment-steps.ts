import { PackedMetadataBudget } from './packing-metadata-budget'
import {
  length,
  offsetNode,
  offsetSegment,
  type PackedNode,
  type PackedSegment,
  rangeSegment,
  rangeNode,
} from './packing-node'
import { PackedWork } from './packing-work'

interface SegmentOwner {
  node: PackedNode | undefined
  source: readonly PackedSegment[] | undefined
  target: PackedSegment[] | undefined
  budget: PackedMetadataBudget | undefined
  create: ((value: PackedNode) => unknown) | undefined
  complete: boolean
}
function owner(
  node: PackedNode,
  budget: PackedMetadataBudget,
  target?: PackedSegment[],
  source?: readonly PackedSegment[],
  create?: (value: PackedNode) => unknown,
): SegmentOwner {
  return { node, source, target, budget, create, complete: false }
}
function work<T, Yield = void>(
  owner: SegmentOwner,
  steps: Generator<Yield, T>,
): PackedWork<T, Yield> {
  return new PackedWork(steps, () => clearOwner(owner))
}
function clearOwner(owner: SegmentOwner): void {
  owner.node = undefined
  owner.source = undefined
  owner.target = undefined
  owner.budget = undefined
  owner.create = undefined
}

export function segmentGeometrySteps(node: PackedNode, budget: PackedMetadataBudget) {
  const state = owner(node, budget)
  return work(state, geometry(state))
}
function* geometry(owner: SegmentOwner): Generator<void, { size: number; count: number }> {
  let node = owner.node as PackedNode
  const budget = owner.budget as PackedMetadataBudget
  while ('shifted' in node) {
    if (budget.advance()) yield
    node = node.shifted
  }
  return { size: length(node), count: 'segments' in node ? node.segments.length : 1 }
}

/** Undefined is a scheduler checkpoint; ordinary entries remain immutable caller-owned data. */
export function segmentEntrySteps(node: PackedNode, budget: PackedMetadataBudget) {
  const state = owner(node, budget)
  return work(state, entries(state))
}
function* entries(owner: SegmentOwner): Generator<PackedSegment | undefined> {
  yield* segmentEntries(owner.node as PackedNode, owner.budget as PackedMetadataBudget)
}
function* segmentEntries(
  node: PackedNode,
  budget: PackedMetadataBudget,
): Generator<PackedSegment | undefined> {
  if ('shifted' in node) {
    if (budget.advance()) yield
    for (const segment of segmentEntries(node.shifted, budget)) {
      if (segment === undefined) yield
      else {
        if (budget.advance()) yield
        yield offsetSegment(segment, node.offset)
      }
    }
  } else if ('segments' in node) {
    for (let index = 0; index < node.segments.length; index++) {
      if (budget.advance()) yield
      const segment = node.segments[index]
      if (!segment) throw new Error('Missing packed array segment')
      yield segment
    }
  } else if ('arena' in node) {
    if (budget.advance()) yield
    yield { arena: node.arena, id: node.id, from: 0, length: node.arena.length(node.id) }
  } else throw new Error('Packed path requires array')
}

/** Visit metadata lazily; discarded references share the caller's metadata quota. */
export function segmentElementSteps(
  node: PackedNode,
  budget?: PackedMetadataBudget,
): PackedWork<void, PackedNode | undefined>
export function segmentElementSteps<T>(
  node: PackedNode,
  budget: PackedMetadataBudget,
  create: (value: PackedNode) => T,
): PackedWork<void, T | undefined>
export function segmentElementSteps(
  node: PackedNode,
  budget = new PackedMetadataBudget(),
  create?: (value: PackedNode) => unknown,
) {
  const state = owner(node, budget, undefined, undefined, create)
  return work(state, elementEntries(state))
}

export interface PackedElementCursor<T> {
  readonly steps: Generator<T | undefined, void, undefined>
  readonly revoke: () => void
}
/** Internal capture composition. Attach revoke to the parent before advancing; the
 * parent must guard reentrancy and close these steps after a running advance unwinds.
 * Standalone callers retain segmentElementSteps and its independent work handle.
 */
export function segmentElementCursor<T>(
  node: PackedNode,
  budget: PackedMetadataBudget,
  create: (value: PackedNode) => T,
): PackedElementCursor<T> {
  return elementCursor<T>(owner(node, budget, undefined, undefined, create))
}
// Keep the revocation closure outside the scope holding the original node argument.
function elementCursor<T>(state: SegmentOwner): PackedElementCursor<T> {
  return {
    steps: elementEntries(state) as Generator<T | undefined, void, undefined>,
    revoke: () => clearOwner(state),
  }
}
function* elementEntries(owner: SegmentOwner): Generator<unknown> {
  const node = owner.node as PackedNode
  const budget = owner.budget as PackedMetadataBudget
  const shifted = 'shifted' in node ? segmentEntries(node, budget) : undefined
  let at = 0
  try {
    while (true) {
      let segment: PackedSegment
      if (shifted) {
        const next = shifted.next()
        if (next.done) break
        if (next.value === undefined) {
          yield
          continue
        }
        segment = next.value
      } else if ('segments' in node) {
        if (at >= node.segments.length) break
        if (budget.advance()) yield
        const next = node.segments[at++]
        if (!next) throw new Error('Missing packed array segment')
        segment = next
      } else if ('arena' in node) {
        if (at++) break
        if (budget.advance()) yield
        segment = { arena: node.arena, id: node.id, from: 0, length: node.arena.length(node.id) }
      } else throw new Error('Packed path requires array')
      if ('value' in segment) yield owner.create ? owner.create(segment.value) : segment.value
      else {
        const items = segment.arena.elements(segment.id)
        let index = 0
        try {
          while (true) {
            if (budget.advance()) yield
            const item = items.next()
            if (item.done || index >= segment.from + segment.length) break
            if (index++ >= segment.from) {
              const value = rangeNode(
                offsetNode({ arena: segment.arena, id: item.value }, segment.offset ?? 0),
                segment.rangeOffset ?? 0,
              )
              yield owner.create ? owner.create(value) : value
            }
          }
        } finally {
          items.return(undefined)
        }
      }
      yield
    }
  } finally {
    shifted?.return(undefined)
  }
}

/** The caller admits and owns target; cancellation never clears a borrowed array. */
export function appendSegmentSliceSteps(
  target: PackedSegment[],
  node: PackedNode,
  from: number,
  to: number,
  budget: PackedMetadataBudget,
) {
  const state = owner(node, budget, target)
  return work(state, appendSlice(state, from, to))
}
function* appendSlice(owner: SegmentOwner, from: number, to: number): Generator<void, true> {
  const target = owner.target as PackedSegment[]
  const node = owner.node as PackedNode
  const budget = owner.budget as PackedMetadataBudget
  let offset = 0
  for (const segment of segmentEntries(node, budget)) {
    if (segment === undefined) {
      yield
      continue
    }
    const start = Math.max(from, offset)
    const end = Math.min(to, offset + segment.length)
    if (end > start) {
      if (budget.advance()) yield
      target.push(
        Object.freeze(
          'value' in segment
            ? segment
            : { ...segment, from: segment.from + start - offset, length: end - start },
        ),
      )
    }
    offset += segment.length
    if (offset >= to) break
  }
  return true
}

/** Assemble the validated suffix without array spreads, whole-array maps or a freeze scan. */
export function assembleSegmentSuffixSteps(
  node: PackedNode,
  start: number,
  size: number,
  suffix: readonly PackedSegment[],
  offset: number,
  range: boolean,
  budget: PackedMetadataBudget,
) {
  const state = owner(node, budget, undefined, suffix)
  return work(state, assemble(state, start, size, offset, range))
}
function* assemble(
  owner: SegmentOwner,
  start: number,
  size: number,
  offset: number,
  range: boolean,
): Generator<void, PackedNode> {
  const node = owner.node as PackedNode
  const source = owner.source as readonly PackedSegment[]
  const budget = owner.budget as PackedMetadataBudget
  const next: PackedSegment[] = []
  try {
    if (!(yield* appendSegmentSliceSteps(next, node, 0, start, budget)))
      throw new Error('Incomplete packed prefix copy')
    for (let index = 0; index < source.length; index++) {
      if (budget.advance()) yield
      const segment = source[index]
      if (!segment) throw new Error('Missing packed suffix segment')
      next.push((range ? rangeSegment : offsetSegment)(segment, offset))
    }
    const result = Object.freeze({ segments: Object.freeze(next), length: size })
    owner.complete = true
    return result
  } finally {
    if (!owner.complete && !Object.isFrozen(next)) next.length = 0
  }
}
