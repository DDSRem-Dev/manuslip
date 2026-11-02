import type { PackedCapture } from '../../core/src/packing-capture'
import type { PackedDocumentBaseline } from '../../core/src/packing-document-baseline'
import type { PackedSource } from '../../core/src/packing-source'
import { packedDocumentSteps } from '../../core/src/packing-validate-document'
import type { PackedRootValidationLimits } from '../../core/src/packing-validate-root'
import { packedKeys } from '../../core/src/packing-validation-read'
import type { PackedPath } from '../../core/src/packing-view'
import type { PackedWordBaseline } from '../../core/src/packing-word-baseline'
import type { PackedWork } from '../../core/src/packing-work'
import {
  collectProjectionContext,
  isCollectedProjectionCapacityError,
} from './collected-projection-context'
import type { RenderOptions } from './index'
import type { PackedProjectionBaseline } from './packed-projection-baseline'
import { packedProjectionOutputSteps } from './packing-validate-output'

/** Document consistency plus exact renderer HTML/layout/widget equivalence. Fresh-parser
 * equivalence, runtime integration and DOM sanitization remain separate activation gates.
 */
export function validatePackedSnapshot(
  capture: PackedCapture,
  source: PackedSource,
  snapshot: PackedPath,
  options: RenderOptions,
  limits: PackedRootValidationLimits,
  baseline?: PackedProjectionBaseline,
  documentBaseline?: PackedDocumentBaseline,
  wordBaseline?: PackedWordBaseline,
): PackedWork<void> {
  return capture.work(
    packedSnapshotSteps(
      capture,
      source,
      snapshot,
      options,
      limits,
      baseline,
      documentBaseline,
      wordBaseline,
    ),
  )
}

/** Internal complete validation under a capture-owned parent. Its raw delegation chain
 * must not escape that parent; independent callers use validatePackedSnapshot.
 */
export function packedSnapshotSteps(
  capture: PackedCapture,
  source: PackedSource,
  snapshot: PackedPath,
  options: RenderOptions,
  limits: PackedRootValidationLimits,
  baseline?: PackedProjectionBaseline,
  documentBaseline?: PackedDocumentBaseline,
  wordBaseline?: PackedWordBaseline,
): Generator<void> {
  capture.reader.at(snapshot)
  if (snapshot.length > 62) throw new Error('Invalid packed snapshot path')
  const path = [...snapshot]
  const render = { ...options }
  const budget = { ...limits }
  return (function* () {
    packedKeys(capture.reader.at(path), [], ['document', 'projection', 'layout'])
    const paired =
      documentBaseline?.compatible(capture, source) && wordBaseline?.compatible(capture, source)
        ? { document: documentBaseline, words: wordBaseline }
        : undefined
    if ((!baseline && !documentBaseline && !wordBaseline) || paired) {
      try {
        yield* collectProjectionContext(
          capture,
          source,
          [...path, 'document', 'root'],
          budget,
          function* (collected) {
            yield* packedProjectionOutputSteps(
              capture,
              source,
              {
                root: [...path, 'document', 'root'],
                projection: [...path, 'projection'],
                layout: [...path, 'layout'],
              },
              render,
              budget,
              baseline,
              documentBaseline,
              collected,
            )
          },
          paired,
        )
        return
      } catch (error) {
        if (!isCollectedProjectionCapacityError(error)) throw error
      }
    }
    yield* packedDocumentSteps(
      capture,
      source,
      [...path, 'document'],
      budget,
      undefined,
      documentBaseline,
      wordBaseline,
    )
    yield* packedProjectionOutputSteps(
      capture,
      source,
      {
        root: [...path, 'document', 'root'],
        projection: [...path, 'projection'],
        layout: [...path, 'layout'],
      },
      render,
      budget,
      baseline,
      documentBaseline,
    )
  })()
}
