import { type Root, sourceHash } from '@manuslip/core'
import type { Root as HastRoot } from 'hast'
import { toHtml } from 'hast-util-to-html'
import { type ExportProjection, renderExport } from './export'
import type { ProjectionChildren, RenderOptions } from './index'
import { readingJsonBytes } from './reading-bytes'
import { ReadingDecoration } from './reading-decoration'
import {
  expandReadingIndex,
  type ReadingIndex,
  readingIndexWrapper,
  readingProjectionBytes,
  readingRowHtml,
} from './reading-index'

export {
  expandReadingIndex,
  readingIndexWrapper,
  readingProjectionBytes,
  readingRowHtml,
} from './reading-index'

export type ReadingLayout = 'replace' | 'side-by-side' | 'interlinear'
export interface ReadingBlock {
  id: string
  kind: string
  from: number
  to: number
  hash: string
}
export interface ReadingProjection extends ExportProjection {
  layout?: ReadingLayout
  blocks?: ReadingBlock[]
  indexed?: ReadingIndex
}
export function readingBlocks(root: Root, source: string): ReadingBlock[] {
  const blocks: ReadingBlock[] = root.children.flatMap((node) => {
    const from = node.position?.start.offset,
      to = node.position?.end.offset
    return from === undefined || to === undefined
      ? []
      : [
          {
            id: crypto.randomUUID(),
            kind: node.type,
            from,
            to,
            hash: sourceHash(source.slice(from, to)),
          },
        ]
  })
  if (root.children.some((node) => node.type === 'footnoteDefinition'))
    blocks.push({
      id: crypto.randomUUID(),
      kind: 'footnotes',
      from: source.length,
      to: source.length,
      hash: 'footnotes',
    })
  return blocks.sort((a, b) => a.from - b.from || b.to - a.to)
}
export interface ReadingOptions {
  layout: ReadingLayout
  blocks: readonly ReadingBlock[]
  sourceLanguage: string
  targetLanguage: string
  labels: { original: string; translation: string }
  /** Source ranges whose reconstructed prose actually translated. */
  translated: ReadonlySet<string>
  units: readonly { from: number; to: number }[]
  children?: ProjectionChildren
  /** Keep complete large bilingual output as admitted, independently addressable rows. */
  indexAboveBytes?: number
}
/** Whole-root rendering preserves references and footnotes; pairs use logical blocks, never lines. */
export function renderReading(
  original: Root,
  translated: Root,
  options: RenderOptions,
  reading: ReadingOptions,
): ReadingProjection {
  const namespace = crypto.randomUUID()
  const decoration = new ReadingDecoration(reading)
  let originalTree: HastRoot | null = null
  let indexed: ReadingIndex | undefined
  // Raw HTML can open a tag in one block and close it in another. Row isolation
  // cannot preserve that whole-fragment parsing behavior, so keep the native path.
  const canIndex = (): boolean => {
    if (!options.rawHtml) return true
    const pending: import('@manuslip/core').Nodes[] = [original, translated]
    while (pending.length) {
      const node = pending.pop()
      if (node?.type === 'html') return false
      if (node && 'children' in node) for (const child of node.children) pending.push(child)
    }
    return true
  }
  const serialize =
    reading.layout !== 'replace' && reading.indexAboveBytes !== undefined && canIndex()
      ? (tree: HastRoot): string => {
          const container = tree.children[0]
          if (container?.type !== 'element') throw new Error('Invalid reading container')
          const values: string[] = [],
            order: number[] = [],
            pairs: boolean[] = [],
            anchors: number[] = []
          const dictionary = new Map<string, number>()
          const byId = new Map(reading.blocks.map((block, index) => [block.id, index]))
          const native = () => {
            dictionary.clear()
            values.length = order.length = pairs.length = anchors.length = 0
            return toHtml(tree, { allowDangerousHtml: options.rawHtml })
          }
          let bytes = 4096 + reading.blocks.length * 768
          for (const node of container.children) {
            const pair =
              node.type === 'element' &&
              Array.isArray(node.properties.className) &&
              node.properties.className.includes('reading-pair')
            const id = node.type === 'element' ? node.properties.dataReadingBlock : undefined
            const html = toHtml(pair && node.type === 'element' ? node.children : node, {
              allowDangerousHtml: options.rawHtml,
            })
            let at = dictionary.get(html)
            if (at === undefined) {
              bytes += 128 + html.length * 4
              if (bytes > 8 * 1024 * 1024) return native()
              at = values.length
              values.push(html)
              dictionary.set(html, at)
            }
            bytes += 64
            if (bytes > 8 * 1024 * 1024) return native()
            order.push(at)
            pairs.push(pair)
            anchors.push(typeof id === 'string' ? (byId.get(id) ?? -1) : -1)
          }
          indexed = { values, order, pairs, anchors }
          return ''
        }
      : undefined
  const source =
    reading.layout === 'replace'
      ? null
      : renderExport(
          original,
          options,
          `original-${namespace}`,
          (tree) => {
            decoration.wrap(tree, true)
            originalTree = tree
          },
          undefined,
          serialize ? () => '' : undefined,
        )
  const projection = renderExport(
    translated,
    options,
    `translated-${namespace}`,
    (tree) => {
      decoration.wrap(tree, false)
      decoration.compose(tree, originalTree)
    },
    reading.children,
    serialize,
  )
  const slots = [...(source?.slots ?? []), ...projection.slots]
  const result: ReadingProjection = {
    html: projection.html,
    slots,
    layout: reading.layout,
    blocks: [...reading.blocks],
  }
  if (indexed) {
    result.indexed = indexed
    const overhead = readingJsonBytes({ ...result, html: '', indexed: undefined }) * 2
    let expanded = overhead + `<div class="${readingIndexWrapper(result)}"></div>`.length * 2
    for (let row = 0; row < indexed.order.length; row++)
      expanded += (readingJsonBytes(readingRowHtml(result, row)) - 2) * 2
    if (expanded <= (reading.indexAboveBytes ?? 0)) {
      result.html = expandReadingIndex(result)
      delete result.indexed
    }
    if (readingProjectionBytes(result) > 8 * 1024 * 1024) throw new Error('translation-view-limit')
  }
  return result
}
