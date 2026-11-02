import { PackedMetadataBudget } from './packing-metadata-budget'
import { elementSteps, length, offsetNode, type PackedNode, PackedView } from './packing-view'

export { elementSteps } from './packing-view'

/** Values and keys in one linear reference scan; no repeated arena.field prefix walks. */
export function* fieldEntries(node: PackedNode): Generator<readonly [string, PackedNode]> {
  if ('shifted' in node) {
    for (const [key, value] of fieldEntries(node.shifted))
      yield [key, offsetNode(value, node.offset)] as const
  } else if ('ranged' in node) {
    for (const [key, value] of fieldEntries(node.ranged))
      yield [
        key,
        key === 'from' || key === 'to' ? rangeValue(value, node.rangeOffset) : value,
      ] as const
  } else if ('fields' in node) yield* node.fields
  else if ('arena' in node) {
    for (const [key, id] of node.arena.fields(node.id))
      yield [key, { arena: node.arena, id }] as const
  } else throw new Error('Packed path requires object')
}

function rangeValue(value: PackedNode, offset: number): PackedNode {
  const number = new PackedView(value).readScalar({ retained: 16, staging: 0 })
  if (typeof number !== 'number') throw new Error('Invalid packed range field')
  return Object.freeze({ number: number + offset })
}

/** Paths keep the existing ordered-operation semantics, yielding through large prefixes. */
export function* childSteps(
  node: PackedNode,
  part: string | number,
  budget = new PackedMetadataBudget(),
): Generator<void, PackedNode, undefined> {
  if ('shifted' in node) {
    if (budget.advance()) yield
    return offsetNode(yield* childSteps(node.shifted, part, budget), node.offset)
  }
  if ('ranged' in node) {
    if (typeof part !== 'string') throw new Error('Packed path requires object')
    if (budget.advance()) yield
    const value = yield* childSteps(node.ranged, part, budget)
    return part === 'from' || part === 'to' ? rangeValue(value, node.rangeOffset) : value
  }
  if (typeof part === 'string') {
    for (const [key, value] of fieldEntries(node)) {
      if (budget.advance()) yield
      if (key === part) return value
    }
  } else if (Number.isSafeInteger(part) && part >= 0 && part < length(node)) {
    let index = 0
    for (const value of elementSteps(node, budget)) {
      if (value === undefined) {
        yield
      } else {
        if (budget.advance()) yield
        if (index++ === part) return value
      }
    }
  }
  throw new Error('Missing or invalid packed path')
}
