import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { DocumentsController } from '../../../../src/renderer/src/documents'
import { IncomingController } from '../../../../src/renderer/src/incoming'
import type { Result } from '../../../../src/shared/contracts'
import type { FileBridge, FileSnapshot } from '../../../../src/shared/file-contracts'
import type { IncomingBridge, IncomingState } from '../../../../src/shared/incoming-contracts'

function snapshot(named = false): FileSnapshot {
  const id = randomUUID()
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
    text: named ? 'disk body' : '',
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { resolve, promise }
}
function setup() {
  const file = snapshot(true)
  const value: IncomingState = {
    requests: [
      { id: randomUUID(), name: file.info.name, displayPath: file.info.displayPath || '' },
    ],
    issue: null,
  }
  let changed = () => {}
  const bridge: FileBridge & IncomingBridge = {
    newDocument: async () => ({ ok: true, value: snapshot() }),
    openDocument: vi.fn(async () => ({ ok: true as const, value: file })),
    saveDocument: async () => ({ ok: true, value: { kind: 'cancelled' } }),
    reloadDocument: async () => ({ ok: true, value: file }),
    confirmDocumentClose: vi.fn(async () => ({ ok: true as const, value: 'discard' as const })),
    closeDocument: async () => ({ ok: true, value: null }),
    closeWindow: async () => ({ ok: true, value: null }),
    checkpoint: async () => ({ ok: true, value: null }),
    clearRecovery: async () => ({ ok: true, value: null }),
    listRecoveries: async () => ({ ok: true, value: [] }),
    restoreRecovery: async () => ({ ok: true, value: file }),
    discardRecovery: async () => ({ ok: true, value: null }),
    onCommand: () => () => {},
    onFileChanged: () => () => {},
    incomingFiles: vi.fn(async () => ({ ok: true as const, value: structuredClone(value) })),
    openIncomingFile: vi.fn(async () => {
      value.requests = []
      return { ok: true as const, value: file }
    }),
    dismissIncomingFile: vi.fn(async (id) => {
      value.requests = value.requests.filter((entry) => entry.id !== id)
      return { ok: true as const, value: null }
    }),
    onIncomingFiles: (listener) => {
      changed = listener
      return () => {}
    },
  }
  const documents = new DocumentsController(bridge),
    incoming = new IncomingController(bridge, documents)
  return { bridge, documents, incoming, file, value, changed: () => changed() }
}

describe('incoming tab lifecycle', () => {
  it('waits for a file operation, coalesces notifications, and retains an existing dirty draft', async () => {
    const { bridge, documents, incoming, changed } = setup()
    await documents.command('new')
    const draft = documents.active
    draft?.dispatch({ changes: { from: 0, insert: 'keep me' } })
    const dialog = deferred<Result<FileSnapshot | null>>()
    vi.mocked(bridge.openDocument).mockImplementationOnce(() => dialog.promise)
    const pending = documents.command('open')
    incoming.start()
    for (let index = 0; index < 20; index++) changed()
    expect(bridge.openIncomingFile).not.toHaveBeenCalled()
    dialog.resolve({ ok: true, value: null })
    await pending
    await vi.waitFor(() => expect(bridge.openIncomingFile).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(incoming.store.getState().opening).toBe(false))
    expect(documents.store.getState().documents).toHaveLength(2)
    expect(draft?.state.doc.toString()).toBe('keep me')
    expect(bridge.incomingFiles).toHaveBeenCalledTimes(1)
    await documents.command('close-window')
  })
  it('keeps failures without automatic retries and retries or dismisses only on request', async () => {
    const { bridge, documents, incoming, value, changed } = setup()
    vi.mocked(bridge.openIncomingFile).mockResolvedValueOnce({
      ok: false,
      error: 'missing',
      code: 'file-missing',
    })
    incoming.start()
    await vi.waitFor(() => expect(incoming.store.getState().failures).toHaveLength(1))
    changed()
    await vi.waitFor(() => expect(incoming.store.getState().opening).toBe(false))
    expect(bridge.openIncomingFile).toHaveBeenCalledTimes(1)
    const request = value.requests[0]
    if (!request) throw new Error('Missing request')
    incoming.retry(request.id)
    await vi.waitFor(() => expect(documents.store.getState().documents).toHaveLength(1))
    expect(incoming.store.getState().failures).toEqual([])
    value.requests = [{ ...request, id: randomUUID() }]
    vi.mocked(bridge.openIncomingFile).mockResolvedValueOnce({
      ok: false,
      error: 'missing',
      code: 'file-missing',
    })
    changed()
    await vi.waitFor(() => expect(incoming.store.getState().failures).toHaveLength(1))
    const missingId = value.requests[0]?.id || ''
    await incoming.dismiss(missingId)
    expect(bridge.dismissIncomingFile).toHaveBeenCalledWith(missingId)
    expect(incoming.store.getState().failures).toEqual([])
    await documents.command('close-window')
  })
  it('resumes incoming requests after cancelling a close decision', async () => {
    const { bridge, documents, incoming } = setup()
    await documents.command('new')
    documents.active?.dispatch({ changes: { from: 0, insert: 'draft' } })
    const decision = deferred<Result<'save' | 'discard' | 'cancel'>>()
    vi.mocked(bridge.confirmDocumentClose).mockImplementationOnce(() => decision.promise)
    const closing = documents.command('close-window')
    incoming.start()
    expect(bridge.openIncomingFile).not.toHaveBeenCalled()
    decision.resolve({ ok: true, value: 'cancel' })
    await closing
    await vi.waitFor(() => expect(documents.store.getState().documents).toHaveLength(2))
    expect(documents.store.getState().documents[0]?.state.doc.toString()).toBe('draft')
    await documents.command('close-window')
  })
})
