import { type Extension, Prec } from '@codemirror/state'
import { type EditorView, keymap } from '@codemirror/view'
import { activateLiveBlock, editingBlock, editLiveBlock } from './live-editing'
import { liveModel } from './live-model'

export function liveInteractions(): Extension {
  return [
    Prec.high(
      keymap.of([
        {
          key: 'Escape',
          run(view) {
            const editing = editingBlock(view.state)
            if (!editing || view.composing) return false
            view.dispatch({ effects: editLiveBlock.of(null), selection: { anchor: editing.to } })
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
  event?: MouseEvent,
): void {
  const block =
    view.state
      .field(liveModel)
      ?.blocks.find((block) => block.id === container.dataset.occurrence) ??
    editingBlock(view.state)?.block
  if (!block || ['table', 'diagram', 'emoji'].includes(block.kind)) return
  const current = editingBlock(view.state)
  if (current && current.from <= block.from && current.to >= block.to) {
    view.focus()
    return
  }
  activateLiveBlock(view, block)
  if (event && block.kind !== 'math') {
    const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
    const editing = editingBlock(view.state)
    if (position !== null && editing && position >= editing.from && position <= editing.to)
      view.dispatch({ selection: { anchor: position } })
  }
}
