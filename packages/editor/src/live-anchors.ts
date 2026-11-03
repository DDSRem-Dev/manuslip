import { EditorView } from '@codemirror/view'
import { type LiveAnchor, liveModel } from './live-model'

const navigations = new WeakMap<EditorView, object>()

/** Mount the target's viewport before looking up its rendered ID. A generated
 * inline note lives at the document end, while its source range stays inline.
 * Moving the caret there would reveal source and destroy the link we return to.
 */
export function navigateLiveAnchor(view: EditorView, anchor: LiveAnchor): void {
  const model = view.state.field(liveModel)
  const navigation = {}
  navigations.set(view, navigation)
  const id = anchor.id.startsWith('user-content-') ? anchor.id : `user-content-${anchor.id}`
  const find = () => view.dom.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
  const focus = (target: HTMLElement) => {
    if (!target.hasAttribute('tabindex') && !target.matches('a[href], button, input'))
      target.tabIndex = -1
    target.focus({ preventScroll: true })
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
  }
  const mounted = find()
  if (mounted) {
    focus(mounted)
    return
  }
  const position = anchor.placement === 'after-document' ? view.state.doc.length : anchor.from
  view.dispatch({ effects: EditorView.scrollIntoView(position, { y: 'center' }) })
  // CodeMirror completes its scroll measurement first, including virtual widgets.
  view.dom.ownerDocument.defaultView?.requestAnimationFrame(() => {
    const current = () =>
      view.dom.isConnected &&
      navigations.get(view) === navigation &&
      view.state.field(liveModel) === model
    if (!current()) return
    view.requestMeasure({
      key: navigations,
      read: find,
      write: (target) => {
        if (!current()) return
        if (target) {
          focus(target)
        } else {
          // The target can already be revealed for editing rather than rendered.
          queueMicrotask(() => {
            if (!current()) return
            view.dispatch({ selection: { anchor: anchor.from }, scrollIntoView: true })
            view.focus()
          })
        }
      },
    })
  })
}
