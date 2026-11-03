import type { SemanticDocument } from '@manuslip/core'

/** Synchronous packing admission precedes cooperative preview preparation. */
export function canPreparePackedPreview(sourceLength: number, document: SemanticDocument): boolean {
  return (
    // The packed schema proves the canonical compiler's fixed metadata shape.
    // Configured documents carry additional heading/callout/typography metadata.
    !document.parserVersion.includes('/document-') &&
    sourceLength <= 512 * 1024 &&
    document.blocks.length <= 2000 &&
    document.root.children.length <= 2000
  )
}
