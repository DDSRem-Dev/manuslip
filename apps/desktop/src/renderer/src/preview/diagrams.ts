import { checkDiagramSource, type DiagramRequest, diagramLimits } from '@manuslip/renderer/diagram'
import type { DiagramBridge } from '../../../shared/diagram-contracts'
import type { WidgetBorrow } from './widget-borrow'

interface Job {
  bridge: DiagramBridge
  request: DiagramRequest
  signal: AbortSignal
  running: boolean
  blocked: boolean
  cancelling: boolean
  lease?: WidgetBorrow
  resolve(svg: string): void
  reject(error: Error): void
}
/** Only mounted consumers register; at most five requests cross IPC at once. */
export class DiagramConsumers {
  private readonly jobs = new Set<Job>()
  private running = 0
  private unsubscribe: (() => void) | null = null
  private capacityGeneration = 0
  render(
    bridge: DiagramBridge,
    request: DiagramRequest,
    signal: AbortSignal,
    borrow?: WidgetBorrow,
  ): Promise<string> {
    if (signal.aborted) return Promise.reject(new Error('diagram-cancelled'))
    try {
      checkDiagramSource(request.source)
    } catch (error) {
      return Promise.reject(error)
    }
    if (this.jobs.size >= diagramLimits.consumers) return Promise.reject(new Error('diagram-limit'))
    let lease: WidgetBorrow | undefined
    try {
      lease = borrow?.retain()
      if (!this.unsubscribe)
        this.unsubscribe = bridge.onDiagramCapacity(() => {
          this.capacityGeneration++
          for (const job of this.jobs) job.blocked = false
          this.pump()
        })
    } catch (error) {
      lease?.release()
      return Promise.reject(error)
    }
    return new Promise((resolve, reject) => {
      const job: Job = {
        bridge,
        request,
        signal,
        running: false,
        blocked: false,
        cancelling: false,
        lease,
        resolve,
        reject,
      }
      this.jobs.add(job)
      const abort = (): void => {
        this.jobs.delete(job)
        reject(new Error('diagram-cancelled'))
        if (job.running) {
          job.cancelling = true
          void Promise.resolve()
            .then(() => bridge.cancelDiagram(request.jobId))
            .catch(() => {})
            .finally(() => {
              job.cancelling = false
              this.releaseBorrow(job)
            })
        } else this.releaseBorrow(job)
        this.release()
      }
      signal.addEventListener('abort', abort, { once: true })
      const finish = (callback: () => void): void => {
        signal.removeEventListener('abort', abort)
        callback()
      }
      job.resolve = (svg) => finish(() => resolve(svg))
      job.reject = (error) => finish(() => reject(error))
      this.pump()
    })
  }
  private release(): void {
    if (!this.jobs.size && !this.running) {
      this.unsubscribe?.()
      this.unsubscribe = null
    }
  }
  private releaseBorrow(job: Job): void {
    if (!job.running && !job.cancelling && !this.jobs.has(job)) {
      job.lease?.release()
      job.lease = undefined
    }
  }
  private pump(): void {
    while (this.running < diagramLimits.pending + 1) {
      const jobs = [...this.jobs].filter(
        (job) => !job.running && !job.blocked && !job.signal.aborted,
      )
      const job = jobs.find((job) => job.request.priority === 'visible') || jobs[0]
      if (!job) break
      job.running = true
      this.running++
      const capacityGeneration = this.capacityGeneration
      let pending: ReturnType<DiagramBridge['renderDiagram']>
      try {
        pending = job.bridge.renderDiagram(job.request)
      } catch (error) {
        pending = Promise.reject(error)
      }
      void pending
        .then((result) => {
          if (job.signal.aborted) return
          if (!result.ok && result.code === 'diagram-busy') {
            job.blocked = capacityGeneration === this.capacityGeneration
            return
          }
          this.jobs.delete(job)
          if (result.ok) job.resolve(result.value)
          else job.reject(new Error(result.code || 'diagram-render'))
        })
        .catch(() => {
          this.jobs.delete(job)
          job.reject(new Error('diagram-process'))
        })
        .finally(() => {
          job.running = false
          this.releaseBorrow(job)
          this.running--
          this.pump()
          this.release()
        })
    }
  }
}
export const diagramConsumers = new DiagramConsumers()
