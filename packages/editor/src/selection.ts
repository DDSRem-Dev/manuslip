import { type Extension, Prec, type Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  layer,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { selectedTextMarkers } from './selection-geometry'

const selectedText = Decoration.mark({ class: 'cm-selectedText' })

function selectionDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const ranges = view.state.selection.ranges
  let first = 0
  // Only decorate rendered text, including secondary selections. Inline marks follow
  // wrapping, bidi text and tabs without painting the unused width of a selected line.
  for (const visible of view.visibleRanges) {
    while (first < ranges.length && (ranges[first]?.to ?? Infinity) <= visible.from) first++
    for (let index = first; index < ranges.length; index++) {
      const range = ranges[index]
      if (!range || range.from >= visible.to) break
      const from = Math.max(visible.from, range.from),
        to = Math.min(visible.to, range.to)
      if (from < to) decorations.push(selectedText.range(from, to))
    }
  }
  return Decoration.set(decorations, true)
}

/** Keep CodeMirror's native input and multiple cursors, but paint only selected text. */
export function textSelection(): Extension {
  const selection = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = selectionDecorations(view)
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.viewportChanged)
          this.decorations = selectionDecorations(update.view)
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
  return [
    // The selection mark belongs inside syntax and inline-code backgrounds.
    Prec.highest(selection),
    layer({
      above: false,
      class: 'cm-textSelectionLayer',
      markers: selectedTextMarkers,
      update: (update) => update.docChanged || update.selectionSet || update.viewportChanged,
    }),
    EditorView.editorAttributes.of((view) =>
      view.state.selection.ranges.some((range) => !range.empty)
        ? { 'data-selecting': 'true' }
        : null,
    ),
    EditorView.theme({
      // drawSelection still owns cursor placement, blinking and native selection hiding.
      '.cm-selectionLayer': { display: 'none' },
      '.cm-selectedText': {
        backgroundColor: 'var(--selection)',
        boxDecorationBreak: 'clone',
      },
      '.cm-textSelectionBackground': { position: 'absolute', backgroundColor: 'var(--selection)' },
      '&[data-selecting] .cm-activeLine': { backgroundColor: 'transparent' },
      '.cm-content::selection, .cm-content ::selection': { color: 'currentColor' },
      '@media (forced-colors: active)': {
        '.cm-selectedText, .cm-textSelectionBackground': {
          backgroundColor: 'Highlight',
          color: 'HighlightText',
          forcedColorAdjust: 'none',
        },
      },
    }),
  ]
}
