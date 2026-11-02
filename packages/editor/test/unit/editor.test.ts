import { redo, undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { createSourceState, documentBytes, limitRejected, maxDocumentBytes } from '../../src/index'

describe('single-source editor state', () => {
  it('keeps byte accounting correct across Unicode, surrogate splits, and multiple selections', () => {
    let state = createSourceState('你好😀 abc\n')
    for (const changes of [
      [{ from: 3, to: 4, insert: 'Z' }],
      [
        { from: 0, to: 1, insert: 'é' },
        { from: 6, to: 7, insert: '📝' },
      ],
      [{ from: 0, to: 2, insert: '' }],
      [
        { from: 0, insert: '😀' },
        { from: 1, insert: '😀' },
      ],
    ]) {
      state = state.update({ changes }).state
      expect(state.field(documentBytes)).toBe(
        new TextEncoder().encode(state.doc.toString()).byteLength,
      )
    }
  })
  it('preserves undo/redo and saved text equality at newer document revisions', () => {
    let state = createSourceState('# Saved\n')
    const baseline = state.doc
    state = state.update({
      changes: { from: state.doc.length, insert: 'edit' },
      userEvent: 'input',
    }).state
    const commands = {
      get state() {
        return state
      },
      dispatch: (transaction: import('@codemirror/state').Transaction) => {
        state = transaction.state
      },
    }
    expect(state.doc.eq(baseline)).toBe(false)
    expect(undo(commands)).toBe(true)
    expect(state.doc.eq(baseline)).toBe(true)
    expect(redo(commands)).toBe(true)
    expect(state.doc.eq(baseline)).toBe(false)
  })
  it('rejects over-cap edits without changing the buffer or undo history', () => {
    const state = createSourceState('retained')
    const transaction = state.update({ changes: { from: 0, insert: 'x'.repeat(maxDocumentBytes) } })
    expect(transaction.newDoc.eq(state.doc)).toBe(true)
    expect(transaction.effects.some((effect) => effect.is(limitRejected))).toBe(true)
  })
})
