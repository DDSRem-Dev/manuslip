import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentController } from '../../../../src/renderer/src/document'
import type {
  FileBridge,
  FileInfo,
  FileSnapshot,
  SaveOutcome,
  SaveRequest,
} from '../../../../src/shared/file-contracts'

const info: FileInfo = {
  id: '12345678-1234-1234-1234-123456789abc',
  name: 'test.md',
  displayPath: '/test.md',
  fingerprint: 'original',
  encoding: 'utf8',
  bom: false,
  newline: 'lf',
  unsafeDecoding: false,
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  return {
    promise: new Promise<T>((done) => {
      resolve = done
    }),
    resolve: (value) => resolve(value),
  }
}
function setup(named = false) {
  let changed: (id: string) => void = () => {}
  const snapshot: FileSnapshot = {
    info: { ...info, displayPath: named ? info.displayPath : null },
    text: 'base',
  }
  const save = vi.fn<FileBridge['saveDocument']>(async (request) => ({
    ok: true,
    value: {
      kind: 'saved',
      info: { ...snapshot.info, fingerprint: 'saved' },
      revision: request.revision,
    },
  }))
  const bridge: FileBridge = {
    checkpoint: vi.fn(async () => ({ ok: true as const, value: null })),
    clearRecovery: vi.fn(async () => ({ ok: true as const, value: null })),
    listRecoveries: async () => ({ ok: true, value: [] }),
    restoreRecovery: async () => ({ ok: true, value: snapshot }),
    discardRecovery: async () => ({ ok: true, value: null }),
    newDocument: async () => ({ ok: true, value: snapshot }),
    openDocument: async () => ({ ok: true, value: snapshot }),
    saveDocument: save,
    reloadDocument: vi.fn(async () => ({ ok: true as const, value: { info, text: 'external' } })),
    closeDocument: vi.fn(async () => ({ ok: true as const, value: null })),
    confirmDocumentClose: vi.fn(async () => ({ ok: true as const, value: 'cancel' as const })),
    closeWindow: async () => ({ ok: true, value: null }),
    onCommand: () => () => {},
    onFileChanged: (listener) => {
      changed = listener
      return () => {
        changed = () => {}
      }
    },
  }
  const document = new DocumentController(snapshot, bridge, 'Markdown source')
  return { document, bridge, save, changed: () => changed(info.id) }
}

afterEach(() => {
  vi.useRealTimers()
})
describe('document lifecycle', () => {
  it('waits for native input before changing editor mode', async () => {
    const { document } = setup()
    const input = deferred<void>()
    vi.spyOn(document, 'synchronizeInput').mockReturnValue(input.promise)
    const mode = vi.spyOn(document.preview, 'setMode')
    const changing = document.changeMode('live')
    expect(mode).not.toHaveBeenCalled()
    document.dispatch({ changes: { from: 4, insert: ' 世界' } })
    input.resolve()
    expect(await changing).toBe(true)
    expect(mode).toHaveBeenCalledExactlyOnceWith('live')
    expect(document.state.doc.toString()).toBe('base 世界')
    await document.dispose()
  })

  it('applies only the latest mode request while native input is pending', async () => {
    const { document } = setup()
    const input = deferred<void>()
    vi.spyOn(document, 'synchronizeInput').mockReturnValue(input.promise)
    const mode = vi.spyOn(document.preview, 'setMode')
    const first = document.changeMode('live')
    const latest = document.changeMode('source')
    input.resolve()
    expect(await first).toBe(false)
    expect(await latest).toBe(true)
    expect(mode).toHaveBeenCalledExactlyOnceWith('source')
    await document.dispose()
  })

  it('does not change modes after the document becomes locked during synchronization', async () => {
    const { document } = setup()
    const input = deferred<void>()
    vi.spyOn(document, 'synchronizeInput').mockReturnValue(input.promise)
    const mode = vi.spyOn(document.preview, 'setMode')
    const changing = document.changeMode('live')
    document.lock(true)
    input.resolve()
    expect(await changing).toBe(false)
    expect(mode).not.toHaveBeenCalled()
    document.lock(false)
    await document.dispose()
  })

  it('does not apply a mode request after its document is disposed', async () => {
    const { document } = setup()
    const input = deferred<void>()
    vi.spyOn(document, 'synchronizeInput').mockReturnValue(input.promise)
    const mode = vi.spyOn(document.preview, 'setMode')
    const changing = document.changeMode('live')
    await document.dispose()
    input.resolve()
    expect(await changing).toBe(false)
    expect(mode).not.toHaveBeenCalled()
  })

  it('keeps the current mode when translated preview is unavailable', async () => {
    const { document } = setup()
    const input = vi.spyOn(document, 'synchronizeInput')
    const mode = vi.spyOn(document.preview, 'setMode')
    expect(await document.changeMode('translated')).toBe(false)
    expect(input).not.toHaveBeenCalled()
    expect(mode).not.toHaveBeenCalled()
    await document.dispose()
  })

  it('reveals verified Unicode search offsets without changing text or accepting stale lines', async () => {
    const { document } = setup()
    document.dispatch({ changes: { from: 0, to: 4, insert: '# Heading\n😀 中文 needle rest' } })
    const before = document.state.doc
    expect(document.revealSearch({ line: 2, from: 6, to: 12, text: '😀 中文 needle rest' })).toBe(
      true,
    )
    expect(
      document.state.sliceDoc(document.state.selection.main.from, document.state.selection.main.to),
    ).toBe('needle')
    expect(document.state.doc).toBe(before)
    const selection = document.state.selection.main
    expect(document.revealSearch({ line: 2, from: 6, to: 12, text: 'different saved line' })).toBe(
      false,
    )
    expect(document.state.selection.main).toBe(selection)
    document.lock(true)
    expect(document.revealRange(0)).toBe(false)
    document.lock(false)
    expect(document.revealRange(-1)).toBe(false)
    expect(document.revealRange(document.state.doc.length + 1)).toBe(false)
    await document.dispose()
  })
  it('pauses autosave while close decisions lock a document and resumes on cancellation', async () => {
    vi.useFakeTimers()
    const { document, save } = setup(true)
    document.dispatch({ changes: { from: 4, insert: ' pending' } })
    document.lock(true)
    await vi.advanceTimersByTimeAsync(6000)
    expect(save).not.toHaveBeenCalled()
    document.lock(false)
    await vi.advanceTimersByTimeAsync(750)
    expect(save).toHaveBeenCalledOnce()
    await document.dispose()
  })
  it('saves pending newer edits immediately when an in-flight save crosses the dirty deadline', async () => {
    vi.useFakeTimers()
    const { document, save } = setup(true)
    const pending = deferred<Awaited<ReturnType<FileBridge['saveDocument']>>>()
    save.mockImplementationOnce(() => pending.promise)
    document.dispatch({ changes: { from: 4, insert: ' first' } })
    const saving = document.save()
    await vi.advanceTimersByTimeAsync(0)
    document.dispatch({ changes: { from: 10, insert: ' second' } })
    await vi.advanceTimersByTimeAsync(6000)
    expect(save).toHaveBeenCalledOnce()
    pending.resolve({ ok: true, value: { kind: 'saved', info, revision: 1 } })
    await saving
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]?.[0].text).toBe('base first second')
    await document.dispose()
  })
  it('checkpoints continuous edits every two seconds and does not rewrite unchanged content', async () => {
    vi.useFakeTimers()
    const { document, bridge } = setup()
    document.dispatch({ changes: { from: 4, insert: 'x' } })
    for (let tick = 0; tick < 3; tick++) {
      await vi.advanceTimersByTimeAsync(500)
      document.dispatch({ changes: { from: 4, insert: 'x' } })
    }
    expect(bridge.checkpoint).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(bridge.checkpoint).toHaveBeenCalledExactlyOnceWith({
      id: info.id,
      revision: 4,
      text: 'basexxxx',
    })
    await vi.advanceTimersByTimeAsync(6000)
    expect(bridge.checkpoint).toHaveBeenCalledOnce()
    document.dispatch({ changes: { from: 4, insert: 'y' } })
    await vi.advanceTimersByTimeAsync(2000)
    expect(bridge.checkpoint).toHaveBeenCalledTimes(2)
    await document.dispose()
  })
  it('scales checkpoint cadence above one MiB and checkpoint errors do not block editing', async () => {
    vi.useFakeTimers()
    const { document, bridge } = setup()
    vi.mocked(bridge.checkpoint).mockResolvedValueOnce({
      ok: false,
      code: 'recovery-io',
      error: 'Storage full',
    })
    document.dispatch({ changes: { from: 4, insert: 'x'.repeat(1024 * 1024) } })
    await vi.advanceTimersByTimeAsync(9999)
    expect(bridge.checkpoint).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(document.store.getState().recoveryError).toBe('recovery-io')
    document.dispatch({ changes: { from: 4, insert: 'still editable' } })
    expect(document.state.doc.toString()).toContain('still editable')
    expect(document.store.getState().error).toBeNull()
    await document.dispose()
  })
  it('applies a save acknowledgement only to captured content; edits during a save remain dirty', async () => {
    const { document, save } = setup()
    const pending = deferred<Awaited<ReturnType<FileBridge['saveDocument']>>>()
    save.mockImplementationOnce(() => pending.promise)
    document.dispatch({ changes: { from: 4, insert: ' first' } })
    const saving = document.save()
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
    document.dispatch({ changes: { from: document.state.doc.length, insert: ' second' } })
    pending.resolve({ ok: true, value: { kind: 'saved', info, revision: 1 } })
    expect(await saving).toBe(true)
    expect(document.store.getState()).toMatchObject({ revision: 2, dirty: true, saving: false })
    document.dispatch({ changes: { from: 0, to: document.state.doc.length, insert: 'base first' } })
    expect(document.store.getState()).toMatchObject({ revision: 3, dirty: false })
    await document.dispose()
  })
  it('queues a later Save As behind the in-flight write and uses the acknowledged fingerprint', async () => {
    const { document, save } = setup()
    const pending = deferred<Awaited<ReturnType<FileBridge['saveDocument']>>>()
    save.mockImplementationOnce(() => pending.promise)
    document.dispatch({ changes: { from: 4, insert: ' first' } })
    const first = document.save()
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
    document.dispatch({ changes: { from: document.state.doc.length, insert: ' second' } })
    const second = document.save('save-as')
    expect(save).toHaveBeenCalledOnce()
    pending.resolve({
      ok: true,
      value: { kind: 'saved', info: { ...info, fingerprint: 'first-save' }, revision: 1 },
    })
    await Promise.all([first, second])
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      text: 'base first second',
      revision: 2,
      expectedFingerprint: 'first-save',
      action: 'save-as',
    })
    expect(document.store.getState().dirty).toBe(false)
    await document.dispose()
  })
  it('autosaves named files after idle; failures suspend retries until an explicit save', async () => {
    vi.useFakeTimers()
    const { document, save } = setup(true)
    save.mockResolvedValueOnce({ ok: false, error: 'Storage full', code: 'file-storage' })
    document.dispatch({ changes: { from: 4, insert: ' edit' } })
    await vi.advanceTimersByTimeAsync(749)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledOnce()
    expect(document.store.getState()).toMatchObject({ error: 'file-storage', dirty: true })
    document.dispatch({ changes: { from: 9, insert: ' more' } })
    await vi.advanceTimersByTimeAsync(10000)
    expect(save).toHaveBeenCalledOnce()
    await document.save()
    expect(save).toHaveBeenCalledTimes(2)
    await document.dispose()
  })
  it('bounds continuous typing autosave at five seconds', async () => {
    vi.useFakeTimers()
    const { document, save } = setup(true)
    document.dispatch({ changes: { from: 4, insert: 'x' } })
    for (let tick = 0; tick < 9; tick++) {
      await vi.advanceTimersByTimeAsync(500)
      document.dispatch({ changes: { from: 4, insert: 'x' } })
    }
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledOnce()
    await document.dispose()
  })
  it('reloads clean external changes, retains dirty edits, and guards a read that races with typing', async () => {
    const { document, bridge, changed } = setup()
    changed()
    await vi.waitFor(() => expect(document.state.doc.toString()).toBe('external'))
    document.dispatch({ changes: { from: 8, insert: ' local' } })
    changed()
    expect(document.store.getState().conflict).toBe(true)
    expect(bridge.reloadDocument).toHaveBeenCalledOnce()
    expect(document.state.doc.toString()).toBe('external local')
    const pending = deferred<Awaited<ReturnType<FileBridge['reloadDocument']>>>()
    vi.mocked(bridge.reloadDocument).mockReturnValueOnce(pending.promise)
    const reloading = document.reload()
    await vi.waitFor(() => expect(bridge.reloadDocument).toHaveBeenCalledTimes(2))
    document.dispatch({ changes: { from: 14, insert: ' typing' } })
    pending.resolve({ ok: true, value: { info, text: 'disk again' } })
    expect(await reloading).toBe(false)
    expect(document.state.doc.toString()).toBe('external local typing')
    await document.dispose()
  })
  it('cancelling a save or saving a copy retains dirty state and closing can be cancelled', async () => {
    const { document, save, bridge } = setup()
    document.dispatch({ changes: { from: 4, insert: ' draft' } })
    save.mockResolvedValueOnce({ ok: true, value: { kind: 'cancelled' } })
    expect(await document.save()).toBe(false)
    save.mockImplementationOnce(async (request: SaveRequest) => ({
      ok: true,
      value: {
        kind: 'copy',
        displayPath: '/copy.md',
        revision: request.revision,
      } satisfies SaveOutcome,
    }))
    expect(await document.save('save-copy')).toBe(true)
    expect(document.store.getState()).toMatchObject({
      dirty: true,
      info: { fingerprint: 'original' },
      copyPath: '/copy.md',
    })
    expect(await document.prepareClose()).toBe(false)
    expect(bridge.closeDocument).not.toHaveBeenCalled()
    await document.dispose()
  })
})
