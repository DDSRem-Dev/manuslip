import { expect, it, vi } from 'vitest'
import { DocumentPlugins } from '../../../../src/renderer/src/plugins'
import type {
  PluginBridge,
  PluginOutcome,
  PluginRunRequest,
} from '../../../../src/shared/plugin-contracts'

const outcome = (): PluginOutcome => ({
  kind: 'transform',
  text: 'Proposed',
  revision: 1,
  pluginId: 'example.tools',
  fingerprint: 'a'.repeat(64),
})
function setup() {
  let revision = 1,
    text = 'Original',
    reply: (value: { ok: true; value: PluginOutcome }) => void = () => {}
  const runPlugin = vi.fn(
    (_input: PluginRunRequest) =>
      new Promise<{ ok: true; value: PluginOutcome }>((resolve) => {
        reply = resolve
      }),
  )
  const plugins = vi.fn(async () => ({
    ok: true,
    value: {
      plugins: [
        {
          id: 'example.tools',
          fingerprint: 'a'.repeat(64),
          enabled: true,
          grants: ['document.write'],
        },
      ],
      recovered: false,
      readOnly: false,
    },
  }))
  const cancelPlugin = vi.fn(async () => ({ ok: true, value: null }))
  const apply = vi.fn((captured: number, value: string) => {
    if (revision !== captured) return false
    text = value
    revision++
    return true
  })
  const synchronize = vi.fn(async () => {})
  const controller = new DocumentPlugins(
    { runPlugin, plugins, cancelPlugin } as unknown as PluginBridge,
    synchronize,
    () => ({
      documentId: crypto.randomUUID(),
      revision,
      text,
      selections: [{ anchor: 1, head: 2 }],
    }),
    apply,
  )
  return {
    controller,
    runPlugin,
    plugins,
    cancelPlugin,
    synchronize,
    apply,
    edit: () => {
      revision++
      text = 'Later'
    },
    text: () => text,
    reply: (value = outcome()) => reply({ ok: true, value }),
  }
}
it('captures pending input once and keeps a proposal inert until explicit apply', async () => {
  const value = setup(),
    running = value.controller.run('example.tools', 'trim')
  await vi.waitFor(() => expect(value.runPlugin).toHaveBeenCalledOnce())
  value.reply()
  await running
  expect(value.text()).toBe('Original')
  expect(value.runPlugin.mock.calls[0]?.[0]).toMatchObject({
    revision: 1,
    text: 'Original',
    selections: [{ anchor: 1, head: 2 }],
  })
  expect(await value.controller.apply()).toBe(true)
  expect(value.text()).toBe('Proposed')
  expect(value.apply).toHaveBeenCalledOnce()
  expect(await value.controller.apply()).toBe(false)
})
it('rejects late revision and revoked installation results without changing source', async () => {
  const value = setup(),
    running = value.controller.run('example.tools', 'trim')
  await vi.waitFor(() => expect(value.runPlugin).toHaveBeenCalledOnce())
  value.edit()
  value.reply()
  await running
  expect(await value.controller.apply()).toBe(false)
  expect(value.text()).toBe('Later')
  expect(value.controller.store.getState().error).toBe('plugin-changed')
  const revoked = setup(),
    second = revoked.controller.run('example.tools', 'trim')
  await vi.waitFor(() => expect(revoked.runPlugin).toHaveBeenCalledOnce())
  revoked.reply()
  await second
  revoked.plugins.mockResolvedValueOnce({
    ok: true,
    value: { plugins: [], recovered: false, readOnly: false },
  })
  expect(await revoked.controller.apply()).toBe(false)
  expect(revoked.apply).not.toHaveBeenCalled()
})
it('keeps cancellation charged until settlement and ignores results after disposal', async () => {
  const value = setup(),
    running = value.controller.run('example.tools', 'trim')
  await vi.waitFor(() => expect(value.runPlugin).toHaveBeenCalledOnce())
  value.controller.cancel()
  await value.controller.run('example.tools', 'trim')
  expect(value.runPlugin).toHaveBeenCalledOnce()
  expect(value.controller.store.getState().running).toBe(true)
  expect(value.cancelPlugin).toHaveBeenCalledOnce()
  value.controller.dispose()
  value.reply()
  await running
  expect(value.apply).not.toHaveBeenCalled()
  expect(value.controller.store.getState().result).toBeNull()
})
it('cancels pending input settlement before capturing or sending any source', async () => {
  const value = setup()
  let settle!: () => void
  value.synchronize.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve
      }),
  )
  const running = value.controller.run('example.tools', 'trim')
  value.controller.cancel()
  settle()
  await running
  expect(value.runPlugin).not.toHaveBeenCalled()
  expect(value.controller.store.getState()).toMatchObject({
    running: false,
    result: null,
    error: 'plugin-cancelled',
  })
})
it('checks permission after pending input settles before applying a reviewed proposal', async () => {
  const value = setup(),
    running = value.controller.run('example.tools', 'trim')
  await vi.waitFor(() => expect(value.runPlugin).toHaveBeenCalledOnce())
  value.reply()
  await running
  let settle!: () => void
  value.synchronize.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve
      }),
  )
  const applying = value.controller.apply()
  await Promise.resolve()
  expect(value.plugins).not.toHaveBeenCalled()
  value.plugins.mockResolvedValueOnce({
    ok: true,
    value: { plugins: [], recovered: false, readOnly: false },
  })
  settle()
  expect(await applying).toBe(false)
  expect(value.apply).not.toHaveBeenCalled()
  expect(value.text()).toBe('Original')
  expect(value.controller.store.getState().error).toBe('plugin-unavailable')
})
