import type { PackedArena } from './packing-arena'
import { PackedMetadataBudget } from './packing-metadata-budget'
import {
  kind,
  length,
  offsetNode,
  offsetSegment,
  type PackedNode,
  type PackedSegment,
  rangeNode,
  rangeSegment,
} from './packing-node'
import type { PackedRecordKey } from './packing-record-key'
import {
  segmentElementSteps as elementSteps,
  type PackedElementCursor,
  segmentElementCursor,
} from './packing-segment-steps'
import { admitPackedKeys, admitScalar, PackedText, type ScalarLimits } from './packing-text'
import { packedTextStepCost } from './packing-text-stream'
import type { PackedWork } from './packing-work'

export type { PackedNode, PackedSegment }
export { elementSteps, kind, length, offsetNode, offsetSegment, rangeNode, rangeSegment }

export type PackedPath = readonly (string | number)[]
/** Internal record location for an untransformed arena, or a copied composite path.
 * A record number owns no arena and is used only with the original guarded lookup.
 */
export type PackedPrefix = PackedPath | number
export interface PackedArrayIndex {
  readonly length: number
  get(index: number): PackedView
}
const emptyPath: PackedPath = Object.freeze([])
function rangeField(node: Extract<PackedNode, { ranged: PackedNode }>, key: string): PackedNode {
  const value = child(node.ranged, key)
  if (key !== 'from' && key !== 'to') return value
  const scalar = new PackedView(value).readScalar({ retained: 16, staging: 0 })
  if (typeof scalar !== 'number') throw new Error('Invalid packed range field')
  return Object.freeze({ number: scalar + node.rangeOffset })
}

export function fields(node: PackedNode): readonly (readonly [string, PackedNode])[] {
  if ('ranged' in node)
    return fields(node.ranged).map(
      ([key, value]) =>
        [key, key === 'from' || key === 'to' ? rangeField(node, key) : value] as const,
    )
  if ('shifted' in node)
    return fields(node.shifted).map(
      ([key, value]) => [key, offsetNode(value, node.offset)] as const,
    )
  if ('fields' in node) return node.fields
  if (!('arena' in node) || node.arena.kind(node.id) !== 'object')
    throw new Error('Packed path requires object')
  return [...node.arena.fields(node.id)].map(
    ([key, id]) => [key, { arena: node.arena, id }] as const,
  )
}
export function segments(node: PackedNode): readonly PackedSegment[] {
  if ('shifted' in node)
    return segments(node.shifted).map((segment) => offsetSegment(segment, node.offset))
  if ('segments' in node) return node.segments
  if (!('arena' in node)) throw new Error('Packed path requires array')
  return [{ arena: node.arena, id: node.id, from: 0, length: node.arena.length(node.id) }]
}
function* segmentElements(segment: PackedSegment): Generator<PackedNode> {
  if ('value' in segment) {
    yield segment.value
    return
  }
  let index = 0
  for (const id of segment.arena.elements(segment.id)) {
    if (index >= segment.from + segment.length) break
    if (index++ >= segment.from)
      yield rangeNode(
        offsetNode({ arena: segment.arena, id }, segment.offset ?? 0),
        segment.rangeOffset ?? 0,
      )
  }
}
export function* elements(node: PackedNode): Generator<PackedNode> {
  for (const segment of segments(node)) yield* segmentElements(segment)
}
function elementView(node: PackedNode): PackedView {
  return new PackedView(node)
}
export function child(node: PackedNode, part: string | number): PackedNode {
  if ('ranged' in node) {
    if (typeof part !== 'string') throw new Error('Packed path requires object')
    return rangeField(node, part)
  }
  if ('shifted' in node) return offsetNode(child(node.shifted, part), node.offset)
  if (typeof part === 'string') {
    if ('arena' in node) {
      const id = node.arena.field(node.id, part)
      if (id !== undefined) return { arena: node.arena, id }
    } else if ('fields' in node) {
      const field = node.fields.find(([key]) => key === part)
      if (field) return field[1]
    }
  } else if (Number.isSafeInteger(part) && part >= 0 && part < length(node)) {
    let index = part
    for (const segment of segments(node)) {
      if (index < segment.length)
        return 'value' in segment
          ? segment.value
          : rangeNode(
              offsetNode(
                {
                  arena: segment.arena,
                  id: segment.arena.element(segment.id, segment.from + index),
                },
                segment.offset ?? 0,
              ),
              segment.rangeOffset ?? 0,
            )
      index -= segment.length
    }
  }
  throw new Error('Missing or invalid packed path')
}

function unshifted(node: PackedNode): PackedNode {
  while ('shifted' in node) node = node.shifted
  return node
}

/** Queries on a complete immutable arena need only a record ID. The same per-edge
 * checks apply without transient node wrappers or an iterator for every short/empty path.
 */
function arenaPath(arena: PackedArena, id: number, path: PackedPath): number {
  for (let index = 0; index < path.length; index++) {
    const part = path[index]
    if (typeof part === 'string') {
      const field = arena.field(id, part)
      if (field === undefined) throw new Error('Missing or invalid packed path')
      id = field
    } else {
      if (part === undefined || !Number.isSafeInteger(part) || part < 0 || part >= arena.length(id))
        throw new Error('Missing or invalid packed path')
      id = arena.element(id, part)
    }
  }
  return id
}
function arenaReference(
  node: Extract<PackedNode, { arena: PackedArena }>,
  path: PackedPath,
  prefix: PackedPrefix,
): number {
  const id = typeof prefix === 'number' ? prefix : arenaPath(node.arena, node.id, prefix)
  return arenaPath(node.arena, id, path)
}

function scalar(node: PackedNode): null | boolean | number | string {
  node = unshifted(node)
  if ('number' in node) return node.number
  if ('text' in node) return node.text.scalar()
  if (!('arena' in node)) throw new Error('Packed value is not scalar')
  return node.arena.scalar(node.id)
}

function scalarCost(node: PackedNode): { retained: number; workspace: number } {
  node = unshifted(node)
  if ('number' in node) return { retained: 16, workspace: 0 }
  if ('text' in node) return node.text.scalarCost()
  if (!('arena' in node)) throw new Error('Packed value is not scalar')
  return node.arena.scalarCost(node.id)
}

function position(node: PackedNode): ReturnType<PackedArena['position']> {
  if ('shifted' in node) {
    const value = position(node.shifted)
    const offset = node.offset
    const point = (endpoint: typeof value.start) =>
      Object.freeze({ ...endpoint, offset: endpoint.offset + offset })
    return Object.freeze({ start: point(value.start), end: point(value.end) })
  }
  if (!('arena' in node)) throw new Error('Packed value is not position')
  return node.arena.position(node.id)
}

function objectKeys(node: PackedNode): readonly string[] {
  while ('shifted' in node || 'ranged' in node)
    node = 'shifted' in node ? node.shifted : node.ranged
  if ('arena' in node) return node.arena.keys(node.id)
  return Object.freeze(fields(node).map(([key]) => key))
}

/** A caller-owned cursor. Private graph references never expose mutable wire or overlay data. */
export class PackedView {
  readonly #node: PackedNode
  constructor(node: PackedNode) {
    this.#node = node
    Object.freeze(this)
  }
  /** Optional dense index for one untransformed arena array. Callers reserve this
   * storage before starting indexArraySteps; overlays use the ordinary view index.
   */
  compactArrayBytes(): number | undefined {
    const node = this.#node
    return 'arena' in node && node.arena.kind(node.id) === 'array'
      ? 256 + node.arena.length(node.id) * 4
      : undefined
  }
  *indexArraySteps(): Generator<void, PackedArrayIndex, undefined> {
    const node = this.#node
    if (!('arena' in node) || node.arena.kind(node.id) !== 'array')
      throw new Error('Packed compact index requires an untransformed arena array')
    const length = node.arena.length(node.id)
    const references = new Uint32Array(length)
    let index = 0
    for (const reference of node.arena.elements(node.id)) {
      references[index++] = reference
      if (index % 256 === 0) yield
    }
    if (index !== length) throw new Error('Invalid packed array index cardinality')
    return {
      length,
      get(at) {
        if (!Number.isSafeInteger(at) || at < 0 || at >= length)
          throw new Error('Invalid packed array index')
        const id = references[at]
        if (id === undefined) throw new Error('Missing packed array index item')
        return new PackedView({ arena: node.arena, id })
      },
    }
  }
  /** Atomic path queries resolve nodes without allocating a temporary view or retaining it. */
  #nodeAt(path: PackedPath, prefix: PackedPrefix = emptyPath): PackedNode {
    let node = this.#node
    if ('arena' in node) {
      const id = arenaReference(node, path, prefix)
      return id === node.id ? node : { arena: node.arena, id }
    }
    if (typeof prefix === 'number') throw new Error('Invalid packed reader prefix')
    for (const part of prefix) node = child(node, part)
    for (const part of path) node = child(node, part)
    return node
  }
  /** Resolve an immutable arena path once without retaining a view or arena in its scope.
   * Composite and transformed roots keep their complete copied path and lazy semantics.
   */
  scopePath(path: PackedPath, prefix: PackedPrefix): PackedPrefix {
    const node = this.#node
    if ('arena' in node) return arenaReference(node, path, prefix)
    if (typeof prefix === 'number') throw new Error('Invalid packed reader prefix')
    const checked = Object.freeze([...prefix, ...path])
    this.checkPath(checked)
    return checked
  }
  /** Check a copied scope path without allocating a view or exposing the selected node. */
  checkPath(path: PackedPath): void {
    this.#nodeAt(path)
  }
  kind(path: PackedPath = emptyPath, prefix: PackedPrefix = emptyPath) {
    const node = this.#node
    if ('arena' in node) return node.arena.kind(arenaReference(node, path, prefix))
    return kind(this.#nodeAt(path, prefix))
  }
  /** Check an own object field without materializing keys or transformed children. */
  hasField(key: string, prefix: PackedPrefix = emptyPath): boolean {
    if (typeof key !== 'string') throw new Error('Invalid packed field name')
    const root = this.#node
    if ('arena' in root)
      return root.arena.field(arenaReference(root, emptyPath, prefix), key) !== undefined
    let node = this.#nodeAt(emptyPath, prefix)
    while ('shifted' in node || 'ranged' in node)
      node = 'shifted' in node ? node.shifted : node.ranged
    if ('arena' in node) return node.arena.field(node.id, key) !== undefined
    if ('fields' in node) return node.fields.some(([name]) => name === key)
    throw new Error('Packed path requires object')
  }
  at(path: PackedPath, prefix: PackedPrefix = emptyPath): PackedView {
    if (!path.length && typeof prefix !== 'number' && !prefix.length) return this
    return new PackedView(this.#nodeAt(path, prefix))
  }
  recordKey(
    path: PackedPath = emptyPath,
    prefix: PackedPrefix = emptyPath,
  ): PackedRecordKey | undefined {
    const root = this.#node
    if ('arena' in root) {
      const id = arenaReference(root, path, prefix)
      return Object.freeze({ token: root.arena.recordToken(id), record: id, offset: 0, range: 0 })
    }
    let node = this.#nodeAt(path, prefix)
    let offset = 0
    let range = 0
    while ('shifted' in node || 'ranged' in node) {
      if ('shifted' in node) {
        offset += node.offset
        node = node.shifted
      } else {
        range += node.rangeOffset
        node = node.ranged
      }
    }
    if (!('arena' in node)) return undefined
    return Object.freeze({ token: node.arena.recordToken(node.id), record: node.id, offset, range })
  }
  /** Shallow records are available only for an untransformed arena subtree. */
  encodedRecord(prefix: PackedPrefix, reference?: number) {
    const node = this.#nodeAt(emptyPath, prefix)
    if (!('arena' in node)) {
      if (reference !== undefined) throw new Error('Packed record requires an untransformed arena')
      return undefined
    }
    if (reference !== undefined && reference > node.id)
      throw new Error('Invalid packed subtree record')
    return node.arena.encodedRecord(reference ?? node.id)
  }
  encodedReference(prefix: PackedPrefix, reference: number, offset: number) {
    const node = this.#nodeAt(emptyPath, prefix)
    if (!('arena' in node) || reference > node.id) throw new Error('Invalid packed subtree record')
    return node.arena.encodedReference(reference, offset)
  }
  encodedText(prefix: PackedPrefix, reference: number): PackedView {
    const node = this.#nodeAt(emptyPath, prefix)
    if (!('arena' in node) || reference > node.id) throw new Error('Invalid packed subtree record')
    if (node.arena.scalarType(reference) !== 'string')
      throw new Error('Packed record is not a string')
    return new PackedView({ arena: node.arena, id: reference })
  }
  /** Only an untransformed complete arena root has an existing full wire encoding. */
  encoding(): { bytes: number; records: number } | undefined {
    const node = this.#node
    return 'arena' in node && node.id === node.arena.root
      ? { bytes: node.arena.bytes, records: node.arena.records }
      : undefined
  }
  *copyEncoding(destination: ArrayBuffer): Generator<void> {
    const node = this.#node
    if (!('arena' in node) || node.id !== node.arena.root)
      throw new Error('Packed encoding requires an untransformed complete root')
    yield* node.arena.copyEncoding(destination)
  }
  scalar(
    path: PackedPath = emptyPath,
    prefix: PackedPrefix = emptyPath,
  ): null | boolean | number | string {
    const node = this.#node
    if ('arena' in node) return node.arena.scalar(arenaReference(node, path, prefix))
    return scalar(this.#nodeAt(path, prefix))
  }
  scalarType(
    path: PackedPath = emptyPath,
    prefix: PackedPrefix = emptyPath,
  ): 'null' | 'boolean' | 'number' | 'string' {
    const root = this.#node
    if ('arena' in root) return root.arena.scalarType(arenaReference(root, path, prefix))
    const node = unshifted(this.#nodeAt(path, prefix))
    if ('number' in node) return 'number'
    if ('text' in node) return 'string'
    if ('arena' in node) return node.arena.scalarType(node.id)
    throw new Error('Packed value is not scalar')
  }
  scalarCost(
    path: PackedPath = emptyPath,
    prefix: PackedPrefix = emptyPath,
  ): { retained: number; workspace: number } {
    const root = this.#node
    if ('arena' in root) return root.arena.scalarCost(arenaReference(root, path, prefix))
    return scalarCost(this.#nodeAt(path, prefix))
  }
  readScalar(limits: ScalarLimits, path: PackedPath = emptyPath, prefix: PackedPrefix = emptyPath) {
    const root = this.#node
    if ('arena' in root) {
      const id = arenaReference(root, path, prefix)
      admitScalar(root.arena.scalarCost(id), limits)
      return root.arena.scalar(id)
    }
    const node = this.#nodeAt(path, prefix)
    admitScalar(scalarCost(node), limits)
    return scalar(node)
  }
  textLength(path: PackedPath = emptyPath, prefix: PackedPrefix = emptyPath): number {
    const root = this.#node
    if ('arena' in root) return root.arena.stringLength(arenaReference(root, path, prefix))
    const node = unshifted(this.#nodeAt(path, prefix))
    if ('text' in node) return node.text.length
    if (!('arena' in node)) throw new Error('Packed value is not a string')
    return node.arena.stringLength(node.id)
  }
  textStepCost(path: PackedPath = emptyPath, prefix: PackedPrefix = emptyPath) {
    this.textLength(path, prefix) // Verify string kind without decoding.
    return packedTextStepCost
  }
  /** Borrow only an already owned, bounded arena string. Overlaid text still streams. */
  cachedText(path: PackedPath = emptyPath, prefix: PackedPrefix = emptyPath): string | undefined {
    const root = this.#node
    if ('arena' in root) return root.arena.cachedString(arenaReference(root, path, prefix))
    const node = unshifted(this.#nodeAt(path, prefix))
    if ('text' in node) return undefined
    if (!('arena' in node)) throw new Error('Packed value is not a string')
    return node.arena.cachedString(node.id)
  }
  *textSteps(): Generator<string | undefined> {
    const node = unshifted(this.#node)
    if ('text' in node) yield* node.text.steps()
    else if ('arena' in node)
      yield* node.arena.stringSteps(node.id, node.arena.stringWorkspace(node.id))
    else throw new Error('Packed value is not a string')
  }
  position(
    path: PackedPath = emptyPath,
    prefix: PackedPrefix = emptyPath,
  ): ReturnType<PackedArena['position']> {
    const root = this.#node
    if ('arena' in root) return root.arena.position(arenaReference(root, path, prefix))
    return position(this.#nodeAt(path, prefix))
  }
  readPosition(
    limits: ScalarLimits,
    path: PackedPath = emptyPath,
    prefix: PackedPrefix = emptyPath,
  ) {
    const root = this.#node
    if ('arena' in root) {
      const id = arenaReference(root, path, prefix)
      admitScalar({ retained: 272, workspace: 0 }, limits)
      return root.arena.position(id)
    }
    const node = this.#nodeAt(path, prefix)
    admitScalar({ retained: 272, workspace: 0 }, limits)
    return position(node)
  }
  keys(path: PackedPath = emptyPath, prefix: PackedPrefix = emptyPath): readonly string[] {
    const root = this.#node
    if ('arena' in root) return root.arena.keys(arenaReference(root, path, prefix))
    return objectKeys(this.#nodeAt(path, prefix))
  }
  /** Match complete own fields without exporting/copying an arena's immutable shape.
   * Resolve once before admission; callers may change their paths from budget getters.
   */
  matchesKeys(
    required: readonly string[],
    optional: readonly string[],
    limits: ScalarLimits,
    path: PackedPath = emptyPath,
    prefix: PackedPrefix = emptyPath,
  ): boolean {
    const root = this.#node
    let keys: readonly string[]
    if ('arena' in root) {
      const id = arenaReference(root, path, prefix)
      if (root.arena.kind(id) !== 'object') return false
      keys = root.arena.keys(id)
    } else {
      const node = this.#nodeAt(path, prefix)
      if (kind(node) !== 'object') return false
      keys = objectKeys(node)
    }
    if (keys.length > required.length + optional.length) return false
    admitPackedKeys(keys, limits)
    return (
      required.every((key) => keys.includes(key)) &&
      keys.every((key) => required.includes(key) || optional.includes(key))
    )
  }
  keyCount(path: PackedPath = emptyPath, prefix: PackedPrefix = emptyPath): number {
    const root = this.#node
    if ('arena' in root) return root.arena.keys(arenaReference(root, path, prefix)).length
    let node = this.#nodeAt(path, prefix)
    while ('shifted' in node || 'ranged' in node)
      node = 'shifted' in node ? node.shifted : node.ranged
    if ('arena' in node) return node.arena.keys(node.id).length
    if ('fields' in node) return node.fields.length
    throw new Error('Packed path requires object')
  }
  length(path: PackedPath = emptyPath, prefix: PackedPrefix = emptyPath) {
    const root = this.#node
    if ('arena' in root) return root.arena.length(arenaReference(root, path, prefix))
    return length(this.#nodeAt(path, prefix))
  }
  *elements(): Generator<PackedView> {
    for (const node of elements(this.#node)) yield new PackedView(node)
  }
  elementSteps(): PackedWork<void, PackedView | undefined> {
    return elementSteps(this.#node, new PackedMetadataBudget(), elementView)
  }
  /** Internal capture cursor; its parent owns immediate revocation and running cleanup. */
  elementCursor(): PackedElementCursor<PackedView> {
    return segmentElementCursor(this.#node, new PackedMetadataBudget(), elementView)
  }
}

export function spliceText(
  node: PackedNode,
  start: number,
  remove: number,
  arena: PackedArena,
  id: number,
  charge: (bytes: number) => void,
): PackedNode {
  // Position-only wrappers do not alter scalar spelling or scalar replacement semantics.
  if ('shifted' in node) return spliceText(node.shifted, start, remove, arena, id, charge)
  const text =
    'text' in node ? node.text : 'arena' in node ? PackedText.from(node.arena, node.id) : undefined
  if (!text) throw new Error('Packed value is not a string')
  return Object.freeze({ text: text.splice(start, remove, arena, id, charge) })
}

/** Slice segment metadata, never the unchanged array's record IDs or values. */
export function sliceSegments(node: PackedNode, from: number, to: number): PackedSegment[] {
  const result: PackedSegment[] = []
  let offset = 0
  for (const segment of segments(node)) {
    const start = Math.max(from, offset)
    const end = Math.min(to, offset + segment.length)
    if (end > start)
      result.push(
        'value' in segment
          ? segment
          : { ...segment, from: segment.from + start - offset, length: end - start },
      )
    offset += segment.length
    if (offset >= to) break
  }
  return result
}

export function splice(
  node: PackedNode,
  start: number,
  remove: number,
  insert: PackedNode | undefined,
  singleton: boolean,
  charge: (bytes: number) => void,
): PackedNode {
  const size = length(node)
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(remove) ||
    start < 0 ||
    remove < 0 ||
    start > size ||
    remove > size - start
  )
    throw new Error('Invalid packed splice range')
  // Admit worst-case segment copies before allocating them. No nested overlay chains.
  const incoming = insert ? (singleton ? 1 : segments(insert).length) : 0
  charge(96 + (segments(node).length * 2 + incoming) * 80)
  const inserted: PackedSegment[] = insert
    ? singleton
      ? [{ value: insert, length: 1 }]
      : [...segments(insert)]
    : []
  const next = [
    ...sliceSegments(node, 0, start),
    ...inserted,
    ...sliceSegments(node, start + remove, size),
  ]
  const added = insert ? (singleton ? 1 : length(insert)) : 0
  const total = size - remove + added
  if (!Number.isSafeInteger(total) || total > 0xffffffff)
    throw new Error('Invalid packed array length')
  for (const segment of next) Object.freeze(segment)
  return Object.freeze({ segments: Object.freeze(next), length: total })
}

export function replaceChild(
  node: PackedNode,
  part: string | number,
  value: PackedNode,
  charge: (bytes: number) => void,
): PackedNode {
  if (typeof part === 'number') return splice(node, part, 1, value, true, charge)
  if (kind(node) !== 'object') throw new Error('Packed path requires object')
  const keys = 'arena' in node ? node.arena.keys(node.id) : fields(node).map(([key]) => key)
  charge(96 + keys.reduce((bytes, key) => bytes + 256 + key.length * 2, 0))
  const next = fields(node).map(([key, old]) =>
    Object.freeze([key, key === part ? value : old] as const),
  )
  return Object.freeze({ fields: Object.freeze(next) })
}
