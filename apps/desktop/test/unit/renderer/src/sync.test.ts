import { expect, it, vi } from 'vitest'
import { DocumentSync } from '../../../../src/renderer/src/sync'
import type { Result } from '../../../../src/shared/contracts'
import type { SyncBridge, SyncState } from '../../../../src/shared/sync-contracts'
import { parseSyncConnect } from '../../../../src/shared/sync-contracts'

function setup() {
  const status = {
    id: crypto.randomUUID(),
    path: 'Saved.md' as string | null,
    revision: 1,
    dirty: false,
    saving: false,
    composing: false,
    conflict: false,
  }
  const state: SyncState = {
    connection: null,
    review: {
      id: crypto.randomUUID(),
      kind: 'download',
      reason: null,
      localBytes: 1,
      remoteBytes: 2,
      localPreview: 'A',
      remotePreview: 'B',
      canUpload: true,
      expiresAt: Date.now() + 10000,
    },
    copies: [],
    recoveryBlocked: false,
    recovered: false,
    readOnly: false,
    busy: false,
  }
  const result = async (): Promise<Result<SyncState>> => ({ ok: true, value: state })
  const bridge: SyncBridge = {
    syncState: vi.fn(result),
    connectSync: vi.fn(result),
    setSyncCredential: vi.fn(result),
    reviewSync: vi.fn(result),
    resolveSync: vi.fn(result),
    cancelSync: vi.fn(async (): Promise<Result<null>> => ({ ok: true, value: null })),
    disconnectSync: vi.fn(result),
    exportSyncRecovery: vi.fn(async (): Promise<Result<boolean>> => ({ ok: true, value: true })),
    removeSyncRecovery: vi.fn(async (): Promise<Result<null>> => ({ ok: true, value: null })),
  }
  const synchronize = vi.fn(async () => {}),
    controller = new DocumentSync(bridge, synchronize, () => status)
  return { status, state, bridge, synchronize, controller }
}
it('waits for input synchronization and refuses dirty, unnamed, composing and conflicted source', async () => {
  for (const patch of [
    { dirty: true },
    { path: null },
    { composing: true },
    { conflict: true },
    { saving: true },
  ]) {
    const value = setup()
    value.synchronize.mockImplementation(async () => {
      Object.assign(value.status, patch)
    })
    await value.controller.review()
    expect(value.bridge.reviewSync).not.toHaveBeenCalled()
    expect(value.controller.store.getState().error).toBe('sync-save-first')
  }
})
it('cancels preparation without issuing a later request and keeps that preparation charged', async () => {
  const value = setup()
  let release: () => void = () => {}
  value.synchronize.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  )
  const pending = value.controller.review()
  value.controller.cancel()
  await value.controller.review()
  expect(value.synchronize).toHaveBeenCalledOnce()
  release()
  await pending
  expect(value.bridge.reviewSync).not.toHaveBeenCalled()
  expect(value.controller.store.getState().running).toBe(false)
})
it('refuses applying a review to a newer revision even when that revision was saved', async () => {
  const value = setup()
  await value.controller.review()
  value.status.revision++
  await value.controller.resolve('download')
  expect(value.bridge.resolveSync).not.toHaveBeenCalled()
  expect(value.controller.store.getState().error).toBe('sync-changed')
})
it('keeps explicit offline errors visible while a fresh review can retry', async () => {
  const value = setup()
  vi.mocked(value.bridge.reviewSync).mockResolvedValueOnce({
    ok: false,
    code: 'sync-network',
    error: 'Unavailable',
  })
  await value.controller.review()
  expect(value.controller.store.getState().error).toBe('sync-network')
  await value.controller.review()
  expect(value.controller.store.getState()).toMatchObject({
    error: null,
    running: false,
    state: { review: value.state.review },
  })
})
it('reports strict preload input failures without mislabeling them as network outages', async () => {
  const value = setup()
  vi.mocked(value.bridge.connectSync).mockImplementation(async (request) => {
    parseSyncConnect(request)
    return { ok: true, value: value.state }
  })
  for (const request of [
    { kind: 'folder' as const, filename: '../other.md' },
    { kind: 'webdav' as const, url: 'http://example.com/writing.md' },
  ]) {
    await value.controller.connect(request)
    expect(value.controller.store.getState()).toMatchObject({
      error: 'sync-invalid',
      running: false,
      state: null,
    })
  }
  await value.controller.connect({ kind: 'folder', filename: 'writing.md' })
  expect(value.controller.store.getState()).toMatchObject({ error: null, state: value.state })
})
it('retains cancellation if a pending bridge request later rejects', async () => {
  const value = setup()
  let rejectRequest: (error: Error) => void = () => {}
  vi.mocked(value.bridge.syncState).mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectRequest = reject
      }),
  )
  const pending = value.controller.load()
  value.controller.cancel()
  rejectRequest(new Error('Unavailable'))
  await pending
  expect(value.controller.store.getState()).toMatchObject({
    error: 'sync-cancelled',
    running: false,
  })
})
