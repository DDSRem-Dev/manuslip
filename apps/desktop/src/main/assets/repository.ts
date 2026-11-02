import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'
import { assetLimits } from '../../shared/asset-contracts'
import { FileOperationError, fileError } from '../files/errors'
import type { FileSessions } from '../files/sessions'
import { type ImageData, imageMime } from '../images/network'
import { resolveNode } from '../workspace/paths'
import { rasterInfo } from './image'
import { readScopedAsset } from './read'

interface Asset extends ImageData {
  weight: number
  owner: number
  documentId: string
  documentPath: string
  path: string
}
interface Capture {
  id: string
  documentId: string
  bytes: Buffer
  timer: ReturnType<typeof setTimeout>
}

/** Local capabilities never expose filesystem paths or grant ambient file:// access. */
export class LocalAssets {
  private readonly assets = new Map<string, Asset>()
  private readonly captures = new Map<number, Capture>()
  private readonly capturing = new Set<number>()
  private running = 0
  private readonly waiting: (() => void)[] = []
  private bytes = 0
  constructor(
    private readonly files: FileSessions,
    private readonly readImage: () => Promise<Buffer>,
  ) {}

  private async operation<T>(action: () => Promise<T>): Promise<T> {
    if (this.running >= assetLimits.running) {
      if (this.waiting.length >= assetLimits.queue) throw new FileOperationError('asset-busy')
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    } else this.running++
    try {
      return await action()
    } catch (error) {
      throw fileError(error)
    } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.running--
    }
  }
  private forget(id: string): void {
    const asset = this.assets.get(id)
    if (asset) this.bytes -= asset.weight
    this.assets.delete(id)
  }
  async load(owner: number, documentId: string, reference: string): Promise<string> {
    return this.operation(async () => {
      const context = await this.files.assetContext(owner, documentId)
      const { path, bytes, mime, weight } = await readScopedAsset(context, reference)
      const current = await this.files.assetContext(owner, documentId)
      if (current.path !== context.path) throw new FileOperationError('file-session')
      while (this.assets.size >= assetLimits.entries || this.bytes + weight > assetLimits.cache) {
        const first = this.assets.keys().next().value
        if (!first) break
        this.forget(first)
      }
      const id = randomUUID()
      this.assets.set(id, {
        owner,
        documentId,
        documentPath: context.path,
        path,
        bytes,
        mime,
        weight,
      })
      this.bytes += weight
      return `manuslip-asset://image/${id}`
    })
  }
  async get(owner: number, id: string): Promise<ImageData | null> {
    const asset = this.assets.get(id)
    if (!asset || asset.owner !== owner) return null
    try {
      const context = await this.files.assetContext(owner, asset.documentId)
      if (context.path !== asset.documentPath) {
        this.forget(id)
        return null
      }
      await resolveNode(context.root, asset.path, false)
      if (this.assets.get(id) !== asset) return null
      this.files.describe(owner, asset.documentId)
      this.assets.delete(id)
      this.assets.set(id, asset)
      return asset
    } catch {
      this.forget(id)
      return null
    }
  }
  async capture(owner: number, documentId: string): Promise<string> {
    if (this.capturing.has(owner)) throw new FileOperationError('asset-busy')
    this.capturing.add(owner)
    try {
      return await this.captureImage(owner, documentId)
    } finally {
      this.capturing.delete(owner)
    }
  }
  private async captureImage(owner: number, documentId: string): Promise<string> {
    this.files.describe(owner, documentId)
    if (this.captures.has(owner)) throw new FileOperationError('asset-busy')
    const bytes = await this.readImage()
    this.files.describe(owner, documentId)
    if (this.captures.has(owner)) throw new FileOperationError('asset-busy')
    if (bytes.length > assetLimits.bytes) throw new FileOperationError('asset-large')
    if (
      bytes.length < 24 ||
      imageMime(bytes) !== 'image/png' ||
      bytes.toString('ascii', 12, 16) !== 'IHDR'
    )
      throw new FileOperationError('asset-capture')
    rasterInfo(bytes)
    const id = randomUUID()
    const timer = setTimeout(() => this.discard(owner, documentId, id), assetLimits.captureMs)
    timer.unref()
    this.captures.set(owner, { id, documentId, bytes, timer })
    return id
  }
  discard(owner: number, documentId: string, id: string): void {
    const capture = this.captures.get(owner)
    if (capture?.id !== id || capture.documentId !== documentId) return
    clearTimeout(capture.timer)
    this.captures.delete(owner)
  }
  async import(owner: number, documentId: string, captureId: string): Promise<string> {
    return this.operation(async () => {
      this.files.describe(owner, documentId)
      const capture = this.captures.get(owner)
      if (capture?.id !== captureId || capture.documentId !== documentId)
        throw new FileOperationError('asset-capture')
      this.discard(owner, documentId, captureId)
      const context = await this.files.assetContext(owner, documentId)
      await resolveNode(context.parent, context.parent.path, true)
      const directory = join(context.parent.path, 'assets')
      try {
        await mkdir(directory)
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'))
          throw error
      }
      await resolveNode(context.parent, directory, true)
      const relative = `assets/pasted-${randomUUID()}.png`
      const path = join(context.parent.path, relative)
      const handle = await open(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0),
        0o600,
      )
      try {
        await resolveNode(context.parent, path, false)
        const current = await this.files.assetContext(owner, documentId)
        if (current.path !== context.path) throw new FileOperationError('file-session')
        const named = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
        try {
          const identity = await handle.stat({ bigint: true })
          const verified = await named.stat({ bigint: true })
          if (identity.dev !== verified.dev || identity.ino !== verified.ino)
            throw new FileOperationError('workspace-changed')
        } finally {
          await named.close()
        }
        await handle.writeFile(capture.bytes)
        await handle.sync()
        await resolveNode(context.parent, path, false)
      } finally {
        await handle.close()
        this.discard(owner, documentId, captureId)
      }
      return relative
    })
  }
  revoke(owner: number, documentId: string): void {
    for (const [id, asset] of this.assets)
      if (asset.owner === owner && asset.documentId === documentId) this.forget(id)
    const capture = this.captures.get(owner)
    if (capture?.documentId === documentId) this.discard(owner, documentId, capture.id)
  }
  revokeOwner(owner: number): void {
    for (const [id, asset] of this.assets) if (asset.owner === owner) this.forget(id)
    const capture = this.captures.get(owner)
    if (capture) this.discard(owner, capture.documentId, capture.id)
  }
  get diagnostics(): {
    bytes: number
    entries: number
    captures: number
    running: number
    queued: number
  } {
    return {
      bytes: this.bytes,
      entries: this.assets.size,
      captures: this.captures.size,
      running: this.running,
      queued: this.waiting.length,
    }
  }
}
