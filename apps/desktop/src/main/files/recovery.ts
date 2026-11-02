import { randomUUID } from 'node:crypto'
import { mkdir, open, opendir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { CheckpointRequest, FileInfo, RecoveryEntry } from '../../shared/file-contracts'
import {
  documentLimit,
  parseFileInfo,
  parseId,
  parseRevision,
  record,
} from '../../shared/file-contracts'
import { FileOperationError } from './errors'

const headerLimit = 64 * 1024
export const recoveryLimits = { entries: 100, bytes: 512 * 1024 * 1024 } as const
interface Header {
  version: 1
  info: FileInfo
  revision: number
  savedAt: number
  bytes: number
}
interface Stored {
  header: Header
  size: number
}

/** Each file is a bounded JSON header, LF, and raw UTF-8 body, never a renderer path. */
export class RecoveryRepository {
  private readonly stored = new Map<string, Stored>()
  private readonly available = new Set<string>()
  private readonly origins = new Map<string, string>()
  private readonly cleared = new Map<string, number>()
  private queue: Promise<void> = Promise.resolve()
  private loadFailed = false

  constructor(
    private readonly directory: string,
    private readonly beforeReplace?: () => Promise<void>,
  ) {}

  private path(id: string): string {
    return join(this.directory, `${parseId(id)}.recovery`)
  }

  async load(): Promise<void> {
    try {
      await this.scan()
      this.loadFailed = false
    } catch {
      this.loadFailed = true
    }
  }

  /** Retry a failed startup scan without re-offering active or claimed drafts.
   * Serialize with checkpoints/removals so their durable state stays authoritative.
   */
  retryLoad(): Promise<void> {
    return this.serialize(async () => {
      if (!this.loadFailed) return
      await this.scan()
      this.loadFailed = false
    })
  }

  private async scan(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const directory = await opendir(this.directory)
    for await (const entry of directory) {
      if (this.stored.size >= recoveryLimits.entries) break
      if (!entry.isFile() || !/^[a-f0-9-]{36}\.recovery$/.test(entry.name)) continue
      const id = entry.name.slice(0, -9)
      if (this.stored.has(id)) continue
      try {
        const stored = await this.read(id, false)
        this.stored.set(id, { header: stored.header, size: stored.size })
        this.available.add(id)
      } catch {
        /* Preserve incompatible or damaged files for inspection; never delete them on load. */
      }
    }
  }

  list(): RecoveryEntry[] {
    if (this.loadFailed) throw new FileOperationError('recovery-io')
    return [...this.available]
      .map((id) => {
        const header = this.stored.get(id)?.header
        if (!header) throw new FileOperationError('recovery-io')
        return {
          id,
          name: header.info.name,
          displayPath: header.info.displayPath,
          savedAt: header.savedAt,
          revision: header.revision,
          bytes: header.bytes,
        }
      })
      .sort((a, b) => b.savedAt - a.savedAt)
  }

  private async read(
    id: string,
    body: boolean,
  ): Promise<{ header: Header; size: number; text: string }> {
    const file = await open(this.path(id), 'r')
    try {
      const metadata = await file.stat()
      if (!metadata.isFile() || metadata.size > documentLimit + headerLimit)
        throw new Error('Recovery too large')
      const prefix = Buffer.alloc(Math.min(headerLimit, metadata.size))
      await file.read(prefix, 0, prefix.length, 0)
      const separator = prefix.indexOf(10)
      if (separator < 0) throw new Error('Invalid recovery header')
      const raw = record(JSON.parse(prefix.subarray(0, separator).toString('utf8')))
      if (raw.version !== 1) throw new Error('Unsupported recovery version')
      const header: Header = {
        version: 1,
        info: parseFileInfo(raw.info),
        revision: parseRevision(raw.revision),
        savedAt: parseRevision(raw.savedAt),
        bytes: parseRevision(raw.bytes),
      }
      if (
        header.info.id !== id ||
        header.bytes > documentLimit ||
        metadata.size !== separator + 1 + header.bytes
      )
        throw new Error('Invalid recovery body')
      let text = ''
      if (body) {
        const bytes = Buffer.alloc(header.bytes)
        let offset = 0
        while (offset < bytes.length) {
          const result = await file.read(
            bytes,
            offset,
            bytes.length - offset,
            separator + 1 + offset,
          )
          if (!result.bytesRead) throw new Error('Truncated recovery')
          offset += result.bytesRead
        }
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      }
      return { header, size: metadata.size, text }
    } finally {
      await file.close()
    }
  }

  private serialize(operation: () => Promise<void>): Promise<void> {
    const task = this.queue.then(operation)
    this.queue = task.catch(() => {})
    return task.catch((error: unknown) => {
      if (error instanceof FileOperationError) throw error
      throw new FileOperationError('recovery-io', { cause: error })
    })
  }

  checkpoint(request: CheckpointRequest, info: FileInfo): Promise<void> {
    return this.serialize(async () => {
      if (
        request.revision <= (this.cleared.get(request.id) ?? -1) ||
        request.revision < (this.stored.get(request.id)?.header.revision ?? -1)
      )
        return
      const bytes = Buffer.from(request.text, 'utf8')
      if (bytes.length > documentLimit || info.id !== request.id)
        throw new FileOperationError('recovery-io')
      const header: Header = {
        version: 1,
        info,
        revision: request.revision,
        savedAt: Date.now(),
        bytes: bytes.length,
      }
      const prefix = Buffer.from(`${JSON.stringify(header)}\n`, 'utf8')
      if (prefix.length > headerLimit) throw new FileOperationError('recovery-io')
      const size = prefix.length + bytes.length
      const previous = this.stored.get(request.id)
      const origin = this.origins.get(request.id)
      const replacedOrigin = origin ? this.stored.get(origin) : undefined
      const total = [...this.stored.values()].reduce((sum, value) => sum + value.size, 0)
      if (
        this.stored.size + (previous ? 0 : 1) - (replacedOrigin ? 1 : 0) > recoveryLimits.entries ||
        total - (previous?.size || 0) - (replacedOrigin?.size || 0) + size > recoveryLimits.bytes
      )
        throw new FileOperationError('recovery-capacity')
      const temporary = join(this.directory, `.${request.id}-${randomUUID()}.tmp`)
      try {
        await mkdir(this.directory, { recursive: true, mode: 0o700 })
        const file = await open(temporary, 'wx', 0o600)
        try {
          await file.writeFile(prefix)
          await file.writeFile(bytes)
          await file.sync()
        } finally {
          await file.close()
        }
        await this.beforeReplace?.()
        await rename(temporary, this.path(request.id))
        this.stored.set(request.id, { header, size })
        if (process.platform !== 'win32') {
          const parent = await open(this.directory, 'r')
          try {
            await parent.sync()
          } finally {
            await parent.close()
          }
        }
        if (origin) {
          await rm(this.path(origin), { force: true })
          this.stored.delete(origin)
          this.origins.delete(request.id)
        }
      } finally {
        await rm(temporary, { force: true }).catch(() => {})
      }
    })
  }

  clear(id: string, revision: number): Promise<void> {
    return this.serialize(async () => {
      this.cleared.set(id, Math.max(revision, this.cleared.get(id) ?? -1))
      if ((this.stored.get(id)?.header.revision ?? -1) > revision) return
      await rm(this.path(id), { force: true })
      this.stored.delete(id)
      this.available.delete(id)
      const origin = this.origins.get(id)
      if (origin) {
        await rm(this.path(origin), { force: true })
        this.stored.delete(origin)
        this.available.delete(origin)
        this.origins.delete(id)
      }
    })
  }

  async restore(id: string): Promise<string> {
    await this.queue
    if (!this.available.has(id)) throw new FileOperationError('file-session')
    try {
      return (await this.read(id, true)).text
    } catch (error) {
      throw new FileOperationError('recovery-io', { cause: error })
    }
  }

  claim(id: string, session: string): void {
    if (!this.available.delete(id)) throw new FileOperationError('file-session')
    this.origins.set(session, id)
  }

  discard(id: string): Promise<void> {
    if (!this.available.has(id)) return Promise.reject(new FileOperationError('file-session'))
    return this.clear(id, Number.MAX_SAFE_INTEGER)
  }

  async flush(): Promise<void> {
    await this.queue
  }
}
