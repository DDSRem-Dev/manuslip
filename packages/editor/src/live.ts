import { syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { codeHighlightStyle } from './highlight'
import { blockDecorations } from './live-blocks'
import { inlineDecorations } from './live-inline'
import type { LiveOptions } from './live-model'

export {
  composingEffect,
  isComposing,
  type LiveAnchor,
  type LiveBlock,
  type LiveModel,
  type LiveOptions,
  liveModel,
  setLiveModel,
} from './live-model'
export { OccurrenceTracker } from './occurrences'
export { navigateLiveAnchor } from './live-anchors'
export function livePreview(options: LiveOptions): Extension[] {
  return [
    EditorView.lineWrapping,
    syntaxHighlighting(codeHighlightStyle),
    blockDecorations(options),
    inlineDecorations(options),
    EditorView.editorAttributes.of({ 'data-mode': 'live' }),
    EditorView.theme({ '.cm-gutters': { display: 'none' } }),
  ]
}
