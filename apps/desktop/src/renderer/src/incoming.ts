import { createStore } from 'zustand/vanilla'
import type {
  IncomingBridge,
  IncomingRequest,
  IncomingState,
} from '../../shared/incoming-contracts'
import type { DocumentsController } from './documents'

interface IncomingStatus {
  failures: (IncomingRequest & { code: string })[]
  issue: IncomingState['issue']
  error: string | null
  opening: boolean
}
/** Pull metadata after startup; serialize body reads through the existing tab lifecycle. */
export class IncomingController {
  readonly store = createStore<IncomingStatus>(() => ({
    failures: [],
    issue: null,
    error: null,
    opening: false,
  }))
  private started = false
  private requested = false
  private running = false
  private waiting = false
  constructor(
    private readonly bridge: IncomingBridge,
    private readonly documents: DocumentsController,
  ) {}
  start(): void {
    if (this.started) return
    this.started = true
    this.bridge.onIncomingFiles(() => this.refresh())
    this.documents.store.subscribe((next, previous) => {
      if (!next.busy && previous.busy && this.waiting) {
        this.waiting = false
        this.refresh()
      }
    })
    this.refresh()
  }
  refresh(): void {
    this.requested = true
    if (this.documents.store.getState().busy) {
      this.waiting = true
      return
    }
    if (!this.running) void this.drain()
  }
  retry(id: string): void {
    this.store.setState({
      failures: this.store.getState().failures.filter((entry) => entry.id !== id),
    })
    this.refresh()
  }
  async dismiss(id: string | null): Promise<void> {
    try {
      const result = await this.bridge.dismissIncomingFile(id)
      if (!result.ok) throw new Error('file-io')
      this.store.setState({
        failures: this.store.getState().failures.filter((entry) => entry.id !== id),
        ...(id === null ? { issue: null } : {}),
      })
      this.refresh()
    } catch {
      this.store.setState({ error: 'incomingRetry' })
    }
  }
  private async drain(): Promise<void> {
    this.running = true
    this.store.setState({ opening: true, error: null })
    try {
      while (this.requested) {
        this.requested = false
        const result = await this.bridge.incomingFiles()
        if (!result.ok) throw new Error('incomingRetry')
        const requests = result.value.requests
        this.store.setState({
          issue: result.value.issue,
          failures: this.store
            .getState()
            .failures.filter((entry) => requests.some((request) => request.id === entry.id)),
        })
        for (const request of requests) {
          if (this.store.getState().failures.some((entry) => entry.id === request.id)) continue
          let code = 'file-io'
          const opened = await this.documents.openFile(async () => {
            const result = await this.bridge.openIncomingFile(request.id)
            if (!result.ok) code = result.code || 'file-io'
            return result
          }, false)
          if (opened === null) {
            this.waiting = true
            break
          }
          if (!opened)
            this.store.setState({
              failures: [...this.store.getState().failures, { ...request, code }],
            })
        }
      }
    } catch {
      this.store.setState({ error: 'incomingRetry' })
    } finally {
      this.running = false
      this.store.setState({ opening: false })
    }
  }
}
