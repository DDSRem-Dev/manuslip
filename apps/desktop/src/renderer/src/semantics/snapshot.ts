import { type SemanticDocument, semanticLimits } from '@manuslip/core'
import { renderMarkdown, type RenderOptions } from '@manuslip/renderer'
import { renderProjectionLayout } from '../../../../../../packages/renderer/src/projection-layout'
import { canPreparePackedPreview } from './packed-admission'
import { type EncodedSnapshot, encodeSnapshot } from './protocol'

/** Optional preparation metadata must never reduce native whole-root transport capacity. */
export function encodeSemanticSnapshot(
  document: SemanticDocument,
  sourceLength: number,
  options: RenderOptions,
): EncodedSnapshot {
  let rendered: ReturnType<typeof renderProjectionLayout> | undefined
  if (canPreparePackedPreview(sourceLength, document)) {
    try {
      rendered = renderProjectionLayout(document.root, options, semanticLimits.rendererBytes)
    } catch {
      // A valid document may have no supported layout for the packed adapter.
    }
  }
  if (rendered) {
    const { projection, layout } = rendered
    try {
      return encodeSnapshot({ document, projection, layout })
    } catch {
      return encodeSnapshot({ document, projection })
    }
  }
  return encodeSnapshot({ document, projection: renderMarkdown(document.root, options) })
}
