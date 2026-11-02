import { createStore } from 'zustand/vanilla'
import type { Result } from '../../shared/contracts'
import type {
  RestoreFile,
  WorkspaceBootstrap,
  WorkspaceBridge,
} from '../../shared/workspace-contracts'
import type { DocumentsController } from './documents'

interface WorkspaceStatus {
  value: WorkspaceBootstrap | null
  busy: boolean
  restoring: boolean
  error: string | null
  persistenceError: string | null
  failures: (RestoreFile & { code: string })[]
}
export class WorkspaceController {
  readonly store = createStore<WorkspaceStatus>(() => ({
    value: null,
    busy: true,
    restoring: true,
    error: null,
    persistenceError: null,
    failures: [],
  }))
  private startup: Promise<void> | null = null
  private enabled = false
  private pending = false
  private saving: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private activeOverride: string | null | undefined
  private readonly metadataSubscriptions = new Map<string, () => void>()
  constructor(
    private readonly bridge: WorkspaceBridge,
    private readonly documents: DocumentsController,
  ) {
    documents.store.subscribe((next, previous) => {
      for (const document of next.documents) {
        const id = document.store.getState().info.id
        if (!this.metadataSubscriptions.has(id))
          this.metadataSubscriptions.set(
            id,
            document.store.subscribe((next, previous) => {
              if (next.info.displayPath !== previous.info.displayPath) this.requestPersistence()
            }),
          )
      }
      for (const [id, unsubscribe] of this.metadataSubscriptions)
        if (!next.documents.some((document) => document.store.getState().info.id === id)) {
          unsubscribe()
          this.metadataSubscriptions.delete(id)
        }
      if (
        next.documents !== previous.documents ||
        next.activeId !== previous.activeId ||
        (!next.busy && previous.busy)
      )
        this.requestPersistence()
    })
    documents.beforeWindowClose = (activeId) => this.flush(activeId)
  }
  start(): Promise<void> {
    this.startup ??= this.load()
    return this.startup
  }
  private async load(): Promise<void> {
    this.store.setState({ busy: true, restoring: true, error: null })
    try {
      const result = await this.bridge.workspace()
      if (!result.ok) throw new Error(result.code || 'workspace-session')
      this.store.setState({ value: result.value })
      const failures = await this.documents.restoreFiles(result.value.restore, (id) =>
        this.bridge.restoreSessionFile(id),
      )
      this.store.setState({ failures })
      this.enabled = true
      this.requestPersistence()
    } catch (error) {
      this.store.setState({ error: error instanceof Error ? error.message : 'workspace-session' })
      this.startup = null
    } finally {
      this.store.setState({ busy: false, restoring: false })
    }
  }
  private async operation(load: () => Promise<Result<WorkspaceBootstrap | null>>): Promise<void> {
    if (this.store.getState().busy) return
    this.store.setState({ busy: true, error: null })
    try {
      const result = await load()
      if (!result.ok) throw new Error(result.code || 'workspace-session')
      if (result.value) this.store.setState({ value: result.value })
      if (!this.enabled && result.value) this.startup = null
    } catch (error) {
      this.store.setState({ error: error instanceof Error ? error.message : 'workspace-session' })
    } finally {
      this.store.setState({ busy: false })
    }
  }
  choose(): Promise<void> {
    return this.operation(() => this.bridge.chooseWorkspace())
  }
  recent(id: string): Promise<void> {
    return this.operation(() => this.bridge.recentWorkspace(id))
  }
  refresh(): Promise<void> {
    return this.operation(() => this.bridge.refreshWorkspace())
  }
  retry(): Promise<void> {
    return this.enabled ? this.refresh() : this.start()
  }
  async open(id: string): Promise<void> {
    await this.documents.openFile(() => this.bridge.openWorkspaceFile(id))
  }
  async retryFile(entry: RestoreFile): Promise<void> {
    const failures = await this.documents.restoreFiles([entry], (id) =>
      this.bridge.restoreSessionFile(id),
    )
    this.store.setState({
      failures: [
        ...this.store.getState().failures.filter((item) => item.id !== entry.id),
        ...failures,
      ],
    })
    this.requestPersistence()
  }
  async forgetFile(id: string): Promise<void> {
    try {
      const result = await this.bridge.forgetSessionFile(id)
      if (!result.ok) throw new Error(result.code || 'workspace-persist')
      this.store.setState({
        failures: this.store.getState().failures.filter((entry) => entry.id !== id),
      })
      this.requestPersistence()
    } catch (error) {
      this.store.setState({
        persistenceError: error instanceof Error ? error.message : 'workspace-persist',
      })
    }
  }
  private requestPersistence(): void {
    if (!this.enabled || this.store.getState().value?.readOnly) return
    this.pending = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.documents.store.getState().busy)
      this.timer = setTimeout(() => {
        this.timer = null
        void this.flush()
      }, 250)
  }
  async flush(activeId?: string | null): Promise<void> {
    if (!this.enabled || this.store.getState().value?.readOnly) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending = true
    if (activeId !== undefined) this.activeOverride = activeId
    this.saving ??= this.drain().finally(() => {
      this.saving = null
    })
    await this.saving
  }
  private async drain(): Promise<void> {
    while (this.pending) {
      this.pending = false
      const state = this.documents.store.getState()
      const activeId = this.activeOverride !== undefined ? this.activeOverride : state.activeId
      this.activeOverride = undefined
      try {
        const result = await this.bridge.rememberDocuments(
          state.documents.map((document) => document.store.getState().info.id),
          activeId,
        )
        if (!result.ok) throw new Error(result.code || 'workspace-persist')
        const value = this.store.getState().value
        this.store.setState({
          persistenceError: null,
          value: value ? { ...value, persistenceError: false } : null,
        })
      } catch (error) {
        this.store.setState({
          persistenceError: error instanceof Error ? error.message : 'workspace-persist',
        })
      }
    }
  }
}
