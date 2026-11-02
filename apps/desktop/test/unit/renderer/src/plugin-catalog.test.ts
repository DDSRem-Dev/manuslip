import { expect, it } from 'vitest'
import {
  loadPluginCatalog,
  pluginCatalog,
  publishPluginState,
} from '../../../../src/renderer/src/plugin-catalog'
import type { Result } from '../../../../src/shared/contracts'
import type { PluginState } from '../../../../src/shared/plugin-contracts'

it('keeps a catalog change when an earlier loading request finishes later', async () => {
  let finish!: (result: Result<PluginState>) => void
  const pending = loadPluginCatalog({
    plugins: () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  })
  const removed: PluginState = { plugins: [], readOnly: false, recovered: false }
  publishPluginState(removed)
  finish({ ok: true, value: { ...removed, readOnly: true } })
  await pending
  expect(pluginCatalog.getState()).toEqual(removed)
})

it('hides a previously available catalog if loading fails', async () => {
  publishPluginState({ plugins: [], readOnly: false, recovered: false })
  await loadPluginCatalog({ plugins: async () => ({ ok: false, error: 'Unavailable' }) })
  expect(pluginCatalog.getState()).toBeNull()
  await loadPluginCatalog({
    plugins: async () => {
      throw new Error('Disconnected')
    },
  })
  expect(pluginCatalog.getState()).toBeNull()
})
