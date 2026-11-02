import type { PackedArena } from './packing-arena'
import { PackedPositions } from './packing-positions'

export interface SubtreeLimits {
  retained: number
  staging: number
}
export interface PackedSubtree {
  value: unknown
  retainedBytes: number
  stagingBytes: number
  records: number
}

/**
 * Materialize only reachable records of a selected immutable subtree. It deliberately has
 * separate budgets from its owned arena. No recursive walk, partial return or source parse.
 */
export function readPackedSubtree(
  arena: PackedArena,
  root: number,
  limits: SubtreeLimits,
): PackedSubtree {
  if (
    !Number.isSafeInteger(limits.retained) ||
    limits.retained < 0 ||
    !Number.isSafeInteger(limits.staging) ||
    limits.staging < 0
  )
    throw new Error('Invalid packed subtree limits')
  const seen = new Set<number>()
  const pending = [root]
  let stagingBytes = 0
  let positionCount = 0
  const stage = (workspace = 0) => {
    // Visited-set entries, sorted IDs and temporary materialization-map entries, plus work IDs.
    stagingBytes = Math.max(stagingBytes, 256 + seen.size * 120 + pending.length * 8 + workspace)
    if (stagingBytes > limits.staging) throw new Error('Packed subtree exceeds staging limit')
  }
  stage()
  while (pending.length) {
    const reference = pending.pop()
    if (reference === undefined || seen.has(reference)) continue
    const kind = arena.kind(reference) // Validate selected IDs before any result is visible.
    seen.add(reference)
    stage()
    if (kind === 'position') positionCount++
    const push = (id: number) => {
      if (!seen.has(id)) {
        pending.push(id)
        stage()
      }
    }
    if (kind === 'array') for (const id of arena.elements(reference)) push(id)
    else if (kind === 'object')
      for (const key of arena.keys(reference)) {
        const id = arena.field(reference, key)
        if (id === undefined) throw new Error('Missing arena field')
        push(id)
      }
  }
  let retainedBytes = positionCount * 24 + (positionCount ? 256 : 0)
  const charge = (bytes: number) => {
    retainedBytes += bytes
    if (retainedBytes > limits.retained) throw new Error('Packed subtree exceeds retained limit')
  }
  charge(0)
  const positions = new PackedPositions(positionCount)
  const values = new Map<number, unknown>()
  const materialize = (reference: number) => {
    if (!values.has(reference)) throw new Error('Missing subtree dependency')
    const value = values.get(reference)
    if (arena.kind(reference) !== 'position') return value
    const index = Number(value)
    if (!positions.hasView(index)) charge(96)
    return positions.materialize(index)
  }
  // Backward-only references make increasing record IDs a complete dependency order.
  for (const reference of [...seen].sort((left, right) => left - right)) {
    const kind = arena.kind(reference)
    if (kind === 'scalar') {
      const cost = arena.scalarCost(reference)
      charge(cost.retained)
      stage(cost.workspace)
      const value = arena.scalar(reference)
      values.set(reference, value)
    } else if (kind === 'position') {
      const { start, end } = arena.position(reference)
      values.set(
        reference,
        positions.add([start.line, start.column, start.offset, end.line, end.column, end.offset]),
      )
    } else if (kind === 'array') {
      charge(48 + arena.length(reference) * 8)
      const array: unknown[] = []
      for (const id of arena.elements(reference)) array.push(materialize(id))
      values.set(reference, Object.freeze(array))
    } else {
      const keys = arena.keys(reference)
      charge(48 + keys.length * 16)
      const position = arena.field(reference, 'position')
      const hasPosition = position !== undefined && arena.kind(position) === 'position'
      const object: Record<string, unknown> = hasPosition ? positions.node() : {}
      for (const key of keys) {
        // Keys are part of the resulting graph even when the original arena is released.
        charge(32 + key.length * 2)
        const id = arena.field(reference, key)
        if (id === undefined) throw new Error('Missing arena field')
        if (key === 'position' && hasPosition) positions.attach(object, Number(values.get(id)))
        else {
          const value = materialize(id)
          if (key === '__proto__') Object.defineProperty(object, key, { value, enumerable: true })
          else object[key] = value
        }
      }
      values.set(reference, Object.freeze(object))
    }
  }
  return { value: materialize(root), retainedBytes, stagingBytes, records: seen.size }
}
