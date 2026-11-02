import { semanticLimits } from '../../core/src/contracts'
import type {
  PackedCapture,
  PackedItemSteps,
  PackedReadScope,
} from '../../core/src/packing-capture'
import { finishPackedCleanup } from '../../core/src/packing-cleanup'
import type { PackedDocumentBaseline } from '../../core/src/packing-document-baseline'
import type { PackedHold } from '../../core/src/packing-hold'
import type { PackedRecordKey } from '../../core/src/packing-record-key'
import type { PackedSource } from '../../core/src/packing-source'
import {
  packedInteger,
  packedSmall,
  validationStreamLimits,
} from '../../core/src/packing-validation-read'
import type { PackedPath } from '../../core/src/packing-view'
import type { PackedWork } from '../../core/src/packing-work'
import type { ProjectionLimits } from './fragment-projection-context'
import type { RenderOptions } from './index'
import { PackedHtmlCursor } from './packed-html-cursor'
import {
  type PackedDocumentContextPrune,
  type PackedProjectionSubtree,
  type ProjectionContextWalk,
  packedDocumentContextPrune,
  packedProjectionDefinitions,
} from './packed-projection-definitions'
import { PackedSnapshotCertificate } from './packed-snapshot-certificate'
import { validatePackedSnapshot } from './packing-validate-snapshot'

const seal = Symbol('validated projection baseline')
const dependent = new Set(['definition', 'footnoteDefinition', 'footnoteReference'])
export interface BaselineWidget {
  readonly key: PackedRecordKey
  readonly from: number
  readonly to: number
}
export interface BaselineBlock {
  readonly traversal: PackedProjectionSubtree
  readonly contextual: boolean
  readonly key: PackedRecordKey
  readonly htmlFrom: number
  readonly htmlTo: number
  readonly visible: boolean
  readonly widgets: readonly BaselineWidget[]
}
interface WorkingBlock {
  traversal: PackedProjectionSubtree
  key: PackedRecordKey | undefined
  from: number
  to: number
  htmlFrom: number
  htmlTo: number
  visible: boolean
  eligible: boolean
  contextual: boolean
  widgets: BaselineWidget[]
}
interface Data {
  capture: PackedCapture
  source: PackedSource
  html: PackedPath
  policy: string
  limits: Readonly<ProjectionLimits>
  records: Map<object, Map<number, BaselineBlock>>
  context: readonly (PackedRecordKey | undefined)[]
}
function* lifetime(baseline: PackedProjectionBaseline, hold: PackedHold): Generator<void> {
  let failed = false
  try {
    yield
    throw new Error('Projection baseline lifetime is not a scheduler')
  } catch (error) {
    failed = true
    throw error
  } finally {
    finishPackedCleanup([() => baseline.close(), () => hold.release()], failed)
  }
}
function* independent(
  node: PackedReadScope,
  limits: ProjectionLimits,
  visited: { nodes: number },
  prune?: PackedDocumentContextPrune,
): Generator<void, { eligible: boolean; contextual: boolean; traversal: PackedProjectionSubtree }> {
  const certified = prune?.(node)
  if (certified) {
    // The exact immutable document was validated completely before this metadata lookup.
    // Account for every descendant even though no second classification walk is needed.
    visited.nodes += certified.nodes
    if (visited.nodes > limits.nodes || certified.depth > limits.depth)
      throw new Error('Projection baseline traversal limit')
    return {
      eligible: true,
      contextual: certified.references,
      traversal: Object.freeze({ nodes: certified.nodes, depth: certified.depth }),
    }
  }
  const frames: PackedItemSteps[] = []
  let eligible = true
  let contextual = false
  let failed = false
  const before = visited.nodes
  let depth = 0
  const visit = (scope: PackedReadScope) => {
    if (++visited.nodes > limits.nodes || frames.length + 1 > limits.depth)
      throw new Error('Projection baseline traversal limit')
    depth = Math.max(depth, frames.length + 1)
    const type = packedSmall(scope, ['type'])
    if (typeof type !== 'string') throw new Error('Invalid projection baseline node')
    if (dependent.has(type)) eligible = false
    if (type === 'linkReference' || type === 'imageReference') contextual = true
    if (scope.hasField('children')) frames.push(scope.elementSteps(['children']))
  }
  try {
    visit(node)
    yield
    while (frames.length) {
      const frame = frames.at(-1)
      if (!frame) throw new Error('Missing projection baseline frame')
      const next = frame.next()
      if (next.done) frames.pop()
      else if (next.value !== undefined) visit(next.value)
      yield
    }
    return {
      eligible,
      contextual,
      traversal: Object.freeze({ nodes: visited.nodes - before, depth }),
    }
  } catch (error) {
    failed = true
    throw error
  } finally {
    finishPackedCleanup(
      (function* () {
        for (const frame of frames) yield () => void frame.return()
      })(),
      failed,
    )
  }
}

/** A scoped certificate built only after complete snapshot validation. It borrows its
 * capture, owns source-free record/layout/widget metadata, and revokes with that capture.
 * Identical shared arena blocks are reusable; link/image references also require an
 * unchanged ordered definition context. Definitions and footnote calls render normally.
 * This does not certify a fresh parse or retain any native root/HAST/HTML output.
 * An exact sealed snapshot certificate may supply the already completed validation;
 * metadata construction and its complete admission/traversal checks still run normally.
 */
export class PackedProjectionBaseline {
  #data: Data | undefined
  #lifetime: PackedWork<void> | undefined
  private constructor(key: typeof seal, data: Data) {
    if (key !== seal) throw new Error('Invalid projection baseline provenance')
    this.#data = data
  }
  static create(
    capture: PackedCapture,
    source: PackedSource,
    snapshot: PackedPath,
    options: RenderOptions,
    limits: ProjectionLimits,
    documentBaseline?: PackedDocumentBaseline,
    certificate?: PackedSnapshotCertificate,
  ): PackedWork<PackedProjectionBaseline> {
    capture.reader.at(snapshot)
    if (snapshot.length > 62) throw new Error('Invalid projection baseline path')
    const path = [...snapshot]
    const render = { ...options }
    const budget = { ...limits }
    return capture.work(
      (function* () {
        if (
          !PackedSnapshotCertificate.validates(certificate, capture, source, path, render, budget)
        )
          yield* validatePackedSnapshot(
            capture,
            source,
            path,
            render,
            budget,
            undefined,
            documentBaseline,
          )
        const root = capture.reader.at([...path, 'document', 'root'])
        const prune = packedDocumentContextPrune(
          capture,
          source,
          [...path, 'document', 'root'],
          budget,
          documentBaseline,
        )
        const projection = capture.reader.at([...path, 'projection'])
        const layout = capture.reader.at([...path, 'layout'])
        const size = root.length(['children'])
        const widgets = projection.length(['blocks'])
        const fixed = 16384 + (budget.depth + 16) * 1024
        if (fixed > budget.retained || fixed > budget.staging)
          throw new Error('Projection baseline exceeds cache limit')
        let hold = capture.workspace(fixed, fixed)
        const walk: ProjectionContextWalk = {
          nodes: 0,
          definitions: 0,
          references: 0,
          referenceUnits: 0,
        }
        try {
          for (const node of packedProjectionDefinitions(root, budget, walk, prune)) {
            void node
            yield
          }
        } finally {
          hold.release()
        }
        // Include each frozen logical subtree summary alongside record/layout metadata.
        const bytes = fixed + size * 1280 + widgets * 512 + walk.definitions * 512
        if (
          size > semanticLimits.blocks ||
          bytes + (budget.depth + 8) * 512 > budget.retained ||
          fixed > budget.staging
        )
          throw new Error('Projection baseline exceeds cache limit')
        // Working blocks, final records and context keys are included in bytes.
        // They consume retained capacity; bounded traversal scratch consumes staging.
        hold = capture.workspace(bytes, fixed)
        let transferred = false
        let failed = false
        const blocks: WorkingBlock[] = []
        const records = new Map<object, Map<number, BaselineBlock>>()
        const context: (PackedRecordKey | undefined)[] = []
        let spans: PackedItemSteps | undefined
        const visited = { nodes: 0 }
        try {
          spans = layout.elementSteps(['blocks'])
          const copied: ProjectionContextWalk = {
            nodes: 0,
            definitions: 0,
            references: 0,
            referenceUnits: 0,
          }
          for (const node of packedProjectionDefinitions(root, budget, copied, prune)) {
            if (node !== undefined) context.push(node.recordKey())
            yield
          }
          let previous = 0
          let disjoint = true
          for (const node of root.elementSteps(['children'])) {
            if (node === undefined) {
              yield
              continue
            }
            let span: PackedReadScope | undefined
            while (!span) {
              const next = spans.next()
              if (next.done) throw new Error('Missing validated projection span')
              span = next.value
              if (!span) yield
            }
            const position = node.position(['position'], { retained: 272, staging: 0 })
            const from = position.start.offset
            const to = position.end.offset
            if (from < previous) disjoint = false
            previous = to
            const key = node.recordKey()
            const { eligible, contextual, traversal } = yield* independent(
              node,
              budget,
              visited,
              prune,
            )
            blocks.push({
              traversal,
              key,
              from,
              to,
              htmlFrom: packedInteger(span, ['from'], projection.textLength(['html'])),
              htmlTo: packedInteger(span, ['to'], projection.textLength(['html'])),
              visible: packedSmall(span, ['visible']) === true,
              eligible: eligible && key !== undefined && key.range === 0,
              contextual,
              widgets: [],
            })
            yield
          }
          let blockIndex = 0
          for (const widget of projection.elementSteps(['blocks'])) {
            if (widget === undefined) {
              yield
              continue
            }
            const from = packedInteger(widget, ['from'], source.text.length)
            const to = packedInteger(widget, ['to'], source.text.length)
            while (blocks[blockIndex] && from >= (blocks[blockIndex]?.to ?? 0)) blockIndex++
            const block = blocks[blockIndex]
            if (block && block.from <= from && to <= block.to) {
              const key = widget.recordKey()
              if (!key) block.eligible = false
              else block.widgets.push(Object.freeze({ key, from, to }))
            }
            yield
          }
          if (disjoint)
            for (const block of blocks) {
              const key = block.key
              if (block.eligible && key) {
                let table = records.get(key.token)
                if (!table) {
                  table = new Map()
                  records.set(key.token, table)
                }
                table.set(
                  key.record,
                  Object.freeze({
                    traversal: block.traversal,
                    key,
                    contextual: block.contextual,
                    htmlFrom: block.htmlFrom,
                    htmlTo: block.htmlTo,
                    visible: block.visible,
                    widgets: Object.freeze(block.widgets),
                  }),
                )
              }
              yield
            }
          // Close construction readers before a published baseline takes ownership.
          // Detach first so a fallible close cannot run twice during unwinding.
          const completed = spans
          spans = undefined
          completed.return()
          // Persistent metadata remains retained; construction staging ends before reuse.
          hold.release()
          hold = capture.workspace(bytes, 0)
          const baseline = new PackedProjectionBaseline(seal, {
            capture,
            source,
            html: [...path, 'projection', 'html'],
            policy: JSON.stringify(render),
            limits: Object.freeze(budget),
            records,
            context: Object.freeze(context),
          })
          baseline.#lifetime = capture.work(lifetime(baseline, hold))
          baseline.#lifetime.next()
          transferred = true
          return baseline
        } catch (error) {
          failed = true
          throw error
        } finally {
          finishPackedCleanup(
            [
              () => void spans?.return(),
              () => {
                if (!transferred) {
                  records.clear()
                  hold.release()
                }
              },
            ],
            failed,
          )
        }
      })(),
    )
  }
  #current(): Data {
    const data = this.#data
    if (!data) throw new Error('Projection baseline closed')
    data.capture.identity
    return data
  }
  /** Complete validation is reusable only for this exact immutable snapshot. No baseline
   * data is borrowed: the caller's capture independently keeps that revision alive, so
   * closing the baseline after this check cannot invalidate the established fact. Native
   * output still needs its own admission. Stricter/invalid limits take full validation.
   */
  validatesSnapshot(
    capture: PackedCapture,
    source: PackedSource,
    snapshot: PackedPath,
    options: RenderOptions,
    limits: ProjectionLimits,
  ): boolean {
    if (!this.#data) return false
    const data = this.#current()
    return (
      data.source === source &&
      capture.sourceResource === source &&
      data.capture.sameRevision(capture) &&
      snapshot.length === data.html.length - 2 &&
      snapshot.every((part, index) => part === data.html[index]) &&
      Object.keys(options).length === 3 &&
      Object.keys(options).every((key) =>
        ['rawHtml', 'footnotesLabel', 'footnoteBackLabel'].includes(key),
      ) &&
      typeof options.rawHtml === 'boolean' &&
      typeof options.footnotesLabel === 'string' &&
      options.footnotesLabel.length <= 200 &&
      typeof options.footnoteBackLabel === 'string' &&
      options.footnoteBackLabel.length <= 200 &&
      data.policy === JSON.stringify(options) &&
      (['retained', 'staging', 'nodes', 'depth'] as const).every(
        (key) => Number.isSafeInteger(limits[key]) && limits[key] >= data.limits[key],
      ) &&
      limits.retained <= semanticLimits.rendererBytes &&
      limits.staging <= semanticLimits.messageBytes &&
      limits.nodes <= semanticLimits.blocks * 16 &&
      limits.depth <= 128
    )
  }
  compatible(capture: PackedCapture, source: PackedSource, options: RenderOptions): boolean {
    if (!this.#data) return false
    const data = this.#current()
    const before = data.source.identity
    const after = source.identity
    return (
      data.capture.sameOwner(capture) &&
      capture.sourceResource === source &&
      ['generation', 'documentId', 'parserVersion', 'rendererVersion', 'options'].every(
        (key) => before[key as keyof typeof before] === after[key as keyof typeof after],
      ) &&
      after.revision > before.revision &&
      data.policy === JSON.stringify(options)
    )
  }
  *sameContext(context: readonly (PackedRecordKey | undefined)[]): Generator<void, boolean> {
    const data = this.#current()
    if (context.length !== data.context.length) return false
    for (let index = 0; index < context.length; index++) {
      this.#current()
      const before = data.context[index]
      const item = context[index]
      if (
        !before ||
        !item ||
        item.token !== before.token ||
        item.record !== before.record ||
        item.range !== before.range
      )
        return false
      if ((index + 1) % 256 === 0) yield
    }
    return true
  }
  find(
    node: PackedReadScope,
    contextVerified = false,
  ): { block: BaselineBlock; offset: number } | undefined {
    const data = this.#current()
    const key = node.recordKey()
    if (key?.range !== 0) return undefined
    const block = data.records.get(key.token)?.get(key.record)
    if (block?.contextual && !contextVerified) return undefined
    return block ? { block, offset: key.offset - block.key.offset } : undefined
  }
  openHtml(): PackedHtmlCursor {
    const data = this.#current()
    return new PackedHtmlCursor(data.capture.reader.textSteps(data.html, validationStreamLimits))
  }
  /** Definition/footnote absence is independent of link/image resolution. Preserve the
   * complete logical node/depth costs even when a context walk prunes this shared block.
   */
  contextFree(node: PackedReadScope): PackedProjectionSubtree | undefined {
    const data = this.#current(),
      key = node.recordKey()
    return key?.range === 0 ? data.records.get(key.token)?.get(key.record)?.traversal : undefined
  }
  assertOpen(): void {
    this.#current()
  }
  close(): void {
    const work = this.#lifetime
    this.#lifetime = undefined
    this.#data?.records.clear()
    this.#data = undefined
    work?.return()
  }
}
