import { Worker } from 'node:worker_threads'
import { assetLimits } from '../../shared/asset-contracts'
import { FileOperationError } from '../files/errors'

/** DOM parsing stays off both the renderer and Electron's event loop. */
export class ClipboardConverter {
  private current: { owner: number; documentId: string; worker: Worker } | null = null
  async convert(owner: number, documentId: string, html: string): Promise<string> {
    if (Buffer.byteLength(html) > assetLimits.html) throw new FileOperationError('paste-large')
    if (this.current) throw new FileOperationError('paste-busy')
    const worker = new Worker(new URL('./clipboard.worker.mjs', import.meta.url), {
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
    })
    const current = { owner, documentId, worker }
    this.current = current
    try {
      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new FileOperationError('paste-failed')),
          assetLimits.conversionMs,
        )
        worker.once('message', (result: unknown) => {
          clearTimeout(timer)
          if (typeof result !== 'object' || !result || !('ok' in result))
            reject(new FileOperationError('paste-failed'))
          else if (
            result.ok &&
            'value' in result &&
            typeof result.value === 'string' &&
            Buffer.byteLength(result.value) <= assetLimits.markdown
          )
            resolve(result.value)
          else reject(new FileOperationError('paste-failed'))
        })
        worker.once('error', () => {
          clearTimeout(timer)
          reject(new FileOperationError('paste-failed'))
        })
        worker.once('exit', () => {
          clearTimeout(timer)
          reject(new FileOperationError('paste-failed'))
        })
        worker.postMessage(html)
      })
    } finally {
      await worker.terminate()
      if (this.current === current) this.current = null
    }
  }
  closeOwner(owner: number): void {
    if (this.current?.owner === owner) void this.current.worker.terminate()
  }
  closeDocument(owner: number, documentId: string): void {
    if (this.current?.owner === owner && this.current.documentId === documentId)
      void this.current.worker.terminate()
  }
}
