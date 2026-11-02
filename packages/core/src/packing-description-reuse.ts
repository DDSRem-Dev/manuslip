import type { PackedItemSteps, PackedReadScope } from './packing-capture'
import { finishPackedCleanup } from './packing-cleanup'
import type { PackedDocumentBaseline, PackedDocumentSubtree } from './packing-document-baseline'
import type { PackedSource } from './packing-source'
import type { ScalarLimits } from './packing-text'
import {
  equalPackedText,
  invalidPackedSemantic,
  packedKeys,
  packedSmall,
  packedString,
} from './packing-validation-read'

function sharedMetadata(
  before: PackedReadScope,
  current: PackedReadScope,
  offset: number,
): boolean {
  const a = before.recordKey(),
    b = current.recordKey()
  return (
    !!a &&
    !!b &&
    a.token === b.token &&
    a.record === b.record &&
    a.offset === b.offset &&
    b.range - a.range === offset
  )
}

/** Source-free proof metadata selects old forward streams. Discarded-prefix advances
 * still yield separately; one descriptor comparison consumes at most one item per stream.
 */
export class PackedDescriptionReuse {
  #baseline: PackedDocumentBaseline | undefined
  #source: PackedSource | undefined
  #blocks: PackedItemSteps | undefined
  #outline: PackedItemSteps | undefined
  #blockAt = 0
  #headingAt = 0
  constructor(baseline: PackedDocumentBaseline, source: PackedSource) {
    this.#baseline = baseline
    this.#source = source
  }
  #current(): PackedDocumentBaseline {
    const baseline = this.#baseline
    if (!baseline) throw new Error('Description reuse closed')
    baseline.assertOpen()
    return baseline
  }
  *#next(items: PackedItemSteps): Generator<void, PackedReadScope> {
    while (true) {
      this.#current()
      const next = items.next()
      if (next.done) invalidPackedSemantic()
      this.#current()
      if (next.value !== undefined) return next.value
      yield
    }
  }
  *prune(
    node: PackedReadScope,
    position: ReturnType<PackedReadScope['position']>,
    budget: ScalarLimits,
    blocks: PackedItemSteps,
    outline: PackedItemSteps,
    accept?: (subtree: PackedDocumentSubtree) => boolean,
  ): Generator<void, PackedDocumentSubtree | undefined> {
    const baseline = this.#current()
    const source = this.#source
    if (!source) throw new Error('Description reuse closed')
    const proof = yield* baseline.prove(node, source, position)
    this.#current()
    if (!proof) return undefined
    const { subtree, offset } = proof
    if (accept) {
      const accepted = accept(subtree)
      this.#current()
      if (!accepted) return undefined
    }
    if (
      subtree.blockAt < this.#blockAt ||
      (subtree.headings && subtree.headingAt < this.#headingAt)
    )
      return undefined
    this.#blocks ??= baseline.open('blocks')
    while (this.#blockAt < subtree.blockAt) {
      yield* this.#next(this.#blocks)
      this.#blockAt++
    }
    for (let index = 0; index < subtree.blocks; index++) {
      const before = yield* this.#next(this.#blocks)
      this.#blockAt++
      const current = yield* this.#next(blocks)
      if (sharedMetadata(before, current, offset)) {
        yield
        continue
      }
      packedKeys(current, [], ['kind', 'from', 'to', 'hash', 'lines'])
      for (const field of ['kind', 'hash', 'lines'])
        if (packedSmall(current, [field]) !== packedSmall(before, [field])) invalidPackedSemantic()
      for (const field of ['from', 'to']) {
        const value = packedSmall(before, [field])
        if (typeof value !== 'number' || packedSmall(current, [field]) !== value + offset)
          invalidPackedSemantic()
      }
      yield
    }
    if (subtree.headings) {
      this.#outline ??= baseline.open('outline')
      while (this.#headingAt < subtree.headingAt) {
        yield* this.#next(this.#outline)
        this.#headingAt++
      }
      for (let index = 0; index < subtree.headings; index++) {
        const before = yield* this.#next(this.#outline)
        this.#headingAt++
        const current = yield* this.#next(outline)
        if (sharedMetadata(before, current, offset)) {
          packedString(current, ['text'], source.text.length)
          yield
          continue
        }
        packedKeys(current, [], ['from', 'to', 'depth', 'text'])
        if (packedSmall(current, ['depth']) !== packedSmall(before, ['depth']))
          invalidPackedSemantic()
        for (const field of ['from', 'to']) {
          const value = packedSmall(before, [field])
          if (typeof value !== 'number' || packedSmall(current, [field]) !== value + offset)
            invalidPackedSemantic()
        }
        packedString(current, ['text'], source.text.length)
        yield* equalPackedText(current, ['text'], ['text'], budget, before)
        yield
      }
    }
    return subtree
  }
  close(): void {
    const blocks = this.#blocks,
      outline = this.#outline
    this.#baseline = this.#source = undefined
    this.#blocks = this.#outline = undefined
    finishPackedCleanup([() => blocks?.return(), () => outline?.return()])
  }
}
