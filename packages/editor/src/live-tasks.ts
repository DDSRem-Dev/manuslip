import { syntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import type { LiveBlock } from './live-model'

/** Keep semantic list replacements as editable as the ordinary inline task widgets. */
export function mountTaskControls(
  container: HTMLElement,
  block: LiveBlock,
  view: EditorView,
  name: string,
  signal: AbortSignal,
): void {
  const inputs = container.querySelectorAll<HTMLInputElement>(
    'li.task-list-item input[type="checkbox"]',
  )
  if (!inputs.length) return
  const markers: number[] = []
  syntaxTree(view.state).iterate({
    from: block.from,
    to: block.to,
    enter(node) {
      if (node.name === 'TaskMarker') markers.push(node.from - block.from)
    },
  })
  if (inputs.length !== markers.length) return
  inputs.forEach((input, index) => {
    const offset = markers[index]
    if (offset === undefined) return
    const label = document.createElement('label')
    label.className = 'cm-live-task'
    input.replaceWith(label)
    label.append(input)
    input.disabled = view.state.readOnly
    input.setAttribute('aria-label', name)
    label.addEventListener('click', (event) => event.stopPropagation(), { signal })
    input.addEventListener(
      'change',
      () => {
        const from = view.posAtDOM(container) + offset
        if (!view.state.readOnly && /^\[[ xX]\]$/.test(view.state.doc.sliceString(from, from + 3)))
          view.dispatch({
            changes: { from: from + 1, to: from + 2, insert: input.checked ? 'x' : ' ' },
            userEvent: 'input',
          })
      },
      { signal },
    )
  })
}
