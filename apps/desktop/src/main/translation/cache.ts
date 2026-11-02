import { Worker } from 'node:worker_threads'
import { type CacheStatus, transportLimits } from '../../shared/translation-contracts'
import type { CacheOperation, CacheReply } from './cache-store'

export interface TranslationCache {
  status: CacheStatus
  request(operation: CacheOperation): Promise<CacheReply>
  dispose(): void
}
interface Pending {
  bytes: number
  timer: ReturnType<typeof setTimeout>
  resolve(reply: CacheReply): void
}
/** Lazy, bounded worker. Persistence failure never prevents an in-memory translation. */
export class TranslationCacheWorker implements TranslationCache {
  status: CacheStatus = 'idle'
  private worker: Worker | null = null
  private sequence = 0
  private bytes = 0
  private readonly pending = new Map<number, Pending>()
  constructor(
    private readonly path: string,
    private readonly changed: () => void,
  ) {}
  private start(): void {
    if (this.worker || this.status === 'unavailable') return
    try {
      this.worker = new Worker(new URL('./translation-cache.worker.mjs', import.meta.url), {
        workerData: { path: this.path },
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
      })
      this.worker.on('message', (message: { id: number; reply: CacheReply }) => {
        const pending = this.pending.get(message?.id)
        if (
          !pending ||
          !message.reply ||
          !['ready', 'recovered', 'unavailable', 'future'].includes(message.reply.status)
        )
          return this.failed()
        clearTimeout(pending.timer)
        this.pending.delete(message.id)
        this.bytes -= pending.bytes
        const previous = this.status
        this.status = message.reply.status
        if (previous !== this.status) this.changed()
        pending.resolve(message.reply)
      })
      this.worker.on('error', () => this.failed())
      this.worker.on('exit', () => this.failed())
    } catch {
      this.failed()
    }
  }
  private failed(): void {
    const previous = this.status
    this.status = 'unavailable'
    const worker = this.worker
    this.worker = null
    void worker?.terminate()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.resolve({ status: this.status, output: null })
    }
    this.pending.clear()
    this.bytes = 0
    if (previous !== this.status) this.changed()
  }
  request(operation: CacheOperation): Promise<CacheReply> {
    this.start()
    const bytes = Buffer.byteLength(JSON.stringify(operation))
    if (
      operation.kind === 'clear' &&
      (this.pending.size >= transportLimits.cachePending ||
        this.bytes + bytes > transportLimits.cacheQueueBytes)
    )
      this.failed()
    if (
      !this.worker ||
      this.pending.size >= transportLimits.cachePending ||
      this.bytes + bytes > transportLimits.cacheQueueBytes
    )
      return Promise.resolve({ status: this.worker ? this.status : 'unavailable', output: null })
    const id = ++this.sequence
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.failed(), transportLimits.cacheDeadlineMs)
      this.pending.set(id, { bytes, timer, resolve })
      this.bytes += bytes
      try {
        this.worker?.postMessage({ id, operation })
      } catch {
        this.failed()
      }
    })
  }
  dispose(): void {
    this.failed()
  }
}
