import { semanticLimits } from '../../core/src/contracts'
import type { PackedCapture, PackedReadScope } from '../../core/src/packing-capture'
import type {
  PackedDocumentBaseline,
  PackedDocumentContextSubtree,
} from '../../core/src/packing-document-baseline'
import {
  copyPackedNative,
  measurePackedNative,
  type PackedNativePlan,
} from '../../core/src/packing-native-copy'
import type { PackedRecordKey } from '../../core/src/packing-record-key'
import type { PackedSource } from '../../core/src/packing-source'
import { packedTextStepCost } from '../../core/src/packing-text-stream'
import { packedDocumentSteps } from '../../core/src/packing-validate-document'
import type { PackedPath } from '../../core/src/packing-view'
import type { PackedWordBaseline } from '../../core/src/packing-word-baseline'
import { PackedWordBuffer } from '../../core/src/packing-word-buffer'
import type { ProjectionLimits } from './fragment-projection-context'
import type { PackedProjectionContextCost } from './packed-projection-context'
import { isProjectionWidgetType } from './projection-engine'
import type { ProjectionDescriptionAbsence } from './projection-owned-output'
import type { ProjectionDefinition } from './projection-sequence'

type Inspector = (
  context: readonly ProjectionDefinition[],
  cost: PackedProjectionContextCost,
) => Generator<void>
export interface CollectedProjectionContext {
  descriptionAbsence(
    capture: PackedCapture,
    source: PackedSource,
    root: PackedPath,
    index: number,
    node?: PackedReadScope,
  ): ProjectionDescriptionAbsence | undefined
  borrow(
    capture: PackedCapture,
    source: PackedSource,
    root: PackedPath,
    limits: ProjectionLimits,
    inspect: Inspector,
  ): Generator<void>
}
interface State {
  capture: PackedCapture
  source: PackedSource
  root: PackedPath
  limits: ProjectionLimits
  bytes: number
  fixed: number
  nativeDepth: number
  selectedDepth: number
  nodes: number
  references: number
  referenceUnits: number
  plan: PackedNativePlan
  context: ProjectionDefinition[]
  keys: (PackedRecordKey | undefined)[]
  summaries: Uint32Array
  token: object | undefined
  block: number
  blocks: number
  bodySummaries: boolean
  rootComplete: boolean
  validated: boolean
  borrowing: boolean
}

const capacity = () => new Error('Collected projection context exceeds workspace limit')
/** Optional collection may retry the independently admitted validation/rendering path. */
export function isCollectedProjectionCapacityError(error: unknown): boolean {
  return (
    error instanceof Error &&
    [
      'Collected projection context exceeds workspace limit',
      'Packed root validation exceeds workspace limit',
      'Packed words exceed workspace limit',
      'Packed reader exceeds staging limit',
      'Packed reader scope limit',
      'Packed validation streams exceed workspace limit',
      'Packed projection context exceeds workspace limit',
      'Packed projection state exceeds workspace limit',
      'Packed native copy exceeds workspace limit',
      'Packed session exceeds retained limit',
      'Packed scalar exceeds retained limit',
      'Packed scalar exceeds staging limit',
      'Packed projection output exceeds workspace limit',
      'Packed projection validation exceeds workspace limit',
      'Packed array lookup exceeds workspace limit',
    ].includes(error.message)
  )
}
class Collection implements CollectedProjectionContext {
  #state: State | undefined
  constructor(state: State) {
    this.#state = state
  }
  #get(): State {
    if (!this.#state) throw new Error('Collected projection context closed')
    this.#state.capture.identity
    return this.#state
  }
  #bound(capture: PackedCapture, source: PackedSource, root: PackedPath): State {
    const state = this.#get()
    if (
      !state.validated ||
      capture !== state.capture ||
      source !== state.source ||
      root.length !== state.root.length ||
      root.some((part, index) => part !== state.root[index])
    )
      throw new Error('Collected projection context mismatch')
    return state
  }
  descriptionAbsence(
    capture: PackedCapture,
    source: PackedSource,
    root: PackedPath,
    index: number,
    node?: PackedReadScope,
  ): ProjectionDescriptionAbsence | undefined {
    const state = this.#bound(capture, source, root)
    if (!state.borrowing) throw new Error('Collected projection context not borrowed')
    if (!Number.isSafeInteger(index) || index < 0 || index > state.blocks)
      throw new Error('Collected projection description index mismatch')
    if (!state.bodySummaries && index < state.blocks) return undefined
    const at = state.bodySummaries ? index * 4 : 0
    if (node) {
      const key = node.recordKey()
      // One source-free token and compact record numbers cover ordinary cold arenas.
      // Other arenas/lazy transforms retain the complete original description walk.
      if (
        index === state.blocks ||
        !key ||
        key.token !== state.token ||
        key.offset !== 0 ||
        key.range !== 0 ||
        key.record + 1 !== state.summaries[at + 3]
      )
        return undefined
    } else if (index !== state.blocks) return undefined
    if (state.summaries[at + 2]) return undefined
    return { nodes: state.summaries[at] ?? 0, depth: state.summaries[at + 1] ?? 0 }
  }
  #summarize(
    state: State,
    type: string,
    units: number,
    lines: number,
    at: number,
    depth: number,
    ordered: boolean,
  ): void {
    state.summaries[at] = (state.summaries[at] ?? 0) + 1
    state.summaries[at + 1] = Math.max(state.summaries[at + 1] ?? 0, depth)
    if (isProjectionWidgetType(type, units, lines, ordered)) state.summaries[at + 2] = 1
  }
  /** The document and text validators have proved this complete immutable subtree.
   * It contains no definitions or footnote calls, so charge its whole logical walk
   * without copying context. Widget absence is unknown: retain ordinary descriptions.
   */
  pruned(subtree: PackedDocumentContextSubtree): void {
    const state = this.#get()
    if (++state.block >= state.blocks) throw new Error('Collected projection block limit')
    state.selectedDepth = 0
    state.nodes += subtree.nodes
    if (state.nodes > state.limits.nodes || subtree.depth + 1 > state.limits.depth)
      throw new Error('Packed projection context traversal limit')
    if (state.plan.nodes + state.nodes > state.limits.nodes)
      throw new Error('Packed projection context node limit')
  }
  observe(
    node: PackedReadScope,
    type: string,
    position: ReturnType<PackedReadScope['position']> | undefined,
    _budget: unknown,
    depth: number,
  ): Generator<void> | void {
    const state = this.#get()
    let units = position ? position.end.offset - position.start.offset : 0
    if (
      (type === 'paragraph' || type === 'heading') &&
      units > semanticLimits.editorInlineUnits &&
      node.length(['children']) === 1
    ) {
      const child = node.at(['children', 0])
      if (child.scalar(['type'], { retained: 1024, staging: 2048 }) === 'text') {
        const range = child.position(['position'], { retained: 512, staging: 0 })
        // Literal prose needs no replacement even when Lezer bounds inline parsing.
        // Keep streaming validation for very large plain paragraphs.
        if (child.textLength(['value']) === range.end.offset - range.start.offset) units = 0
      }
    }
    const lines = position ? position.end.line - position.start.line + 1 : 1
    const ordered =
      type === 'list' && node.scalar(['ordered'], { retained: 16, staging: 0 }) === true
    if (depth === 2) {
      if (++state.block >= state.blocks) throw new Error('Collected projection block limit')
      if (state.bodySummaries) {
        const key = node.recordKey()
        if (key && key.offset === 0 && key.range === 0) {
          state.token ??= key.token
          if (key.token === state.token) state.summaries[state.block * 4 + 3] = key.record + 1
        }
      }
    }
    if (depth > 1 && state.bodySummaries)
      this.#summarize(state, type, units, lines, state.block * 4, depth - 1, ordered)
    const footer = state.bodySummaries ? state.blocks * 4 : 0
    // The root validator still observes every descendant of copied definitions.
    // Count that complete selected subtree exactly once for the eventual footer,
    // including unused notes and definitions nested within them.
    if (state.selectedDepth && depth > state.selectedDepth)
      this.#summarize(state, type, units, lines, footer, depth - state.selectedDepth + 1, ordered)
    else if (type === 'definition' || type === 'footnoteDefinition')
      this.#summarize(state, type, units, lines, footer, 1, ordered)
    if (state.selectedDepth && depth > state.selectedDepth) return
    state.selectedDepth = 0
    if (++state.nodes > state.limits.nodes || depth > state.limits.depth)
      throw new Error('Packed projection context traversal limit')
    if (state.plan.nodes + state.nodes > state.limits.nodes)
      throw new Error('Packed projection context node limit')
    if (type === 'definition' || type === 'footnoteDefinition')
      return this.#copyDefinition(state, node, depth)
    if (type === 'footnoteReference') {
      state.references++
      state.referenceUnits += node.textLength(['identifier'])
    }
  }
  *#copyDefinition(state: State, node: PackedReadScope, depth: number): Generator<void> {
    const definitions = state.context.length + 1
    const admit = () => {
      const stream = state.plan.longest ? packedTextStepCost : { retained: 0, workspace: 0 }
      const bytes =
        state.fixed +
        state.plan.retained +
        64 +
        definitions * 640 +
        (state.plan.longest
          ? PackedWordBuffer.collectionBytes(state.plan.longest, state.plan.longest + 1)
          : 0)
      if (
        bytes +
          stream.retained +
          stream.workspace +
          (state.nativeDepth + state.limits.depth + 12) * 512 >
        state.bytes
      )
        throw capacity()
      if (
        state.plan.nodes + state.nodes > state.limits.nodes ||
        definitions > semanticLimits.blocks
      )
        throw new Error('Packed projection context node limit')
    }
    yield* measurePackedNative(
      node,
      { nodes: state.limits.nodes, depth: state.nativeDepth },
      state.plan,
      admit,
    )
    admit()
    state.keys.push(node.recordKey())
    state.context.push((yield* copyPackedNative(node)) as ProjectionDefinition)
    state.selectedDepth = depth
  }
  completeRoot(): number {
    const state = this.#get()
    if (state.rootComplete) throw new Error('Collected projection root already completed')
    if (state.block + 1 !== state.blocks) throw new Error('Collected projection block mismatch')
    Object.freeze(state.context)
    Object.freeze(state.keys)
    state.rootComplete = true
    state.bytes =
      state.fixed +
      state.plan.retained +
      64 +
      state.context.length * 640 +
      (state.plan.longest
        ? PackedWordBuffer.collectionBytes(state.plan.longest, state.plan.longest + 1)
        : 0)
    return state.bytes
  }
  complete(): void {
    const state = this.#get()
    if (!state.rootComplete) throw new Error('Collected projection root not completed')
    state.validated = true
  }
  *borrow(
    capture: PackedCapture,
    source: PackedSource,
    root: PackedPath,
    limits: ProjectionLimits,
    inspect: Inspector,
  ): Generator<void> {
    const state = this.#bound(capture, source, root)
    if (limits.nodes < state.limits.nodes || limits.depth < state.limits.depth)
      throw new Error('Collected projection context mismatch')
    if (state.bytes > limits.retained || state.bytes > limits.staging) throw capacity()
    if (state.borrowing) throw new Error('Collected projection context already borrowed')
    state.borrowing = true
    try {
      const work = inspect(
        state.context,
        Object.freeze({
          recordKeys: state.keys,
          retainedBytes: state.bytes,
          stagingBytes: state.bytes,
          nativeBytes: state.plan.retained,
          nodes: state.nodes + state.plan.nodes,
          definitions: state.context.length,
          bodyReferences: state.references,
          bodyReferenceUnits: state.referenceUnits,
        }),
      )
      try {
        while (true) {
          this.#get()
          const step = work.next()
          this.#get()
          if (step.done) return
          yield
        }
      } finally {
        work.return(undefined)
      }
    } finally {
      state.borrowing = false
    }
  }
  close(): void {
    this.#state = undefined
  }
}

/** One private cold-validation transaction. Complete schema/source/description/word
 * validation must finish before this context can be borrowed. The prepaid reservation
 * retains all existing native/context weights and bounds optional collection headroom;
 * a capacity failure must discard the transaction and retry ordinary validation.
 */
export function* collectProjectionContext(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  limits: ProjectionLimits,
  inspect: (context: CollectedProjectionContext) => Generator<void>,
  baselines?: { readonly document: PackedDocumentBaseline; readonly words: PackedWordBaseline },
): Generator<void> {
  if (root.at(-1) !== 'root') throw new Error('Invalid collected projection context path')
  const nativeDepth = Math.min(512, limits.depth * 4 + 16)
  const base = 16384 + (nativeDepth + limits.depth) * 1024
  const blocks = capture.reader.at(root).length(['children'])
  if (blocks > semanticLimits.blocks) throw new Error('Collected projection block limit')
  // A warm body can reuse projection metadata separately. Its document proof does
  // not establish widget absence, so keep only the fully observed footer summary.
  // Native-copy frame/stream costs retain their original prepaid headroom. That
  // scratch is released after the root walk, before the whole-prose count phase.
  const bodySummaries = baselines === undefined
  const summaries = bodySummaries ? blocks + 1 : 1
  const fixed = base + 1024 + summaries * 16
  const frames = (nativeDepth + limits.depth + 12) * 512
  const bytes = base + 1024 * 1024
  if (fixed + frames > bytes) throw capacity()
  if (bytes > limits.retained || bytes > limits.staging) throw capacity()
  const workspace = capture.reserveWorkspace(bytes, bytes)
  let collection: Collection | undefined
  try {
    collection = new Collection({
      capture,
      source,
      root: [...root],
      limits: { ...limits },
      bytes,
      fixed,
      nativeDepth,
      selectedDepth: 0,
      nodes: 0,
      references: 0,
      referenceUnits: 0,
      plan: { retained: 0, longest: 0, nodes: 0 },
      context: [],
      keys: [],
      summaries: new Uint32Array(summaries * 4),
      token: undefined,
      block: -1,
      blocks,
      bodySummaries,
      rootComplete: false,
      validated: false,
      borrowing: false,
    })
    yield* packedDocumentSteps(
      capture,
      source,
      root.slice(0, -1),
      limits,
      undefined,
      baselines?.document,
      baselines?.words,
      collection.observe.bind(collection),
      {
        bytes,
        prune: baselines ? collection.pruned.bind(collection) : undefined,
        completeRoot: () => {
          if (!collection) throw new Error('Collected projection context closed')
          const completedBytes = collection.completeRoot()
          workspace.resize(completedBytes, completedBytes)
          return completedBytes
        },
      },
    )
    collection.complete()
    yield* inspect(collection)
  } finally {
    collection?.close()
    workspace.release()
  }
}
