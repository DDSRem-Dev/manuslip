import type { Heading, ParseTimings, SemanticBlock } from '../../core/src/contracts'
import type { PackedCapture } from '../../core/src/packing-capture'
import type { PackedDocumentBaseline } from '../../core/src/packing-document-baseline'
import type { PackedHold } from '../../core/src/packing-hold'
import {
  copyPackedNative,
  measurePackedNative,
  type PackedNativePlan,
} from '../../core/src/packing-native-copy'
import { type PackedSource, sameIdentity } from '../../core/src/packing-source'
import { packedTextStepCost } from '../../core/src/packing-text-stream'
import type { PackedRootValidationLimits } from '../../core/src/packing-validate-root'
import type { PackedValue } from '../../core/src/packing-value'
import type { PackedPath } from '../../core/src/packing-view'
import type { PackedWordBaseline } from '../../core/src/packing-word-baseline'
import { PackedWordBuffer } from '../../core/src/packing-word-buffer'
import type { PackedWork } from '../../core/src/packing-work'
import type { RenderedBlock, RenderOptions } from './index'
import type { PackedProjectionBaseline } from './packed-projection-baseline'
import { PackedSnapshotCertificate } from './packed-snapshot-certificate'
import { validatePackedSnapshot } from './packing-validate-snapshot'
import {
  copyPreviewDescriptors,
  measurePreviewDescriptors,
  previewDescriptorRanges,
} from './preview-descriptors'

export interface PackedPreviewInput {
  readonly document: {
    readonly blocks: readonly SemanticBlock[]
    readonly outline: readonly Heading[]
    readonly counts: Readonly<{ words: number; characters: number }>
    readonly timings: Readonly<ParseTimings>
  }
  readonly projection: {
    readonly blocks: readonly RenderedBlock[]
    readonly renderMs: number
  }
}
export interface PackedPreviewCost {
  /** Complete native input, held through every inspector suspension. */
  readonly retainedBytes: number
  readonly stagingBytes: 0
  readonly copyStagingBytes: number
  readonly nodes: number
}
export interface PackedPreviewBaselines {
  readonly snapshot?: PackedSnapshotCertificate
  readonly projection?: PackedProjectionBaseline
  readonly document?: PackedDocumentBaseline
  readonly words?: PackedWordBaseline
}
export interface PreparedPackedPreviewInput {
  readonly input: PackedPreviewInput
  readonly cost: Readonly<PackedPreviewCost>
}

/** Experimental input adapter for the application's existing preview preparation.
 * Complete snapshot validation precedes native allocation. Semantic descriptors, rendered
 * widgets and preview status/metric fields are copied; the AST and full HTML stay packed.
 * Output has a separate retained reservation; only bounded copy/decoder scratch is staging.
 * The trusted inspector must separately admit its model/index output, and may not retain
 * these borrowed arrays/strings after inspection without independent ownership.
 */
export function inspectPackedPreview(
  capture: PackedCapture,
  source: PackedSource,
  snapshot: PackedPath,
  options: RenderOptions,
  limits: PackedRootValidationLimits,
  inspect: (input: PackedPreviewInput, cost: Readonly<PackedPreviewCost>) => Generator<void>,
  baselines: PackedPreviewBaselines = {},
): PackedWork<void> {
  capture.reader.at(snapshot)
  if (snapshot.length > 62 || typeof inspect !== 'function')
    throw new Error('Invalid packed preview request')
  const path = [...snapshot],
    render = { ...options },
    budget = { ...limits },
    reuse = { ...baselines }
  return capture.work(
    (function* () {
      let output: PackedValue<PreparedPackedPreviewInput> | undefined
      const preparation = preparePackedPreviewInput(capture, source, path, render, budget, reuse)
      try {
        while (true) {
          const next = preparation.next()
          if (next.done) {
            output = next.value
            break
          }
          yield
        }
        if (!output) return
        yield* inspect(output.value.input, output.value.cost)
      } finally {
        output?.release()
        preparation.return()
      }
    })(),
  )
}

/** Complete validated input with independent native ownership. Successful completion
 * transfers the handle to the caller; cancellation/failure releases partial output.
 * The capture may close afterwards. Release the result after every consumer ends;
 * session disposal clears it even when callers keep the closed handle unadvanced.
 * Widget selection changes only this consumer's native descriptors, after complete
 * validation; the captured document/root and full-input adapter stay lossless.
 */
export function preparePackedPreviewInput(
  capture: PackedCapture,
  source: PackedSource,
  snapshot: PackedPath,
  options: RenderOptions,
  limits: PackedRootValidationLimits,
  baselines: PackedPreviewBaselines = {},
  descriptors: 'all' | 'widgets' = 'all',
): PackedWork<PackedValue<PreparedPackedPreviewInput>> {
  capture.reader.at(snapshot)
  if (snapshot.length > 62) throw new Error('Invalid packed preview request')
  const path = [...snapshot],
    render = { ...options },
    budget = { ...limits },
    reuse = { ...baselines }
  return capture.work(
    (function* () {
      if (capture.sourceResource !== source || !sameIdentity(capture.identity, source.identity))
        throw new Error('Packed preview source mismatch')
      if (
        !PackedSnapshotCertificate.validates(
          reuse.snapshot,
          capture,
          source,
          path,
          render,
          budget,
        ) &&
        !reuse.projection?.validatesSnapshot(capture, source, path, render, budget)
      )
        yield* validatePackedSnapshot(
          capture,
          source,
          path,
          render,
          budget,
          reuse.projection,
          reuse.document,
          reuse.words,
        )
      const blocks = capture.reader.at([...path, 'document', 'blocks'])
      const widgets = capture.reader.at([...path, 'projection', 'blocks'])
      const outline = capture.reader.at([...path, 'document', 'outline'])
      const counts = capture.reader.at([...path, 'document', 'counts'])
      const timings = capture.reader.at([...path, 'document', 'timings'])
      const renderMs = capture.reader.at([...path, 'projection', 'renderMs'])
      // Widget models consume range-matched descriptors only. The complete semantic
      // document above remains validated and retained in the immutable capture.
      const selectionBytes = descriptors === 'widgets' ? 4096 + widgets.length() * 192 : 0
      const fixed = 32768 + (budget.depth + path.length + 8) * 1024 + selectionBytes
      const plan: PackedNativePlan = { retained: 0, longest: 0, nodes: 0 }
      const scratch = () =>
        plan.longest ? PackedWordBuffer.collectionBytes(plan.longest, plan.longest + 1) : 0
      const stream = () => (plan.longest ? packedTextStepCost : { retained: 0, workspace: 0 })
      const admit = () => {
        const decoder = stream()
        if (
          fixed +
            plan.retained +
            scratch() +
            decoder.retained +
            decoder.workspace +
            (budget.depth + 8) * 512 >
            budget.retained ||
          fixed + scratch() + decoder.workspace > budget.staging
        )
          throw new Error('Packed preview exceeds workspace limit')
      }
      admit()
      let hold: PackedHold | undefined = capture.workspace(fixed, fixed)
      let output: PackedValue<PreparedPackedPreviewInput> | undefined
      let transferred = false
      try {
        const ranges =
          descriptors === 'widgets' ? yield* previewDescriptorRanges(widgets) : undefined
        if (ranges) yield* measurePreviewDescriptors(blocks, ranges, budget, plan, admit)
        else yield* measurePackedNative(blocks, budget, plan, admit)
        for (const scope of [widgets, outline, counts, timings, renderMs]) {
          yield* measurePackedNative(scope, budget, plan, admit)
          yield
        }
        const copyStagingBytes = fixed + scratch()
        hold.release()
        hold = undefined
        hold = capture.workspace(fixed + plan.retained + scratch(), copyStagingBytes)
        yield
        const semanticBlocks = ranges
          ? yield* copyPreviewDescriptors(blocks, ranges)
          : ((yield* copyPackedNative(blocks)) as readonly SemanticBlock[])
        yield
        const renderedBlocks = (yield* copyPackedNative(widgets)) as readonly RenderedBlock[]
        yield
        const headings = (yield* copyPackedNative(outline)) as readonly Heading[]
        yield
        const wordCounts = (yield* copyPackedNative(
          counts,
        )) as PackedPreviewInput['document']['counts']
        yield
        const parseTimings = (yield* copyPackedNative(timings)) as Readonly<ParseTimings>
        yield
        const renderTime = (yield* copyPackedNative(renderMs)) as number
        const input = Object.freeze({
          document: Object.freeze({
            blocks: semanticBlocks,
            outline: headings,
            counts: wordCounts,
            timings: parseTimings,
          }),
          projection: Object.freeze({ blocks: renderedBlocks, renderMs: renderTime }),
        })
        // Copy frames/collectors have ended. The independent native output reservation
        // remains live, including while the inspector allocates its separately owned model.
        const retainedBytes = 16384 + plan.retained
        hold.release()
        hold = undefined
        output = capture.own(
          Object.freeze({
            input,
            cost: Object.freeze({
              retainedBytes,
              stagingBytes: 0,
              copyStagingBytes,
              nodes: plan.nodes,
            }),
          }),
          retainedBytes,
        )
        yield
        transferred = true
        return output
      } finally {
        if (!transferred) output?.release()
        hold?.release()
      }
    })(),
  )
}
