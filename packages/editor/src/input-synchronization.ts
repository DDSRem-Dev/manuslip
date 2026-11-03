import type { EditorView } from '@codemirror/view'
import { embeddedInput } from './embedded-editor'

interface InputWait {
  promise: Promise<void>
  resolve(): void
}

/** Native menu commands can arrive before the editor's DOM observer consumes input.
 * Wait for active composition to end, then for CodeMirror's public measurement boundary
 * to consume its final DOM input. This also protects commands that replace the view.
 * Closing an unmounted view settles queued waits.
 */
export class SourceInputSynchronization {
  #view: EditorView | undefined
  #pending: InputWait | undefined
  #compositionTargets: readonly EventTarget[]
  constructor(view: EditorView) {
    this.#view = view
    const content = view.contentDOM as HTMLElement & { editContext?: EventTarget | null }
    this.#compositionTargets = content.editContext ? [content, content.editContext] : [content]
    for (const target of this.#compositionTargets)
      target.addEventListener('compositionend', this.#compositionEnded)
  }
  readonly #compositionEnded = (): void => {
    const view = this.#view
    const pending = this.#pending
    if (view && pending) this.#measure(view, pending)
  }
  flush(): Promise<void> {
    const view = this.#view
    if (!view) return Promise.resolve()
    const child = embeddedInput(view)
    if (child) return child.flush().then(() => this.flushSource())
    return this.flushSource()
  }
  private flushSource(): Promise<void> {
    const view = this.#view
    if (!view) return Promise.resolve()
    if (this.#pending) return this.#pending.promise
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    const pending = { promise, resolve }
    this.#pending = pending
    this.#measure(view, pending)
    return promise
  }
  #measure(view: EditorView, pending: InputWait): void {
    if (view.compositionStarted) return
    view.requestMeasure({
      key: this,
      read: () => undefined,
      write: () => {
        if (this.#pending !== pending || view.compositionStarted) return
        this.#pending = undefined
        pending.resolve()
      },
    })
  }
  close(): void {
    this.#view = undefined
    for (const target of this.#compositionTargets)
      target.removeEventListener('compositionend', this.#compositionEnded)
    this.#compositionTargets = []
    const pending = this.#pending
    this.#pending = undefined
    pending?.resolve()
  }
}
