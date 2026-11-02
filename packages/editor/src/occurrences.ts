import {
  type ChangeDesc,
  MapMode,
  RangeSet,
  RangeSetBuilder,
  RangeValue,
  type Text,
} from '@codemirror/state'
import type { BlockOccurrence, SemanticBlock } from '@manuslip/core'

class Occurrence extends RangeValue {
  override startSide = 1
  override endSide = -1
  override mapMode = MapMode.TrackDel
  constructor(
    readonly block: BlockOccurrence,
    readonly source: Text,
  ) {
    super()
  }
}

export interface PreparedOccurrences {
  blocks: BlockOccurrence[]
  /** Commits once, and only while no edit/reset/other reconciliation has intervened. */
  commit(): boolean
}

/** Maps positions, never matches duplicate paragraphs by content hash alone. */
export class OccurrenceTracker {
  private ranges = RangeSet.empty as RangeSet<Occurrence>
  private version = 0
  map(changes: ChangeDesc): void {
    this.version++
    this.ranges = this.ranges.map(changes)
  }
  reset(): void {
    this.version++
    this.ranges = RangeSet.empty
  }
  /** Independent candidate index over immutable ranges. Preparing a replacement must
   * not mutate the installed tracker before the replacement is accepted.
   */
  fork(): OccurrenceTracker {
    const fork = new OccurrenceTracker()
    fork.ranges = this.ranges
    return fork
  }

  reconcile(
    blocks: readonly SemanticBlock[],
    source: Text,
    newId: () => string = () => crypto.randomUUID(),
  ): BlockOccurrence[] {
    const preparation = this.prepare(blocks, source, newId)
    let result = preparation.next()
    while (!result.done) result = preparation.next()
    if (!result.value.commit()) throw new Error('Occurrence reconciliation was superseded')
    return result.value.blocks
  }

  /** Source-ordered descriptors; yields every 64 entries without mutating the live index. */
  *prepare(
    blocks: readonly SemanticBlock[],
    source: Text,
    newId: () => string = () => crypto.randomUUID(),
  ): Generator<void, PreparedOccurrences> {
    const version = this.version
    // A null value marks an ambiguous mapped range; no candidate arrays are needed.
    const candidates = new Map<string, Occurrence | null>()
    const key = (block: Pick<SemanticBlock, 'kind' | 'hash'>, from: number, to: number): string =>
      `${block.kind}:${from}:${to}:${block.hash}`
    let visited = 0
    for (const cursor = this.ranges.iter(); cursor.value; cursor.next()) {
      const value = cursor.value
      const identity = key(value.block, cursor.from, cursor.to)
      candidates.set(identity, candidates.has(identity) ? null : value)
      if (++visited % 64 === 0) yield
    }
    const result: BlockOccurrence[] = []
    const builder = new RangeSetBuilder<Occurrence>()
    let lastFrom = -1
    for (const block of blocks) {
      if (block.from < lastFrom) throw new Error('Occurrence descriptors must be source ordered')
      lastFrom = block.from
      const candidate = candidates.get(key(block, block.from, block.to))
      const same =
        candidate &&
        source.sliceString(block.from, block.to) ===
          candidate.source.sliceString(candidate.block.from, candidate.block.to)
      const occurrence = { ...block, id: same ? candidate.block.id : newId() }
      result.push(occurrence)
      if (block.from < block.to)
        builder.add(block.from, block.to, new Occurrence(occurrence, source))
      if (++visited % 64 === 0) yield
    }
    const ranges = builder.finish()
    return {
      blocks: result,
      commit: () => {
        if (this.version !== version) return false
        this.ranges = ranges
        this.version++
        return true
      },
    }
  }
}
