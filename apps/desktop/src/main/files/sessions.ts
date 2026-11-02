import { randomUUID } from 'node:crypto'
import { type FSWatcher, watch } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  documentLimit,
  type FileInfo,
  type FileSnapshot,
  type SaveOutcome,
  type SaveRequest,
} from '../../shared/file-contracts'
import { atomicWrite, type DiskSnapshot, maybeDisk, readDisk } from './disk'
import { decodeDocument, type EncodingInfo, encodeDocument } from './encoding'
import { FileOperationError, fileError } from './errors'

export interface FileDialogs {
  open(): Promise<string | null>
  save(suggestedPath: string): Promise<string | null>
  overwrite(displayPath: string): Promise<boolean>
}
export type FileAuthorization = (canonical: string, identity?: string) => Promise<void>
export interface AssetRoot {
  path: string
  identity: string
}
export interface SavedFileCapture {
  path: string
  disk: DiskSnapshot
}
interface FileRecord {
  path: string
  identity: string
  queue: Promise<void>
  sessions: Set<string>
  watchKey: string
}
interface Session {
  assetRoot?: AssetRoot
  authorize?: FileAuthorization
  id: string
  owner: number
  file: FileRecord | null
  info: FileInfo
  queue: Promise<void>
  notified: string | null
}
interface DirectoryWatch {
  watcher: FSWatcher
  records: Set<FileRecord>
  timer: ReturnType<typeof setTimeout> | null
}

export class FileSessions {
  private readonly sessions = new Map<string, Session>()
  private readonly records = new Set<FileRecord>()
  private readonly watches = new Map<string, DirectoryWatch>()
  private registryQueue: Promise<void> = Promise.resolve()
  constructor(private readonly changed: (owner: number, id: string) => void) {}

  create(owner: number): FileSnapshot {
    if ([...this.sessions.values()].filter((session) => session.owner === owner).length >= 32)
      throw new FileOperationError('file-tabs')
    const id = randomUUID()
    const info: FileInfo = {
      id,
      name: 'Untitled',
      displayPath: null,
      fingerprint: null,
      encoding: 'utf8',
      bom: false,
      newline: 'lf',
      unsafeDecoding: false,
    }
    this.sessions.set(id, { id, owner, file: null, info, queue: Promise.resolve(), notified: null })
    return { info: { ...info }, text: '' }
  }

  private owned(owner: number, id: string): Session {
    const session = this.sessions.get(id)
    if (!session || session.owner !== owner) throw new FileOperationError('file-session')
    return session
  }

  describe(owner: number, id: string): FileInfo {
    return { ...this.owned(owner, id).info }
  }
  /** Sync joins the ordinary save queues and retains the exact saved-byte fingerprint. */
  private savedOperation<T>(
    owner: number,
    id: string,
    current: () => void,
    operation: (session: Session, record: FileRecord) => Promise<T>,
  ): Promise<T> {
    const session = this.owned(owner, id)
    const pending = session.queue.then(async () => {
      current()
      const record = this.owned(owner, id).file
      if (!record) throw new FileOperationError('sync-save-first')
      const queued = record.queue.then(async () => {
        current()
        if (this.owned(owner, id).file !== record) throw new FileOperationError('sync-changed')
        await session.authorize?.(record.path)
        current()
        return operation(session, record)
      })
      record.queue = queued.then(
        () => {},
        () => {},
      )
      return queued
    })
    session.queue = pending.then(
      () => {},
      () => {},
    )
    return pending
  }
  captureSaved(owner: number, id: string, current: () => void): Promise<SavedFileCapture> {
    return this.savedOperation(owner, id, current, async (session, record) => {
      const disk = await readDisk(record.path)
      await session.authorize?.(record.path, disk.identity)
      current()
      if (disk.fingerprint !== session.info.fingerprint)
        throw new FileOperationError('sync-changed')
      return { path: record.path, disk }
    })
  }
  replaceSaved(
    owner: number,
    id: string,
    captured: SavedFileCapture,
    bytes: Buffer,
    current: () => void,
  ): Promise<void> {
    return this.savedOperation(owner, id, current, async (session, record) => {
      if (record.path !== captured.path || session.info.fingerprint !== captured.disk.fingerprint)
        throw new FileOperationError('sync-changed')
      if (Buffer.byteLength(decodeDocument(bytes).text, 'utf8') > documentLimit)
        throw new FileOperationError('file-large')
      const authorize = async (): Promise<void> => {
        current()
        if (this.owned(owner, id).file !== record) throw new FileOperationError('sync-changed')
        await session.authorize?.(record.path)
        current()
      }
      const written = await atomicWrite(record.path, bytes, captured.disk.fingerprint, {
        beforeWrite: authorize,
        beforeReplace: authorize,
        beforeCommit: current,
      })
      record.identity = written.identity
      // Preserve session metadata until the renderer's existing reload/conflict flow accepts it.
      this.notify(record, written.fingerprint)
    })
  }
  async assertExportDestination(path: string): Promise<void> {
    const target = await stat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    for (const record of this.records) {
      if (record.path === path) throw new FileOperationError('export-target')
      if (!target) continue
      const current = await stat(record.path, { bigint: true }).catch(() => null)
      if (current && current.dev === target.dev && current.ino === target.ino)
        throw new FileOperationError('export-target')
    }
  }

  async assetContext(
    owner: number,
    id: string,
  ): Promise<{ path: string; root: AssetRoot; parent: AssetRoot }> {
    const session = this.owned(owner, id)
    const record = session.file
    if (!record) throw new FileOperationError('asset-save-first')
    await session.authorize?.(record.path)
    if (this.owned(owner, id).file !== record) throw new FileOperationError('file-session')
    const parent = { path: dirname(record.path), identity: record.watchKey }
    return { path: record.path, root: session.assetRoot || parent, parent }
  }

  private async record(path: string, disk: DiskSnapshot): Promise<FileRecord> {
    let result: FileRecord | undefined
    const operation = this.registryQueue.then(async () => {
      for (const existing of this.records) {
        let identity: string | null = null
        try {
          const current = await stat(existing.path, { bigint: true })
          identity = `${current.dev}:${current.ino}`
        } catch {
          /* An unrelated missing or unreadable file cannot block this open. */
        }
        if (existing.path === path || identity === disk.identity) {
          result = existing
          return
        }
      }
      const parent = await stat(dirname(path), { bigint: true })
      const watchKey = `${parent.dev}:${parent.ino}`
      result = {
        path,
        identity: disk.identity,
        queue: Promise.resolve(),
        sessions: new Set(),
        watchKey,
      }
      let directory = this.watches.get(watchKey)
      if (!directory) {
        const records = new Set<FileRecord>()
        const watcher = watch(dirname(path), () => {
          const entry = this.watches.get(watchKey)
          if (!entry || entry.timer) return
          entry.timer = setTimeout(() => {
            entry.timer = null
            for (const record of records) void this.inspect(record)
          }, 150)
        })
        watcher.on('error', () => {
          for (const record of records) this.notify(record, 'watch-error')
        })
        directory = { watcher, records, timer: null }
        this.watches.set(watchKey, directory)
      }
      directory.records.add(result)
      this.records.add(result)
    })
    this.registryQueue = operation.catch(() => {})
    await operation
    if (!result) throw new FileOperationError('file-io')
    return result
  }

  async open(
    owner: number,
    path: string,
    encoding?: string,
    reuseOwner = false,
    authorize?: FileAuthorization,
    assetRoot?: AssetRoot,
  ): Promise<FileSnapshot> {
    try {
      const canonical = await realpath(path)
      await authorize?.(canonical)
      const disk = await readDisk(canonical)
      await authorize?.(canonical, disk.identity)
      const decoded = decodeDocument(disk.bytes, encoding)
      if (Buffer.byteLength(decoded.text, 'utf8') > documentLimit)
        throw new FileOperationError('file-large')
      const record = await this.record(canonical, disk)
      if (reuseOwner) {
        const existing = [...record.sessions]
          .map((id) => this.sessions.get(id))
          .find((session) => session?.owner === owner)
        if (existing) {
          if (assetRoot && canonical === record.path) existing.assetRoot = assetRoot
          return { info: { ...existing.info }, text: decoded.text }
        }
      }
      let snapshot: FileSnapshot
      try {
        snapshot = this.create(owner)
      } catch (error) {
        if (!record.sessions.size) this.release(record)
        throw error
      }
      const session = this.owned(owner, snapshot.info.id)
      session.file = record
      session.authorize = authorize
      session.assetRoot = assetRoot
      record.sessions.add(session.id)
      session.info = this.info(session.id, record, disk, decoded.metadata)
      return { info: { ...session.info }, text: decoded.text }
    } catch (error) {
      throw fileError(error)
    }
  }

  private info(
    id: string,
    record: FileRecord,
    disk: DiskSnapshot,
    metadata: EncodingInfo,
  ): FileInfo {
    return {
      id,
      name: basename(record.path),
      displayPath: record.path,
      fingerprint: disk.fingerprint,
      ...metadata,
    }
  }

  async reload(owner: number, id: string, encoding?: string): Promise<FileSnapshot> {
    const session = this.owned(owner, id)
    const operation = session.queue.then(async () => {
      this.owned(owner, id)
      if (!session.file) return { info: { ...session.info }, text: '' }
      await session.file.queue
      await session.authorize?.(session.file.path)
      const disk = await readDisk(session.file.path)
      await session.authorize?.(session.file.path, disk.identity)
      const decoded = decodeDocument(disk.bytes, encoding)
      if (Buffer.byteLength(decoded.text, 'utf8') > documentLimit)
        throw new FileOperationError('file-large')
      session.info = this.info(id, session.file, disk, decoded.metadata)
      session.notified = null
      return { info: { ...session.info }, text: decoded.text }
    })
    session.queue = operation.then(
      () => {},
      () => {},
    )
    try {
      return await operation
    } catch (error) {
      throw fileError(error)
    }
  }

  async save(owner: number, request: SaveRequest, dialogs: FileDialogs): Promise<SaveOutcome> {
    const session = this.owned(owner, request.id)
    let outcome: SaveOutcome = { kind: 'cancelled' }
    const operation = session.queue.then(async () => {
      this.owned(owner, request.id)
      const copying = request.action === 'save-copy'
      const choosing = copying || request.action === 'save-as' || !session.file
      const oldRecord = session.file
      let path = oldRecord?.path || ''
      let expected = request.expectedFingerprint
      let metadata: EncodingInfo = {
        encoding: session.info.encoding,
        bom: session.info.bom,
        newline: session.info.newline,
        unsafeDecoding: session.info.unsafeDecoding,
      }
      if (request.utf8 || copying || !oldRecord)
        metadata = { ...metadata, encoding: 'utf8', bom: false, unsafeDecoding: false }
      if (request.normalize) metadata.newline = request.normalize
      if (copying && metadata.newline === 'mixed') metadata.newline = 'lf'
      if (choosing) {
        const suggested =
          copying && path
            ? join(dirname(path), `${basename(path).replace(/\.[^.]+$/, '')}-copy.md`)
            : path || 'Untitled.md'
        const selected = await dialogs.save(suggested)
        if (!selected) return
        path = join(await realpath(dirname(selected)), basename(selected))
        const existing = await maybeDisk(path)
        if (copying && existing) throw new FileOperationError('file-changed')
        if (existing) path = await realpath(path)
        expected = existing?.fingerprint || null
      } else if (request.action === 'overwrite') {
        if (!(await dialogs.overwrite(path))) return
        expected = (await maybeDisk(path))?.fingerprint || null
      }
      if (!copying && oldRecord && metadata.unsafeDecoding)
        throw new FileOperationError('file-unsafe')
      const bytes = encodeDocument(request.text, metadata)
      if (!choosing) await session.authorize?.(path)
      const current = await maybeDisk(path)
      if (!choosing) await session.authorize?.(path, current?.identity)
      const target = current ? await this.record(path, current) : null
      if (
        !copying &&
        target &&
        [...target.sessions].some(
          (id) => id !== session.id && this.sessions.get(id)?.owner === owner,
        )
      )
        throw new FileOperationError('file-open')
      const write = async (): Promise<void> => {
        if (!choosing) await session.authorize?.(path)
        const disk = await atomicWrite(path, bytes, expected)
        if (copying) {
          outcome = { kind: 'copy', displayPath: path, revision: request.revision }
          return
        }
        const next = target || (await this.record(path, disk))
        next.identity = disk.identity
        if (oldRecord && oldRecord !== next) this.detach(session)
        session.file = next
        if (choosing) {
          session.authorize = undefined
          session.assetRoot = undefined
        }
        next.sessions.add(session.id)
        session.info = this.info(session.id, next, disk, metadata)
        session.notified = null
        outcome = { kind: 'saved', info: { ...session.info }, revision: request.revision }
      }
      const queued = (target?.queue || Promise.resolve()).then(write)
      if (target) target.queue = queued.catch(() => {})
      try {
        await queued
      } finally {
        if (target && !target.sessions.size) this.release(target)
      }
    })
    session.queue = operation.catch(() => {})
    try {
      await operation
      return outcome
    } catch (error) {
      throw fileError(error)
    }
  }

  private notify(record: FileRecord, fingerprint: string): void {
    for (const id of record.sessions) {
      const session = this.sessions.get(id)
      if (session && fingerprint !== session.info.fingerprint && session.notified !== fingerprint) {
        session.notified = fingerprint
        this.changed(session.owner, id)
      }
    }
  }
  private async inspect(record: FileRecord): Promise<void> {
    await record.queue
    try {
      let authorized = false
      for (const id of record.sessions) {
        const session = this.sessions.get(id)
        if (!session) continue
        try {
          await session.authorize?.(record.path)
          authorized = true
          break
        } catch {
          /* Notify consumers without reading a revoked path. */
        }
      }
      if (!authorized) {
        this.notify(record, 'unreadable')
        return
      }
      this.notify(record, (await maybeDisk(record.path))?.fingerprint || 'missing')
    } catch {
      this.notify(record, 'unreadable')
    }
  }
  async checkExternal(owner: number): Promise<void> {
    await Promise.all(
      [...this.records]
        .filter((record) =>
          [...record.sessions].some((id) => this.sessions.get(id)?.owner === owner),
        )
        .map((record) => this.inspect(record)),
    )
  }
  private detach(session: Session): void {
    const record = session.file
    if (!record) return
    record.sessions.delete(session.id)
    if (!record.sessions.size) this.release(record)
  }
  private release(record: FileRecord): void {
    this.records.delete(record)
    const directory = this.watches.get(record.watchKey)
    directory?.records.delete(record)
    if (directory && !directory.records.size) {
      directory.watcher.close()
      if (directory.timer) clearTimeout(directory.timer)
      this.watches.delete(record.watchKey)
    }
  }
  async close(owner: number, id: string): Promise<void> {
    const session = this.owned(owner, id)
    await session.queue
    this.detach(session)
    this.sessions.delete(id)
  }
  async closeOwner(owner: number): Promise<void> {
    await Promise.all(
      [...this.sessions.values()]
        .filter((session) => session.owner === owner)
        .map((session) => this.close(owner, session.id)),
    )
  }
  get diagnostics(): { sessions: number; files: number; watchers: number } {
    return { sessions: this.sessions.size, files: this.records.size, watchers: this.watches.size }
  }
}
