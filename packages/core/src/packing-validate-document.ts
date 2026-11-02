import type { PackedCapture } from './packing-capture'
import type { PackedDocumentBaseline } from './packing-document-baseline'
import {
  type PackedDocumentCollection,
  packedDocumentCollectionBudget,
  packedDocumentWordsSteps,
} from './packing-document-words'
import type { PackedSource } from './packing-source'
import { packedDescriptionSteps } from './packing-validate-descriptions'
import type { PackedRootObserver, PackedRootValidationLimits } from './packing-validate-root'
import { type PackedWordPhase, packedWordSteps } from './packing-validate-words'
import type { PackedPath } from './packing-view'
import type { PackedWordBaseline } from './packing-word-baseline'
import type { PackedWork } from './packing-work'

/** All SemanticDocument field checks, including exact counts. Projection checks and parser
 * equivalence remain separate. Both phases share aggregate capture/session ownership.
 * Later revisions using sealed subtrees still run the complete independent word phase.
 * The exact original immutable document can reuse its completed validation. Supplying a
 * word observer requests the actual phases, including their original validation/errors.
 */
export function validatePackedDocument(
  capture: PackedCapture,
  source: PackedSource,
  document: PackedPath,
  limits: PackedRootValidationLimits,
  wordPhase?: (phase: PackedWordPhase) => void,
  baseline?: PackedDocumentBaseline,
  wordBaseline?: PackedWordBaseline,
): PackedWork<void> {
  return capture.work(
    packedDocumentSteps(capture, source, document, limits, wordPhase, baseline, wordBaseline),
  )
}

/** Internal validation steps; an enclosing capture-owned task must own and close them. */
export function packedDocumentSteps(
  capture: PackedCapture,
  source: PackedSource,
  document: PackedPath,
  limits: PackedRootValidationLimits,
  wordPhase?: (phase: PackedWordPhase) => void,
  baseline?: PackedDocumentBaseline,
  wordBaseline?: PackedWordBaseline,
  observeRoot?: PackedRootObserver,
  collection?: PackedDocumentCollection,
): Generator<void> {
  capture.reader.at(document)
  const path = [...document]
  const budget = { ...limits }
  return (function* () {
    if (
      wordPhase === undefined &&
      observeRoot === undefined &&
      baseline?.validatesDocument(capture, source, path, budget)
    )
      return
    const reuse =
      wordPhase === undefined &&
      (observeRoot === undefined || collection?.prune !== undefined) &&
      baseline &&
      wordBaseline &&
      baseline.compatible(capture, source) &&
      wordBaseline.compatible(capture, source)
        ? { document: baseline, words: wordBaseline }
        : undefined
    if (wordPhase === undefined && ((!baseline && !wordBaseline) || reuse)) {
      try {
        const inspect = () =>
          packedDocumentWordsSteps(capture, source, path, budget, observeRoot, reuse, collection)
        if (reuse) {
          const complete = yield* reuse.words.inspect(inspect)
          if (complete !== true) throw new Error('Word baseline closed during validation')
        } else yield* inspect()
        return
      } catch (error) {
        // An optional observer may own partial collection. Its enclosing transaction
        // must release that collection before retrying the independent phases.
        if (observeRoot) throw error
        // Collection overlaps the root/description workspaces. If that optional overlap
        // cannot be admitted, its finally has closed every reader and released prose;
        // retain the existing separate phases and their original eligibility.
        if (
          !(error instanceof Error) ||
          ![
            'Packed words exceed workspace limit',
            'Packed reader exceeds staging limit',
            'Packed reader scope limit',
            'Packed validation streams exceed workspace limit',
          ].includes(error.message)
        )
          throw error
      }
    }
    yield* packedDescriptionSteps(
      capture,
      source,
      path,
      packedDocumentCollectionBudget(budget, collection),
      baseline,
      undefined,
      observeRoot,
    )
    yield* packedWordSteps(
      capture,
      source,
      path,
      packedDocumentCollectionBudget(budget, collection, true),
      wordPhase,
      wordBaseline,
    )
  })()
}
