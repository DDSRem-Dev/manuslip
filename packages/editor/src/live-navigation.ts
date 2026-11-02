import { selectLineDown, selectLineUp } from '@codemirror/commands'
import { type Extension, Prec, StateEffect, type StateField } from '@codemirror/state'
import { type DecorationSet, type EditorView, keymap } from '@codemirror/view'
import { proseProjection } from './live-model'

export const revealProse = StateEffect.define<readonly string[]>()

/** Extend into a projected paragraph's source lines without revealing it for caret motion. */
export function proseNavigation(field: StateField<{ visible: DecorationSet }>): Extension {
  const move = (view: EditorView, forward: boolean): boolean => {
    if (view.composing) return false
    const { state } = view
    const visible = state.field(field).visible
    if (!visible.size) return false
    const reveal = new Set<string>()
    for (const range of state.selection.ranges) {
      const moved = view.moveVertically(range, forward)
      const from = Math.min(range.head, moved.head),
        to = Math.max(range.head, moved.head)
      let occurrence: string | undefined
      visible.between(from, to, (start, end, decoration) => {
        if (!proseProjection(decoration.spec.widget?.block.kind)) return
        if (forward && start >= range.head && start <= moved.head && occurrence === undefined)
          occurrence = decoration.spec.occurrence as string
        if (!forward && end <= range.head && end >= moved.head)
          occurrence = decoration.spec.occurrence as string
      })
      if (occurrence) reveal.add(occurrence)
    }
    if (!reveal.size) return false
    // Reveal before the native command measures its destination. CodeMirror retains
    // the pixel goal column across blank/short lines, wrapping, tabs and bidi text.
    view.dispatch({ effects: revealProse.of([...reveal]) })
    const command = forward ? selectLineDown : selectLineUp
    const handled = command(view)
    if (view.state.selection.ranges.every((range) => range.empty))
      view.dispatch({ effects: revealProse.of([]) })
    return handled
  }
  return Prec.high(
    keymap.of([
      {
        key: 'ArrowDown',
        shift: (view) => move(view, true),
      },
      {
        key: 'ArrowUp',
        shift: (view) => move(view, false),
      },
    ]),
  )
}
