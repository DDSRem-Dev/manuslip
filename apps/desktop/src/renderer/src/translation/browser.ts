import { readingJsonBytes } from '../../../../../../packages/renderer/src/reading-bytes'
import { decodeReadingValue, type ReadingWireValue } from './prepared-wire'
import {
  type ReadingEngine,
  type ReadingOperation,
  type ReadingValue,
  readingLimits,
  readingOperationBytes,
} from './protocol'

export class ReadingWorker implements ReadingEngine {
  private readonly worker = new Worker(new URL('./reading.worker.ts', import.meta.url), {
    type: 'module',
    name: 'manuslip-translation',
  })
  private sequence = 0
  private pending: {
    sequence: number
    resolve(value: ReadingValue): void
    reject(error: Error): void
    timer: ReturnType<typeof setTimeout>
  } | null = null
  private closed = false
  constructor() {
    this.worker.onerror = this.worker.onmessageerror = () => this.fail()
    this.worker.onmessage = (
      event: MessageEvent<{ sequence: number; value?: ReadingWireValue; error?: string }>,
    ) => {
      const pending = this.pending
      if (
        !pending ||
        event.data?.sequence !== pending.sequence ||
        readingJsonBytes(event.data) >
          (event.data.value?.kind === 'rendered' ? readingLimits.response : readingLimits.message)
      )
        return this.fail()
      clearTimeout(pending.timer)
      this.pending = null
      if (event.data.error) pending.reject(new Error(event.data.error))
      else {
        try {
          pending.resolve(decodeReadingValue(event.data.value))
        } catch {
          this.fail(pending)
        }
      }
    }
  }
  request(operation: ReadingOperation): Promise<ReadingValue> {
    if (this.closed || this.pending) return Promise.reject(new Error('translation-view-worker'))
    if (readingOperationBytes(operation) > readingLimits.message)
      return Promise.reject(new Error('translation-view-limit'))
    return new Promise((resolve, reject) => {
      const sequence = ++this.sequence
      this.pending = {
        sequence,
        resolve,
        reject,
        timer: setTimeout(() => this.fail(), readingLimits.watchdog),
      }
      try {
        this.worker.postMessage(
          { sequence, operation },
          operation.kind === 'prepare-packed' ? [operation.payload] : [],
        )
      } catch {
        this.fail()
      }
    })
  }
  private fail(pending = this.pending): void {
    if (pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('translation-view-worker'))
    }
    this.pending = null
    this.closed = true
    this.worker.terminate()
  }
  dispose(): void {
    this.fail()
  }
}
