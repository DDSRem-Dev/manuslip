import { expect, it, vi } from 'vitest'
import { RecoveryController } from '../../../../src/renderer/src/recovery'
import type { FileBridge, RecoveryEntry } from '../../../../src/shared/file-contracts'

const entry: RecoveryEntry = {
  id: 'draft',
  name: '世界.md',
  displayPath: '/世界.md',
  bytes: 20,
  revision: 2,
  savedAt: 1000,
}
const failure = { ok: false as const, code: 'recovery-io', error: 'PRIVATE_STORAGE_ERROR' }
function setup() {
  const bridge: Pick<FileBridge, 'listRecoveries' | 'discardRecovery'> = {
    listRecoveries: vi.fn(async () => ({ ok: true as const, value: [entry] })),
    discardRecovery: vi.fn(async () => ({ ok: true as const, value: null })),
  }
  const restore = vi.fn(async () => true)
  return { bridge, restore, controller: new RecoveryController(bridge, restore) }
}
it.each(['result', 'rejection'] as const)(
  'allows explicit reload after a list %s failure without leaking native errors',
  async (mode) => {
    const { bridge, controller } = setup()
    if (mode === 'result') vi.mocked(bridge.listRecoveries).mockResolvedValueOnce(failure)
    else vi.mocked(bridge.listRecoveries).mockRejectedValueOnce(new Error('PRIVATE_STORAGE_ERROR'))
    expect(await controller.reload()).toBe(false)
    expect(controller.store.getState()).toMatchObject({
      busy: false,
      loaded: false,
      error: { action: 'load' },
    })
    expect(JSON.stringify(controller.store.getState())).not.toContain('PRIVATE_')
    expect(await controller.reload()).toBe(true)
    expect(controller.store.getState()).toMatchObject({
      busy: false,
      loaded: true,
      entries: [entry],
      error: null,
    })
  },
)
it('keeps the visible list when a later metadata read fails', async () => {
  const { bridge, controller } = setup()
  await controller.reload()
  vi.mocked(bridge.listRecoveries).mockResolvedValueOnce(failure)
  await controller.reload()
  expect(controller.store.getState()).toMatchObject({
    entries: [entry],
    loaded: true,
    error: { action: 'load' },
  })
})
it('has one active operation and no queue while a list is pending', async () => {
  const { bridge, restore, controller } = setup()
  let release!: (value: Awaited<ReturnType<FileBridge['listRecoveries']>>) => void
  vi.mocked(bridge.listRecoveries).mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve
    }),
  )
  const pending = controller.reload()
  expect(await controller.reload()).toBe(false)
  expect(await controller.act(entry.id, 'restore')).toBe(false)
  expect(restore).not.toHaveBeenCalled()
  expect(bridge.listRecoveries).toHaveBeenCalledTimes(1)
  release({ ok: true, value: [entry] })
  expect(await pending).toBe(true)
})
it.each(['restore', 'discard'] as const)('does not submit an unknown %s target', async (action) => {
  const { bridge, restore, controller } = setup()
  await controller.reload()
  expect(await controller.act('unknown', action)).toBe(false)
  expect(restore).not.toHaveBeenCalled()
  expect(bridge.discardRecovery).not.toHaveBeenCalled()
})
it.each(['restore', 'discard'] as const)(
  'preserves the entry after a failed %s and allows an explicit retry',
  async (action) => {
    const { bridge, restore, controller } = setup()
    await controller.reload()
    if (action === 'restore') restore.mockResolvedValueOnce(false)
    else vi.mocked(bridge.discardRecovery).mockResolvedValueOnce(failure)
    expect(await controller.act(entry.id, action)).toBe(false)
    expect(controller.store.getState()).toMatchObject({
      busy: false,
      entries: [entry],
      error: { action, id: entry.id },
    })
    vi.mocked(bridge.listRecoveries).mockResolvedValueOnce({ ok: true, value: [] })
    expect(await controller.act(entry.id, action)).toBe(true)
    expect(controller.store.getState()).toMatchObject({
      busy: false,
      pending: null,
      entries: [],
      error: null,
    })
  },
)
it.each(['restore', 'discard'] as const)(
  'preserves completion of %s when its following list refresh fails',
  async (action) => {
    const { bridge, controller } = setup()
    await controller.reload()
    vi.mocked(bridge.listRecoveries).mockResolvedValueOnce(failure)
    expect(await controller.act(entry.id, action)).toBe(true)
    expect(controller.store.getState()).toMatchObject({
      busy: false,
      entries: [],
      error: { action: 'load' },
      pending: null,
    })
  },
)
it.each(['restore', 'discard'] as const)(
  'closes pending %s state when its IPC call rejects',
  async (action) => {
    const { bridge, restore, controller } = setup()
    await controller.reload()
    if (action === 'restore') restore.mockRejectedValueOnce(new Error('PRIVATE_RESTORE'))
    else vi.mocked(bridge.discardRecovery).mockRejectedValueOnce(new Error('PRIVATE_DISCARD'))
    expect(await controller.act(entry.id, action)).toBe(false)
    expect(controller.store.getState()).toMatchObject({
      busy: false,
      pending: null,
      entries: [entry],
      error: { action, id: entry.id },
    })
    expect(JSON.stringify(controller.store.getState())).not.toContain('PRIVATE_')
  },
)
it('blocks duplicate discard and reload while durable removal is pending', async () => {
  const { bridge, controller } = setup()
  await controller.reload()
  let release!: (value: Awaited<ReturnType<FileBridge['discardRecovery']>>) => void
  vi.mocked(bridge.discardRecovery).mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve
    }),
  )
  const pending = controller.act(entry.id, 'discard')
  expect(controller.store.getState()).toMatchObject({
    busy: true,
    pending: { id: entry.id, action: 'discard' },
  })
  expect(await controller.act(entry.id, 'discard')).toBe(false)
  expect(await controller.reload()).toBe(false)
  expect(bridge.discardRecovery).toHaveBeenCalledTimes(1)
  vi.mocked(bridge.listRecoveries).mockResolvedValueOnce({ ok: true, value: [] })
  release({ ok: true, value: null })
  expect(await pending).toBe(true)
})
