import type { Nodes } from 'mdast'
import { type Heading, type SemanticBlock, semanticLimits } from './contracts'
import { countFragmentDocument } from './fragment-counts'
import { assertFragmentProof } from './fragment-proof'
import type { MarkdownFragment } from './markdown-fragment'
import type { PackedArena } from './packing-arena'
import type { PackedCapture } from './packing-capture'
import type { PackedDocumentBaseline } from './packing-document-baseline'
import type { PackedResource } from './packing-resources'
import type { PackedOperation } from './packing-revision'
import { type PackedIdentity, type PackedSource, sameIdentity } from './packing-source'
import type { PackedPath } from './packing-view'
import type { PackedWordBaseline } from './packing-word-baseline'
import type { SemanticDependencies } from './semantic-dependencies'
import { describeBlock, describeHeading, describesBlock } from './semantic-description'

export interface MetadataLimits {
  retained: number
  staging: number
  nodes: number
  depth: number
}
interface Replacement<T> {
  readonly start: number
  readonly remove: number
  readonly values: readonly T[]
}
export interface DocumentMetadataPatch {
  readonly base: PackedIdentity
  readonly source: PackedSource
  readonly blocks: Replacement<Readonly<SemanticBlock>>
  readonly outline: Replacement<Readonly<Heading>>
  readonly counts: Readonly<{ words: number; characters: number }>
  readonly timings: Readonly<{ parse: number; describe: number }>
  readonly retainedBytes: number
  readonly stagingBytes: number
  resources(): Generator<PackedResource>
}
const certified = new WeakMap<object, { token: object; document: PackedPath }>()
const fragments = new WeakMap<object, object>()
function footprint(source: PackedSource) {
  return function* (this: DocumentMetadataPatch): Generator<PackedResource> {
    yield { key: source, bytes: source.retainedBytes }
    yield { key: this, bytes: this.retainedBytes - source.retainedBytes }
  }
}

/** Complete non-root parser metadata for an attested local edit, without expanding the root. */
export function describeDocumentFragment(
  request: {
    capture: PackedCapture
    dependencies: SemanticDependencies
    fragment: MarkdownFragment
    document: PackedPath
    parseMs: number
    words?: PackedWordBaseline
    baseline?: PackedDocumentBaseline
  },
  limits: MetadataLimits,
): DocumentMetadataPatch {
  const started = performance.now()
  for (const key of ['retained', 'staging', 'nodes', 'depth'] as const)
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0)
      throw new Error('Invalid document metadata limits')
  if (
    limits.retained > semanticLimits.workerCacheBytes ||
    limits.staging > semanticLimits.messageBytes ||
    limits.nodes > semanticLimits.blocks * 16 ||
    limits.depth > 64
  )
    throw new Error('Invalid document metadata limits')
  const { capture, dependencies, fragment: patch, document, parseMs, words, baseline } = request
  if (
    !Number.isFinite(parseMs) ||
    parseMs < 0 ||
    document.length > 64 ||
    document.some((part) =>
      typeof part === 'number'
        ? !Number.isSafeInteger(part) || part < 0
        : typeof part !== 'string' || part.length > 256,
    )
  )
    throw new Error('Invalid document metadata request')
  assertFragmentProof(dependencies, patch)
  dependencies.assertBase(capture.identity, patch.baseSource)
  if (!sameIdentity(patch.base, capture.identity))
    throw new Error('Document metadata base mismatch')
  const scalar = (field: string) =>
    capture.reader.scalar([...document, field], { retained: 4096, staging: 4096 })
  if (
    scalar('sourceHash') !== patch.base.sourceHash ||
    scalar('parserVersion') !== patch.base.parserVersion
  )
    throw new Error('Stale document metadata; full resync required')
  let retained =
    patch.source.retainedBytes +
    1024 +
    Object.values(patch.base).reduce((sum, value) => sum + String(value).length * 2, 0) +
    document.reduce<number>((sum, part) => sum + 64 + String(part).length * 2, 0)
  let staging = 1024
  let nodes = 0
  const charge = (bytes: number) => {
    if (retained + bytes > limits.retained)
      throw new Error('Document metadata exceeds retained limit')
    retained += bytes
  }
  const stage = (bytes: number) => {
    staging = Math.max(staging, bytes)
    if (staging > limits.staging) throw new Error('Document metadata exceeds staging limit')
  }
  charge(0)
  stage(1024)
  const blocks: Readonly<SemanticBlock>[] = []
  const outline: Readonly<Heading>[] = []
  const pending: { node: Nodes; depth: number }[] = []
  for (let index = patch.children.length - 1; index >= 0; index--) {
    const node = patch.children[index]
    if (node) pending.push({ node, depth: 1 })
  }
  while (pending.length) {
    stage(2048 + pending.length * 128)
    const item = pending.pop()
    if (!item) break
    if (++nodes > limits.nodes) throw new Error('Document metadata node limit')
    if (item.depth > limits.depth) throw new Error('Document metadata depth limit')
    const { node } = item
    const span = (node.position?.end.offset ?? 0) - (node.position?.start.offset ?? 0)
    stage(2048 + pending.length * 128 + span * 8 * item.depth)
    if (describesBlock(node.type)) {
      if (blocks.length >= semanticLimits.blocks) throw new Error('Document metadata block limit')
      charge(384 + node.type.length * 2)
      const block = describeBlock(node, patch.source.text)
      if (block) blocks.push(Object.freeze(block))
    }
    if (node.type === 'heading') {
      charge(256 + span * 2)
      const heading = describeHeading(node)
      if (heading) outline.push(Object.freeze(heading))
    }
    if ('children' in node) {
      stage(2048 + (pending.length + node.children.length) * 128)
      for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index]
        if (child) pending.push({ node: child, depth: item.depth + 1 })
      }
    }
  }
  const before = dependencies.blocks.at(patch.start)
  const ranges = baseline?.metadataRange(capture, document, patch.start, patch.remove)
  function locate<T>(field: 'blocks' | 'outline', values: readonly T[]): Replacement<T> {
    const certified = ranges?.[field]
    if (certified) {
      if (certified.total - certified.remove + values.length > semanticLimits.blocks)
        throw new Error('Document metadata block limit')
      return Object.freeze({
        start: certified.start,
        remove: certified.remove,
        values: Object.freeze(values),
      })
    }
    const size = capture.reader.length([...document, field])
    if (size > semanticLimits.blocks) throw new Error('Document metadata block limit')
    let start = size
    let remove = 0
    let index = 0
    let previous = 0
    let ended = false
    for (const item of capture.reader.elements([...document, field])) {
      stage(4096)
      const from = item.scalar(['from'], { retained: 16, staging: 0 })
      const to = item.scalar(['to'], { retained: 16, staging: 0 })
      if (
        typeof from !== 'number' ||
        typeof to !== 'number' ||
        !Number.isSafeInteger(from) ||
        !Number.isSafeInteger(to) ||
        from < previous ||
        to < from ||
        to > patch.baseSource.length
      )
        throw new Error('Invalid document metadata range')
      previous = from
      if (before && start === size && from >= before.from) start = index
      if (before && patch.remove && from >= before.from && to <= before.to) {
        if (ended) throw new Error('Ambiguous document metadata range')
        if (!remove) start = index
        remove++
      } else if (remove) ended = true
      index++
    }
    if (size - remove + values.length > semanticLimits.blocks)
      throw new Error('Document metadata block limit')
    return Object.freeze({ start, remove, values: Object.freeze(values) })
  }
  const replacementBlocks = locate('blocks', blocks)
  const replacementOutline = locate('outline', outline)
  const counts = countFragmentDocument(capture, [...document, 'root'], patch, limits, words)
  stage(counts.stagingBytes)
  const result: DocumentMetadataPatch = Object.freeze({
    base: patch.base,
    source: patch.source,
    blocks: replacementBlocks,
    outline: replacementOutline,
    counts: Object.freeze({ words: counts.words, characters: counts.characters }),
    timings: Object.freeze({ parse: parseMs, describe: performance.now() - started }),
    retainedBytes: retained,
    stagingBytes: staging,
    resources: footprint(patch.source),
  })
  let token = fragments.get(patch)
  if (!token) {
    token = Object.freeze({})
    fragments.set(patch, token)
  }
  certified.set(result, { token, document: Object.freeze([...document]) })
  return result
}

/** Build ordered operations over one caller-admitted payload containing root and metadata values. */
export function documentFragmentOperations(
  patch: MarkdownFragment,
  metadata: DocumentMetadataPatch,
  payload: PackedArena,
  document: PackedPath,
): PackedOperation[] {
  const proof = certified.get(metadata)
  if (
    !proof ||
    proof.token !== fragments.get(patch) ||
    proof.document.length !== document.length ||
    proof.document.some((part, index) => part !== document[index]) ||
    !sameIdentity(patch.base, metadata.base) ||
    patch.source !== metadata.source
  )
    throw new Error('Document fragment metadata mismatch')
  const record = (field: string) => {
    const id = payload.field(payload.root, field)
    if (id === undefined) throw new Error('Missing document fragment payload field')
    return id
  }
  const operations: PackedOperation[] = [
    {
      kind: 'splice',
      path: [...document, 'root', 'children'],
      start: patch.start,
      remove: patch.remove,
      record: record('children'),
    },
    {
      kind: 'offset',
      path: [...document, 'root', 'children'],
      start: patch.start + patch.children.length,
      offset: patch.suffixOffset,
    },
    { kind: 'replace', path: [...document, 'root', 'position'], record: record('position') },
  ]
  for (const field of ['blocks', 'outline'] as const) {
    const replacement = metadata[field]
    operations.push(
      {
        kind: 'splice',
        path: [...document, field],
        start: replacement.start,
        remove: replacement.remove,
        record: record(field),
      },
      {
        kind: 'range',
        path: [...document, field],
        start: replacement.start + replacement.values.length,
        offset: patch.suffixOffset,
      },
    )
  }
  for (const field of ['counts', 'sourceHash', 'parserVersion', 'timings'])
    operations.push({ kind: 'replace', path: [...document, field], record: record(field) })
  return operations
}
