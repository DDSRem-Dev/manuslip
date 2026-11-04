import { EditorSelection, type Extension, Prec } from '@codemirror/state'
import { type EditorView, keymap } from '@codemirror/view'
import { activateLiveBlock, editingBlock, editLiveBlock } from './live-editing'
import { blockSourceRange, inlineProjection, isComposing } from './live-model'
import { blockAtPreview, previewHitAtPoint } from './live-preview-position'
import { delimitedSourcePosition } from './live-source-position'

export function liveInteractions(): Extension {
  return [
    Prec.high(
      keymap.of([
        {
          key: 'Escape',
          run(view) {
            const editing = editingBlock(view.state)
            if (!editing || view.composing) return false
            const at =
              !inlineProjection(editing.block.kind) && blockSourceRange(view.state, editing.block)
                ? Math.min(view.state.doc.length, editing.to + 1)
                : editing.to
            view.dispatch({
              effects: editLiveBlock.of(null),
              selection: EditorSelection.cursor(at, 1),
              scrollIntoView: true,
            })
            return true
          },
        },
      ]),
    ),
  ]
}

export function activateRendered(
  view: EditorView,
  container: HTMLElement,
  event?: MouseEvent | KeyboardEvent,
): void {
  if (
    view.state.readOnly ||
    view.composing ||
    view.state.field(isComposing) ||
    !view.dom.contains(container)
  )
    return
  const current = editingBlock(view.state)
  const hit = event instanceof MouseEvent ? previewHitAtPoint(view, container, event) : undefined
  const block = hit?.block ?? blockAtPreview(view, container, event)
  if (!block || ['table', 'emoji'].includes(block.kind)) return
  if (current && current.from <= block.from && current.to >= block.to) {
    view.focus()
    return
  }
  let at = hit?.at
  if (at === undefined && (block.kind === 'math' || block.kind === 'inlineMath')) {
    const source = view.state.doc.sliceString(block.from, block.to)
    const start = block.kind === 'math' ? Math.max(0, block.value.search(/\S/)) : 0
    const position = delimitedSourcePosition(source, block.value, start)
    if (position !== undefined) at = block.from + position
  }
  activateLiveBlock(view, block, at)
}
