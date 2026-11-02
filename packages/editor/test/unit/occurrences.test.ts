import { EditorState } from '@codemirror/state'
import { parseMarkdown } from '@manuslip/core'
import { expect, it } from 'vitest'
import { OccurrenceTracker } from '../../src/occurrences'

it('forks independent edit/reconciliation state while preserving mapped duplicate identities', () => {
  const state = EditorState.create({ doc: 'Same\n\nSame\n\nEnd' }),
    tracker = new OccurrenceTracker()
  const original = tracker.reconcile(parseMarkdown(state.doc.toString()).blocks, state.doc)
  const fork = tracker.fork()
  const transaction = state.update({ changes: { from: 0, insert: 'New\n\n' } })
  fork.map(transaction.changes)
  const current = fork.reconcile(
    parseMarkdown(transaction.state.doc.toString()).blocks,
    transaction.state.doc,
  )
  expect(current.slice(1).map((block) => block.id)).toEqual(original.map((block) => block.id))
  expect(
    tracker
      .reconcile(parseMarkdown(state.doc.toString()).blocks, state.doc)
      .map((block) => block.id),
  ).toEqual(original.map((block) => block.id))
  tracker.reset()
  expect(
    fork
      .reconcile(parseMarkdown(transaction.state.doc.toString()).blocks, transaction.state.doc)
      .map((block) => block.id),
  ).toEqual(current.map((block) => block.id))
})

it('retains distinct duplicate identities by mapped ranges, including inserts before them', () => {
  let state = EditorState.create({ doc: 'Same\n\nSame\n\nEnd' })
  const tracker = new OccurrenceTracker()
  let id = 0
  const reconcile = () =>
    tracker.reconcile(parseMarkdown(state.doc.toString()).blocks, state.doc, () => String(++id))
  const before = reconcile()
  expect(before[0]?.id).not.toBe(before[1]?.id)
  const transaction = state.update({ changes: { from: 0, insert: 'New\n\n' } })
  tracker.map(transaction.changes)
  state = transaction.state
  const after = reconcile()
  expect(after.slice(1).map((block) => block.id)).toEqual(before.map((block) => block.id))
})

it('assigns new identities after splitting, merging and explicit reload reset', () => {
  let state = EditorState.create({ doc: 'First second' })
  const tracker = new OccurrenceTracker()
  let id = 0
  const reconcile = () =>
    tracker.reconcile(parseMarkdown(state.doc.toString()).blocks, state.doc, () => String(++id))
  const original = reconcile()[0]?.id
  let transaction = state.update({ changes: { from: 5, to: 6, insert: '\n\n' } })
  tracker.map(transaction.changes)
  state = transaction.state
  const split = reconcile()
  expect(split).toHaveLength(2)
  expect(split.every((block) => block.id !== original)).toBe(true)
  transaction = state.update({ changes: { from: 5, to: 7, insert: ' ' } })
  tracker.map(transaction.changes)
  state = transaction.state
  const merged = reconcile()[0]?.id
  expect(split.every((block) => block.id !== merged)).toBe(true)
  tracker.reset()
  expect(reconcile()[0]?.id).not.toBe(merged)
})

it('does not install a partially prepared index, and rejects preparation superseded by edits or reset', () => {
  let state = EditorState.create({ doc: 'Same\n\n'.repeat(160) })
  const tracker = new OccurrenceTracker()
  const blocks = () => parseMarkdown(state.doc.toString()).blocks
  const original = tracker.reconcile(blocks(), state.doc)
  const pending = tracker.prepare(blocks(), state.doc)
  expect(pending.next().done).toBe(false)
  const transaction = state.update({ changes: { from: 0, insert: 'New\n\n' } })
  tracker.map(transaction.changes)
  state = transaction.state
  let prepared = pending.next()
  while (!prepared.done) prepared = pending.next()
  expect(prepared.value.commit()).toBe(false)
  const current = tracker.reconcile(blocks(), state.doc)
  expect(current.slice(1).map((block) => block.id)).toEqual(original.map((block) => block.id))
  const reset = tracker.prepare(blocks(), state.doc)
  expect(reset.next().done).toBe(false)
  tracker.reset()
  let stale = reset.next()
  while (!stale.done) stale = reset.next()
  expect(stale.value.commit()).toBe(false)
  const afterReset = tracker.reconcile(blocks(), state.doc)
  expect(afterReset.every((block, index) => block.id !== current[index]?.id)).toBe(true)
})

it('verifies source text on colliding descriptors and commits a preparation only once', () => {
  let state = EditorState.create({ doc: 'Same' })
  const tracker = new OccurrenceTracker()
  const descriptor = [{ kind: 'paragraph', from: 0, to: 4, hash: 'collision', lines: 1 }]
  const original = tracker.reconcile(descriptor, state.doc)
  const transaction = state.update({ changes: { from: 1, to: 2, insert: 'o' } })
  tracker.map(transaction.changes)
  state = transaction.state
  const generator = tracker.prepare(descriptor, state.doc)
  const prepared = generator.next()
  if (!prepared.done) throw new Error('Small preparation should finish synchronously')
  expect(prepared.value.blocks[0]?.id).not.toBe(original[0]?.id)
  expect(prepared.value.commit()).toBe(true)
  expect(prepared.value.commit()).toBe(false)
})

it('never reuses an ambiguous mapped identity or commits over a newer reconciliation', () => {
  const state = EditorState.create({ doc: 'Same' })
  const tracker = new OccurrenceTracker()
  const descriptor = { kind: 'paragraph', from: 0, to: 4, hash: 'same', lines: 1 }
  const before = tracker.reconcile([descriptor, descriptor], state.doc)
  const pending = tracker.prepare([descriptor, descriptor], state.doc).next()
  if (!pending.done) throw new Error('Small preparation should finish synchronously')
  const after = tracker.reconcile([descriptor, descriptor], state.doc)
  expect(after.every((block) => before.every((old) => old.id !== block.id))).toBe(true)
  expect(pending.value.commit()).toBe(false)
})
