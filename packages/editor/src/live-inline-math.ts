import type { EditorView } from '@codemirror/view'
import { editingBlock } from './live-editing'

/** Align with the editable character, including its inset, wrapping and zoom.
 * Measure after CodeMirror draws; changing padding must stay in its write phase.
 */
export function alignInlineMathPreview(view: EditorView): void {
  if (editingBlock(view.state)?.block.kind !== 'inlineMath') return
  view.requestMeasure({
    key: alignInlineMathPreview,
    read(view) {
      const editing = editingBlock(view.state)
      if (editing?.block.kind !== 'inlineMath') return
      const preview = view.contentDOM.querySelector<HTMLElement>(
        '.cm-live-inlineMath.cm-live-edit-preview',
      )
      const source = view.coordsAtPos(editing.block.from, 1)
      if (!preview || !source) return
      return {
        preview,
        offset: Math.max(0, (source.left - preview.getBoundingClientRect().left) / view.scaleX),
      }
    },
    write(measured, view) {
      if (!measured?.preview.isConnected) return
      const offset = `${measured.offset}px`
      if (measured.preview.style.getPropertyValue('--inline-math-offset') === offset) return
      measured.preview.style.setProperty('--inline-math-offset', offset)
      view.requestMeasure()
    },
  })
}
