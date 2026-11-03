import { EditorState } from '@codemirror/state'
import { parseDocumentMarkdown } from '@manuslip/core'
import { renderMarkdown } from '@manuslip/renderer'
import { describe, expect, it } from 'vitest'
import { blockDecorations } from '../../src/live-blocks'
import { isComposing, type LiveOptions, liveModel, setLiveModel } from '../../src/live-model'
import { editorSyntax } from '../../src/syntax'

const options: LiveOptions = {
  sourceLabel: () => 'Source',
  taskLabel: () => 'Task',
  openLink: () => {},
  render: () => {},
}
const render = (source: string) =>
  renderMarkdown(parseDocumentMarkdown(source).root, {
    rawHtml: false,
    footnotesLabel: 'Footnotes',
    footnoteBackLabel: 'Back',
  }).blocks

function fixture(task: string) {
  const source = `# Tasks\n\n$$E=mc^2$$\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n${task}\n\nEnd\n`
  const field = blockDecorations(options)
  const blocks = render(source).map((block, index) => ({ ...block, id: `${index}`, lines: 1 }))
  const model = { blocks, anchors: [{ from: 0, id: 'tasks' }] }
  const state = EditorState.create({
    doc: source,
    extensions: [editorSyntax, liveModel, isComposing, field],
  }).update({ effects: setLiveModel.of(model) }).state
  return { source, state, model, field }
}

describe('task marker edits while semantics are pending', () => {
  it('keeps every semantic widget and its anchors when an inline task changes', () => {
    const { state, model, field } = fixture('- [ ] Inline task')
    const from = state.doc.toString().indexOf('[ ]') + 1
    const next = state.update({ changes: { from, to: from + 1, insert: 'x' } }).state
    expect(next.field(liveModel)).toBe(model)
    expect(next.field(field).visible).toBe(state.field(field).visible)
    expect(next.doc.toString()).toContain('- [x] Inline task')
  })

  it.each([
    '3. [ ] Ordered task\n4. [x] Next task',
    '> - [ ] Quoted task\n>   - [x] Nested task',
    '- [ ] "Smart" task\n  - [x] Nested task',
  ])('updates only checkbox HTML inside a semantic container: %s', (task) => {
    const { state, model, field } = fixture(task)
    const from = state.doc.toString().indexOf('[ ]') + 1
    const next = state.update({ changes: { from, to: from + 1, insert: 'x' } }).state
    const updated = next.field(liveModel)
    expect(updated).not.toBeNull()
    expect(updated?.anchors).toBe(model.anchors)
    expect(next.field(field).visible.size).toBe(state.field(field).visible.size)
    expect(updated?.blocks.map((block) => block.html)).toEqual(
      render(next.doc.toString()).map((block) => block.html),
    )
    for (const block of model.blocks.filter((block) => ['math', 'table'].includes(block.kind)))
      expect(updated?.blocks.find((candidate) => candidate.id === block.id)).toBe(block)
  })

  it('keeps rapid toggles, uppercase markers and their inverse changes current', () => {
    const { state, model } = fixture('3. [ ] First\n4. [X] Second')
    const source = state.doc.toString()
    const first = source.indexOf('[ ]') + 1
    const second = source.indexOf('[X]') + 1
    const transaction = state.update({
      changes: [
        { from: first, to: first + 1, insert: 'x' },
        { from: second, to: second + 1, insert: ' ' },
      ],
    })
    expect(transaction.state.field(liveModel)?.blocks.map((block) => block.html)).toEqual(
      render(transaction.state.doc.toString()).map((block) => block.html),
    )
    const undone = transaction.state.update({
      changes: transaction.changes.invert(state.doc),
    }).state
    expect(undone.doc.toString()).toBe(source)
    expect(undone.field(liveModel)?.blocks).toEqual(model.blocks)
  })

  it.each([
    ['- [ ] Task', '[ ]', 'y'],
    ['- [ ] Task', 'Task', 'a'],
    ['```md\n- [ ] Literal\n```', '[ ]', 'x'],
    ['A literal [ ] marker', '[ ]', 'x'],
  ])(
    'invalidates other edits instead of retaining stale projections: %s',
    (task, target, insert) => {
      const { state } = fixture(task)
      const from = state.doc.toString().indexOf(target) + 1
      const next = state.update({ changes: { from, to: from + 1, insert } }).state
      expect(next.field(liveModel)).toBeNull()
    },
  )

  it('invalidates a batch that also changes task text', () => {
    const { state } = fixture('3. [ ] Task')
    const from = state.doc.toString().indexOf('[ ]') + 1
    const next = state.update({
      changes: [
        { from, to: from + 1, insert: 'x' },
        { from: from + 4, to: from + 5, insert: 'a' },
      ],
    }).state
    expect(next.field(liveModel)).toBeNull()
  })
})
