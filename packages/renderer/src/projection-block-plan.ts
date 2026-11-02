import type { MarkdownFragment } from '../../core/src/markdown-fragment'
import type { PackedCapture } from '../../core/src/packing-capture'
import type { PackedPath } from '../../core/src/packing-view'
import type { SemanticDependencies } from '../../core/src/semantic-dependencies'
import type { RenderedBlock } from './index'

/** Plan bounded splices using only old ranges; unchanged HTML/value strings stay packed. */
export function planProjectionBlocks(
  capture: PackedCapture,
  projection: PackedPath,
  index: SemanticDependencies,
  fragment: MarkdownFragment,
  added: readonly RenderedBlock[],
  stagingLimit: number,
) {
  const size = capture.reader.length([...projection, 'blocks'])
  let stagingBytes = 4096 + size * 128 + added.length * 192
  if (stagingBytes > stagingLimit || size > 50000 || added.length > 50000)
    throw new Error('Projection block plan exceeds staging/block limit')
  const selected = index.blocks.at(fragment.start)
  const footer: { from: number; to: number }[] = []
  for (const definition of index.definitions) {
    if (definition.kind !== 'footnote' || !definition.selected) continue
    stagingBytes += 192
    if (stagingBytes > stagingLimit)
      throw new Error('Projection block plan exceeds staging/block limit')
    footer.push({ from: definition.from, to: definition.to })
  }
  const old: { from: number; to: number; remove: boolean }[] = []
  let previous = -1
  for (const item of capture.reader.elements([...projection, 'blocks'])) {
    const from = item.scalar(['from'], { retained: 16, staging: 0 })
    const to = item.scalar(['to'], { retained: 16, staging: 0 })
    if (
      typeof from !== 'number' ||
      typeof to !== 'number' ||
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from < previous ||
      from < 0 ||
      to < from ||
      to > fragment.baseSource.length
    )
      throw new Error('Invalid projection block range')
    previous = from
    old.push({
      from,
      to,
      remove:
        Boolean(selected && fragment.remove && from >= selected.from && to <= selected.to) ||
        footer.some((definition) => from >= definition.from && to <= definition.to),
    })
  }
  const shiftStart = selected ? old.findIndex((item) => item.from >= selected.to) : old.length
  const shifted = (item: (typeof old)[number], cursor: number) => ({
    from: item.from + (shiftStart >= 0 && cursor >= shiftStart ? fragment.suffixOffset : 0),
    to: item.to + (shiftStart >= 0 && cursor >= shiftStart ? fragment.suffixOffset : 0),
  })
  const edits: { start: number; remove: number; values: RenderedBlock[] }[] = []
  let addedIndex = 0
  let position = 0
  let pending = { start: 0, remove: 0, values: [] as RenderedBlock[] }
  const flush = () => {
    if (pending.remove || pending.values.length) {
      edits.push(pending)
      position += pending.values.length
      if (edits.length > 256)
        throw new Error('Projection block operation limit; full rendering required')
    }
    pending = { start: position, remove: 0, values: [] }
  }
  for (let cursor = 0; cursor <= old.length; cursor++) {
    const item = old[cursor]
    if (item?.remove) {
      pending.remove++
      continue
    }
    const range = item ? shifted(item, cursor) : undefined
    while (addedIndex < added.length) {
      const next = added[addedIndex]
      if (!next) throw new Error('Missing projection replacement')
      if (range && (next.from > range.from || (next.from === range.from && next.to < range.to)))
        break
      if (range && next.from === range.from && next.to === range.to)
        throw new Error('Ambiguous projection block merge')
      pending.values.push(next)
      addedIndex++
    }
    flush()
    if (item) {
      position++
      pending.start = position
    }
  }
  return { edits, shiftStart: shiftStart < 0 ? old.length : shiftStart, stagingBytes }
}
