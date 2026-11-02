import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

const paddingProperty = '--manuslip-typewriter-padding'

class TypewriterViewport {
  private disposed = false
  private centerRequested = true
  private height = 0
  private width = 0
  private padding = -1

  constructor(private readonly view: EditorView) {
    this.measure()
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet || (update.focusChanged && this.view.hasFocus))
      this.centerRequested = true
    if (this.centerRequested || update.geometryChanged) this.measure()
  }

  requestCenter(): void {
    this.centerRequested = true
    this.measure()
  }

  measure(): void {
    this.view.requestMeasure({
      key: this,
      read: () => {
        const view = this.view
        if (this.disposed || view.compositionStarted || !view.inView) return null
        const height = view.scrollDOM.clientHeight
        const width = view.scrollDOM.clientWidth
        if (!height || !width) return null
        const resized = height !== this.height || width !== this.width
        const padding = Math.max(0, (height - view.defaultLineHeight) / 2)
        const needsPadding = Math.abs(padding - this.padding) > 0.5
        const center = (this.centerRequested || resized) && view.hasFocus
        if (!needsPadding && !center) return null
        const caret = center ? view.coordsAtPos(view.state.selection.main.head) : null
        const bounds = view.scrollDOM.getBoundingClientRect()
        return {
          height,
          width,
          padding,
          needsPadding,
          center,
          delta: caret
            ? (caret.top + caret.bottom - bounds.top - bounds.bottom) / 2 / view.scaleY
            : null,
        }
      },
      write: (measurement) => {
        if (this.disposed || !measurement) return
        this.height = measurement.height
        this.width = measurement.width
        if (measurement.needsPadding) {
          this.padding = measurement.padding
          this.view.dom.style.setProperty(paddingProperty, `${measurement.padding}px`)
          this.centerRequested = measurement.center
          this.measure()
          return
        }
        if (measurement.center && measurement.delta !== null) {
          if (Math.abs(measurement.delta) > 0.5) this.view.scrollDOM.scrollTop += measurement.delta
          this.centerRequested = false
        }
      },
    })
  }

  destroy(): void {
    this.disposed = true
    this.view.dom.style.removeProperty(paddingProperty)
  }
}

/** A view-only mode: source, selection and history never change. */
export const typewriterWriting: Extension = [
  EditorView.editorAttributes.of({ class: 'cm-typewriter' }),
  EditorView.theme({
    '&.cm-typewriter .cm-content': {
      paddingTop: `var(${paddingProperty}, 24px)`,
      paddingBottom: `var(${paddingProperty}, 24px)`,
    },
  }),
  ViewPlugin.fromClass(TypewriterViewport, {
    eventHandlers: {
      focus() {
        this.requestCenter()
      },
      compositionend() {
        this.requestCenter()
      },
    },
  }),
]
