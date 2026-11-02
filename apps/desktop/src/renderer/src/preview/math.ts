import { BoundedCache, semanticLimits, utf8Bytes } from '@manuslip/core'

interface Job {
  sequence: number
  key: string
  tex: string
  display: boolean
  signal: AbortSignal
  resolve(value: string): void
  reject(reason: Error): void
}

/** One terminable math worker; viewport lifetimes cancel queued work and guard DOM updates. */
class MathRenderer {
  private worker: Worker | null = null
  private queue: Job[] = []
  private running: Job | null = null
  private sequence = 0
  private watchdog: ReturnType<typeof setTimeout> | null = null
  private failures: number[] = []
  private readonly cache = new BoundedCache<string, string>(semanticLimits.mathCacheBytes)

  render(tex: string, display: boolean, signal: AbortSignal, retry = false): Promise<string> {
    if (retry) this.failures = []
    if (utf8Bytes(tex) > semanticLimits.texBytes) return Promise.reject(new Error('math-limit'))
    const key = JSON.stringify([display, tex])
    const cached = this.cache.get(key)
    if (cached) return Promise.resolve(cached)
    this.queue = this.queue.filter((job) => {
      if (job.signal.aborted) {
        job.reject(new Error('cancelled'))
        return false
      }
      return true
    })
    if (this.queue.length >= semanticLimits.viewportMath)
      return Promise.reject(new Error('math-limit'))
    return new Promise((resolve, reject) => {
      this.queue.push({ sequence: ++this.sequence, key, tex, display, signal, resolve, reject })
      this.start()
    })
  }
  private start(): void {
    if (this.running) return
    const job = this.queue.shift()
    if (!job) return
    if (job.signal.aborted) {
      job.reject(new Error('cancelled'))
      this.start()
      return
    }
    const now = Date.now()
    this.failures = this.failures.filter((time) => now - time < semanticLimits.restartWindow)
    if (this.failures.length > semanticLimits.restarts) {
      job.reject(new Error('math-timeout'))
      this.start()
      return
    }
    this.running = job
    try {
      if (!this.worker) {
        const worker = new Worker(new URL('./math.worker.ts', import.meta.url), {
          type: 'module',
          name: 'manuslip-math',
        })
        this.worker = worker
        worker.onmessage = (event: MessageEvent<unknown>) => {
          if (this.worker === worker) this.received(event.data)
        }
        worker.onerror = worker.onmessageerror = () => {
          if (this.worker === worker) this.failed()
        }
      }
      this.watchdog = setTimeout(() => this.failed(), semanticLimits.mathWatchdog)
      this.worker.postMessage({ sequence: job.sequence, tex: job.tex, display: job.display })
    } catch {
      this.failed()
    }
  }
  private received(value: unknown): void {
    const job = this.running
    if (!job || !value || typeof value !== 'object') {
      this.failed()
      return
    }
    const result = value as { sequence?: unknown; svg?: unknown; error?: unknown }
    if (
      result.sequence !== job.sequence ||
      (typeof result.svg !== 'string' && result.error !== 'math-render')
    ) {
      this.failed()
      return
    }
    if (this.watchdog) clearTimeout(this.watchdog)
    this.watchdog = null
    this.running = null
    if (typeof result.svg === 'string' && utf8Bytes(result.svg) <= semanticLimits.messageBytes) {
      this.cache.set(job.key, result.svg, (job.key.length + result.svg.length) * 2)
      job.resolve(result.svg)
    } else job.reject(new Error('math-render'))
    this.start()
  }
  private failed(): void {
    if (this.watchdog) clearTimeout(this.watchdog)
    this.watchdog = null
    this.worker?.terminate()
    this.worker = null
    this.failures.push(Date.now())
    this.running?.reject(new Error('math-timeout'))
    this.running = null
    this.start()
  }
  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    if (this.watchdog) clearTimeout(this.watchdog)
    this.running?.reject(new Error('cancelled'))
    this.running = null
    for (const job of this.queue) job.reject(new Error('cancelled'))
    this.queue = []
    this.cache.clear()
  }
}

export const mathRenderer = new MathRenderer()
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => mathRenderer.dispose())
