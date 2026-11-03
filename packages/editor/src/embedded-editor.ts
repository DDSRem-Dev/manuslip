import type { EditorView } from '@codemirror/view'
import type { SourceInputSynchronization } from './input-synchronization'

const embedded = new WeakMap<EditorView, { view: EditorView; input: SourceInputSynchronization }>()

export function activeEmbeddedEditor(view: EditorView): EditorView | undefined {
  return embedded.get(view)?.view
}

export function embeddedInput(view: EditorView): SourceInputSynchronization | undefined {
  return embedded.get(view)?.input
}

export function registerEmbeddedEditor(
  parent: EditorView,
  child: EditorView,
  input: SourceInputSynchronization,
): () => void {
  embedded.set(parent, { view: child, input })
  return () => {
    input.close()
    if (embedded.get(parent)?.view === child) embedded.delete(parent)
  }
}
