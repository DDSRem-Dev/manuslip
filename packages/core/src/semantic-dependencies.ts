import { type SourceRange, semanticLimits } from './contracts'
import { collectDependencyFragment } from './dependency-fragment'
import { DependencyRanges, type DependencyRecords } from './dependency-ranges'
import { assertFragmentProof } from './fragment-proof'
import type { MarkdownFragment } from './markdown-fragment'
import type { PackedCapture, PackedItems, PackedReadScope } from './packing-capture'
import type { PackedResource } from './packing-resources'
import { type PackedIdentity, type PackedSource, sameIdentity } from './packing-source'
import type { PackedPath } from './packing-view'
import { finishPackedSteps, type PackedWork } from './packing-work'

export interface DependencyLimits {
  retained: number
  staging: number
  nodes: number
  depth: number
}
/** A complete native tree may lack independent source geometry for local dependency
 * proofs. Callers may recompute the whole result; this never certifies missing ranges.
 */
export class UnsupportedSemanticDependencies extends Error {}
export type DefinitionKind = 'link' | 'footnote'
export interface DependencyBlock extends Readonly<SourceRange> {
  readonly type: string
  readonly brackets: boolean
  readonly nodes: number
}
export interface DependencyDefinition extends Readonly<SourceRange> {
  readonly kind: DefinitionKind
  /** The renderer's uppercase key, derived from the parser-normalized identifier. */
  readonly key: string
  readonly block: number
  readonly selected: boolean
}
export interface DependencyReference extends Readonly<SourceRange> {
  readonly kind: 'link' | 'image' | 'footnote'
  readonly key: string
  readonly block: number
  /** Enclosing footnote definition, or null for the main document body. */
  readonly host: number | null
  readonly definition: number
}
export interface FootnoteCall {
  readonly reference: number
  readonly number: number
  readonly occurrence: number
}
interface Frame extends SourceRange {
  iterator: PackedItems
  block: number
  host: number | null
}
type WorkingReference = { -readonly [Key in keyof DependencyReference]: DependencyReference[Key] }
interface IndexData {
  blocks: DependencyRecords<DependencyBlock>
  definitions: DependencyRecords<DependencyDefinition>
  references: DependencyRecords<DependencyReference>
  footnoteOrder: readonly number[]
  calls: readonly FootnoteCall[]
  links: ReadonlyMap<string, number>
  footnotes: ReadonlyMap<string, number>
  retained: number
  staging: number
  nodes: number
  depth: number
  disjointBlocks: boolean
}
/** Source-free tables and descriptors; resource keys expose none of the mutable maps. */
class DependencyBacking {
  readonly #data: IndexData
  readonly #baseline: number
  constructor(data: IndexData, bytes: number) {
    this.#data = data
    this.#baseline = data.retained - bytes
    Object.freeze(this)
  }
  get bytes(): number {
    return this.#data.retained - this.#baseline
  }
}
function validateLimits(limits: DependencyLimits): void {
  for (const key of ['retained', 'staging', 'nodes', 'depth'] as const)
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0)
      throw new Error('Invalid semantic dependency limits')
  if (
    limits.retained > semanticLimits.workerCacheBytes ||
    limits.staging > semanticLimits.messageBytes ||
    limits.nodes > semanticLimits.blocks * 16 ||
    limits.depth > 256
  )
    throw new Error('Invalid semantic dependency limits')
}
function* hasBracket(source: string, range: SourceRange): Generator<void, boolean> {
  for (let index = range.from; index < range.to; index++) {
    if (source.charCodeAt(index) === 91) return true
    if ((index - range.from) % 4096 === 4095) yield
  }
  return false
}

/**
 * Experimental caller-owned context index over a verified whole parser root. It does
 * not authorize fragment reuse or validate arbitrary mdast. No arena, capture or reader
 * escapes the build. Its separate admission includes its exact source and metadata.
 */
export class SemanticDependencies {
  readonly identity: PackedIdentity
  readonly blocks: DependencyRecords<DependencyBlock>
  readonly definitions: DependencyRecords<DependencyDefinition>
  readonly references: DependencyRecords<DependencyReference>
  /** Selected definition indexes, in actual body-then-footer first-call order. */
  readonly footnoteOrder: readonly number[]
  readonly calls: readonly FootnoteCall[]
  readonly retainedBytes: number
  readonly stagingBytes: number
  readonly nodes: number
  readonly depth: number
  /** False for overlapping or out-of-source-order upstream block positions. */
  readonly disjointBlocks: boolean
  readonly #source: PackedSource
  readonly #links: ReadonlyMap<string, number>
  readonly #footnotes: ReadonlyMap<string, number>
  readonly #backings: readonly DependencyBacking[]
  get sourceResource(): PackedSource {
    return this.#source
  }
  /** Trusted internal accounting footprint, independent of capture/revision lifetimes. */
  *resources(): Generator<PackedResource> {
    yield { key: this.#source, bytes: this.#source.retainedBytes }
    for (const backing of this.#backings) yield { key: backing, bytes: backing.bytes }
  }
  private constructor(
    source: PackedSource,
    data: IndexData,
    backings?: readonly DependencyBacking[],
  ) {
    this.#source = source
    this.identity = source.identity
    Object.freeze(data.blocks)
    Object.freeze(data.definitions)
    Object.freeze(data.references)
    this.blocks = data.blocks
    this.definitions = data.definitions
    this.references = data.references
    this.footnoteOrder = Object.freeze(data.footnoteOrder)
    this.calls = Object.freeze(data.calls)
    this.#links = data.links
    this.#footnotes = data.footnotes
    this.retainedBytes = data.retained
    this.stagingBytes = data.staging
    this.nodes = data.nodes
    this.depth = data.depth
    this.disjointBlocks = data.disjointBlocks
    this.#backings = Object.freeze(
      backings ?? [new DependencyBacking(data, data.retained - source.retainedBytes)],
    )
    Object.freeze(this)
  }
  assertBase(identity: PackedIdentity, source: string): void {
    if (!sameIdentity(identity, this.identity) || source !== this.#source.text)
      throw new Error('Semantic dependency base mismatch; full parse required')
  }
  /** Accepts an already normalized uppercase renderer key; does not reinterpret a raw label. */
  resolve(kind: DefinitionKind, key: string): DependencyDefinition | undefined {
    const index = (kind === 'link' ? this.#links : this.#footnotes).get(key)
    return index === undefined ? undefined : this.definitions.at(index)
  }
  /** Advance only a real local-parser result certified against this exact immutable index. */
  advance(patch: MarkdownFragment, limits: DependencyLimits): SemanticDependencies {
    validateLimits(limits)
    assertFragmentProof(this, patch)
    this.assertBase(patch.base, patch.baseSource)
    if (this.#backings.length >= 128)
      throw new Error('Semantic dependency history limit; full resync required')
    const segmentBudget =
      9 +
      [this.blocks, this.definitions, this.references].reduce(
        (sum, records) =>
          sum +
          (records instanceof DependencyRanges ? records.segments : Number(records.length > 0)),
        0,
      )
    const metadataBase = 1024 + segmentBudget * 128 + this.#backings.length * 64
    const retainedBase =
      patch.source.retainedBytes +
      metadataBase +
      this.#backings.reduce((sum, resource) => sum + resource.bytes, 0)
    if (retainedBase > limits.retained)
      throw new Error('Semantic dependencies exceed retained limit')
    let workspace = 2048 + segmentBudget * 256
    if (workspace + 1024 > limits.staging)
      throw new Error('Semantic dependencies exceed staging limit')
    const local = <T extends DependencyDefinition | DependencyReference>(
      records: DependencyRecords<T>,
    ) => {
      const start = records.findIndex((record) => record.block >= patch.start)
      const first = start < 0 ? records.length : start
      const values: T[] = []
      for (let index = first; index < records.length; index++) {
        const value = records.at(index)
        if (!value || value.block >= patch.start + patch.remove) break
        workspace += 512
        if (workspace + 1024 > limits.staging)
          throw new Error('Semantic dependencies exceed staging limit')
        values.push(value)
      }
      return { first, values }
    }
    const definitions = local(this.definitions)
    const references = local(this.references)
    const replacement = collectDependencyFragment(
      patch,
      definitions.values,
      references.values,
      definitions.first,
      { ...limits, retained: limits.retained - retainedBase, staging: limits.staging - workspace },
    )
    const count = patch.children.length - patch.remove
    const splice = <T extends Readonly<SourceRange>>(
      records: DependencyRecords<T>,
      start: number,
      remove: number,
      values: readonly T[],
    ) =>
      (records instanceof DependencyRanges ? records : DependencyRanges.from(records)).splice(
        start,
        remove,
        values,
        patch.suffixOffset,
        count,
      )
    const blocks = splice(this.blocks, patch.start, patch.remove, replacement.blocks)
    const nextDefinitions = splice(
      this.definitions,
      definitions.first,
      definitions.values.length,
      replacement.definitions,
    )
    const nextReferences = splice(
      this.references,
      references.first,
      references.values.length,
      replacement.references,
    )
    if (blocks.length > semanticLimits.blocks) throw new Error('Semantic dependency block limit')
    let removedNodes = 0
    for (let index = patch.start; index < patch.start + patch.remove; index++)
      removedNodes += this.blocks.at(index)?.nodes ?? 0
    const nodes = this.nodes - removedNodes + replacement.nodes
    const depth = Math.max(this.depth, replacement.depth)
    if (nodes > limits.nodes) throw new Error('Semantic dependency node limit')
    if (depth > limits.depth) throw new Error('Semantic dependency depth limit')
    const metadata = metadataBase + replacement.retained
    const retained = retainedBase + replacement.retained
    const staging = workspace + replacement.staging
    if (retained > limits.retained) throw new Error('Semantic dependencies exceed retained limit')
    if (staging > limits.staging) throw new Error('Semantic dependencies exceed staging limit')
    const data: IndexData = {
      blocks,
      definitions: nextDefinitions,
      references: nextReferences,
      footnoteOrder: this.footnoteOrder,
      calls: this.calls,
      links: this.#links,
      footnotes: this.#footnotes,
      retained,
      staging,
      nodes,
      depth,
      disjointBlocks: true,
    }
    return new SemanticDependencies(patch.source, data, [
      ...this.#backings,
      new DependencyBacking(data, metadata),
    ])
  }
  static build(
    capture: PackedCapture,
    source: string,
    root: PackedPath,
    limits: DependencyLimits,
  ): SemanticDependencies {
    const result = finishPackedSteps(SemanticDependencies.buildSteps(capture, source, root, limits))
    if (!result) throw new Error('Incomplete semantic dependencies')
    return result
  }
  /** Cooperative index construction. The trusted caller can reserve native metadata and
   * traversal scratch before growth; complete source ownership is already in the capture.
   * Closing work or releasing the capture closes every active reader and drops partial maps.
   */
  static buildSteps(
    capture: PackedCapture,
    source: string,
    root: PackedPath,
    limits: DependencyLimits,
    admit?: (retained: number, staging: number) => void,
  ): PackedWork<SemanticDependencies> {
    validateLimits(limits)
    if (
      root.length > 64 ||
      root.some((part) =>
        typeof part === 'number'
          ? !Number.isSafeInteger(part) || part < 0
          : typeof part !== 'string' || part.length > 256,
      )
    )
      throw new Error('Invalid semantic dependency limits or root path')
    capture.reader.at(root)
    if (admit !== undefined && typeof admit !== 'function')
      throw new Error('Invalid semantic dependency admission')
    return capture.work(
      SemanticDependencies.#build(capture, source, [...root], { ...limits }, admit),
    )
  }
  static *#build(
    capture: PackedCapture,
    source: string,
    root: PackedPath,
    limits: DependencyLimits,
    admit?: (retained: number, staging: number) => void,
  ): Generator<void, SemanticDependencies> {
    let retained = 1024
    let staging = 0
    const frames: Frame[] = []
    const charge = (bytes: number) => {
      if (retained + bytes > limits.retained)
        throw new Error('Semantic dependencies exceed retained limit')
      retained += bytes
      admit?.(retained, staging)
      capture.identity
    }
    const workspace = (bytes: number) => {
      const needed = 1024 + frames.length * 1024 + bytes
      if (needed > limits.staging) throw new Error('Semantic dependencies exceed staging limit')
      staging = Math.max(staging, needed)
      admit?.(retained, staging)
      capture.identity
    }
    // Check before constructing source metadata; counting/hash validation allocates no source copy.
    if (typeof source !== 'string' || source.length * 2 + 1536 > limits.retained)
      throw new Error('Semantic dependencies exceed retained limit')
    const checked = capture.sourceResource
    if (checked.text !== source) throw new Error('Invalid packed revision identity')
    charge(checked.retainedBytes)
    const string = (reader: PackedReadScope, path: PackedPath, maxLength: number): string => {
      const length = reader.textLength(path)
      if (length > maxLength) throw new Error('Invalid semantic dependency string')
      const cost = reader.scalarCost(path)
      workspace(cost.workspace + cost.retained + length * 6 + 256)
      const value = reader.scalar(path, { retained: limits.staging, staging: limits.staging })
      if (typeof value !== 'string') throw new Error('Invalid semantic dependency string')
      return value
    }
    const range = (reader: PackedReadScope, path: PackedPath): SourceRange => {
      workspace(512)
      if (!(path.length === 1 ? reader : reader.at(path.slice(0, -1))).hasField('position'))
        throw new UnsupportedSemanticDependencies('Semantic dependency position unavailable')
      const value = reader.position(path, { retained: 512, staging: 0 })
      const from = value.start.offset
      const to = value.end.offset
      if (
        !Number.isSafeInteger(from) ||
        !Number.isSafeInteger(to) ||
        from === undefined ||
        to === undefined ||
        from < 0 ||
        to < from ||
        to > source.length
      )
        throw new Error('Invalid semantic dependency range')
      return { from, to }
    }
    const reader = capture.reader
    const rootRange = range(reader, [...root, 'position'])
    if (
      string(reader, [...root, 'type'], 64) !== 'root' ||
      rootRange.from !== 0 ||
      rootRange.to !== source.length
    )
      throw new UnsupportedSemanticDependencies('Semantic dependencies require a complete root')
    const blocks: { -readonly [Key in keyof DependencyBlock]: DependencyBlock[Key] }[] = []
    let disjointBlocks = true
    const definitions: DependencyDefinition[] = []
    const references: WorkingReference[] = []
    const links = new Map<string, number>()
    const footnotes = new Map<string, number>()
    const groups = new Map<number | null, number[]>()
    const open = (scope: PackedReadScope, path: PackedPath, frame: Omit<Frame, 'iterator'>) => {
      if (frames.length >= limits.depth) throw new Error('Semantic dependency depth limit')
      workspace(1024)
      frames.push({ ...frame, iterator: scope.elements(path) })
    }
    let nodes = 1
    let depth = 0
    try {
      if (nodes > limits.nodes) throw new Error('Semantic dependency node limit')
      open(reader, [...root, 'children'], { ...rootRange, block: -1, host: null })
      while (frames.length) {
        const frame = frames[frames.length - 1]
        if (!frame) throw new Error('Missing semantic dependency frame')
        const next = frame.iterator.next()
        if (next.done) {
          frames.pop()
          yield
          continue
        }
        if (++nodes > limits.nodes) throw new Error('Semantic dependency node limit')
        const scope = next.value
        const type = string(scope, ['type'], 64)
        // The pinned GFM literal-autolink transform synthesizes unpositioned text and
        // links. They have no independent dependency ranges; retain their positioned
        // ancestor's bounds for traversal only. Top-level blocks and definitions/
        // references still require their own exact positions.
        const span =
          !scope.hasField('position') && frame.block >= 0 && (type === 'text' || type === 'link')
            ? { from: frame.from, to: frame.to }
            : range(scope, ['position'])
        if (span.from < frame.from || span.to > frame.to)
          throw new Error('Semantic dependency range escapes parent')
        let block = frame.block
        let host = frame.host
        if (block === -1) {
          if (blocks.length >= semanticLimits.blocks)
            throw new Error('Semantic dependency block limit')
          if (span.from < (blocks.at(-1)?.to ?? 0)) disjointBlocks = false
          charge(192 + type.length * 2)
          block = blocks.length
          const brackets = yield* hasBracket(source, span)
          blocks.push({ ...span, type, brackets, nodes: 0 })
        }
        const currentBlock = blocks[block]
        if (!currentBlock) throw new Error('Missing semantic dependency block')
        currentBlock.nodes++
        depth = Math.max(depth, frames.length)
        if (
          type === 'definition' ||
          type === 'footnoteDefinition' ||
          type === 'linkReference' ||
          type === 'imageReference' ||
          type === 'footnoteReference'
        ) {
          const length = scope.textLength(['identifier'])
          charge((type === 'definition' || type === 'footnoteDefinition' ? 384 : 224) + length * 6) // Identifier expansion, records, maps and grouping metadata.
          const identifier = string(scope, ['identifier'], source.length)
          const key = identifier.toUpperCase()
          if (!key.length || key.length > identifier.length * 3)
            throw new Error('Invalid semantic dependency identifier')
          if (type === 'definition' || type === 'footnoteDefinition') {
            const kind = type === 'definition' ? 'link' : 'footnote'
            const map = kind === 'link' ? links : footnotes
            const index = definitions.length
            const selected = !map.has(key)
            if (selected) map.set(key, index)
            definitions.push(Object.freeze({ ...span, kind, key, block, selected }))
            if (kind === 'footnote') host = index
          } else {
            const kind =
              type === 'footnoteReference'
                ? 'footnote'
                : type === 'imageReference'
                  ? 'image'
                  : 'link'
            if (kind === 'footnote') {
              let group = groups.get(host)
              if (!group) {
                group = []
                groups.set(host, group)
              }
              group.push(references.length)
            }
            references.push({ ...span, kind, key, block, host, definition: -1 })
          }
        }
        workspace(8192)
        const keys = scope.keys([], { retained: 8192, staging: 0 })
        if (keys.includes('children')) open(scope, ['children'], { ...span, block, host })
        yield
      }
    } finally {
      for (const frame of frames) frame.iterator.return()
    }
    for (const reference of references) {
      const definition = (reference.kind === 'footnote' ? footnotes : links).get(reference.key)
      if (definition === undefined) throw new Error('Unresolved semantic dependency in parser root')
      reference.definition = definition
      Object.freeze(reference)
      yield
    }
    const footnoteOrder: number[] = []
    const calls: FootnoteCall[] = []
    const counts = new Map<number, { number: number; occurrence: number }>()
    const call = function* (host: number | null): Generator<void> {
      for (const index of groups.get(host) ?? []) {
        const reference = references[index]
        if (!reference) throw new Error('Missing semantic dependency reference')
        charge(256)
        let count = counts.get(reference.definition)
        if (!count) {
          count = { number: footnoteOrder.length + 1, occurrence: 0 }
          counts.set(reference.definition, count)
          footnoteOrder.push(reference.definition)
        }
        count.occurrence++
        calls.push(Object.freeze({ reference: index, ...count }))
        yield
      }
    }
    yield* call(null)
    for (let index = 0; index < footnoteOrder.length; index++) {
      const definition = footnoteOrder[index]
      if (definition === undefined) throw new Error('Missing footnote dependency')
      yield* call(definition)
    }
    for (const block of blocks) {
      Object.freeze(block)
      yield
    }
    return new SemanticDependencies(checked, {
      blocks,
      definitions,
      references,
      footnoteOrder,
      calls,
      links,
      footnotes,
      retained,
      staging,
      nodes,
      depth,
      disjointBlocks,
    })
  }
}
