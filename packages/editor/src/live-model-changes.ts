import type { Transaction } from '@codemirror/state'
import type { LiveModel } from './live-model'

/** Keep untouched projections steady while the worker refreshes changed source.
 * A changed block is removed immediately; its active editing session owns any
 * source/preview pairing until the authoritative replacement arrives.
 */
export function mapUnchangedBlocks(model: LiveModel, transaction: Transaction): LiveModel | null {
  const blocks = model.blocks.flatMap((block) => {
    if (transaction.changes.touchesRange(block.from, block.to)) return []
    const from = transaction.changes.mapPos(block.from, 1)
    const to = transaction.changes.mapPos(block.to, -1)
    return [from === block.from && to === block.to ? block : { ...block, from, to }]
  })
  const anchors = model.anchors?.flatMap((anchor) =>
    transaction.changes.touchesRange(anchor.from, anchor.from)
      ? []
      : [{ ...anchor, from: transaction.changes.mapPos(anchor.from, 1) }],
  )
  return blocks.length || anchors?.length ? { blocks, ...(anchors ? { anchors } : {}) } : null
}
