import { createStore } from 'zustand/vanilla'
import type { Result } from '../../shared/contracts'
import type {
  SyncBridge,
  SyncChoice,
  SyncConnectRequest,
  SyncCredentialRequest,
  SyncState,
} from '../../shared/sync-contracts'

interface SavedStatus {
  id: string
  path: string | null
  revision: number
  dirty: boolean
  saving: boolean
  composing: boolean
  conflict: boolean
}
export class DocumentSync {
  readonly store = createStore<{
    state: SyncState | null
    running: boolean
    error: string | null
    exported: boolean
  }>(() => ({ state: null, running: false, error: null, exported: false }))
  private disposed = false
  private active = false
  private cancelled = false
  private reviewRevision: number | null = null
  constructor(
    private readonly bridge: SyncBridge,
    private readonly synchronize: () => Promise<void>,
    private readonly snapshot: () => SavedStatus,
  ) {}
  private async perform<T>(
    operation: () => Promise<Result<T>>,
    accepted: (value: T) => Promise<void> | void,
    clean = false,
  ): Promise<void> {
    if (this.disposed || this.active) return
    this.active = true
    this.cancelled = false
    this.store.setState({ running: true, error: null, exported: false })
    try {
      if (clean) {
        await this.synchronize()
        if (this.disposed || this.cancelled) return
        const status = this.snapshot()
        if (!status.path || status.dirty || status.saving || status.composing || status.conflict) {
          this.store.setState({ error: 'sync-save-first' })
          return
        }
      }
      if (this.disposed || this.cancelled) return
      const result = await operation()
      if (this.disposed) return
      if (this.cancelled) this.store.setState({ error: 'sync-cancelled' })
      else if (!result.ok) this.store.setState({ error: result.code || 'sync-network' })
      else await accepted(result.value)
    } catch (error) {
      if (!this.disposed)
        this.store.setState({
          error: this.cancelled
            ? 'sync-cancelled'
            : error instanceof Error && error.message === 'sync-invalid'
              ? 'sync-invalid'
              : 'sync-network',
        })
    } finally {
      this.active = false
      if (!this.disposed) this.store.setState({ running: false })
    }
  }
  private accept(state: SyncState): void {
    this.store.setState({ state })
    if (!state.review) this.reviewRevision = null
  }
  load(): Promise<void> {
    return this.perform(
      () => this.bridge.syncState(this.snapshot().id),
      (value) => this.accept(value),
    )
  }
  connect(
    request:
      | Omit<Extract<SyncConnectRequest, { kind: 'folder' }>, 'documentId'>
      | Omit<Extract<SyncConnectRequest, { kind: 'webdav' }>, 'documentId'>,
  ): Promise<void> {
    return this.perform(
      () => this.bridge.connectSync({ ...request, documentId: this.snapshot().id }),
      (value) => this.accept(value),
      true,
    )
  }
  credential(request: Omit<SyncCredentialRequest, 'documentId'>): Promise<void> {
    return this.perform(
      () => this.bridge.setSyncCredential({ ...request, documentId: this.snapshot().id }),
      (value) => this.accept(value),
    )
  }
  review(): Promise<void> {
    return this.perform(
      () => this.bridge.reviewSync(this.snapshot().id),
      (value) => {
        this.accept(value)
        this.reviewRevision = value.review ? this.snapshot().revision : null
      },
      true,
    )
  }
  resolve(choice: SyncChoice): Promise<void> {
    return this.perform(
      async () => {
        const review = this.store.getState().state?.review
        if (!review || this.reviewRevision !== this.snapshot().revision)
          return { ok: false, error: '', code: 'sync-changed' }
        return this.bridge.resolveSync(review.id, choice)
      },
      (value) => this.accept(value),
      true,
    )
  }
  disconnect(): Promise<void> {
    return this.perform(
      () => this.bridge.disconnectSync(this.snapshot().id),
      (value) => this.accept(value),
    )
  }
  export(id: string): Promise<void> {
    return this.perform(
      () => this.bridge.exportSyncRecovery(id),
      (exported) => {
        this.store.setState({ exported })
      },
    )
  }
  remove(id: string): Promise<void> {
    return this.perform(
      () => this.bridge.removeSyncRecovery(id),
      async () => {
        const result = await this.bridge.syncState(this.snapshot().id)
        if (result.ok) this.accept(result.value)
        else this.store.setState({ error: result.code || 'sync-storage' })
      },
    )
  }
  cancel(): void {
    this.cancelled = true
    this.reviewRevision = null
    const state = this.store.getState().state
    if (state) this.store.setState({ state: { ...state, review: null } })
    void this.bridge.cancelSync(this.snapshot().id).catch(() => {})
  }
  dispose(): void {
    this.cancel()
    this.disposed = true
  }
}
