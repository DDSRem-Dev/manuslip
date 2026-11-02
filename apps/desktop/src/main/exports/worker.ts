import { Worker } from 'node:worker_threads'
import { FileOperationError } from '../files/errors'

/** One sequential export worker; all synchronous parse/math/PDF inspection is terminable. */
export class ExportWorker {
  private readonly worker = new Worker(new URL('./export.worker.mjs', import.meta.url), {
    resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
  })
  private closed = false
  private pending: ((error: Error) => void) | null = null
  constructor() {
    this.worker.on('error', () => this.failed())
    this.worker.on('exit', () => this.failed())
  }
  private failed(): void {
    if (this.closed) return
    this.closed = true
    this.pending?.(new FileOperationError('export-render'))
    void this.worker.terminate()
  }
  async request(input: unknown, timeout: number, transfer: ArrayBuffer[] = []): Promise<unknown> {
    if (this.closed) throw new FileOperationError('export-render')
    if (this.pending) throw new FileOperationError('export-busy')
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error?: Error, value?: unknown): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.worker.removeListener('message', message)
        this.pending = null
        if (error) reject(error)
        else resolve(value)
      }
      const message = (output: { ok?: boolean; value?: unknown; code?: string }): void => {
        if (output?.ok === true) finish(undefined, output.value)
        else
          finish(
            new FileOperationError(
              output?.code === 'export-pages'
                ? 'export-pages'
                : output?.code === 'pandoc-failed'
                  ? 'pandoc-failed'
                  : output?.code === 'pandoc-limit'
                    ? 'pandoc-limit'
                    : output?.code === 'export-limit'
                      ? 'export-limit'
                      : output?.code === 'export-incomplete'
                        ? 'export-incomplete'
                        : output?.code === 'export-invalid'
                          ? 'export-invalid'
                          : 'export-render',
            ),
          )
      }
      const timer = setTimeout(() => {
        finish(new FileOperationError('export-timeout'))
        this.dispose()
      }, timeout)
      this.worker.once('message', message)
      this.pending = (error) => finish(error)
      try {
        this.worker.postMessage(input, transfer)
      } catch {
        this.failed()
      }
    })
  }
  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.pending?.(new FileOperationError('export-cancelled'))
    void this.worker.terminate()
  }
}
