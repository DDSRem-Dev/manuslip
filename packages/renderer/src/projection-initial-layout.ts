import type { Nodes, Root } from 'mdast'
import { type RenderedBlock, type RenderOptions, rendererVersion } from './index'
import { type ProjectionLayout, renderProjectionLayout } from './projection-layout'
import { type ProjectionDefinition, ProjectionSequence } from './projection-sequence'

/** Complete initial projection of a stable native parser root, with one body HAST
 * block at a time. Definitions and footnote state span the complete document.
 * Input, context and accumulated output remain caller-admitted; conversion and
 * joining are atomic. A large individual container or footer can still be large.
 */
export function renderInitialProjectionLayout(
  root: Root,
  options: RenderOptions,
  retainedLimit: number,
) {
  const retainedBytes = 1024 + root.children.length * 192
  if (!Number.isSafeInteger(retainedLimit) || retainedLimit < retainedBytes)
    throw new Error('Projection layout exceeds retained limit')
  // Custom root data can replace the entire output after body conversion. Preserve
  // the full renderer's root-wide policy; the pinned native parser has no such data.
  if (root.data) return renderProjectionLayout(root, options, retainedLimit)
  const started = performance.now()
  const definitions: ProjectionDefinition[] = []
  const frames = [{ node: root as Nodes, at: 0 }]
  while (frames.length) {
    const frame = frames[frames.length - 1]
    if (!frame) break
    const { node } = frame
    if (frame.at === 0 && (node.type === 'definition' || node.type === 'footnoteDefinition'))
      definitions.push(node)
    if ('children' in node && frame.at < node.children.length) {
      const child = node.children[frame.at++]
      if (child) frames.push({ node: child, at: 0 })
    } else frames.pop()
  }
  const sequence = new ProjectionSequence(definitions, options)
  const parts: string[] = []
  const blocks = new Map<string, RenderedBlock>()
  const spans: { from: number; to: number; visible: boolean }[] = []
  const ranges = new Set<string>()
  let at = 0
  let visible = false
  const appendBlocks = (items: readonly RenderedBlock[]) => {
    for (const block of items) blocks.set(`${block.from}:${block.to}`, block)
  }
  try {
    for (const node of root.children) {
      const from = node.position?.start.offset,
        to = node.position?.end.offset
      const range = `${from}:${to}`
      if (from === undefined || to === undefined || ranges.has(range))
        throw new Error('Ambiguous projection layout; full rendering required')
      ranges.add(range)
      const chunk = sequence.render(node)
      if (chunk.visible) {
        if (visible) {
          parts.push('\n')
          at++
        }
        const start = at
        parts.push(chunk.projection.html)
        at += chunk.projection.html.length
        spans.push({ from: start, to: at, visible: true })
        visible = true
      } else spans.push({ from: at, to: at, visible: false })
      appendBlocks(chunk.projection.blocks)
    }
    const bodyEnd = at
    const footer = sequence.finish()
    parts.push(footer.html)
    at += footer.html.length
    appendBlocks(footer.blocks)
    const html = parts.join('')
    if (html.length !== at) throw new Error('Invalid projection layout length')
    const layout: ProjectionLayout = Object.freeze({
      blocks: Object.freeze(spans.map((block) => Object.freeze(block))),
      bodyEnd,
      htmlLength: at,
    })
    const projection = {
      html,
      blocks: [...blocks.values()].sort((a, b) => a.from - b.from || b.to - a.to),
      renderMs: performance.now() - started,
      rendererVersion,
    }
    return { projection, layout, retainedBytes }
  } finally {
    sequence.close()
  }
}
