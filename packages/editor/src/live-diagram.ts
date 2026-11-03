import type { EditorView } from '@codemirror/view'
import { activateLiveBlock, editingBlock } from './live-editing'
import { isComposing, type LiveBlock, liveModel } from './live-model'

/** A diagram opens a persistent source-and-preview editor. Its preview never
 * toggles the source or replaces the user's caret with a source selection.
 */
export function mountDiagramEditing(
  container: HTMLElement,
  view: EditorView,
  block: LiveBlock,
  signal: AbortSignal,
): void {
  const activate = (): void => {
    if (
      view.state.readOnly ||
      view.composing ||
      view.state.field(isComposing) ||
      !view.dom.contains(container)
    )
      return
    const editing = editingBlock(view.state)?.block
    const current =
      view.state.field(liveModel)?.blocks.find((candidate) => candidate.id === block.id) ??
      (editing?.id === block.id ? editing : undefined)
    if (current?.kind === 'diagram') activateLiveBlock(view, current)
  }
  container.addEventListener(
    'click',
    (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        !(event.target instanceof Element) ||
        event.target.closest('button, input, select, textarea, a[href]')
      )
        return
      event.preventDefault()
      event.stopPropagation()
      activate()
    },
    { signal },
  )
  container.addEventListener(
    'keydown',
    (event) => {
      if (event.target !== container || (event.key !== 'Enter' && event.key !== ' ')) return
      event.preventDefault()
      event.stopPropagation()
      activate()
    },
    { signal },
  )
}
