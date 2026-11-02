import { createStore } from 'zustand/vanilla'
import type { FileBridge, RecoveryEntry } from '../../shared/file-contracts'

type Action = 'restore' | 'discard'
interface RecoveryStatus {
  entries: RecoveryEntry[]
  loaded: boolean
  busy: boolean
  pending: { id: string; action: Action } | null
  error: { action: 'load' | Action; id?: string } | null
}

/** One recovery operation at a time. A failed read retains the last known list;
 * successful restore/discard removes only that entry before refreshing metadata.
 */
export class RecoveryController {
  readonly store = createStore<RecoveryStatus>(() => ({
    entries: [],
    loaded: false,
    busy: false,
    pending: null,
    error: null,
  }))
  constructor(
    private readonly bridge: Pick<FileBridge, 'listRecoveries' | 'discardRecovery'>,
    private readonly restoreDraft: (id: string) => Promise<boolean>,
  ) {}
  private async read(): Promise<boolean> {
    try {
      const result = await this.bridge.listRecoveries()
      if (!result.ok) throw new Error('Recovery list unavailable')
      this.store.setState({ entries: result.value, loaded: true, error: null })
      return true
    } catch {
      this.store.setState({ error: { action: 'load' } })
      return false
    }
  }
  async reload(): Promise<boolean> {
    if (this.store.getState().busy) return false
    this.store.setState({ busy: true, error: null })
    try {
      return await this.read()
    } finally {
      this.store.setState({ busy: false })
    }
  }
  async act(id: string, action: Action): Promise<boolean> {
    const state = this.store.getState()
    if (state.busy || !state.entries.some((entry) => entry.id === id)) return false
    this.store.setState({ busy: true, pending: { id, action }, error: null })
    try {
      const completed =
        action === 'restore'
          ? await this.restoreDraft(id)
          : (await this.bridge.discardRecovery(id)).ok
      if (!completed) throw new Error('Recovery action failed')
      this.store.setState({
        entries: this.store.getState().entries.filter((entry) => entry.id !== id),
      })
      await this.read()
      return true
    } catch {
      this.store.setState({ error: { id, action } })
      return false
    } finally {
      this.store.setState({ busy: false, pending: null })
    }
  }
}
