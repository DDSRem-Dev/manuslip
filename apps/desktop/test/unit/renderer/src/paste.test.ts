import { createSourceState, EditorSelection, type TransactionSpec } from '@manuslip/editor'
import { describe, expect, it, vi } from 'vitest'
import { DocumentPaste } from '../../../../src/renderer/src/paste'
import type { SliceRuntime } from '../../../../src/renderer/src/semantics/sliced-work'
import type { AssetBridge } from '../../../../src/shared/asset-contracts'

function setup(text = 'one two', runtime?: SliceRuntime) {
  let state = createSourceState(text).update({ selection: { anchor: 4, head: 7 } }).state
  let named = true
  let canApply = true
  const status = vi.fn()
  const bridge: AssetBridge = {
    loadLocalImage: vi.fn(async () => ({ ok: true as const, value: 'url' })),
    captureClipboardImage: vi.fn(async () => ({ ok: true as const, value: 'capture' })),
    importClipboardImage: vi.fn(async () => ({ ok: true as const, value: 'assets/test.png' })),
    discardClipboardImage: vi.fn(async () => ({ ok: true as const, value: null })),
    convertClipboardHtml: vi.fn(async () => ({ ok: true as const, value: '**HTML**' })),
  }
  const save = vi.fn(async () => {
    named = true
    return true
  })
  const dispatch = (spec: TransactionSpec): void => {
    const transaction = state.update(spec)
    paste.map([transaction])
    state = transaction.state
  }
  const paste = new DocumentPaste(
    {
      id: 'id',
      state: () => state,
      named: () => named,
      canApply: () => canApply,
      save,
      dispatch,
      status,
    },
    bridge,
    runtime,
  )
  return {
    paste,
    bridge,
    save,
    status,
    dispatch,
    state: () => state,
    untitled: () => {
      named = false
    },
    lock: () => {
      canApply = false
    },
  }
}
describe('clipboard transactions', () => {
  it('replaces all selections in a single paste transaction', async () => {
    const context = setup()
    context.dispatch({
      selection: EditorSelection.create(
        [EditorSelection.range(0, 3), EditorSelection.range(4, 7)],
        1,
      ),
    })
    await context.paste.run({ html: '<b>HTML</b>' })
    expect(context.state().doc.toString()).toBe('**HTML** **HTML**')
    expect(context.state().selection.ranges.map((range) => range.from)).toEqual([8, 17])
  })
  it('maps the original selection past unrelated concurrent edits', async () => {
    const context = setup()
    let resolve!: (value: Awaited<ReturnType<AssetBridge['convertClipboardHtml']>>) => void
    vi.mocked(context.bridge.convertClipboardHtml).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    const job = context.paste.run({ html: 'rich' })
    context.dispatch({ changes: { from: 0, insert: 'prefix ' } })
    resolve({ ok: true, value: 'PASTE' })
    await job
    expect(context.state().doc.toString()).toBe('prefix one PASTE')
  })
  it('preserves edits inside a pending replacement and asks the user to paste again', async () => {
    const context = setup()
    let resolve!: (value: Awaited<ReturnType<AssetBridge['convertClipboardHtml']>>) => void
    vi.mocked(context.bridge.convertClipboardHtml).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    const job = context.paste.run({ html: 'rich' })
    context.dispatch({ changes: { from: 5, insert: '!' } })
    resolve({ ok: true, value: 'PASTE' })
    await job
    expect(context.state().doc.toString()).toBe('one t!wo')
    expect(context.status).toHaveBeenCalledWith(true, 'paste-interrupted')
  })
  it('captures before Save As and releases the capture after insertion', async () => {
    const context = setup()
    context.untitled()
    await context.paste.run({ image: true })
    expect(context.bridge.captureClipboardImage).toHaveBeenCalledBefore(context.save)
    expect(context.save).toHaveBeenCalledBefore(vi.mocked(context.bridge.importClipboardImage))
    expect(context.state().doc.toString()).toBe('one ![Image](assets/test.png)')
    expect(context.bridge.discardClipboardImage).toHaveBeenCalledWith('id', 'capture')
  })
  it('does not change text or write an image after Save As cancellation', async () => {
    const context = setup()
    context.untitled()
    context.save.mockResolvedValue(false)
    await context.paste.run({ image: true })
    expect(context.state().doc.toString()).toBe('one two')
    expect(context.bridge.importClipboardImage).not.toHaveBeenCalled()
    expect(context.bridge.discardClipboardImage).toHaveBeenCalled()
  })
  it('does not delete selected source when conversion is empty or fails', async () => {
    const context = setup()
    vi.mocked(context.bridge.convertClipboardHtml).mockResolvedValueOnce({ ok: true, value: '' })
    await context.paste.run({ html: '<script>bad()</script>' })
    expect(context.state().doc.toString()).toBe('one two')
    vi.mocked(context.bridge.convertClipboardHtml).mockResolvedValueOnce({
      ok: false,
      code: 'paste-failed',
      error: 'bad',
    })
    await context.paste.run({ html: 'bad' })
    expect(context.state().doc.toString()).toBe('one two')
    expect(context.status).toHaveBeenCalledWith(true, 'paste-failed')
  })
})

describe('staged plain-text paste', () => {
  function scheduled(text = 'one two') {
    const tasks: (() => void)[] = []
    let clock = 0
    const context = setup(text, {
      now: () => (clock += 2),
      defer: (run) => tasks.push(run),
    })
    return {
      ...context,
      tasks,
      drain: () => {
        while (tasks.length) tasks.shift()?.()
      },
    }
  }

  it.each(['\n', '\r\n', '\r'])(
    'distributes normalized %j lines over the captured selections after unrelated edits',
    async (separator) => {
      for (const main of [0, 1]) {
        const context = scheduled('x one two')
        context.dispatch({
          selection: EditorSelection.create(
            [EditorSelection.range(2, 5), EditorSelection.range(9, 6)],
            main,
          ),
        })
        const first = `first 中文😀${'a'.repeat(140000)}`
        const second = `second 日本語${'b'.repeat(150000)}`
        const job = context.paste.run({ text: `${first}${separator}${second}` })
        context.tasks.shift()?.()
        expect(context.state().doc.toString()).toBe('x one two')
        context.dispatch({ changes: { from: 0, insert: 'prefix ' } })
        context.drain()
        await job
        expect(context.status.mock.calls.filter(([, error]) => error)).toEqual([])
        expect(context.state().doc.eq(createSourceState(`prefix x ${first} ${second}`).doc)).toBe(
          true,
        )
        expect(context.state().selection.ranges.map((range) => range.head)).toEqual([
          9 + first.length,
          10 + first.length + second.length,
        ])
        expect(context.state().selection.mainIndex).toBe(main)
        expect(context.state().selection.ranges.map((range) => range.assoc)).toEqual([-1, -1])
        expect(context.bridge.convertClipboardHtml).not.toHaveBeenCalled()
      }
    },
  )

  it.each(['\n', 'first\n', '\nsecond'])(
    'preserves empty clipboard lines when distributing %j',
    async (text) => {
      const context = scheduled()
      context.dispatch({
        selection: EditorSelection.create(
          [EditorSelection.range(0, 3), EditorSelection.range(4, 7)],
          1,
        ),
      })
      const job = context.paste.run({ text })
      context.drain()
      await job
      expect(context.state().doc.toString()).toBe(text.replace('\n', ' '))
      expect(context.state().selection.ranges).toHaveLength(2)
    },
  )

  it.each(['single line', 'one\ntwo\nthree'])(
    'repeats the complete plain text when line and selection counts differ',
    async (text) => {
      const context = scheduled()
      context.dispatch({
        selection: EditorSelection.create(
          [EditorSelection.range(0, 3), EditorSelection.range(4, 7)],
          1,
        ),
      })
      const job = context.paste.run({ text })
      context.drain()
      await job
      expect(context.state().doc.toString()).toBe(`${text} ${text}`)
    },
  )

  it('repeats rich multiline conversion even when its line count matches the selections', async () => {
    const context = scheduled()
    context.dispatch({
      selection: EditorSelection.create(
        [EditorSelection.range(0, 3), EditorSelection.range(4, 7)],
        1,
      ),
    })
    vi.mocked(context.bridge.convertClipboardHtml).mockResolvedValue({
      ok: true,
      value: '**first**\n**second**',
    })
    await context.paste.run({ html: '<p>first</p><p>second</p>' })
    expect(context.state().doc.toString()).toBe('**first**\n**second** **first**\n**second**')
  })

  it('keeps large text private until commit and maps unrelated edits', async () => {
    const context = scheduled()
    const pasted = 'word\r\n中文😀 '.repeat(350000)
    const job = context.paste.run({ text: pasted })
    context.tasks.shift()?.()
    expect(context.state().doc.toString()).toBe('one two')
    context.dispatch({ changes: { from: 0, insert: 'prefix ' } })
    context.drain()
    await job
    expect(context.state().doc.toString()).toBe(`prefix one ${pasted.replaceAll('\r\n', '\n')}`)
    expect(context.state().selection.main.head).toBe(context.state().doc.length)
    expect(context.bridge.convertClipboardHtml).not.toHaveBeenCalled()
  })

  it('releases cancelled preparation, preserves intervening edits and does not clear a newer status', async () => {
    const context = scheduled()
    const job = context.paste.run({ text: 'x'.repeat(5 * 1024 * 1024) })
    context.tasks.shift()?.()
    context.dispatch({ changes: { from: 0, insert: 'edit ' } })
    expect(context.paste.cancel()).toBe(true)
    const next = context.paste.run({ html: '<b>new</b>' })
    context.drain()
    await Promise.all([job, next])
    expect(context.state().doc.toString()).toBe('edit one **HTML**')
    expect(context.status.mock.calls.filter(([, error]) => error)).toEqual([])
    expect(context.paste.cancel()).toBe(false)
  })

  it('discards staged text when the selected range changes or application becomes unavailable', async () => {
    for (const invalidate of [
      (context: ReturnType<typeof scheduled>) =>
        context.dispatch({ changes: { from: 5, insert: '!' } }),
      (context: ReturnType<typeof scheduled>) => context.lock(),
    ]) {
      const context = scheduled()
      const job = context.paste.run({ text: 'x'.repeat(5 * 1024 * 1024) })
      context.tasks.shift()?.()
      invalidate(context)
      const before = context.state().doc.toString()
      context.drain()
      await job
      expect(context.state().doc.toString()).toBe(before)
      expect(context.status).toHaveBeenCalledWith(true, 'paste-interrupted')
    }
  })
})
