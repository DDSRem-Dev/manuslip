import type { Root as HastRoot } from 'hast'
import { toHtml } from 'hast-util-to-html'
import type { Root } from 'mdast'
import type { RenderOptions } from './index'
import { projectWithHandlers } from './projection-engine'

export interface ProjectionLayout {
  readonly blocks: readonly Readonly<{ from: number; to: number; visible: boolean }>[]
  readonly bodyEnd: number
  readonly htmlLength: number
}

/** Exact serializer spans, not a search through possibly duplicated or raw HTML text. */
export function measureProjectionLayout(
  root: Root,
  hast: HastRoot,
  options: RenderOptions,
): ProjectionLayout {
  const spans = new Map<string, number>()
  const blocks = root.children.map((node, index) => {
    const from = node.position?.start.offset
    const to = node.position?.end.offset
    if (from === undefined || to === undefined || spans.has(`${from}:${to}`))
      throw new Error('Ambiguous projection layout; full rendering required')
    spans.set(`${from}:${to}`, index)
    return { from: 0, to: 0, visible: false }
  })
  const last = hast.children.at(-1)
  const hasFooter = last?.type === 'element' && last.properties.dataFootnotes === true
  const bodyCount = hast.children.length - (hasFooter ? 2 : 0)
  let offset = 0
  let bodyEnd = 0
  for (const [index, node] of hast.children.entries()) {
    const from = offset
    offset += toHtml(node, { allowDangerousHtml: options.rawHtml }).length
    if (index < bodyCount) {
      bodyEnd = offset
      if (node.position) {
        const block =
          blocks[spans.get(`${node.position.start.offset}:${node.position.end.offset}`) ?? -1]
        if (!block || block.visible)
          throw new Error('Unsupported projection layout; full rendering required')
        Object.assign(block, { from, to: offset, visible: true })
      } else if (node.type !== 'text' || node.value !== '\n')
        throw new Error('Unsupported projection layout; full rendering required')
    }
  }
  let previous = 0
  for (const block of blocks) {
    if (block.visible) previous = block.to
    else {
      block.from = previous
      block.to = previous
    }
  }
  return Object.freeze({
    blocks: Object.freeze(blocks.map((block) => Object.freeze(block))),
    bodyEnd,
    htmlLength: offset,
  })
}

/** Internal initial render. Caller already admits the full parser/HAST/projection construction. */
export function renderProjectionLayout(root: Root, options: RenderOptions, retainedLimit: number) {
  const retainedBytes = 1024 + root.children.length * 192
  if (!Number.isSafeInteger(retainedLimit) || retainedLimit < retainedBytes)
    throw new Error('Projection layout exceeds retained limit')
  let layout: ProjectionLayout | undefined
  const projection = projectWithHandlers(root, options, undefined, (hast) => {
    layout = measureProjectionLayout(root, hast, options)
  })
  if (!layout || layout.htmlLength !== projection.html.length)
    throw new Error('Invalid projection layout length')
  return { projection, layout, retainedBytes }
}
