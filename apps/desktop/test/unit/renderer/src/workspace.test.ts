import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentsController } from '../../../../src/renderer/src/documents'
import { WorkspaceController } from '../../../../src/renderer/src/workspace'
import type { Result } from '../../../../src/shared/contracts'
import type { FileBridge, FileSnapshot } from '../../../../src/shared/file-contracts'
import type {
  WorkspaceBootstrap,
  WorkspaceBridge,
} from '../../../../src/shared/workspace-contracts'

function snapshot(id = randomUUID(), named = true): FileSnapshot {
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
    text: named ? 'body' : '',
  }
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function setup() {
  const a = snapshot(),
    b = snapshot()
  const value: WorkspaceBootstrap = {
    root: null,
    recents: [],
    restore: [a, b].map((file, index) => ({
      id: file.info.id,
      name: file.info.name,
      displayPath: file.info.displayPath || '',
      active: index === 0,
    })),
    recovered: false,
    readOnly: false,
    missingRoot: false,
    persistenceError: false,
  }
  const bridge: FileBridge & WorkspaceBridge = {
    newDocument: async () => ({ ok: true, value: snapshot(randomUUID(), false) }),
    openDocument: async () => ({ ok: true, value: a }),
    saveDocument: async () => ({ ok: true, value: { kind: 'cancelled' } }),
    reloadDocument: async () => ({ ok: true, value: a }),
    confirmDocumentClose: async () => ({ ok: true, value: 'discard' }),
    closeDocument: vi.fn(async () => ({ ok: true as const, value: null })),
    closeWindow: vi.fn(async () => ({ ok: true as const, value: null })),
    checkpoint: async () => ({ ok: true, value: null }),
    clearRecovery: async () => ({ ok: true, value: null }),
    listRecoveries: async () => ({ ok: true, value: [] }),
    restoreRecovery: async () => ({ ok: true, value: a }),
    discardRecovery: async () => ({ ok: true, value: null }),
    onCommand: () => () => {},
    onFileChanged: () => () => {},
    workspace: vi.fn(async () => ({ ok: true as const, value })),
    chooseWorkspace: async () => ({ ok: true, value }),
    recentWorkspace: async () => ({ ok: true, value }),
    refreshWorkspace: async () => ({ ok: true, value }),
    listWorkspace: async () => ({
      ok: true,
      value: { nodes: [], next: null, truncated: false, skippedLinks: false },
    }),
    openWorkspaceFile: async () => ({ ok: true, value: a }),
    restoreSessionFile: vi.fn(async (id) => ({
      ok: true as const,
      value: id === a.info.id ? a : b,
    })),
    forgetSessionFile: vi.fn(async () => ({ ok: true as const, value: null })),
    rememberDocuments: vi.fn(async () => ({ ok: true as const, value: null })),
  }
  const documents = new DocumentsController(bridge)
  const workspace = new WorkspaceController(bridge, documents)
  return { a, b, value, bridge, documents, workspace }
}
afterEach(() => vi.useRealTimers())

describe('renderer session restoration', () => {
  it('never publishes a partial restored session and preserves an existing dirty draft', async () => {
    vi.useFakeTimers()
    const { a, b, bridge, documents, workspace } = setup()
    await documents.command('new')
    const draft = documents.active
    draft?.dispatch({ changes: { from: 0, insert: 'keep draft' } })
    const second = deferred<Result<FileSnapshot>>()
    vi.mocked(bridge.restoreSessionFile)
      .mockImplementationOnce(async () => ({ ok: true, value: a }))
      .mockImplementationOnce(() => second.promise)
    const loading = workspace.start()
    for (let index = 0; index < 12; index++) await Promise.resolve()
    expect(bridge.restoreSessionFile).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(500)
    expect(bridge.rememberDocuments).not.toHaveBeenCalled()
    second.resolve({ ok: true, value: b })
    await loading
    expect(documents.active).toBe(draft)
    expect(draft?.state.doc.toString()).toBe('keep draft')
    await vi.advanceTimersByTimeAsync(250)
    expect(bridge.rememberDocuments).toHaveBeenLastCalledWith(
      documents.store.getState().documents.map((document) => document.store.getState().info.id),
      draft?.store.getState().info.id,
    )
    await documents.command('close-window')
  })
  it('flushes the original active tab before disposing any sessions on window close', async () => {
    vi.useFakeTimers()
    const { a, b, documents, bridge, workspace } = setup()
    await workspace.start()
    expect(documents.store.getState().activeId).toBe(a.info.id)
    const gate = deferred<Result<null>>()
    vi.mocked(bridge.rememberDocuments).mockImplementationOnce(() => gate.promise)
    const closing = documents.command('close-window')
    for (let index = 0; index < 16; index++) await Promise.resolve()
    expect(bridge.rememberDocuments).toHaveBeenCalledWith([a.info.id, b.info.id], a.info.id)
    expect(bridge.closeDocument).not.toHaveBeenCalled()
    gate.resolve({ ok: true, value: null })
    await closing
    expect(bridge.closeDocument).toHaveBeenCalledTimes(2)
    expect(bridge.closeWindow).toHaveBeenCalledWith(true)
  })
  it('keeps a failed restoration visible until retry succeeds or forgetting is acknowledged', async () => {
    vi.useFakeTimers()
    const { a, bridge, documents, workspace } = setup()
    vi.mocked(bridge.restoreSessionFile).mockResolvedValueOnce({
      ok: false,
      error: 'Missing',
      code: 'file-missing',
    })
    await workspace.start()
    expect(workspace.store.getState().failures[0]?.code).toBe('file-missing')
    const missing = workspace.store.getState().failures[0]
    if (!missing) throw new Error('Missing failure')
    await workspace.retryFile(missing)
    expect(workspace.store.getState().failures).toEqual([])
    expect(
      documents.store
        .getState()
        .documents.some((document) => document.store.getState().info.id === a.info.id),
    ).toBe(true)
    await documents.command('close-window')
  })
  it('exposes persistence failures without blocking editing or silently marking them saved', async () => {
    vi.useFakeTimers()
    const { bridge, documents, workspace } = setup()
    await workspace.start()
    vi.mocked(bridge.rememberDocuments).mockResolvedValueOnce({
      ok: false,
      error: 'Disk full',
      code: 'workspace-persist',
    })
    await workspace.flush()
    expect(workspace.store.getState().persistenceError).toBe('workspace-persist')
    documents.active?.dispatch({ changes: { from: 4, insert: ' writing' } })
    expect(documents.active?.state.doc.toString()).toBe('body writing')
    await workspace.flush()
    expect(workspace.store.getState().persistenceError).toBeNull()
    await documents.command('close-window')
  })
})
