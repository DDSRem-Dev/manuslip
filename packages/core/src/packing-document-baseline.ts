import { semanticLimits } from './contracts'
import type { PackedCapture, PackedItemSteps, PackedReadScope } from './packing-capture'
import { finishPackedCleanup } from './packing-cleanup'
import type { PackedHold } from './packing-hold'
import { mdastSourceMinimum } from './packing-mdast-schema'
import type { PackedRecordKey } from './packing-record-key'
import type { PackedSource } from './packing-source'
import { validatePackedDocument } from './packing-validate-document'
import type { PackedRootSubtree, PackedRootValidationLimits } from './packing-validate-root'
import { packedSmall } from './packing-validation-read'
import type { PackedPath } from './packing-view'
import type { PackedWork } from './packing-work'
import { describesBlock } from './semantic-description'

const seal = Symbol('validated document baseline')
export interface PackedDocumentContextSubtree extends PackedRootSubtree {
  /** Complete subtree contains link or image reference nodes. */
  readonly references: boolean
}
export interface PackedDocumentSubtree extends PackedDocumentContextSubtree {
  readonly key: PackedRecordKey
  readonly from: number
  readonly to: number
  readonly minimum: number
  readonly blockAt: number
  readonly blocks: number
  readonly headingAt: number
  readonly headings: number
  /** Complete semantic subtree contains no definitions or footnote calls. */
  readonly contextFree: boolean
}
interface Data {
  capture: PackedCapture
  source: PackedSource
  document: PackedPath
  limits: Readonly<PackedRootValidationLimits>
  records: Map<object, Map<number, PackedDocumentSubtree>>
  /** Block/heading prefix counts for every top-level child boundary, including EOF. */
  metadata: Uint32Array
}
export interface PackedDocumentMetadataRange {
  readonly blocks: Readonly<{ start: number; remove: number; total: number }>
  readonly outline: Readonly<{ start: number; remove: number; total: number }>
}
function* lifetime(baseline: PackedDocumentBaseline, hold: PackedHold): Generator<void> {
  try {
    yield
    throw new Error('Document baseline lifetime is not a scheduler')
  } finally {
    try {
      baseline.close()
    } finally {
      hold.release()
    }
  }
}
function* inspection(
  active: Set<PackedWork<boolean>>,
  slot: { work?: PackedWork<boolean> },
  inspect: () => Generator<void>,
): Generator<void, boolean> {
  try {
    yield* inspect()
    return true
  } finally {
    if (slot.work) active.delete(slot.work)
  }
}
function* summarize(
  node: PackedReadScope,
  limits: PackedRootValidationLimits,
  visited: { nodes: number },
): Generator<
  void,
  {
    nodes: number
    depth: number
    minimum: number
    blocks: number
    headings: number
    contextFree: boolean
    references: boolean
  }
> {
  const frames: PackedItemSteps[] = []
  const before = visited.nodes
  let failed = false
  let depth = 0,
    minimum = 0,
    blocks = 0,
    headings = 0,
    contextFree = true,
    references = false
  const visit = (scope: PackedReadScope) => {
    if (++visited.nodes > limits.nodes || frames.length + 2 > limits.depth)
      throw new Error('Document baseline traversal limit')
    depth = Math.max(depth, frames.length + 1)
    const type = packedSmall(scope, ['type'])
    if (typeof type !== 'string') throw new Error('Invalid document baseline node')
    if (type === 'definition' || type === 'footnoteDefinition' || type === 'footnoteReference')
      contextFree = false
    if (type === 'linkReference' || type === 'imageReference') references = true
    minimum = Math.max(minimum, mdastSourceMinimum(scope, type))
    if (scope.hasField('position')) {
      if (describesBlock(type)) blocks++
      if (type === 'heading') headings++
    }
    if (scope.hasField('children')) frames.push(scope.elementSteps(['children']))
  }
  try {
    visit(node)
    yield
    while (frames.length) {
      const frame = frames.at(-1)
      if (!frame) throw new Error('Missing document baseline frame')
      const next = frame.next()
      if (next.done) frames.pop()
      else if (next.value !== undefined) visit(next.value)
      yield
    }
    return {
      nodes: visited.nodes - before,
      depth,
      minimum,
      blocks,
      headings,
      contextFree,
      references,
    }
  } catch (error) {
    failed = true
    throw error
  } finally {
    finishPackedCleanup(
      (function* () {
        for (const frame of frames) yield () => frame.return()
      })(),
      failed,
    )
  }
}

/** Full document certification followed by admitted source-free subtree metadata. It borrows
 * its capture; close/release revokes both metadata and active inspections. It does not
 * certify a fresh parse or projection output. Later revisions still need independent exact
 * word validation; only the exact original document can reuse the completed whole proof.
 */
export class PackedDocumentBaseline {
  #data: Data | undefined
  #lifetime: PackedWork<void> | undefined
  readonly #active = new Set<PackedWork<boolean>>()
  private constructor(key: typeof seal, data: Data) {
    if (key !== seal) throw new Error('Invalid document baseline provenance')
    this.#data = data
  }
  static create(
    capture: PackedCapture,
    source: PackedSource,
    document: PackedPath,
    limits: PackedRootValidationLimits,
  ): PackedWork<PackedDocumentBaseline> {
    capture.reader.at(document)
    if (document.length > 63) throw new Error('Invalid document baseline path')
    const path = [...document]
    const budget = { ...limits }
    return capture.work(
      (function* () {
        yield* validatePackedDocument(capture, source, path, budget)
        const root = capture.reader.at([...path, 'root'])
        const size = root.length(['children'])
        const scratch = 16384 + (budget.depth + 16) * 1024
        const bytes = scratch + size * 1024 + 64 + (size + 1) * 8
        if (
          size > semanticLimits.blocks ||
          bytes + (budget.depth + 8) * 512 > budget.retained ||
          scratch > budget.staging
        )
          throw new Error('Document baseline exceeds cache limit')
        // Prefixes and record maps are retained data throughout construction. Their
        // complete weights stay admitted; only bounded traversal scratch is staging.
        let hold = capture.workspace(bytes, scratch)
        let transferred = false
        const records = new Map<object, Map<number, PackedDocumentSubtree>>()
        const visited = { nodes: 1 }
        let blockAt = 0,
          headingAt = 0,
          childAt = 0
        try {
          const metadata = new Uint32Array((size + 1) * 2)
          for (const node of root.elementSteps(['children'])) {
            if (node === undefined) {
              yield
              continue
            }
            const key = node.recordKey()
            const position = node.position(['position'], { retained: 272, staging: 0 })
            const summary = yield* summarize(node, budget, visited)
            if (key?.range === 0) {
              let table = records.get(key.token)
              if (!table) {
                table = new Map()
                records.set(key.token, table)
              }
              table.set(
                key.record,
                Object.freeze({
                  key,
                  from: position.start.offset,
                  to: position.end.offset,
                  ...summary,
                  blockAt,
                  headingAt,
                }),
              )
            }
            blockAt += summary.blocks
            headingAt += summary.headings
            childAt++
            metadata[childAt * 2] = blockAt
            metadata[childAt * 2 + 1] = headingAt
            yield
          }
          if (childAt !== size) throw new Error('Document baseline child count mismatch')
          hold.release()
          hold = capture.workspace(bytes, 0)
          const baseline = new PackedDocumentBaseline(seal, {
            capture,
            source,
            document: Object.freeze(path),
            limits: Object.freeze(budget),
            records,
            metadata,
          })
          baseline.#lifetime = capture.work(lifetime(baseline, hold))
          baseline.#lifetime.next()
          transferred = true
          return baseline
        } finally {
          if (!transferred) {
            records.clear()
            hold.release()
          }
        }
      })(),
    )
  }
  #current(): Data {
    const data = this.#data
    if (!data) throw new Error('Document baseline closed')
    data.capture.identity
    return data
  }
  /** Certified descriptor intervals for this exact original document. This only locates
   * metadata; it grants no later-revision/schema/count validation shortcut. The attested
   * fragment builder still checks all changed native nodes and complete current counts.
   * Returned numbers retain neither the baseline, capture nor its typed backing store.
   */
  metadataRange(
    capture: PackedCapture,
    document: PackedPath,
    start: number,
    remove: number,
  ): PackedDocumentMetadataRange | undefined {
    if (!this.#data) return undefined
    const data = this.#current()
    if (
      capture.sourceResource !== data.source ||
      !data.capture.sameRevision(capture) ||
      document.length !== data.document.length ||
      document.some((part, index) => part !== data.document[index])
    )
      return undefined
    const children = data.metadata.length / 2 - 1
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(remove) ||
      start < 0 ||
      remove < 0 ||
      start > children ||
      remove > children - start
    )
      throw new Error('Invalid document baseline metadata range')
    const range = (field: number) => {
      const at = data.metadata[start * 2 + field] ?? 0
      return Object.freeze({
        start: at,
        remove: (data.metadata[(start + remove) * 2 + field] ?? 0) - at,
        total: data.metadata[children * 2 + field] ?? 0,
      })
    }
    return Object.freeze({ blocks: range(0), outline: range(1) })
  }
  /** Complete document validation (including exact counts) remains true for this exact
   * immutable revision, independently held by the caller's capture. No metadata is borrowed.
   * Equal identity fields, changed paths and stricter/invalid budgets cannot reuse it.
   */
  validatesDocument(
    capture: PackedCapture,
    source: PackedSource,
    document: PackedPath,
    limits: PackedRootValidationLimits,
  ): boolean {
    if (!this.#data) return false
    const data = this.#current()
    return (
      data.source === source &&
      capture.sourceResource === source &&
      data.capture.sameRevision(capture) &&
      document.length === data.document.length &&
      document.every((part, index) => part === data.document[index]) &&
      (['retained', 'staging', 'nodes', 'depth'] as const).every(
        (key) => Number.isSafeInteger(limits[key]) && limits[key] >= data.limits[key],
      ) &&
      limits.retained <= semanticLimits.rendererBytes &&
      limits.staging <= semanticLimits.messageBytes &&
      limits.nodes <= semanticLimits.blocks * 16 &&
      limits.depth <= 128
    )
  }
  compatible(capture: PackedCapture, source: PackedSource): boolean {
    if (!this.#data) return false
    const data = this.#current()
    const before = data.source.identity,
      after = source.identity
    return (
      data.capture.sameOwner(capture) &&
      capture.sourceResource === source &&
      before.generation === after.generation &&
      before.documentId === after.documentId &&
      before.parserVersion === after.parserVersion &&
      after.revision > before.revision
    )
  }
  /** Source-free absence proof for an identical immutable subtree. No renderer output is
   * certified. Closed metadata falls back to a full walk; returned costs remain immutable.
   */
  contextFree(node: PackedReadScope): PackedDocumentContextSubtree | undefined {
    if (!this.#data) return undefined
    const data = this.#current()
    const key = node.recordKey()
    if (key?.range !== 0) return undefined
    const subtree = data.records.get(key.token)?.get(key.record)
    return subtree?.contextFree ? subtree : undefined
  }
  /** Dual ownership: the caller's capture owns its validator; the borrowed capture and
   * baseline also own this complete inspection. Revocation cannot look like successful EOF.
   */
  inspect(inspect: () => Generator<void>): PackedWork<boolean> {
    const data = this.#current()
    const slot: { work?: PackedWork<boolean> } = {}
    const work = data.capture.work(inspection(this.#active, slot, inspect))
    slot.work = work
    this.#active.add(work)
    return work
  }
  *prove(
    node: PackedReadScope,
    source: PackedSource,
    position: ReturnType<PackedReadScope['position']>,
  ): Generator<void, { subtree: PackedDocumentSubtree; offset: number } | undefined> {
    const data = this.#current()
    const key = node.recordKey()
    if (key?.range !== 0) return undefined
    const subtree = data.records.get(key.token)?.get(key.record)
    if (!subtree || subtree.minimum > source.text.length) return undefined
    const base = Number(data.source.text.charCodeAt(0) === 0xfeff)
    if (base !== Number(source.text.charCodeAt(0) === 0xfeff)) return undefined
    const offset = key.offset - subtree.key.offset
    if (
      position.start.offset !== subtree.from + offset ||
      position.end.offset !== subtree.to + offset
    )
      return undefined
    // Include both parser coordinates (which exclude BOM) and descriptor hash spelling
    // (which uses raw source offsets). No substring, hash-only proof or source copy.
    const length = subtree.to - subtree.from + base
    for (let index = 0; index < length; index++) {
      if (
        data.source.text.charCodeAt(subtree.from + index) !==
        source.text.charCodeAt(position.start.offset + index)
      )
        return undefined
      if (index % 4096 === 4095) {
        yield
        this.#current()
      }
    }
    this.#current()
    return { subtree, offset }
  }
  open(field: 'blocks' | 'outline'): PackedItemSteps {
    const data = this.#current()
    return data.capture.reader.elementSteps([...data.document, field])
  }
  assertOpen(): void {
    this.#current()
  }
  close(): void {
    const work = this.#lifetime
    this.#lifetime = undefined
    this.#data?.records.clear()
    this.#data = undefined
    const active = [...this.#active]
    this.#active.clear()
    finishPackedCleanup(
      (function* () {
        for (const item of active) yield () => item.return()
        yield () => work?.return()
      })(),
    )
  }
}
