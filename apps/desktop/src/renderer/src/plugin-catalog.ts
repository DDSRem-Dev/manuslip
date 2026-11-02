import { createStore } from 'zustand/vanilla'
import type { PluginBridge, PluginState } from '../../shared/plugin-contracts'

export const pluginCatalog = createStore<PluginState | null>(() => null)
let generation = 0

export function publishPluginState(state: PluginState): void {
  generation++
  pluginCatalog.setState(state, true)
}

export async function loadPluginCatalog(bridge: Pick<PluginBridge, 'plugins'>): Promise<void> {
  const request = ++generation
  try {
    const result = await bridge.plugins()
    if (request === generation) pluginCatalog.setState(result.ok ? result.value : null, true)
  } catch {
    if (request === generation) pluginCatalog.setState(null, true)
  }
}
