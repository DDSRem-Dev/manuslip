import { semanticLimits } from '@manuslip/core'
import { toHtml } from 'hast-util-to-html'
import type { ReadingProjection } from './reading'
import { readingJsonBytes } from './reading-bytes'

/** Whole logical rows; exact HTML values share storage, while anchors remain per occurrence. */
export interface ReadingIndex {
  values: string[]
  order: number[]
  pairs: boolean[]
  anchors: number[]
}
const invalid = (): never => {
  throw new Error('translation-view-worker')
}
/** Borrow normal UUIDs; preserve the pinned native serializer for unusual caller IDs. */
export function readingBlockAttribute(value: string): string {
  if (/^[a-zA-Z0-9_.:-]+$/.test(value)) return value
  const wrapper = toHtml({
    type: 'element',
    tagName: 'div',
    properties: { dataReadingBlock: value },
    children: [],
  })
  return wrapper.slice('<div data-reading-block="'.length, -'"></div>'.length)
}
export function readingRowHtml(projection: ReadingProjection, row: number, anchor = true): string {
  const index = projection.indexed
  if (!index) return invalid()
  const value = index.values[index.order[row] ?? -1]
  if (value === undefined) return invalid()
  if (!index.pairs[row]) return value
  const block = projection.blocks?.[index.anchors[row] ?? -1]
  return `<div class="reading-pair"${anchor && block ? ` data-reading-block="${readingBlockAttribute(block.id)}"` : ''}>${value}</div>`
}
export function readingIndexWrapper(projection: ReadingProjection): string {
  if (!['side-by-side', 'interlinear'].includes(projection.layout ?? '')) return invalid()
  return `reading-layout reading-${projection.layout}`
}
/** Validate and charge actual retained dictionary plus every occurrence's metadata. */
export function readingProjectionBytes(projection: ReadingProjection): number {
  if (!projection.indexed) return readingJsonBytes(projection) * 2
  const index = projection.indexed
  if (
    projection.html !== '' ||
    !Array.isArray(projection.blocks) ||
    projection.blocks.length > semanticLimits.blocks + 1 ||
    !Array.isArray(projection.slots) ||
    !Array.isArray(index.values) ||
    !Array.isArray(index.order) ||
    !Array.isArray(index.pairs) ||
    !Array.isArray(index.anchors) ||
    index.order.length > semanticLimits.blocks + 1 ||
    index.values.length > index.order.length ||
    index.pairs.length !== index.order.length ||
    index.anchors.length !== index.order.length ||
    Object.keys(index).sort().join(',') !== 'anchors,order,pairs,values'
  )
    return invalid()
  readingIndexWrapper(projection)
  for (const slot of projection.slots) {
    if (
      !slot ||
      typeof slot.id !== 'string' ||
      slot.id.length === 0 ||
      slot.id.length > 256 ||
      !['math', 'diagram'].includes(slot.kind) ||
      typeof slot.source !== 'string' ||
      typeof slot.display !== 'boolean' ||
      (slot.syntax !== undefined &&
        (slot.kind !== 'diagram' || !['mermaid', 'sequence', 'flowchart'].includes(slot.syntax)))
    )
      return invalid()
  }
  let bytes =
    4096 +
    index.order.length * 128 +
    projection.blocks.length * 512 +
    readingJsonBytes(projection.slots) * 2
  for (const value of index.values) {
    if (typeof value !== 'string') return invalid()
    bytes += 64 + value.length * 2
  }
  const used = new Set<number>()
  const anchored = new Set<number>()
  for (let row = 0; row < index.order.length; row++) {
    const at = index.order[row],
      block = index.anchors[row]
    if (
      !Number.isSafeInteger(at) ||
      at === undefined ||
      at < 0 ||
      at >= index.values.length ||
      typeof index.pairs[row] !== 'boolean' ||
      !Number.isSafeInteger(block) ||
      block === undefined ||
      block < -1 ||
      block >= projection.blocks.length ||
      (index.pairs[row] && block < 0)
    )
      return invalid()
    used.add(at)
    if (block >= 0) {
      if (anchored.has(block)) return invalid()
      anchored.add(block)
    }
  }
  if (used.size !== index.values.length) return invalid()
  const ids = new Set<string>()
  for (const block of projection.blocks) {
    if (
      !block ||
      typeof block.id !== 'string' ||
      block.id.length === 0 ||
      block.id.length > 256 ||
      ids.has(block.id) ||
      typeof block.kind !== 'string' ||
      block.kind.length > 128 ||
      typeof block.hash !== 'string' ||
      block.hash.length > 256 ||
      !Number.isSafeInteger(block.from) ||
      !Number.isSafeInteger(block.to) ||
      block.from < 0 ||
      block.to < block.from
    )
      return invalid()
    ids.add(block.id)
    bytes += (block.id.length + block.kind.length + block.hash.length) * 2
  }
  return bytes
}
/** Diagnostic/native compatibility only. Large UI copies consume rows without flattening. */
export function expandReadingIndex(projection: ReadingProjection): string {
  if (!projection.indexed) return projection.html
  const rows = [`<div class="${readingIndexWrapper(projection)}">`]
  for (let row = 0; row < projection.indexed.order.length; row++)
    rows.push(readingRowHtml(projection, row))
  rows.push('</div>')
  return rows.join('')
}
