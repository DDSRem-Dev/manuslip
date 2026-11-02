import type { Heading, SemanticBlock } from '@manuslip/core'
import type { LiveBlock, LiveModel, OccurrenceTracker, Text } from '@manuslip/editor'
import type { RenderedBlock } from '@manuslip/renderer'

export interface PreviewInput {
  readonly document: {
    readonly blocks: readonly SemanticBlock[]
    readonly outline: readonly Heading[]
    readonly counts: Readonly<{ words: number; characters: number }>
  }
  readonly projection: { readonly blocks: readonly RenderedBlock[] }
}

export interface PreparedPreview {
  model: LiveModel
  status: {
    wordCount: number
    characterCount: number
    outline: readonly Heading[]
  }
  commit(): boolean
}

/** Prepare all identities before one atomic install; no partially current model is visible. */
export function* preparePreview(
  snapshot: PreviewInput,
  source: Text,
  tracker: OccurrenceTracker,
): Generator<void, PreparedPreview> {
  const occurrences = yield* tracker.prepare(snapshot.document.blocks, source)
  const blocks: LiveBlock[] = []
  if (snapshot.projection.blocks.length) {
    const identities = new Map<string, { id: string; lines: number }>()
    let visited = 0
    for (const block of occurrences.blocks) {
      identities.set(`${block.from}:${block.to}`, block)
      if (++visited % 64 === 0) yield
    }
    for (const block of snapshot.projection.blocks) {
      const occurrence = identities.get(`${block.from}:${block.to}`)
      blocks.push({
        ...block,
        id: occurrence?.id ?? crypto.randomUUID(),
        lines: occurrence?.lines ?? 1,
      })
      if (++visited % 64 === 0) yield
    }
  }
  return {
    model: { blocks },
    status: {
      wordCount: snapshot.document.counts.words,
      characterCount: snapshot.document.counts.characters,
      outline: snapshot.document.outline,
    },
    commit: occurrences.commit,
  }
}
