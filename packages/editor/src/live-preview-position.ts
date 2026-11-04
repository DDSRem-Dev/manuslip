import type { Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { diagramPositionAtPoint } from './live-diagram-position'
import { editingBlock } from './live-editing'
import { mathPositionAtPoint } from './live-math-position'
import { type LiveBlock, liveModel, proseProjection } from './live-model'
import {
  maxPositionUnits,
  type RenderedTextHit,
  renderedTextHit,
  sourcePositionAtText,
} from './live-position'
import { delimitedSourcePosition } from './live-source-position'

interface PointerHit {
  owner: string | undefined
  block: LiveBlock
  doc: Text
  offset: number
  x: number
  y: number
}

// A worker can replace literal loading text with SVG between press and release.
// Retain the authored hit, never its geometry, for this one pointer gesture.
const pressed = new WeakMap<HTMLElement, PointerHit>()

/** Widget DOM can survive edits before it. Event handlers must resolve current
 * source ownership rather than retaining the original widget's coordinates.
 */
export function blockAtPreview(
  view: EditorView,
  container: HTMLElement,
  event?: Pick<Event, 'target'>,
): LiveBlock | undefined {
  const id = container.dataset.occurrence
  const blocks = view.state.field(liveModel)?.blocks
  const editing = editingBlock(view.state)?.block
  const block =
    blocks?.find((block) => block.id === id) ?? (editing?.id === id ? editing : undefined)
  if (!block || !event || !proseProjection(block.kind)) return block
  const nested =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>(
          '[role="math"][data-render-kind][aria-label], [data-render-kind="diagram"]',
        )
      : null
  if (!nested || !container.contains(nested)) return block
  const value = nested.getAttribute('aria-label')
  const kind = nested.dataset.renderKind
  // Composite HTML owns nested renderers, but each formula/diagram still has
  // its own semantic source span. Resolve repeated content by DOM order.
  const renderers = [
    ...container.querySelectorAll<HTMLElement>(
      '[role="math"][data-render-kind][aria-label], [data-render-kind="diagram"]',
    ),
  ].filter(
    (element) =>
      element.dataset.renderKind === kind && element.getAttribute('aria-label') === value,
  )
  const candidates = blocks?.filter(
    (candidate) =>
      candidate.kind === kind &&
      (kind === 'diagram' || candidate.value === value) &&
      candidate.from >= block.from &&
      candidate.to <= block.to,
  )
  return candidates?.length === renderers.length
    ? (candidates[renderers.indexOf(nested)] ?? block)
    : block
}

function sourcePosition(
  view: EditorView,
  container: HTMLElement,
  block: LiveBlock,
  event: MouseEvent,
): number | undefined {
  if (block.kind === 'diagram' || block.kind === 'math' || block.kind === 'inlineMath') {
    const target =
      event.target instanceof Element ? event.target.closest<HTMLElement>('[role="math"]') : null
    const math =
      target && container.contains(target)
        ? target
        : container.querySelector<HTMLElement>('[role="math"]')
    const offset =
      block.kind === 'diagram'
        ? diagramPositionAtPoint(
            event.target instanceof Element
              ? (event.target.closest<HTMLElement>('[data-render-kind="diagram"]') ?? container)
              : container,
            block.value,
            event,
          )
        : math
          ? mathPositionAtPoint(math, block.value, event)
          : undefined
    if (offset === undefined) return
    const position = delimitedSourcePosition(
      view.state.doc.sliceString(block.from, block.to),
      block.value,
      offset,
    )
    return position === undefined ? undefined : block.from + position
  }
  if (block.kind !== 'code' && block.to - block.from > maxPositionUnits) return
  const content = container.querySelector<HTMLElement>('.cm-live-rendered') ?? container
  const code = block.kind === 'code' ? content.querySelector<HTMLElement>('pre code') : null
  const source = view.state.doc.sliceString(block.from, block.to)
  const hit = renderedTextHit(code ?? content, event, source)
  if (!hit) return
  if (code) return codePosition(view, block, hit)
  const offset = sourcePositionAtText(source, hit, block.kind === 'defList' ? 'defList' : undefined)
  return offset === undefined ? undefined : block.from + offset
}

export function capturePreviewPointer(
  view: EditorView,
  container: HTMLElement,
  event: PointerEvent,
): void {
  pressed.delete(container)
  const block = blockAtPreview(view, container, event)
  if (!block) return
  const offset = sourcePosition(view, container, block, event)
  if (offset !== undefined) {
    pressed.set(container, {
      owner: container.dataset.occurrence,
      block,
      doc: view.state.doc,
      offset,
      x: event.clientX,
      y: event.clientY,
    })
    // Keep release/click on this widget if SVG installation shrinks its bounds.
    // Touch retains native scrolling; a mouse drag releases capture below.
    if (event.isTrusted && event.pointerType === 'mouse')
      container.setPointerCapture(event.pointerId)
  }
}

export function releasePreviewPointer(container: HTMLElement, event: PointerEvent): void {
  const hit = pressed.get(container)
  if (hit && (Math.abs(hit.x - event.clientX) > 4 || Math.abs(hit.y - event.clientY) > 4)) {
    pressed.delete(container)
    if (container.hasPointerCapture(event.pointerId))
      container.releasePointerCapture(event.pointerId)
  }
}

export function cancelPreviewPointer(container: HTMLElement): void {
  pressed.delete(container)
}

export function completesPreviewPointer(container: HTMLElement, event: PointerEvent): boolean {
  const hit = pressed.get(container)
  return Boolean(
    hit &&
      event.button === 0 &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      container.hasPointerCapture(event.pointerId) &&
      Math.abs(hit.x - event.clientX) <= 4 &&
      Math.abs(hit.y - event.clientY) <= 4,
  )
}

export function previewHitAtPoint(
  view: EditorView,
  container: HTMLElement,
  event: MouseEvent,
): { block: LiveBlock; at: number | undefined } | undefined {
  const hit = pressed.get(container)
  pressed.delete(container)
  if (
    hit &&
    hit.owner === container.dataset.occurrence &&
    hit.doc === view.state.doc &&
    Math.abs(hit.x - event.clientX) <= 4 &&
    Math.abs(hit.y - event.clientY) <= 4
  )
    return { block: hit.block, at: hit.offset }
  const block = blockAtPreview(view, container, event)
  return block ? { block, at: sourcePosition(view, container, block, event) } : undefined
}

/** Literal code maps by logical line and column, without reparsing or measuring
 * source text with the preview's potentially different font and wrapping.
 */
function codePosition(view: EditorView, block: LiveBlock, hit: RenderedTextHit): number {
  const offset = Math.min(hit.offset, block.value.length)
  let row = 0,
    start = 0
  for (
    let end = block.value.indexOf('\n');
    end >= 0 && end < offset;
    end = block.value.indexOf('\n', start)
  ) {
    row++
    start = end + 1
  }
  const end = block.value.indexOf('\n', offset)
  const text = block.value.slice(start, end < 0 ? block.value.length : end)
  const first = view.state.doc.lineAt(block.from)
  const fenced = /^[ \t]*(?:`{3,}|~{3,})/.test(first.text)
  const line = view.state.doc.line(
    Math.min(view.state.doc.lines, first.number + Number(fenced) + row),
  )
  const indent = line.text.endsWith(text)
    ? line.length - text.length
    : Math.max(0, line.text.indexOf(text))
  return Math.max(block.from, Math.min(block.to, line.to, line.from + indent + offset - start))
}
