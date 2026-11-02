import { createStore } from 'zustand/vanilla'
import type { PluginBridge, PluginOutcome, PluginRunRequest } from '../../shared/plugin-contracts'

export type PluginSnapshot = Omit<PluginRunRequest, 'jobId' | 'pluginId' | 'commandId'>
interface PluginCommandState {
  running: boolean
  error: string | null
  result: PluginOutcome | null
}
export class DocumentPlugins {
  readonly store = createStore<PluginCommandState>(() => ({
    running: false,
    error: null,
    result: null,
  }))
  private disposed = false
  private jobId: string | null = null
  private preparing = false
  private captured: PluginSnapshot | null = null
  private applying = false
  private cancelled = false
  constructor(
    private readonly bridge: PluginBridge,
    private readonly synchronize: () => Promise<void>,
    private readonly snapshot: () => PluginSnapshot,
    private readonly applyText: (revision: number, text: string) => boolean,
  ) {}
  async run(pluginId: string, commandId: string): Promise<void> {
    if (this.disposed || this.jobId || this.preparing) return
    this.preparing = true
    this.cancelled = false
    this.captured = null
    this.store.setState({ running: true, error: null, result: null })
    try {
      await this.synchronize()
      if (this.disposed) return
      if (this.cancelled) {
        this.store.setState({ error: 'plugin-cancelled' })
        return
      }
      const captured = this.snapshot(),
        jobId = crypto.randomUUID()
      this.jobId = jobId
      const result = await this.bridge.runPlugin({ ...captured, jobId, pluginId, commandId })
      if (this.disposed || this.jobId !== jobId) return
      if (this.cancelled) this.store.setState({ error: 'plugin-cancelled' })
      else if (!result.ok) this.store.setState({ error: result.code || 'plugin-failed' })
      else if (result.value.revision !== captured.revision)
        this.store.setState({ error: 'plugin-changed' })
      else {
        this.captured = captured
        this.store.setState({ result: result.value })
      }
    } catch (error) {
      if (!this.disposed)
        this.store.setState({
          error:
            error instanceof Error && error.message === 'plugin-limit'
              ? 'plugin-limit'
              : 'plugin-failed',
        })
    } finally {
      this.preparing = false
      this.jobId = null
      if (!this.disposed) this.store.setState({ running: false })
    }
  }
  async apply(): Promise<boolean> {
    const captured = this.captured,
      result = this.store.getState().result
    if (this.disposed || this.applying || !captured || !result || result.kind !== 'transform')
      return false
    this.applying = true
    try {
      await this.synchronize()
      if (this.disposed || this.captured !== captured) return false
      const current = await this.bridge.plugins()
      const installed =
        current.ok &&
        current.value.plugins.find(
          (plugin) =>
            plugin.id === result.pluginId &&
            plugin.fingerprint === result.fingerprint &&
            plugin.enabled &&
            plugin.grants.includes('document.write'),
        )
      if (!installed) {
        this.store.setState({ error: 'plugin-unavailable' })
        return false
      }
      if (
        this.disposed ||
        this.captured !== captured ||
        !this.applyText(captured.revision, result.text)
      ) {
        this.store.setState({ error: 'plugin-changed' })
        return false
      }
      this.discard()
      return true
    } catch {
      if (!this.disposed) this.store.setState({ error: 'plugin-failed' })
      return false
    } finally {
      this.applying = false
    }
  }
  discard(): void {
    this.captured = null
    this.store.setState({ result: null, error: null })
  }
  cancel(): void {
    this.cancelled = true
    if (this.jobId) void this.bridge.cancelPlugin(this.jobId).catch(() => {})
  }
  dispose(): void {
    this.disposed = true
    this.cancel()
    this.captured = null
  }
}
