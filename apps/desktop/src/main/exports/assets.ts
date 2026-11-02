import { safeImage, safeLink } from '@manuslip/renderer/urls'
import { exportLimits } from '../../shared/export-contracts'
import { rasterInfo } from '../assets/image'
import { type AssetContext, readScopedAsset } from '../assets/read'
import { FileOperationError } from '../files/errors'
import type { FileSessions } from '../files/sessions'
import type { ImageRepository } from '../images/repository'

/** Export-owned snapshots contain raster data only; no filesystem paths reach the print host. */
export class ExportAssets {
  private readonly cache = new Map<string, { url: string; bytes: number; decoded: number }>()
  private compressed = 0
  private decoded = 0
  private count = 0
  private running = false
  constructor(
    private readonly owner: number,
    private readonly documentId: string,
    private readonly context: AssetContext | null,
    private readonly files: FileSessions,
    private readonly images: ImageRepository,
    private readonly remote: boolean,
    private readonly signal: AbortSignal,
  ) {}

  async resolve(reference: string): Promise<string> {
    if (this.running) throw new FileOperationError('export-busy')
    this.running = true
    try {
      return await this.read(reference)
    } finally {
      this.running = false
    }
  }
  private async read(reference: string): Promise<string> {
    this.signal.throwIfAborted()
    this.files.describe(this.owner, this.documentId)
    if (
      safeLink(reference)?.startsWith('https:') &&
      (!this.remote || !this.images.allowed(this.owner, this.documentId))
    )
      throw new FileOperationError('export-asset')
    if (++this.count > exportLimits.images) throw new FileOperationError('export-limit')
    const cached = this.cache.get(reference)
    if (cached) {
      this.decoded += cached.decoded
      if (this.decoded > exportLimits.decoded) throw new FileOperationError('export-limit')
      return cached.url
    }
    try {
      this.files.describe(this.owner, this.documentId)
      let bytes: Buffer
      const inline = safeImage(reference)
      if (inline?.startsWith('data:image/')) {
        const match = /^data:image\/(?:png|jpeg|gif|webp);base64,([a-z0-9+/=\s]+)$/i.exec(inline)
        if (!match) throw new FileOperationError('export-asset')
        bytes = Buffer.from(match[1] || '', 'base64')
      } else if (safeLink(reference)?.startsWith('https:')) {
        if (!this.remote) throw new FileOperationError('export-asset')
        const image = await this.images.readForExport(
          this.owner,
          this.documentId,
          reference,
          this.signal,
        )
        bytes = image.bytes
      } else {
        if (!this.context) throw new FileOperationError('export-asset')
        bytes = (await readScopedAsset(this.context, reference)).bytes
      }
      this.signal.throwIfAborted()
      this.files.describe(this.owner, this.documentId)
      const { mime, weight } = rasterInfo(bytes)
      if (bytes.length > exportLimits.asset) throw new FileOperationError('export-limit')
      this.compressed += bytes.length
      this.decoded += weight - bytes.length
      if (this.compressed > exportLimits.assets || this.decoded > exportLimits.decoded)
        throw new FileOperationError('export-limit')
      const url = `data:${mime};base64,${bytes.toString('base64')}`
      this.cache.set(reference, { url, bytes: bytes.length, decoded: weight - bytes.length })
      return url
    } catch (error) {
      if (error instanceof FileOperationError && ['asset-large', 'file-large'].includes(error.code))
        throw new FileOperationError('export-limit')
      if (error instanceof FileOperationError && error.code === 'export-limit') throw error
      throw new FileOperationError('export-asset')
    }
  }
  dispose(): void {
    this.cache.clear()
  }
}
