import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentsController } from '../../../../src/renderer/src/documents'
import type { FileBridge, FileSnapshot } from '../../../../src/shared/file-contracts'

function snapshot(id: string, text = '', named = false): FileSnapshot {
  return {
    info: {
      id,
      name: `${id}.md`,
      displayPath: named ? `/${id}.md` : null,
      fingerprint: named ? 'disk' : null,
      encoding: 'utf8',
      bom: false,
      newline: 'lf',
      unsafeDecoding: false,
    },
    text,
  }
}
function setup() {
  let sequence = 0
  const bridge: FileBridge = {
    newDocument: vi.fn(async () => ({ ok: true as const, value: snapshot(String(++sequence)) })),
    openDocument: vi.fn(async () => ({ ok: true as const, value: snapshot('file', 'disk', true) })),
    saveDocument: vi.fn(async () => ({ ok: true as const, value: { kind: 'cancelled' as const } })),
    reloadDocument: vi.fn(async (id) => ({
      ok: true as const,
      value: snapshot(id, 'reloaded', true),
    })),
    confirmDocumentClose: vi.fn(async () => ({ ok: true as const, value: 'cancel' as const })),
    closeDocument: vi.fn(async () => ({ ok: true as const, value: null })),
    closeWindow: vi.fn(async () => ({ ok: true as const, value: null })),
    checkpoint: vi.fn(async () => ({ ok: true as const, value: null })),
    clearRecovery: vi.fn(async () => ({ ok: true as const, value: null })),
    listRecoveries: async () => ({ ok: true, value: [] }),
    restoreRecovery: vi.fn(async () => ({
      ok: true as const,
      value: snapshot('recovered', 'draft'),
    })),
    discardRecovery: async () => ({ ok: true, value: null }),
    onCommand: () => () => {},
    onFileChanged: () => () => {},
  }
  const documents = new DocumentsController(bridge)
  const discard = () =>
    vi.mocked(bridge.confirmDocumentClose).mockResolvedValue({ ok: true, value: 'discard' })
  const dispose = async () => {
    discard()
    await documents.command('close-window')
  }
  return { bridge, documents, discard, dispose }
}
afterEach(() => vi.useRealTimers())

function activeDocument(documents: DocumentsController) {
  const document = documents.active
  if (!document) throw new Error('Missing active document')
  return document
}

describe('document tabs', () => {
  it('cycles in display order in both directions without opening files, including empty and single-document windows', async () => {
    const { documents, bridge, dispose } = setup()
    try {
      await documents.command('next-document')
      expect(documents.active).toBeNull()
      await documents.command('new')
      const first = activeDocument(documents)
      await documents.command('previous-document')
      expect(documents.active).toBe(first)
      await documents.command('new')
      await documents.command('new')
      for (const [command, id] of [
        ['next-document', '1'],
        ['next-document', '2'],
        ['previous-document', '1'],
        ['previous-document', '3'],
      ] as const) {
        await documents.command(command)
        expect(documents.store.getState().activeId).toBe(id)
      }
      expect(bridge.openDocument).not.toHaveBeenCalled()
    } finally {
      await dispose()
    }
  })

  it('accumulates cycling requests during input synchronization and saves only the final destination', async () => {
    const { documents, bridge, dispose } = setup()
    await documents.command('new')
    await documents.command('new')
    await documents.command('new')
    await documents.activate('1')
    const first = activeDocument(documents)
    let release!: () => void
    const input = new Promise<void>((resolve) => {
      release = resolve
    })
    const synchronize = vi.spyOn(first, 'synchronizeInput').mockReturnValue(input)
    const selected: (string | null)[] = []
    const unsubscribe = documents.store.subscribe((state, before) => {
      if (state.activeId !== before.activeId) selected.push(state.activeId)
    })
    try {
      const second = documents.command('next-document')
      const third = documents.command('next-document')
      const saving = documents.command('save')
      await Promise.resolve()
      expect(documents.active).toBe(first)
      expect(bridge.saveDocument).not.toHaveBeenCalled()
      first.dispatch({ changes: { from: 0, insert: 'Committed 世界' } })
      release()
      await Promise.all([second, third, saving])
      expect(documents.store.getState().activeId).toBe('3')
      expect(selected).toEqual(['3'])
      expect(first.state.doc.toString()).toBe('Committed 世界')
      expect(bridge.saveDocument).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: '3', text: '' }),
      )
    } finally {
      release()
      unsubscribe()
      synchronize.mockRestore()
      await dispose()
    }
  })

  it('starts cycling from a pending explicit tab request and preserves the latest reverse request', async () => {
    const { documents, dispose } = setup()
    await documents.command('new')
    await documents.command('new')
    await documents.command('new')
    await documents.activate('1')
    const first = activeDocument(documents)
    let release!: () => void
    const synchronize = vi.spyOn(first, 'synchronizeInput').mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    try {
      const explicit = documents.activate('3')
      const previous = documents.command('previous-document')
      release()
      await Promise.all([explicit, previous])
      expect(documents.store.getState().activeId).toBe('2')
    } finally {
      release()
      synchronize.mockRestore()
      await dispose()
    }
  })
  it('keeps input on the old tab until synchronization and commits only the latest requested tab', async () => {
    const { documents, dispose } = setup()
    await documents.command('new')
    await documents.command('new')
    await documents.command('new')
    await documents.activate('1')
    const first = activeDocument(documents)
    let release!: () => void
    const input = new Promise<void>((resolve) => {
      release = resolve
    })
    const synchronize = vi.spyOn(first, 'synchronizeInput').mockReturnValue(input)
    const selected: (string | null)[] = []
    const unsubscribe = documents.store.subscribe((state) => selected.push(state.activeId))
    try {
      const second = documents.activate('2')
      const third = documents.activate('3')
      expect(documents.active).toBe(first)
      first.dispatch({ changes: { from: 0, insert: 'latest input 世界' } })
      release()
      await Promise.all([second, third])
      expect(documents.store.getState().activeId).toBe('3')
      expect(selected).toEqual(['3'])
      expect(first.state.doc.toString()).toBe('latest input 世界')
    } finally {
      release()
      unsubscribe()
      synchronize.mockRestore()
      await dispose()
    }
  })
  it('saves the requested tab when Save follows an activation whose input is still pending', async () => {
    const { documents, bridge, dispose } = setup()
    await documents.command('new')
    await documents.command('new')
    const second = activeDocument(documents)
    second.dispatch({ changes: { from: 0, insert: 'second body' } })
    await documents.activate('1')
    const first = activeDocument(documents)
    let release!: () => void
    const input = new Promise<void>((resolve) => {
      release = resolve
    })
    const synchronize = vi.spyOn(first, 'synchronizeInput').mockReturnValue(input)
    try {
      const switching = documents.activate('2')
      const saving = documents.command('save')
      await Promise.resolve()
      expect(bridge.saveDocument).not.toHaveBeenCalled()
      release()
      await Promise.all([switching, saving])
      expect(documents.active).toBe(second)
      expect(bridge.saveDocument).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: '2', text: 'second body' }),
      )
    } finally {
      release()
      synchronize.mockRestore()
      await dispose()
    }
  })
  it('synchronizes the latest edits when an asynchronously opened file is ready to replace the view', async () => {
    const { documents, bridge, dispose } = setup()
    await documents.command('new')
    const first = activeDocument(documents)
    let opened!: (result: Awaited<ReturnType<FileBridge['openDocument']>>) => void
    vi.mocked(bridge.openDocument).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          opened = resolve
        }),
    )
    const opening = documents.command('open')
    await vi.waitFor(() => expect(bridge.openDocument).toHaveBeenCalledOnce())
    let release!: () => void
    const input = new Promise<void>((resolve) => {
      release = resolve
    })
    const synchronize = vi.spyOn(first, 'synchronizeInput').mockReturnValue(input)
    try {
      opened({ ok: true, value: snapshot('file', 'opened', true) })
      await vi.waitFor(() => expect(synchronize).toHaveBeenCalledOnce())
      expect(documents.active).toBe(first)
      first.dispatch({ changes: { from: 0, insert: 'typed while opening' } })
      release()
      await opening
      expect(documents.active?.state.doc.toString()).toBe('opened')
      expect(first.state.doc.toString()).toBe('typed while opening')
    } finally {
      release()
      synchronize.mockRestore()
      await dispose()
    }
  })
  it.each(['tab', 'window'] as const)(
    'synchronizes pending input before locking and confirming a %s close',
    async (kind) => {
      const { documents, bridge, dispose } = setup()
      await documents.command('new')
      const first = activeDocument(documents)
      let release!: () => void
      const input = new Promise<void>((resolve) => {
        release = resolve
      })
      const synchronize = vi.spyOn(first, 'synchronizeInput').mockReturnValue(input)
      try {
        const closing = kind === 'tab' ? documents.closeTab('1') : documents.command('close-window')
        await vi.waitFor(() => expect(synchronize).toHaveBeenCalledOnce())
        expect(first.state.readOnly).toBe(false)
        expect(bridge.confirmDocumentClose).not.toHaveBeenCalled()
        first.dispatch({ changes: { from: 0, insert: 'pending close input' } })
        release()
        await closing
        expect(bridge.confirmDocumentClose).toHaveBeenCalledExactlyOnceWith('1')
        expect(bridge.closeDocument).not.toHaveBeenCalled()
        expect(documents.active).toBe(first)
        expect(first.state.readOnly).toBe(false)
        expect(first.state.doc.toString()).toBe('pending close input')
      } finally {
        release()
        synchronize.mockRestore()
        await dispose()
      }
    },
  )
  it('creates separate dirty drafts without close prompts and restores selection when activated', async () => {
    const { documents, bridge, dispose } = setup()
    await documents.command('new')
    const first = documents.active
    first?.dispatch({ changes: { from: 0, insert: 'first draft' }, selection: { anchor: 4 } })
    await documents.command('new')
    documents.active?.dispatch({ changes: { from: 0, insert: 'second draft' } })
    expect(documents.store.getState().documents).toHaveLength(2)
    expect(bridge.confirmDocumentClose).not.toHaveBeenCalled()
    await documents.activate('1')
    expect(documents.active).toBe(first)
    expect(first?.state.doc.toString()).toBe('first draft')
    expect(first?.state.selection.main.head).toBe(4)
    expect(first && documents.title(first)).toBe('Untitled 1')
    await dispose()
  })
  it('reopening an owned file activates its dirty state without applying fresh disk text', async () => {
    const { documents, dispose } = setup()
    await documents.command('open')
    const first = documents.active
    first?.dispatch({ changes: { from: 0, to: 4, insert: 'local' } })
    await documents.command('new')
    await documents.command('open')
    expect(documents.store.getState().documents).toHaveLength(2)
    expect(documents.active).toBe(first)
    expect(documents.active?.state.doc.toString()).toBe('local')
    await dispose()
  })
  it('closing a background tab preserves the active tab; cancelled close retains its body', async () => {
    const { documents, bridge, dispose } = setup()
    await documents.command('new')
    await documents.command('new')
    await documents.closeTab('1')
    expect(documents.store.getState().activeId).toBe('2')
    documents.active?.dispatch({ changes: { from: 0, insert: 'keep' } })
    await documents.command('close-document')
    expect(documents.active?.state.doc.toString()).toBe('keep')
    expect(bridge.closeDocument).toHaveBeenCalledTimes(1)
    await dispose()
  })
  it('checks every dirty tab before disposing any, and cancellation retains even discarded drafts', async () => {
    const { documents, bridge, dispose } = setup()
    await documents.command('new')
    documents.active?.dispatch({ changes: { from: 0, insert: 'first' } })
    await documents.command('new')
    documents.active?.dispatch({ changes: { from: 0, insert: 'second' } })
    vi.mocked(bridge.confirmDocumentClose).mockResolvedValueOnce({ ok: true, value: 'discard' })
    await documents.command('close-window')
    expect(bridge.closeDocument).not.toHaveBeenCalled()
    expect(bridge.clearRecovery).not.toHaveBeenCalled()
    expect(bridge.closeWindow).toHaveBeenLastCalledWith(false)
    expect(
      documents.store.getState().documents.map((document) => document.state.doc.toString()),
    ).toEqual(['first', 'second'])
    expect(documents.store.getState().documents.every((document) => !document.state.readOnly)).toBe(
      true,
    )
    await dispose()
    expect(bridge.closeDocument).toHaveBeenCalledTimes(2)
    expect(bridge.closeWindow).toHaveBeenLastCalledWith(true)
  })
  it('queues window close behind an open dialog instead of dropping the close request', async () => {
    const { documents, bridge } = setup()
    let finish: (result: Awaited<ReturnType<FileBridge['openDocument']>>) => void = () => {}
    vi.mocked(bridge.openDocument).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const opening = documents.command('open')
    await Promise.resolve()
    const closing = documents.command('close-window')
    finish({ ok: true, value: snapshot('file', 'disk', true) })
    await Promise.all([opening, closing])
    expect(bridge.closeDocument).toHaveBeenCalledWith('file')
    expect(bridge.closeWindow).toHaveBeenCalledWith(true)
    expect(documents.store.getState().busy).toBe(false)
  })
  it('restores a recovery into another tab and keeps the current dirty draft', async () => {
    const { documents, bridge, dispose } = setup()
    await documents.command('new')
    documents.active?.dispatch({ changes: { from: 0, insert: 'current' } })
    expect(await documents.restore('recovery')).toBe(true)
    expect(documents.store.getState().documents).toHaveLength(2)
    expect(documents.active?.store.getState().recovered).toBe(true)
    expect(bridge.confirmDocumentClose).not.toHaveBeenCalled()
    await dispose()
  })
  it('coalesces repeated window-close requests while a close decision is pending', async () => {
    const { documents, bridge, dispose } = setup()
    await documents.command('new')
    documents.active?.dispatch({ changes: { from: 0, insert: 'draft' } })
    let finish: (result: Awaited<ReturnType<FileBridge['confirmDocumentClose']>>) => void = () => {}
    vi.mocked(bridge.confirmDocumentClose).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const closing = documents.command('close-window')
    await vi.waitFor(() => expect(bridge.confirmDocumentClose).toHaveBeenCalledOnce())
    await documents.command('close-window')
    finish({ ok: true, value: 'cancel' })
    await closing
    expect(bridge.confirmDocumentClose).toHaveBeenCalledOnce()
    expect(bridge.closeWindow).toHaveBeenCalledTimes(1)
    expect(documents.active?.state.doc.toString()).toBe('draft')
    await dispose()
  })
  it('retains existing tabs and surfaces recovery failures without losing the error code', async () => {
    const { documents, bridge, dispose } = setup()
    await documents.command('new')
    vi.mocked(bridge.restoreRecovery).mockResolvedValueOnce({
      ok: false,
      error: 'Full',
      code: 'recovery-capacity',
    })
    expect(await documents.restore('recovery')).toBe(false)
    expect(documents.store.getState().error).toBe('recovery-capacity')
    expect(documents.store.getState().documents).toHaveLength(1)
    await dispose()
  })
  it('returns failed restore to the recovery flow without a duplicate global error, then permits retry', async () => {
    const { documents, bridge, dispose } = setup()
    vi.mocked(bridge.restoreRecovery).mockResolvedValueOnce({
      ok: false,
      error: 'Private storage failure',
      code: 'recovery-io',
    })
    expect(await documents.restore('recovery', false)).toBe(false)
    expect(documents.store.getState()).toMatchObject({ error: null, busy: false, documents: [] })
    expect(await documents.restore('recovery', false)).toBe(true)
    expect(documents.active?.store.getState().recovered).toBe(true)
    await dispose()
  })
})
