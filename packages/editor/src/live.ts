import { syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { codeHighlightStyle } from './highlight'
import { blockDecorations } from './live-blocks'
import { liveEditing } from './live-editing'
import { frontmatterDecorations } from './live-frontmatter'
import { inlineDecorations } from './live-inline'
import { liveInteractions } from './live-interactions'
import type { LiveOptions } from './live-model'
import { tableEditing } from './live-table'

export { navigateLiveAnchor } from './live-anchors'
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
export function livePreview(options: LiveOptions): Extension[] {
  return [
    EditorView.lineWrapping,
    syntaxHighlighting(codeHighlightStyle),
    frontmatterDecorations,
    liveEditing,
    blockDecorations(options),
    inlineDecorations(options),
    tableEditing,
    liveInteractions(),
    EditorView.editorAttributes.of({ 'data-mode': 'live' }),
    EditorView.theme({ '.cm-gutters': { display: 'none' } }),
  ]
}
