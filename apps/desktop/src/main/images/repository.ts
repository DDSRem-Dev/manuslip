import { randomUUID } from 'node:crypto'
import { fetchRemoteImage, type ImageData, imageLimits } from './network'

interface Permission {
  owner: number
  epoch: number
  enabled: boolean
}
interface Asset extends ImageData {
  key: string
  id: string
  documentId: string
  owner: number
}
interface Request {
  documentId: string
  owner: number
  epoch: number
  url: string
  controller: AbortController
  resolve(url: string): void
  reject(error: Error): void
  receive?(image: ImageData): void
  release?(): void
}

/** Permission and assets live only for the current open document, never in persisted settings. */
export class ImageRepository {
  private readonly permissions = new Map<string, Permission>()
  private readonly assets = new Map<string, Asset>()
  private readonly urls = new Map<string, string>()
  private readonly pending = new Map<string, Promise<string>>()
  private readonly inflight = new Set<Request>()
  private queue: Request[] = []
  private used = 0
  private epoch = 0
  constructor(private readonly fetchImage: typeof fetchRemoteImage = fetchRemoteImage) {}

  permission(owner: number, id: string, enabled: boolean): void {
    this.revoke(owner, id)
    this.permissions.set(id, { owner, enabled, epoch: ++this.epoch })
  }
  revoke(owner: number, id: string): void {
    if (this.permissions.get(id)?.owner !== owner) return
    this.permissions.delete(id)
    for (const request of this.inflight) if (request.documentId === id) request.controller.abort()
    this.queue = this.queue.filter((request) => {
      if (request.documentId !== id) return true
      request.reject(new Error('image-permission'))
      request.release?.()
      return false
    })
    for (const [key, asset] of this.assets)
      if (asset.documentId === id) {
        this.used -= asset.bytes.length
        this.urls.delete(asset.key)
        this.assets.delete(key)
      }
  }
  revokeOwner(owner: number): void {
    for (const [id, permission] of this.permissions)
      if (permission.owner === owner) this.revoke(owner, id)
  }
  allowed(owner: number, id: string): boolean {
    const permission = this.permissions.get(id)
    return permission?.owner === owner && permission.enabled
  }
  /** Export shares network admission and permission epochs, but owns cancellation and bytes. */
  readForExport(owner: number, id: string, url: string, signal: AbortSignal): Promise<ImageData> {
    signal.throwIfAborted()
    const permission = this.permissions.get(id)
    if (!permission?.enabled || permission.owner !== owner)
      return Promise.reject(new Error('image-permission'))
    const key = JSON.stringify([owner, id, permission.epoch, url])
    const cached = this.urls.get(key)
    const image = cached ? this.get(owner, cached) : null
    if (image) return Promise.resolve(image)
    if (this.queue.length >= imageLimits.queued) return Promise.reject(new Error('image-limit'))
    return new Promise((resolve, reject) => {
      const request: Request = {
        owner,
        documentId: id,
        epoch: permission.epoch,
        url,
        controller: new AbortController(),
        resolve: () => {},
        reject,
        receive: resolve,
      }
      const abort = (): void => {
        request.controller.abort()
        this.queue = this.queue.filter((queued) => queued !== request)
        request.release?.()
        reject(new Error('image-cancelled'))
      }
      request.release = () => signal.removeEventListener('abort', abort)
      signal.addEventListener('abort', abort, { once: true })
      this.queue.push(request)
      this.start()
    })
  }
  load(owner: number, id: string, url: string): Promise<string> {
    const permission = this.permissions.get(id)
    if (!permission?.enabled || permission.owner !== owner)
      return Promise.reject(new Error('image-permission'))
    const key = JSON.stringify([owner, id, permission.epoch, url])
    const cached = this.urls.get(key)
    if (cached && this.get(owner, cached))
      return Promise.resolve(`manuslip-asset://image/${cached}`)
    const existing = this.pending.get(key)
    if (existing) return existing
    if (this.queue.length >= imageLimits.queued) return Promise.reject(new Error('image-limit'))
    const promise = new Promise<string>((resolve, reject) => {
      this.queue.push({
        owner,
        documentId: id,
        epoch: permission.epoch,
        url,
        controller: new AbortController(),
        resolve,
        reject,
      })
      this.start()
    })
    this.pending.set(key, promise)
    void promise.then(
      () => this.pending.delete(key),
      () => this.pending.delete(key),
    )
    return promise
  }
  private current(request: Request): boolean {
    const permission = this.permissions.get(request.documentId)
    return (
      !!permission?.enabled &&
      permission.owner === request.owner &&
      permission.epoch === request.epoch
    )
  }
  private start(): void {
    while (this.inflight.size < imageLimits.concurrency && this.queue.length) {
      const request = this.queue.shift()
      if (!request) break
      if (!this.current(request)) {
        request.reject(new Error('image-permission'))
        request.release?.()
        continue
      }
      this.inflight.add(request)
      void this.run(request)
    }
  }
  private async run(request: Request): Promise<void> {
    const timer = setTimeout(() => request.controller.abort(), imageLimits.timeout)
    try {
      const result = await this.fetchImage(request.url, request.controller.signal)
      if (!this.current(request) || request.controller.signal.aborted)
        throw new Error('image-permission')
      if (result.bytes.length > imageLimits.bytes) throw new Error('image-limit')
      if (request.receive) {
        request.receive(result)
        return
      }
      while (this.used + result.bytes.length > imageLimits.total) {
        const oldest = this.assets.entries().next().value
        if (!oldest) break
        this.assets.delete(oldest[0])
        this.urls.delete(oldest[1].key)
        this.used -= oldest[1].bytes.length
      }
      const id = randomUUID()
      const key = JSON.stringify([request.owner, request.documentId, request.epoch, request.url])
      this.assets.set(id, {
        ...result,
        key,
        id,
        owner: request.owner,
        documentId: request.documentId,
      })
      this.urls.set(key, id)
      this.used += result.bytes.length
      request.resolve(`manuslip-asset://image/${id}`)
    } catch {
      request.reject(new Error('image-load'))
    } finally {
      clearTimeout(timer)
      request.release?.()
      this.inflight.delete(request)
      this.start()
    }
  }
  get(owner: number, id: string): ImageData | null {
    const asset = this.assets.get(id)
    if (!asset || asset.owner !== owner || !this.permissions.get(asset.documentId)?.enabled)
      return null
    this.assets.delete(id)
    this.assets.set(id, asset)
    return { bytes: asset.bytes, mime: asset.mime }
  }
  get bytes(): number {
    return this.used
  }
}
