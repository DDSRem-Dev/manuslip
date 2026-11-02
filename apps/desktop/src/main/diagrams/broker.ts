import { checkDiagramSource, type DiagramRequest, diagramLimits } from '@manuslip/renderer/diagram'
import { FileOperationError } from '../files/errors'

export interface DiagramHost {
  render(request: DiagramRequest): Promise<string>
  destroy(): void
}
interface Job {
  request: DiagramRequest
  valid: boolean
  stopped?: boolean
  resolve(svg: string): void
  reject(error: Error): void
}
export interface HostFactory {
  create(): Promise<DiagramHost>
  destroy(): void
}
/** Main owns deadlines; a blocked DOM renderer cannot block this scheduler. */
export class DiagramBroker {
  private pending: Job[] = []
  private current: Job | null = null
  private host: DiagramHost | null = null
  private failures: number[] = []
  private closed = false
  private cacheBytes = 0
  private readonly cache = new Map<string, string>()
  constructor(
    private readonly factory: HostFactory,
    private readonly capacity: () => void,
  ) {}

  render(request: DiagramRequest): Promise<string> {
    if (this.closed) return Promise.reject(new FileOperationError('diagram-cancelled'))
    try {
      checkDiagramSource(request.source)
    } catch (error) {
      return Promise.reject(
        new FileOperationError(
          error instanceof Error && error.message === 'diagram-config'
            ? 'diagram-config'
            : 'diagram-limit',
        ),
      )
    }
    if (request.retry) this.failures = []
    this.failures = this.failures.filter((time) => Date.now() - time < diagramLimits.restartWindow)
    if (this.failures.length > diagramLimits.restarts)
      return Promise.reject(new FileOperationError('diagram-paused'))
    const same = (job: Job): boolean =>
      job.request.documentId === request.documentId &&
      job.request.occurrenceId === request.occurrenceId
    this.pending = this.pending.filter((job) => {
      if (!same(job)) return true
      job.valid = false
      job.reject(new FileOperationError('diagram-cancelled'))
      return false
    })
    if (this.current && same(this.current)) {
      this.current.valid = false
      this.current.reject(new FileOperationError('diagram-cancelled'))
    }
    const key = JSON.stringify([request.syntax ?? 'mermaid', request.theme, request.source])
    const cached = this.cache.get(key)
    if (cached) {
      this.cache.delete(key)
      this.cache.set(key, cached)
      return Promise.resolve(cached)
    }
    if (this.pending.length >= diagramLimits.pending)
      return Promise.reject(new FileOperationError('diagram-busy'))
    return new Promise((resolve, reject) => {
      this.pending.push({ request, valid: true, resolve, reject })
      this.pump()
    })
  }
  cancel(jobId: string): void {
    const cancel = (job: Job): void => {
      job.valid = false
      job.reject(new FileOperationError('diagram-cancelled'))
    }
    this.pending = this.pending.filter((job) => {
      if (job.request.jobId !== jobId) return true
      cancel(job)
      return false
    })
    if (this.current?.request.jobId === jobId) cancel(this.current)
    this.capacity()
  }
  closeDocument(documentId: string): void {
    for (const job of [...this.pending, ...(this.current ? [this.current] : [])])
      if (job.request.documentId === documentId) this.cancel(job.request.jobId)
    if (this.current?.request.documentId === documentId) {
      this.current.stopped = true
      this.factory.destroy()
      this.host = null
    }
  }
  private pump(): void {
    if (this.current || this.closed) return
    this.failures = this.failures.filter((time) => Date.now() - time < diagramLimits.restartWindow)
    if (this.failures.length > diagramLimits.restarts) {
      for (const job of this.pending) job.reject(new FileOperationError('diagram-paused'))
      this.pending = []
      return
    }
    const index = this.pending.findIndex((job) => job.request.priority === 'visible')
    const job = this.pending.splice(Math.max(index, 0), 1)[0]
    if (!job) return
    this.current = job
    void this.run(job)
  }
  private async run(job: Job): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const svg = await Promise.race([
        (async () => {
          this.host ??= await this.factory.create()
          if (this.closed) throw new FileOperationError('diagram-cancelled')
          return this.host.render(job.request)
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new FileOperationError('diagram-timeout')),
            diagramLimits.timeout,
          )
        }),
      ])
      if (Buffer.byteLength(svg) > diagramLimits.svg) throw new FileOperationError('diagram-limit')
      if (job.valid && !this.closed) {
        const key = JSON.stringify([
          job.request.syntax ?? 'mermaid',
          job.request.theme,
          job.request.source,
        ])
        const weight = (key.length + svg.length) * 2
        while (this.cacheBytes + weight > diagramLimits.cache && this.cache.size) {
          const first = this.cache.entries().next().value
          if (!first) break
          this.cacheBytes -= (first[0].length + first[1].length) * 2
          this.cache.delete(first[0])
        }
        if (weight <= diagramLimits.cache) {
          this.cache.set(key, svg)
          this.cacheBytes += weight
        }
        job.resolve(svg)
      }
    } catch (error) {
      const code = error instanceof FileOperationError ? error.code : 'diagram-process'
      if (['diagram-timeout', 'diagram-process'].includes(code)) {
        if (!job.stopped && !this.closed) this.failures.push(Date.now())
        this.factory.destroy()
        this.host = null
      }
      if (job.valid)
        job.reject(
          error instanceof FileOperationError ? error : new FileOperationError('diagram-process'),
        )
    } finally {
      if (timer) clearTimeout(timer)
      if (this.current === job) this.current = null
      this.capacity()
      this.pump()
    }
  }
  dispose(): void {
    this.closed = true
    for (const job of [...this.pending, ...(this.current ? [this.current] : [])]) {
      job.valid = false
      job.reject(new FileOperationError('diagram-cancelled'))
    }
    this.pending = []
    this.factory.destroy()
    this.host = null
    this.cache.clear()
    this.cacheBytes = 0
  }
  get diagnostics(): { pending: number; running: number; cacheBytes: number; failures: number } {
    return {
      pending: this.pending.length,
      running: this.current ? 1 : 0,
      cacheBytes: this.cacheBytes,
      failures: this.failures.length,
    }
  }
}
