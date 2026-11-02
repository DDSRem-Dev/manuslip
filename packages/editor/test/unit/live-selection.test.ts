import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { blockDecorations } from '../../src/live-blocks'
import {
  composingEffect,
  isComposing,
  type LiveOptions,
  liveModel,
  setLiveModel,
} from '../../src/live-model'
import { selectionTouches } from '../../src/live-selection'

const options: LiveOptions = {
  sourceLabel: () => 'Source',
  taskLabel: () => 'Task',
  openLink: () => {},
  render: () => {},
}

function fixture() {
  const field = blockDecorations(options)
  let state = EditorState.create({
    doc: 'first\nsecond\nthird',
    extensions: [EditorState.allowMultipleSelections.of(true), liveModel, isComposing, field],
  })
  state = state.update({
    effects: setLiveModel.of({
      blocks: [
        { id: 'first', from: 0, to: 5 },
        { id: 'second', from: 6, to: 12 },
        { id: 'third', from: 13, to: 18 },
      ].map((block) => ({ ...block, kind: 'code', value: '', html: '<pre>code</pre>', lines: 1 })),
    }),
  }).state
  return {
    get state() {
      return state
    },
    select(ranges: readonly (readonly [number, number])[]) {
      state = state.update({
        selection: EditorSelection.create(
          ranges.map(([anchor, head]) => EditorSelection.range(anchor, head)),
        ),
      }).state
    },
    compose(value: boolean) {
      state = state.update({ effects: composingEffect.of(value) }).state
    },
    rendered() {
      const ids: string[] = []
      for (const cursor = state.field(field).visible.iter(); cursor.value; cursor.next())
        ids.push(cursor.value.spec.occurrence as string)
      return ids
    },
  }
}

describe('live source selection', () => {
  it('reveals selected characters but keeps the next block at an exclusive endpoint rendered', () => {
    const editor = fixture()
    for (const range of [
      [1, 6],
      [6, 1],
    ] as const) {
      editor.select([range])
      expect(editor.rendered()).toEqual(['second', 'third'])
    }
    editor.select([[5, 6]]) // Only the line break, between the two source ranges.
    expect(editor.rendered()).toEqual(['first', 'second', 'third'])
  })

  it('keeps widgets rendered at boundary and interior carets', () => {
    const editor = fixture()
    editor.select([[6, 6]])
    expect(editor.rendered()).toEqual(['first', 'second', 'third'])
    editor.select([[5, 5]])
    expect(editor.rendered()).toEqual(['first', 'second', 'third'])
    editor.select([[8, 8]])
    expect(editor.rendered()).toEqual(['first', 'second', 'third'])
  })

  it('reveals every intersected line in forward and backward multiline selections', () => {
    const editor = fixture()
    for (const range of [
      [2, 15],
      [15, 2],
    ] as const) {
      editor.select([range])
      expect(editor.rendered()).toEqual([])
      expect(editor.state.doc.toString()).toBe('first\nsecond\nthird')
    }
    editor.select([[0, 1]])
    expect(editor.rendered()).toEqual(['second', 'third'])
  })

  it('keeps disjoint selections independent and restores widgets after composition', () => {
    const editor = fixture()
    editor.select([
      [1, 3],
      [17, 14],
    ])
    expect(editor.rendered()).toEqual(['second'])
    editor.compose(true)
    expect(editor.rendered()).toEqual([])
    editor.compose(false)
    expect(editor.rendered()).toEqual(['second'])
    expect(editor.state.selection.ranges.map(({ anchor, head }) => [anchor, head])).toEqual([
      [1, 3],
      [17, 14],
    ])
  })

  it('uses UTF-16 document offsets without treating Unicode characters or line breaks as neighbors', () => {
    const text = '中文😀\n**café**',
      from = text.indexOf('**'),
      to = text.length
    const before = EditorSelection.single(0, from),
      across = EditorSelection.single(text.indexOf('😀'), from + 3)
    expect(selectionTouches(before, from, to)).toBe(false)
    expect(selectionTouches(across, from, to)).toBe(true)
    expect(selectionTouches(EditorSelection.single(from), from, from + 2)).toBe(false)
    expect(selectionTouches(EditorSelection.single(from + 1), from, from + 2)).toBe(false)
  })

  it('distinguishes text selections from carets inside or at the edges of inline syntax', () => {
    for (const position of [0, 1, 2, 6, 8])
      expect(selectionTouches(EditorSelection.single(position), 0, 8)).toBe(false)
    for (const [anchor, head] of [
      [2, 6],
      [6, 2],
      [3, 4],
      [0, 1],
    ] as const)
      expect(selectionTouches(EditorSelection.single(anchor, head), 0, 8)).toBe(true)
    const mixed = EditorSelection.create([EditorSelection.cursor(2), EditorSelection.range(10, 14)])
    expect(selectionTouches(mixed, 0, 8)).toBe(false)
    expect(selectionTouches(mixed, 9, 15)).toBe(true)
    expect(selectionTouches(EditorSelection.single(8, 10), 0, 8)).toBe(false)
  })
})
