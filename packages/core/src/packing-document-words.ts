import type { PackedCapture, PackedReadScope } from './packing-capture'
import { finishPackedCleanup } from './packing-cleanup'
import type {
  PackedDocumentBaseline,
  PackedDocumentContextSubtree,
} from './packing-document-baseline'
import type { PackedSource } from './packing-source'
import { packedTextStepCost } from './packing-text-stream'
import { packedDescriptionSteps } from './packing-validate-descriptions'
import {
  type PackedRootObserver,
  type PackedRootValidationLimits,
  packedRootWorkspace,
} from './packing-validate-root'
import { checkPackedWordCount, checkPackedWordLimits } from './packing-validate-words'
import {
  invalidPackedSemantic,
  packedInteger,
  validationStreamLimits,
} from './packing-validation-read'
import type { PackedPath } from './packing-view'
import type { PackedWordBaseline } from './packing-word-baseline'
import { PackedWordBuffer } from './packing-word-buffer'
import type { PackedWordCache } from './packing-word-texts'

/** Internal prepaid context scratch. Completing the root releases only scratch whose
 * generators have closed; it does not certify the document before exact word checks.
 */
export interface PackedDocumentCollection {
  readonly bytes: number
  readonly prune?: (subtree: PackedDocumentContextSubtree) => void
  completeRoot(): number
}

export function packedDocumentCollectionBudget(
  limits: PackedRootValidationLimits,
  collection?: PackedDocumentCollection,
  completed = false,
): PackedRootValidationLimits {
  if (!collection) return limits
  const reserved = collection.bytes
  if (
    !Number.isSafeInteger(reserved) ||
    reserved < 0 ||
    reserved > limits.retained ||
    reserved > limits.staging
  )
    throw new Error('Invalid packed document collection budget')
  const bytes = completed ? collection.completeRoot() : reserved
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > reserved)
    throw new Error('Invalid packed document collection budget')
  return { ...limits, retained: limits.retained - bytes, staging: limits.staging - bytes }
}

/** Complete document validation with one root walk. Text is borrowed only after
 * checked schema or matching independently sealed document and word subtrees.
 * The caller must own these steps through capture.work and close them on cancellation.
 */
export function* packedDocumentWordsSteps(
  capture: PackedCapture,
  source: PackedSource,
  document: PackedPath,
  limits: PackedRootValidationLimits,
  observeRoot?: PackedRootObserver,
  baselines?: { readonly document: PackedDocumentBaseline; readonly words: PackedWordBaseline },
  collection?: PackedDocumentCollection,
): Generator<void> {
  checkPackedWordLimits(document, limits)
  const budget = packedDocumentCollectionBudget(limits, collection)
  const descriptionBytes = 8192 + limits.depth * 1024 + (baselines ? 4096 : 0)
  const rootBytes = packedRootWorkspace(source, [...document, 'root'], {
    ...budget,
    retained: budget.retained - descriptionBytes,
    staging: budget.staging - descriptionBytes,
  })
  // Both validators' fixed workspaces coexist with the growing prose collector. Keep
  // all original buffer/stream/traversal weights; session admission also covers streams
  // opened by description and schema checks while collection is suspended.
  const available = {
    retained: budget.retained - descriptionBytes - rootBytes,
    staging: budget.staging - descriptionBytes - rootBytes,
  }
  let collecting = collection !== undefined
  let units = 0
  let texts = 0
  const admit = (nextUnits: number, nextTexts: number, streaming: boolean) => {
    const bytes = collecting
      ? PackedWordBuffer.collectionBytes(nextUnits, nextTexts) + limits.depth * 1024
      : PackedWordBuffer.bytes(nextUnits, nextTexts, limits.depth)
    const stream = streaming ? packedTextStepCost : { retained: 0, workspace: 0 }
    if (
      bytes + stream.retained + stream.workspace + (limits.depth + 4) * 512 > available.retained ||
      bytes + stream.workspace > available.staging
    )
      throw new Error('Packed words exceed workspace limit')
    return bytes
  }
  const workspace = capture.reserveWorkspace(
    admit(0, 0, false),
    PackedWordBuffer.bytes(0, 0, limits.depth),
  )
  let buffer: PackedWordBuffer | undefined
  let failed = false
  try {
    buffer = PackedWordBuffer.create(0)
    const collector = buffer
    function* collect(node: PackedReadScope): Generator<void> {
      const length = node.textLength(['value'])
      const nextUnits = units + length + Number(texts > 0)
      const bytes = admit(nextUnits, texts + 1, true)
      workspace.resize(bytes, bytes)
      collector.grow(nextUnits)
      if (texts++ > 0) collector.append(' ')
      units = nextUnits
      const cached = node.cachedText(['value'])
      if (cached !== undefined) collector.append(cached)
      else
        for (const chunk of node.textSteps(['value'], validationStreamLimits)) {
          if (chunk !== undefined) collector.append(chunk)
          yield
        }
      yield
    }
    function* copyCached(cached: PackedWordCache): Generator<void> {
      for (const chunk of cached.chunks) {
        for (let offset = 0; offset < chunk.length; offset += 4098) {
          collector.append(chunk.slice(offset, offset + 4098))
          yield
        }
      }
      yield
    }
    function collectCached(cached: PackedWordCache): Generator<void> | void {
      if (cached.maximum > source.text.length) invalidPackedSemantic()
      const nextUnits = units + cached.units + Number(texts > 0 && cached.texts > 0)
      const nextTexts = texts + cached.texts
      const bytes = admit(nextUnits, nextTexts, true)
      workspace.resize(bytes, bytes)
      collector.grow(nextUnits)
      if (texts > 0 && cached.texts > 0) collector.append(' ')
      units = nextUnits
      texts = nextTexts
      // The sealed buffer flushes after 256 nonempty pieces: <=4096 units occupy
      // at most 16 chunks. Copy that bounded input before the root's next checkpoint;
      // larger caches retain the original per-chunk suspension and copy limits.
      if (cached.units <= 4096) {
        for (const chunk of cached.chunks) collector.append(chunk)
      } else return copyCached(cached)
    }
    function collectShared(
      cached: PackedWordCache,
      subtree?: PackedDocumentContextSubtree,
    ): Generator<void> | void {
      const work = collectCached(cached)
      if (work !== undefined)
        return (function* () {
          yield* work
          if (subtree) collection?.prune?.(subtree)
        })()
      if (subtree) collection?.prune?.(subtree)
    }
    yield* packedDescriptionSteps(
      capture,
      source,
      document,
      budget,
      baselines?.document,
      collect,
      observeRoot,
      baselines
        ? (node) => {
            // A context collector can consume a complete sealed absence proof. A
            // subtree containing definitions or footnote calls must still be observed
            // descendant by descendant, even when its document/text caches match.
            const cached = baselines.words.find(node)
            return cached
              ? {
                  nodes: cached.nodes,
                  depth: cached.depth,
                  accept: collection?.prune ? (subtree) => subtree.contextFree : undefined,
                  collect: (subtree) =>
                    collectShared(cached, collection?.prune ? subtree : undefined),
                }
              : undefined
          }
        : undefined,
    )
    // Root/description/native-copy frames have closed. Release their caller's prepaid
    // context scratch before reserving the complete join/ICU/segment phase. Keep every
    // original prose, stream and traversal weight; nothing is counted until admitted.
    const remaining = packedDocumentCollectionBudget(limits, collection, true)
    available.retained = remaining.retained - descriptionBytes - rootBytes
    available.staging = remaining.staging - descriptionBytes - rootBytes
    collecting = false
    const bytes = admit(units, texts, true)
    workspace.resize(bytes, bytes)
    const expected = packedInteger(
      capture.reader.at(document),
      ['counts', 'words'],
      source.text.length,
    )
    capture.identity
    yield
    const prose = collector.finish()
    yield* checkPackedWordCount(prose, expected, () => {
      capture.identity
    })
  } catch (error) {
    failed = true
    throw error
  } finally {
    finishPackedCleanup([() => buffer?.close(), () => workspace.release()], failed)
  }
}
