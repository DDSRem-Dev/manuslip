import { createStore } from 'zustand/vanilla'
import type { ExportBridge, ExportRequest } from '../../shared/export-contracts'
import type { PandocOptions } from '../../shared/pandoc-contracts'
import { i18next } from './i18n'

interface ExportState {
  format: ExportRequest['format'] | null
  presented: boolean
  running: boolean
  revision: number | null
  path: string | null
  error: string | null
  cancelled: boolean
  feedbackAt: number | null
  confirmation: {
    format: ExportRequest['format']
    revision: number
    layout: string
    target: string
    missing: number
    stale: boolean
  } | null
}
export type CapturedExport = Omit<ExportRequest, 'jobId' | 'format' | 'locale'> & {
  missing?: number
}
export class DocumentExport {
  readonly store = createStore<ExportState>(() => ({
    format: null,
    presented: false,
    running: false,
    revision: null,
    path: null,
    error: null,
    cancelled: false,
    feedbackAt: null,
    confirmation: null,
  }))
  private jobId: string | null = null
  private disposed = false
  private preparation: object | null = null
  private pending: { format: ExportRequest['format']; snapshot: CapturedExport } | null = null
  constructor(
    private readonly snapshot: () => CapturedExport | null,
    private readonly bridge: ExportBridge,
    private readonly synchronizeInput?: () => Promise<void>,
  ) {}
  async start(format: ExportRequest['format'], options?: PandocOptions): Promise<void> {
    if (this.disposed || this.jobId || this.pending || this.preparation) return
    this.store.setState({
      format,
      presented: false,
      error: null,
      path: null,
      cancelled: false,
      feedbackAt: null,
    })
    let pandoc: PandocOptions | undefined
    try {
      if (format === 'pandoc') {
        if (!options) throw new Error('pandoc-invalid')
        pandoc = { format: options.format, profile: options.profile }
      } else if (options !== undefined) throw new Error('pandoc-invalid')
    } catch {
      this.feedback({ error: 'pandoc-invalid' })
      return
    }
    if (this.synchronizeInput) {
      const preparation = {}
      this.preparation = preparation
      this.feedback({
        running: true,
        revision: null,
        error: null,
        path: null,
        cancelled: false,
      })
      try {
        await this.synchronizeInput()
      } catch {
        if (!this.disposed && this.preparation === preparation) {
          this.preparation = null
          this.feedback({ running: false, error: 'export-render' })
        }
        return
      }
      if (this.disposed || this.preparation !== preparation) return
      this.preparation = null
    }
    let snapshot: CapturedExport | null
    try {
      snapshot = this.snapshot()
      if (snapshot && pandoc) snapshot = { ...snapshot, pandoc }
    } catch (error) {
      this.feedback({
        running: false,
        error:
          error instanceof Error && error.message === 'export-reading-empty'
            ? 'export-reading-empty'
            : 'export-limit',
        path: null,
      })
      return
    }
    if (!snapshot) {
      this.feedback({ running: false, error: 'export-composing' })
      return
    }
    if (snapshot.reading && (snapshot.reading.stale || (snapshot.missing ?? 0) > 0)) {
      this.pending = { format, snapshot }
      this.store.setState({
        running: false,
        feedbackAt: null,
        confirmation: {
          format,
          revision: snapshot.revision,
          layout: snapshot.reading.layout,
          target: snapshot.reading.targetLanguage,
          missing: snapshot.missing ?? 0,
          stale: snapshot.reading.stale,
        },
        error: null,
        path: null,
        cancelled: false,
      })
      return
    }
    await this.run(format, snapshot)
  }
  async confirm(): Promise<void> {
    const pending = this.pending
    if (!pending || this.disposed || this.jobId) return
    this.pending = null
    const reading = pending.snapshot.reading
    await this.run(pending.format, {
      ...pending.snapshot,
      ...(reading ? { reading: { ...reading, missing: 'source', confirmed: true } } : {}),
    })
  }
  cancelConfirmation(): void {
    this.pending = null
    this.feedback({ confirmation: null, cancelled: true })
  }
  private async run(format: ExportRequest['format'], snapshot: CapturedExport): Promise<void> {
    const jobId = crypto.randomUUID()
    this.jobId = jobId
    this.feedback({
      running: true,
      revision: snapshot.revision,
      path: null,
      error: null,
      cancelled: false,
      confirmation: null,
      format,
      presented: false,
    })
    try {
      const { missing: _missing, ...request } = snapshot
      const result = await this.bridge.exportDocument({
        ...request,
        jobId,
        format,
        locale: i18next.language === 'zh-CN' ? 'zh-CN' : 'en',
      })
      if (this.disposed || this.jobId !== jobId) return
      if (!result.ok) this.feedback({ error: result.code || 'export-render' })
      else if (result.value.kind === 'exported') this.feedback({ path: result.value.path })
      else if (result.value.kind === 'presented') this.feedback({ presented: true })
      else this.feedback({ cancelled: true })
    } catch (error) {
      if (!this.disposed)
        this.feedback({
          error:
            error instanceof Error && error.message === 'export-limit'
              ? 'export-limit'
              : 'export-render',
        })
    } finally {
      if (this.jobId === jobId) this.jobId = null
      if (!this.disposed) this.store.setState({ running: false })
    }
  }
  private feedback(state: Partial<ExportState>): void {
    this.store.setState({ ...state, feedbackAt: Date.now() })
  }
  cancel(): void {
    if (this.preparation) {
      this.preparation = null
      this.feedback({ running: false, cancelled: true })
    }
    if (this.pending) this.cancelConfirmation()
    if (this.jobId) void this.bridge.cancelExport(this.jobId).catch(() => {})
  }
  dispose(): void {
    this.disposed = true
    this.cancel()
  }
}
