import { redo, undo } from '@codemirror/commands'
import { parseMarkdown, type Root } from '@manuslip/core'
import {
  createSourceState,
  EditorState,
  type Transaction,
  type TransactionSpec,
} from '@manuslip/editor'
import { describe, expect, it, vi } from 'vitest'
import { DocumentTable } from '../../../../src/renderer/src/table'

const original =
  'Before.\n\n| A | B |\n| :--- | ---: |\n| x | `protected` |\n| y | [ref][private] |\n\nAfter.\n'
function deferred() {
  let resolve = () => {}
  return {
    promise: new Promise<void>((done) => {
      resolve = done
    }),
    resolve: () => resolve(),
  }
}
function setup(rejectTable = false) {
  let state = createSourceState(original, {
      extensions: rejectTable
        ? [
            EditorState.transactionFilter.of((transaction) =>
              transaction.isUserEvent('input.table') ? [] : transaction,
            ),
          ]
        : [],
    }),
    revision = 0,
    allowed = true
  const synchronizeInput = vi.fn(async () => {})
  const capture = vi.fn(
    async (_revision: number, _signal: AbortSignal): Promise<Root | null> =>
      parseMarkdown(state.doc.toString()).root,
  )
  const dispatch = vi.fn((spec: TransactionSpec) => {
    const transaction = state.update(spec)
    state = transaction.state
    if (transaction.docChanged) revision++
  })
  const table = new DocumentTable({
    state: () => state,
    revision: () => revision,
    canApply: () => allowed,
    synchronizeInput,
    capture,
    dispatch,
  })
  return {
    table,
    capture,
    synchronizeInput,
    dispatch,
    get state() {
      return state
    },
    allow: (value: boolean) => {
      allowed = value
    },
    change: (spec: TransactionSpec) => {
      dispatch(spec)
      table.changed()
    },
    transaction: (transaction: Transaction) => {
      state = transaction.state
      if (transaction.docChanged) revision++
      table.changed()
    },
  }
}
describe('source table transaction controller', () => {
  it('stages row/column movement and alignment, then commits once with mapped selection and isolated undo', async () => {
    const env = setup(),
      at = original.indexOf('A |'),
      anchor = original.indexOf('After') + 4,
      head = anchor - 2
    env.change({ selection: { anchor, head } })
    await env.table.open(at)
    env.table.select(1, 0)
    env.table.cell(1, 0, 'edited | 中文')
    env.table.row('down')
    env.table.column('right')
    env.table.align('center')
    expect(env.state.doc.toString()).toBe(original)
    env.dispatch.mockClear()
    expect(await env.table.apply()).toBe(true)
    expect(env.dispatch).toHaveBeenCalledTimes(1)
    const changed = env.state.doc.toString(),
      delta = changed.length - original.length
    expect(changed).toContain('| [ref][private] | y |')
    expect(changed).toContain('| `protected` | edited \\| 中文 |')
    expect(changed).toContain('| ---: | :---: |')
    expect(changed.startsWith('Before.\n\n')).toBe(true)
    expect(changed.endsWith('\n\nAfter.\n')).toBe(true)
    expect(env.state.selection.main.anchor).toBe(anchor + delta)
    expect(env.state.selection.main.head).toBe(head + delta)
    const command = (action: typeof undo) => action({ state: env.state, dispatch: env.transaction })
    expect(command(undo)).toBe(true)
    expect(env.state.doc.toString()).toBe(original)
    expect(env.state.selection.main.anchor).toBe(anchor)
    expect(command(redo)).toBe(true)
    expect(env.state.doc.toString()).toBe(changed)
  })
  it('keeps the header and one column, inserts/removes cells consistently and cancels without edits', async () => {
    const env = setup()
    await env.table.open(original.indexOf('A |'))
    env.table.row('remove')
    env.table.row('up')
    expect(env.table.store.getState().draft?.rows[0]).toEqual(['A', 'B'])
    env.table.column('remove')
    env.table.column('remove')
    expect(env.table.store.getState().draft?.align).toHaveLength(1)
    env.table.column('after')
    env.table.column('before')
    env.table.row('below')
    env.table.row('above')
    env.table.row('remove')
    expect(env.table.store.getState().draft?.rows.every((row) => row.length === 3)).toBe(true)
    env.table.close()
    expect(env.state.doc.toString()).toBe(original)
    expect(env.dispatch).not.toHaveBeenCalled()
  })
  it('does not create a history event for unchanged Apply', async () => {
    const env = setup(),
      doc = env.state.doc
    await env.table.open(original.indexOf('A |'))
    expect(await env.table.apply()).toBe(true)
    expect(env.state.doc).toBe(doc)
    expect(env.dispatch).not.toHaveBeenCalled()
  })
  it('keeps the staged draft open when the authoritative editor rejects its transaction', async () => {
    const env = setup(true)
    await env.table.open(original.indexOf('A |'))
    env.table.cell(1, 0, 'draft')
    expect(await env.table.apply()).toBe(false)
    expect(env.table.store.getState().error).toBe('table-source-limit')
    expect(env.table.store.getState().open).toBe(true)
    expect(env.table.store.getState().draft?.rows[1]?.[0]).toBe('draft')
    expect(env.state.doc.toString()).toBe(original)
  })
  it('settles pending source input before capture and rejects a moved widget position', async () => {
    const env = setup(),
      input = deferred()
    env.synchronizeInput.mockReturnValueOnce(input.promise)
    const opening = env.table.open(original.indexOf('A |'))
    expect(env.table.store.getState().open).toBe(false)
    expect(env.capture).not.toHaveBeenCalled()
    env.change({ changes: { from: 0, insert: 'new\n' } })
    input.resolve()
    await opening
    expect(env.table.store.getState().error).toBe('table-changed')
    expect(env.capture).not.toHaveBeenCalled()
    env.table.close()
  })
  it('rejects stale revisions and locked documents without replacing source', async () => {
    const env = setup()
    await env.table.open(original.indexOf('A |'))
    env.table.cell(1, 0, 'draft')
    env.change({ changes: { from: 0, insert: 'new\n' } })
    expect(env.table.store.getState().stale).toBe(true)
    expect(await env.table.apply()).toBe(false)
    expect(env.state.doc.toString()).toBe(`new\n${original}`)
    env.table.close()
    await env.table.open(env.state.doc.toString().indexOf('A |'))
    env.table.cell(1, 0, 'draft')
    env.allow(false)
    expect(await env.table.apply()).toBe(false)
    expect(env.table.store.getState().error).toBe('table-unavailable')
    expect(env.state.doc.toString()).toBe(`new\n${original}`)
  })
  it('does not apply or close a replacement session when a cancelled Apply resumes', async () => {
    const env = setup()
    await env.table.open(original.indexOf('A |'))
    env.table.cell(1, 0, 'old draft')
    const input = deferred()
    env.synchronizeInput.mockReturnValueOnce(input.promise)
    const applying = env.table.apply()
    env.table.close()
    await env.table.open(original.indexOf('A |'))
    env.table.cell(1, 0, 'new draft')
    input.resolve()
    expect(await applying).toBe(false)
    expect(env.table.store.getState().open).toBe(true)
    expect(env.table.store.getState().draft?.rows[1]?.[0]).toBe('new draft')
    expect(env.state.doc.toString()).toBe(original)
  })
  it('preserves complete source when no current native tree is available', async () => {
    const env = setup()
    env.capture.mockResolvedValueOnce(null)
    await env.table.open(original.indexOf('A |'))
    expect(env.table.store.getState().error).toBe('table-unsupported')
    expect(env.state.doc.toString()).toBe(original)
    env.table.close()
  })
  it('shows an input synchronization failure without capturing or changing the document', async () => {
    const env = setup()
    env.synchronizeInput.mockRejectedValueOnce(new Error('input unavailable'))
    await env.table.open(original.indexOf('A |'))
    expect(env.table.store.getState().open).toBe(true)
    expect(env.table.store.getState().error).toBe('table-unavailable')
    expect(env.capture).not.toHaveBeenCalled()
    expect(env.state.doc.toString()).toBe(original)
    env.table.close()
  })
})
