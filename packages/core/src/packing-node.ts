import type { PackedArena } from './packing-arena'
import type { PackedText } from './packing-text'

export type PackedNode =
  | { arena: PackedArena; id: number }
  | { fields: readonly (readonly [string, PackedNode])[] }
  | { segments: readonly PackedSegment[]; length: number }
  | { text: PackedText }
  | { shifted: PackedNode; offset: number }
  | { ranged: PackedNode; rangeOffset: number }
  | { number: number }
export type PackedSegment =
  | {
      arena: PackedArena
      id: number
      from: number
      length: number
      offset?: number
      rangeOffset?: number
      /** Opaque, source-free evidence issued only after complete immediate-range validation. */
      rangeProof?: object
      /** Opaque bounds/count/depth evidence for this exact immutable position segment. */
      positionProof?: object
    }
  | { value: PackedNode; length: 1 }

export function offsetNode(node: PackedNode, offset: number): PackedNode {
  if (!offset) return node
  if ('ranged' in node) return rangeNode(offsetNode(node.ranged, offset), node.rangeOffset)
  if ('shifted' in node) {
    offset += node.offset
    node = node.shifted
  }
  return offset ? Object.freeze({ shifted: node, offset }) : node
}

export function rangeNode(node: PackedNode, rangeOffset: number): PackedNode {
  if (!rangeOffset) return node
  if ('ranged' in node) {
    rangeOffset += node.rangeOffset
    node = node.ranged
  }
  return rangeOffset ? Object.freeze({ ranged: node, rangeOffset }) : node
}

export function rangeSegment(segment: PackedSegment, rangeOffset: number): PackedSegment {
  return 'value' in segment
    ? Object.freeze({ value: rangeNode(segment.value, rangeOffset), length: 1 })
    : Object.freeze({ ...segment, rangeOffset: (segment.rangeOffset ?? 0) + rangeOffset })
}

export function offsetSegment(segment: PackedSegment, offset: number): PackedSegment {
  return 'value' in segment
    ? Object.freeze({ value: offsetNode(segment.value, offset), length: 1 })
    : Object.freeze({ ...segment, offset: (segment.offset ?? 0) + offset })
}

export function kind(node: PackedNode) {
  if ('shifted' in node) return kind(node.shifted)
  if ('ranged' in node) return kind(node.ranged)
  if ('number' in node) return 'scalar' as const
  return 'arena' in node
    ? node.arena.kind(node.id)
    : 'text' in node
      ? 'scalar'
      : 'fields' in node
        ? 'object'
        : 'array'
}

export function length(node: PackedNode): number {
  if ('shifted' in node) return length(node.shifted)
  if ('segments' in node) return node.length
  if (!('arena' in node)) throw new Error('Packed path requires array')
  return node.arena.length(node.id)
}
