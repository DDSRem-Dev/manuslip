import { type EditorState, StateEffect, StateField } from '@codemirror/state'
import { type LiveEditing, editingBlock, editLiveBlock } from './live-editing'
import type { LiveBlock } from './live-model'

/** Preview ownership follows the editing session, including pending worker results. */
export function hasEditingPreview(block: LiveBlock): boolean {
  return ['math', 'inlineMath', 'diagram', 'html'].includes(block.kind)
}

export const dockLivePreview = StateEffect.define<LiveEditing>()

// Once a source/preview pair outgrows the viewport, keep its preview in a bounded
// panel until editing ends. Resizing or an asynchronous render must not repeatedly
// move it between the document and panel, or replace the source editor's focus.
export const livePreviewPlacement = StateField.define<boolean>({
  create: () => false,
  update(docked, transaction) {
    const editing = editingBlock(transaction.state)
    if (
      !editing ||
      !hasEditingPreview(editing.block) ||
      transaction.effects.some((effect) => effect.is(editLiveBlock))
    )
      return false
    return (
      docked ||
      transaction.effects.some((effect) => effect.is(dockLivePreview) && effect.value === editing)
    )
  },
})

export function previewIsDocked(state: EditorState): boolean {
  return state.field(livePreviewPlacement, false) ?? false
}
