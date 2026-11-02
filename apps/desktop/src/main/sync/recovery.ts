import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { documentLimit, parseId, record } from '../../shared/file-contracts'
import { FileOperationError } from '../files/errors'
import { syncHash } from './webdav'

export const syncRecoveryLimits = { entries: 100, bytes: 512 * 1024 * 1024, header: 4096 } as const
interface Header {
  version: 1
  id: string
  connectionId: string
  name: string
  side: 'local' | 'remote'
  savedAt: number
  bytes: number
  hash: string
}
export interface SyncRecoveryCopy {
  id: string
  name: string
  side: 'local' | 'remote' | 'unknown'
  savedAt: number
  bytes: number
  state: 'verified' | 'damaged' | 'incomplete'
}
function parseHeader(input: unknown): Header {
  const value = record(input)
  if (
    Object.keys(value).sort().join() !== 'bytes,connectionId,hash,id,name,savedAt,side,version' ||
    value.version !== 1 ||
    typeof value.name !== 'string' ||
    !value.name ||
    value.name.length > 160 ||
    !value.name.isWellFormed() ||
    [...value.name].some((character) => character.charCodeAt(0) < 32) ||
    (value.side !== 'local' && value.side !== 'remote') ||
    !Number.isSafeInteger(value.savedAt) ||
    (value.savedAt as number) < 0 ||
    !Number.isSafeInteger(value.bytes) ||
    (value.bytes as number) < 0 ||
    (value.bytes as number) > documentLimit ||
    typeof value.hash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.hash)
  )
    throw new FileOperationError('sync-recovery')
  return {
    version: 1,
    id: parseId(value.id),
    connectionId: parseId(value.connectionId),
    name: value.name,
    side: value.side,
    savedAt: value.savedAt as number,
    bytes: value.bytes as number,
    hash: value.hash,
  }
}
function recoveryKey(input: string): { id: string; pending: boolean } {
  const pending = input.endsWith('-pending')
  return { id: parseId(pending ? input.slice(0, -8) : input), pending }
}
const summary = (header: Header): SyncRecoveryCopy => ({
  id: header.id,
  name: header.name,
  side: header.side,
  savedAt: header.savedAt,
  bytes: header.bytes,
  state: 'verified',
})

/** Bounded raw-byte archives, streamed verification, explicit export/removal, no eviction. */
export class SyncRecoveryRepository {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly directory: string,
    private readonly quotaBytes: number = syncRecoveryLimits.bytes,
    private readonly quotaEntries: number = syncRecoveryLimits.entries,
  ) {}
  private path(key: string): string {
    const value = recoveryKey(key)
    return join(this.directory, `${value.id}${value.pending ? '.pending' : '.sync-copy'}`)
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation)
    this.queue = pending.catch(() => {})
    return pending
  }
  private async inspect(
    key: string,
    includeBytes: boolean,
  ): Promise<{ header: Header; size: number; bytes?: Buffer }> {
    const handle = await open(this.path(key), constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    try {
      const metadata = await handle.stat({ bigint: true })
      if (
        !metadata.isFile() ||
        metadata.nlink > 1n ||
        metadata.size > BigInt(documentLimit + syncRecoveryLimits.header)
      )
        throw new FileOperationError('sync-recovery')
      const prefix = Buffer.alloc(Math.min(syncRecoveryLimits.header, Number(metadata.size))),
        head = await handle.read(prefix, 0, prefix.length, 0),
        end = prefix.subarray(0, head.bytesRead).indexOf(10)
      if (end < 0) throw new FileOperationError('sync-recovery')
      const header = parseHeader(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(prefix.subarray(0, end))),
      )
      if (header.id !== recoveryKey(key).id || header.bytes + end + 1 !== Number(metadata.size))
        throw new FileOperationError('sync-recovery')
      const bytes = includeBytes ? Buffer.alloc(header.bytes) : undefined,
        chunk = Buffer.alloc(Math.min(64 * 1024, header.bytes)),
        digest = createHash('sha256')
      let offset = 0
      while (offset < header.bytes) {
        const next = await handle.read(
          chunk,
          0,
          Math.min(chunk.length, header.bytes - offset),
          end + 1 + offset,
        )
        if (!next.bytesRead) throw new FileOperationError('sync-recovery')
        digest.update(chunk.subarray(0, next.bytesRead))
        bytes?.set(chunk.subarray(0, next.bytesRead), offset)
        offset += next.bytesRead
      }
      const after = await handle.stat({ bigint: true })
      if (
        after.size !== metadata.size ||
        after.mtimeNs !== metadata.mtimeNs ||
        after.ctimeNs !== metadata.ctimeNs ||
        digest.digest('hex') !== header.hash
      )
        throw new FileOperationError('sync-recovery')
      return { header, size: Number(metadata.size), ...(bytes ? { bytes } : {}) }
    } finally {
      await handle.close()
    }
  }
  private async scan(): Promise<{ copies: SyncRecoveryCopy[]; bytes: number; blocked: boolean }> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const files = await readdir(this.directory, { withFileTypes: true }),
      copies: SyncRecoveryCopy[] = []
    let bytes = 0,
      blocked = false
    if (files.length > this.quotaEntries * 2) throw new FileOperationError('sync-limit')
    for (const file of files) {
      if (file.name.startsWith('.uuid')) continue
      const suffix = file.name.endsWith('.sync-copy')
        ? '.sync-copy'
        : file.name.endsWith('.pending')
          ? '.pending'
          : null
      if (!suffix) {
        blocked = true
        continue
      }
      const id = file.name.slice(0, -suffix.length),
        key = `${id}${suffix === '.pending' ? '-pending' : ''}`
      try {
        parseId(id)
      } catch {
        blocked = true
        continue
      }
      try {
        if (!file.isFile() || suffix === '.pending') throw new FileOperationError('sync-recovery')
        const stored = await this.inspect(key, false)
        bytes += stored.size
        copies.push(summary(stored.header))
      } catch {
        const handle = file.isFile()
          ? await open(this.path(key), constants.O_RDONLY | (constants.O_NOFOLLOW || 0)).catch(
              () => null,
            )
          : null
        const metadata = await handle?.stat().finally(() => handle.close())
        bytes += metadata?.size || 0
        blocked = true
        copies.push({
          id: key,
          name: 'Unverified recovery',
          side: 'unknown',
          savedAt: Math.floor(metadata?.mtimeMs || 0),
          bytes: metadata?.size || 0,
          state: suffix === '.pending' ? 'incomplete' : 'damaged',
        })
      }
    }
    return { copies: copies.sort((a, b) => b.savedAt - a.savedAt), bytes, blocked }
  }
  list(): Promise<{ copies: SyncRecoveryCopy[]; blocked: boolean }> {
    return this.serialize(async () => {
      const { copies, blocked } = await this.scan()
      return { copies, blocked }
    })
  }
  preserve(
    connectionId: string,
    name: string,
    side: 'local' | 'remote',
    bytes: Buffer,
    current: () => void,
  ): Promise<SyncRecoveryCopy> {
    return this.serialize(async () => {
      current()
      const header = parseHeader({
          version: 1,
          id: randomUUID(),
          connectionId,
          name,
          side,
          savedAt: Date.now(),
          bytes: bytes.length,
          hash: syncHash(bytes),
        }),
        prefix = Buffer.from(`${JSON.stringify(header)}\n`),
        inventory = await this.scan()
      if (inventory.blocked) throw new FileOperationError('sync-recovery')
      if (
        prefix.length > syncRecoveryLimits.header ||
        inventory.copies.length >= this.quotaEntries ||
        inventory.bytes + prefix.length + bytes.length > this.quotaBytes
      )
        throw new FileOperationError('sync-limit')
      const key = `${header.id}-pending`,
        temporary = this.path(key),
        handle = await open(temporary, 'wx', 0o600)
      try {
        current()
        await handle.writeFile(prefix)
        await handle.writeFile(bytes)
        await handle.sync()
        current()
      } catch (error) {
        await handle.close()
        await rm(temporary, { force: true })
        throw error
      }
      await handle.close()
      try {
        current()
        await rename(temporary, this.path(header.id))
      } catch (error) {
        await rm(temporary, { force: true })
        throw error
      }
      if (process.platform !== 'win32') {
        const directory = await open(this.directory, 'r')
        try {
          await directory.sync()
        } finally {
          await directory.close()
        }
      }
      const verified = await this.inspect(header.id, false)
      return summary(verified.header)
    })
  }
  restore(id: string): Promise<{ bytes: Buffer; artifact: boolean }> {
    return this.serialize(async () => {
      try {
        if (recoveryKey(id).pending) throw new FileOperationError('sync-recovery')
        const stored = await this.inspect(id, true)
        if (!stored.bytes) throw new FileOperationError('sync-recovery')
        return { bytes: stored.bytes, artifact: false }
      } catch {
        const handle = await open(this.path(id), constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
        try {
          const metadata = await handle.stat({ bigint: true })
          if (
            !metadata.isFile() ||
            metadata.nlink > 1n ||
            metadata.size > BigInt(documentLimit + syncRecoveryLimits.header)
          )
            throw new FileOperationError('sync-recovery')
          const bytes = Buffer.alloc(Number(metadata.size))
          let offset = 0
          while (offset < bytes.length) {
            const next = await handle.read(
              bytes,
              offset,
              Math.min(64 * 1024, bytes.length - offset),
              offset,
            )
            if (!next.bytesRead) throw new FileOperationError('sync-recovery')
            offset += next.bytesRead
          }
          const after = await handle.stat({ bigint: true })
          if (
            after.size !== metadata.size ||
            after.mtimeNs !== metadata.mtimeNs ||
            after.ctimeNs !== metadata.ctimeNs
          )
            throw new FileOperationError('sync-recovery')
          return { bytes, artifact: true }
        } finally {
          await handle.close()
        }
      }
    })
  }
  remove(id: string, current: () => void): Promise<void> {
    return this.serialize(async () => {
      current()
      await rm(this.path(id))
    })
  }
}
