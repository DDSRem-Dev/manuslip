import type { PackedItemSteps, PackedReadScope } from './packing-capture'
import {
  invalidPackedSemantic,
  packedKeys,
  packedSmall,
  packedString,
} from './packing-validation-read'

export interface PackedWordWalk {
  nodes: number
  depth: number
}
export interface PackedWordCache {
  readonly cached: true
  readonly chunks: Iterable<string>
  readonly nodes: number
  readonly depth: number
  readonly texts: number
  readonly units: number
  readonly maximum: number
}
export type PackedWordReuse = (node: PackedReadScope) => PackedWordCache | undefined
type WordPart = PackedReadScope | PackedWordCache | undefined

/** Text leaves in parser preorder, including empty leaves. Undefined is bounded traversal
 * progress. A yielded scope lives until the next advance; consume its stream first.
 * This checks traversal geometry; the complete mdast schema is a separate validation layer.
 */
export function packedWordTexts(
  root: PackedReadScope,
  sourceLength: number,
  limits: { nodes: number; depth: number },
): Generator<PackedReadScope | undefined, void, undefined>
export function packedWordTexts(
  root: PackedReadScope,
  sourceLength: number,
  limits: { nodes: number; depth: number },
  reuse: PackedWordReuse | undefined,
): Generator<WordPart, void, undefined>
export function* packedWordTexts(
  root: PackedReadScope,
  sourceLength: number,
  limits: { nodes: number; depth: number },
  reuse?: PackedWordReuse,
): Generator<WordPart, void, undefined> {
  if (packedSmall(root, ['type']) !== 'root') invalidPackedSemantic()
  yield* wordTexts(root, sourceLength, limits, { nodes: 0, depth: 0 }, reuse)
}

/** Internal subtree scan used only while constructing an independently validated cache. */
export function* packedSubtreeWordTexts(
  root: PackedReadScope,
  sourceLength: number,
  limits: { nodes: number; depth: number },
  walk: PackedWordWalk,
): Generator<PackedReadScope | undefined, void, undefined> {
  for (const part of wordTexts(root, sourceLength, limits, walk)) {
    if (part && 'cached' in part) throw new Error('Unexpected word subtree cache')
    yield part
  }
}
function* wordTexts(
  root: PackedReadScope,
  sourceLength: number,
  limits: { nodes: number; depth: number },
  walk: PackedWordWalk,
  reuse?: PackedWordReuse,
): Generator<WordPart, void, undefined> {
  const frames: PackedItemSteps[] = []
  const visit = (scope: PackedReadScope): WordPart => {
    if (++walk.nodes > limits.nodes || frames.length + 1 > limits.depth)
      throw new Error('Packed word traversal limit')
    walk.depth = Math.max(walk.depth, frames.length + 1)
    // The sealed cache already walked this exact immutable record. Recheck current
    // logical bounds before borrowing it; new/overlaid records still check every field.
    const cached = frames.length === 1 ? reuse?.(scope) : undefined
    if (cached) {
      if (cached.maximum > sourceLength) invalidPackedSemantic()
      walk.nodes += cached.nodes - 1
      if (walk.nodes > limits.nodes || frames.length + cached.depth > limits.depth)
        throw new Error('Packed word traversal limit')
      walk.depth = Math.max(walk.depth, frames.length + cached.depth)
      return cached
    }
    if (scope.kind() !== 'object' || scope.keyCount() > 10) invalidPackedSemantic()
    const type = packedSmall(scope, ['type'])
    if (typeof type !== 'string') invalidPackedSemantic()
    if (type === 'text') {
      packedKeys(scope, [], ['type', 'value'], ['position'])
      packedString(scope, ['value'], sourceLength)
      return scope
    }
    if (scope.hasField('children')) frames.push(scope.elementSteps(['children']))
    return undefined
  }
  try {
    yield visit(root)
    while (frames.length) {
      const frame = frames.at(-1)
      if (!frame) throw new Error('Missing packed word frame')
      const next = frame.next()
      if (next.done) {
        frames.pop()
        yield undefined
      } else yield next.value === undefined ? undefined : visit(next.value)
    }
  } finally {
    for (const frame of frames) frame.return()
  }
}
