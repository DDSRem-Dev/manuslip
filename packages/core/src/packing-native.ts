import type { PackedReadScope } from './packing-capture'
import type { PackedPath } from './packing-view'

/** Bounded caller-owned native copy of a selected subtree; no capture or cursor escapes. */
export function readPackedNative(
  reader: PackedReadScope,
  path: PackedPath,
  limits: { retained: number; staging: number; nodes: number; depth: number },
  positionOffset = 0,
) {
  for (const key of ['retained', 'staging', 'nodes', 'depth'] as const)
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0)
      throw new Error('Invalid packed native limits')
  if (limits.depth > 256) throw new Error('Invalid packed native limits')
  if (!Number.isSafeInteger(positionOffset) || Math.abs(positionOffset) > 0xffffffff)
    throw new Error('Invalid packed native position shift')
  let retainedBytes = 0
  let stagingBytes = 0
  let nodes = 0
  const charge = (bytes: number) => {
    if (retainedBytes + bytes > limits.retained)
      throw new Error('Packed native exceeds retained limit')
    retainedBytes += bytes
  }
  const stage = (bytes: number) => {
    stagingBytes = Math.max(stagingBytes, bytes)
    if (stagingBytes > limits.staging) throw new Error('Packed native exceeds staging limit')
  }
  const read = (scope: PackedReadScope, path: PackedPath, depth: number): unknown => {
    if (++nodes > limits.nodes || depth > limits.depth)
      throw new Error('Packed native node/depth limit')
    stage(1024 + depth * 1024)
    switch (scope.kind(path)) {
      case 'scalar': {
        const cost = scope.scalarCost(path)
        charge(cost.retained)
        stage(1024 + depth * 1024 + cost.workspace)
        return scope.scalar(path, limits)
      }
      case 'position': {
        charge(272)
        const position = scope.position(path, limits)
        const point = (value: typeof position.start) => {
          const offset = value.offset + positionOffset
          if (!Number.isSafeInteger(offset) || offset < 0 || offset > 0xffffffff)
            throw new Error('Packed native position range')
          return Object.freeze({ ...value, offset })
        }
        return Object.freeze({ start: point(position.start), end: point(position.end) })
      }
      case 'array': {
        charge(64 + scope.length(path) * 8)
        const result: unknown[] = []
        for (const item of scope.elements(path)) result.push(read(item, [], depth + 1))
        return Object.freeze(result)
      }
      case 'object': {
        stage(9216 + depth * 1024)
        const keys = scope.keys(path, { retained: Math.min(limits.staging, 8192), staging: 0 })
        charge(64 + keys.reduce((sum, key) => sum + 64 + key.length * 2, 0))
        const result = {}
        for (const key of keys)
          Object.defineProperty(result, key, {
            value: read(scope, [...path, key], depth + 1),
            enumerable: true,
          })
        return Object.freeze(result)
      }
    }
  }
  const value = read(reader, path, 0)
  return { value, retainedBytes, stagingBytes, nodes }
}
