import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, Text } from '@codemirror/state'
import { parseDocumentMarkdown } from '@manuslip/core'
import { renderMarkdown } from '@manuslip/renderer'
import { describe, expect, it } from 'vitest'
import { blockDecorations } from '../../src/live-blocks'
import { isComposing, type LiveOptions, liveModel, setLiveModel } from '../../src/live-model'
import { revealProse } from '../../src/live-navigation'
import { OccurrenceTracker } from '../../src/occurrences'
import { editorSyntax } from '../../src/syntax'

const options: LiveOptions = {
  sourceLabel: () => 'Select source',
  taskLabel: () => 'Task',
  openLink: () => {},
  render: () => {},
}

describe('inline footnote Live Preview', () => {
  it('keeps note bodies after the document without replacing source or hiding on selection', () => {
    const source = 'Start^[First] and named[^n].\n\nOther^[Second].\n\n[^n]: Named'
    const field = blockDecorations(options)
    const document = parseDocumentMarkdown(source)
    expect(
      new OccurrenceTracker().reconcile(document.blocks, Text.of(source.split('\n'))),
    ).toHaveLength(document.blocks.length)
    const blocks = renderMarkdown(document.root, {
      rawHtml: false,
      footnotesLabel: 'Footnotes',
      footnoteBackLabel: 'Back',
    }).blocks.map((block, index) => ({ ...block, id: String(index), lines: 1 }))
    let state = EditorState.create({
      doc: source,
      extensions: [liveModel, isComposing, field],
    }).update({ effects: setLiveModel.of({ blocks }) }).state
    const virtual = () => {
      const ranges: { from: number; to: number }[] = []
      for (const cursor = state.field(field).visible.iter(); cursor.value; cursor.next())
        if (cursor.value.spec.virtual) ranges.push({ from: cursor.from, to: cursor.to })
      return ranges
    }
    expect(virtual()).toEqual([
      { from: source.length, to: source.length },
      { from: source.length, to: source.length },
    ])
    state = state.update({ selection: EditorSelection.single(source.length) }).state
    expect(virtual()).toHaveLength(2)
    state = state.update({ selection: EditorSelection.single(0, source.length) }).state
    expect(virtual()).toHaveLength(2)
    state = state.update({ effects: revealProse.of([]) }).state
    expect(state.doc.toString()).toBe(source)
  })
})

describe('removed disclosure editor recognition', () => {
  it('keeps unfinished and multiline disclosure openings out of HTML blocks', () => {
    const source = '<details\nopen>\n\n**Body**\n\n</details>\n\n<summary'
    const state = EditorState.create({ doc: source, extensions: [editorSyntax] })
    const tree = ensureSyntaxTree(state, state.doc.length, 1000)
    const names: string[] = []
    tree?.iterate({
      enter: (node) => {
        names.push(node.name)
      },
    })
    expect(names).not.toContain('HTMLBlock')
    expect(names).toContain('StrongEmphasis')
  })
  it('recognizes body Markdown without HTML blocks, including nested disclosures', () => {
    const source =
      '<details open>\n<summary>Title</summary>\n**Body**\n</details>\n\n> <details>\n> **Nested**\n> </details>\n\n<span>ordinary</span>'
    const state = EditorState.create({ doc: source, extensions: [editorSyntax] })
    const tree = ensureSyntaxTree(state, state.doc.length, 1000)
    expect(tree).not.toBeNull()
    const names: string[] = []
    tree?.iterate({
      enter: (node) => {
        names.push(node.name)
      },
    })
    expect(names).not.toContain('HTMLBlock')
    expect(names.filter((name) => name === 'StrongEmphasis')).toHaveLength(2)
    expect(names.filter((name) => name === 'LiteralHTML')).toHaveLength(6)
    expect(names).toContain('HTMLTag')
  })
})
