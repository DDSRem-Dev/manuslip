import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type {
  SyncChoice,
  SyncConnectRequest,
  SyncCredentialRequest,
  SyncReview,
  SyncState,
} from '../../shared/sync-contracts'
import { atomicWrite, maybeDisk } from '../files/disk'
import { decodeDocument } from '../files/encoding'
import { FileOperationError, fileError } from '../files/errors'
import type { FileSessions, SavedFileCapture } from '../files/sessions'
import type { KeyStore } from '../translation/credentials'
import { SyncCredentials, type TrackSyncWork } from './credentials'
import { chooseFolderScope, FolderAdapter } from './folder'
import { planSync } from './plan'
import type { SyncRecoveryRepository } from './recovery'
import type { SyncConfiguration, SyncConnection, SyncRepository } from './repository'
import { type RemoteSnapshot, syncHash, WebDavAdapter } from './webdav'

interface Job {
  documentId: string | null
  key: string
  controller: AbortController
  done: Promise<unknown>
  pending: Set<Promise<unknown>>
}
interface Review {
  owner: number
  documentId: string
  connection: SyncConnection
  local: SavedFileCapture
  remote: RemoteSnapshot | null
  summary: SyncReview
  timer: ReturnType<typeof setTimeout>
}
export interface SyncDialogs {
  folder(): Promise<string | null>
  save(name: string, artifact: boolean): Promise<string | null>
}
function preview(bytes: Buffer): string {
  try {
    return decodeDocument(bytes.subarray(0, 8192)).text.slice(0, 8192).replaceAll('\0', '�')
  } catch {
    return ''
  }
}
/** Explicit, conditional transfers. No remote access occurs while listing or opening documents. */
export class SyncService {
  private readonly jobs = new Map<number, Job>()
  private readonly reviews = new Map<number, Review>()
  private readonly credentials: SyncCredentials
  private readonly loaded: Promise<void>
  constructor(
    private readonly repository: SyncRepository,
    private readonly recoveries: SyncRecoveryRepository,
    private readonly files: FileSessions,
    keyStore: KeyStore,
  ) {
    this.credentials = new SyncCredentials(repository, keyStore)
    this.loaded = repository.load()
  }
  private clearReview(owner: number): void {
    const previous = this.reviews.get(owner)
    if (previous) clearTimeout(previous.timer)
    this.reviews.delete(owner)
  }
  private connection(owner: number, documentId: string): SyncConnection | null {
    const path = this.files.describe(owner, documentId).displayPath
    return this.repository.list().find((row) => row.localPath === path) || null
  }
  private required(owner: number, documentId: string): SyncConnection {
    const row = this.connection(owner, documentId)
    if (!row) throw new FileOperationError('sync-invalid')
    return row
  }
  async state(owner: number, documentId: string, authorize: () => void): Promise<SyncState> {
    authorize()
    await this.loaded
    const row = this.connection(owner, documentId),
      inventory = await this.recoveries.list()
    authorize()
    this.files.describe(owner, documentId)
    const review = this.reviews.get(owner)
    if (review && (review.summary.expiresAt <= Date.now() || review.connection.id !== row?.id))
      this.clearReview(owner)
    return {
      connection: row
        ? {
            id: row.id,
            kind: row.configuration.kind,
            scope:
              row.configuration.kind === 'folder'
                ? join(row.configuration.scope.root, row.configuration.scope.filename)
                : row.configuration.url,
            syncedAt: row.syncedAt,
            interrupted: row.intent !== null,
            credential: this.credentials.status(row),
          }
        : null,
      review:
        this.reviews.get(owner)?.documentId === documentId
          ? this.reviews.get(owner)?.summary || null
          : null,
      copies: inventory.copies,
      recoveryBlocked: inventory.blocked,
      recovered: this.repository.recovered,
      readOnly: this.repository.readOnly,
      busy: this.jobs.has(owner),
    }
  }
  private async run<T>(
    owner: number,
    documentId: string | null,
    authorize: () => void,
    operation: (current: () => void, signal: AbortSignal, track: TrackSyncWork) => Promise<T>,
  ): Promise<T> {
    authorize()
    await this.loaded
    const key =
      documentId === null ? 'recoveries' : this.files.describe(owner, documentId).displayPath
    if (!key) throw new FileOperationError('sync-save-first')
    if (this.jobs.has(owner) || [...this.jobs.values()].some((job) => job.key === key))
      throw new FileOperationError('sync-busy')
    const job: Job = {
      documentId,
      key,
      controller: new AbortController(),
      done: Promise.resolve(),
      pending: new Set(),
    }
    this.jobs.set(owner, job)
    const current = (): void => {
      authorize()
      if (job.controller.signal.aborted) throw job.controller.signal.reason
      if (
        this.jobs.get(owner) !== job ||
        (documentId !== null && this.files.describe(owner, documentId).displayPath !== key)
      )
        throw new FileOperationError('sync-changed')
    }
    const track: TrackSyncWork = <V>(pending: Promise<V>): Promise<V> => {
      job.pending.add(pending)
      void pending.finally(() => job.pending.delete(pending)).catch(() => {})
      return pending
    }
    const deadline = setTimeout(
      () => job.controller.abort(new FileOperationError('sync-timeout')),
      60_000,
    )
    let aborted: (() => void) | undefined
    const interrupted = new Promise<never>((_, reject) => {
      aborted = () => reject(job.controller.signal.reason)
      job.controller.signal.addEventListener('abort', aborted, { once: true })
    })
    const execution = (async () => {
      try {
        current()
        return await operation(current, job.controller.signal, track)
      } catch (error) {
        if (job.controller.signal.aborted) throw job.controller.signal.reason
        throw fileError(error)
      }
    })()
    const settled = execution.finally(async () => {
      // Native pickers/key-store operations cannot always be aborted. Keep the slot charged.
      if (job.pending.size) await Promise.allSettled([...job.pending])
      clearTimeout(deadline)
      if (aborted) job.controller.signal.removeEventListener('abort', aborted)
      if (this.jobs.get(owner) === job) this.jobs.delete(owner)
    })
    job.done = settled
    void settled.catch(() => {})
    return Promise.race([execution, interrupted])
  }
  async connect(
    owner: number,
    request: SyncConnectRequest,
    dialogs: SyncDialogs,
    authorize: () => void,
  ): Promise<SyncState> {
    await this.run(owner, request.documentId, authorize, async (current) => {
      const local = await this.files.captureSaved(owner, request.documentId, current)
      if (this.connection(owner, request.documentId)) throw new FileOperationError('sync-invalid')
      let configuration: SyncConfiguration
      if (request.kind === 'folder') {
        const selected = await dialogs.folder()
        current()
        if (!selected) return
        const scope = await chooseFolderScope(selected, request.filename)
        await this.files.assertExportDestination(join(scope.root, scope.filename))
        current()
        configuration = { kind: 'folder', scope }
      } else configuration = { kind: 'webdav', url: request.url }
      await this.repository.mutate(
        (rows) => [
          ...rows,
          {
            id: randomUUID(),
            localPath: local.path,
            configuration,
            baseline: null,
            syncedAt: null,
            intent: null,
            encryptedCredential: null,
          },
        ],
        current,
      )
      this.clearReview(owner)
    })
    return this.state(owner, request.documentId, authorize)
  }
  async credential(
    owner: number,
    request: SyncCredentialRequest,
    authorize: () => void,
  ): Promise<SyncState> {
    await this.run(owner, request.documentId, authorize, async (current, _signal, track) => {
      const connection = this.required(owner, request.documentId)
      for (const [reviewOwner, review] of this.reviews)
        if (review.connection.id === connection.id) this.clearReview(reviewOwner)
      await this.credentials.set(connection, request, current, track)
    })
    return this.state(owner, request.documentId, authorize)
  }
  private async adapter(
    connection: SyncConnection,
    current: () => void,
    track: TrackSyncWork,
  ): Promise<FolderAdapter | WebDavAdapter> {
    if (connection.configuration.kind === 'folder')
      return new FolderAdapter(connection.configuration.scope, (path) =>
        this.files.assertExportDestination(path),
      )
    const authorization = await this.credentials.get(connection, current, track)
    current()
    return new WebDavAdapter(connection.configuration.url, () => {
      current()
      return authorization
    })
  }
  private update(row: SyncConnection, hash: string, current: () => void): Promise<void> {
    return this.repository.mutate(
      (rows) =>
        rows.map((value) =>
          value.id === row.id
            ? { ...value, baseline: hash, syncedAt: Date.now(), intent: null }
            : value,
        ),
      current,
    )
  }
  async review(owner: number, documentId: string, authorize: () => void): Promise<SyncState> {
    await this.run(owner, documentId, authorize, async (current, signal, track) => {
      this.clearReview(owner)
      const connection = this.required(owner, documentId),
        local = await this.files.captureSaved(owner, documentId, current),
        adapter = await this.adapter(connection, current, track),
        remote = await adapter.read(signal, current)
      current()
      const latest = await this.files.captureSaved(owner, documentId, current)
      if (latest.path !== local.path || latest.disk.fingerprint !== local.disk.fingerprint)
        throw new FileOperationError('sync-changed')
      const plan = planSync(syncHash(local.disk.bytes), remote?.hash || null, connection.baseline)
      if (plan.kind === 'equal') {
        await this.update(connection, plan.hash, current)
        return
      }
      if (
        plan.kind === 'conflict' &&
        (plan.reason === 'local-missing' || plan.reason === 'both-missing')
      )
        throw new FileOperationError('sync-save-first')
      const summary: SyncReview = {
        id: randomUUID(),
        kind: plan.kind,
        reason: plan.kind === 'conflict' ? (plan.reason as SyncReview['reason']) : null,
        localBytes: local.disk.bytes.length,
        remoteBytes: remote?.bytes.length ?? null,
        localPreview: preview(local.disk.bytes),
        remotePreview: remote ? preview(remote.bytes) : null,
        canUpload: connection.configuration.kind === 'folder' || !remote || remote.version !== null,
        expiresAt: Date.now() + 5 * 60_000,
      }
      const timer = setTimeout(() => this.clearReview(owner), 5 * 60_000)
      this.reviews.set(owner, { owner, documentId, connection, local, remote, summary, timer })
    })
    return this.state(owner, documentId, authorize)
  }
  private async exportBytes(
    bytes: Buffer,
    suggested: string,
    artifact: boolean,
    dialogs: SyncDialogs,
    current: () => void,
  ): Promise<boolean> {
    const selected = await dialogs.save(suggested, artifact)
    current()
    if (!selected) return false
    const path = join(await realpath(dirname(selected)), basename(selected)),
      previous = await maybeDisk(path, 50 * 1024 * 1024 + 4096)
    const protect = async (): Promise<void> => {
      current()
      await this.files.assertExportDestination(path)
      current()
    }
    await protect()
    await atomicWrite(path, bytes, previous?.fingerprint || null, {
      maximumBytes: 50 * 1024 * 1024 + 4096,
      beforeWrite: protect,
      beforeReplace: protect,
      beforeCommit: current,
    })
    return true
  }
  async resolve(
    owner: number,
    token: string,
    choice: SyncChoice,
    dialogs: SyncDialogs,
    authorize: () => void,
  ): Promise<SyncState> {
    const review = this.reviews.get(owner)
    if (!review || review.summary.id !== token || review.summary.expiresAt <= Date.now())
      throw new FileOperationError('sync-changed')
    await this.run(owner, review.documentId, authorize, async (current, signal, track) => {
      if (
        this.reviews.get(owner) !== review ||
        this.required(owner, review.documentId).id !== review.connection.id
      )
        throw new FileOperationError('sync-changed')
      if (
        (choice !== 'download' && !review.summary.canUpload) ||
        (choice !== 'upload' && !review.remote)
      )
        throw new FileOperationError('sync-validator')
      const adapter = await this.adapter(review.connection, current, track)
      const validate = async (): Promise<{
        local: SavedFileCapture
        remote: RemoteSnapshot | null
      }> => {
        const local = await this.files.captureSaved(owner, review.documentId, current),
          remote = await adapter.read(signal, current)
        current()
        if (
          local.path !== review.local.path ||
          local.disk.fingerprint !== review.local.disk.fingerprint ||
          remote?.hash !== review.remote?.hash ||
          remote?.version !== review.remote?.version
        )
          throw new FileOperationError('sync-changed')
        return { local, remote }
      }
      let { local, remote } = await validate()
      if (choice === 'keep-both' && remote) {
        if (
          !(await this.exportBytes(
            remote.bytes,
            `${basename(local.path).replace(/\.[^.]+$/, '')}-remote.md`,
            false,
            dialogs,
            current,
          ))
        )
          return
        ;({ local, remote } = await validate())
      }
      const direction = choice === 'download' ? 'download' : 'upload',
        overwritten = direction === 'download' ? local.disk.bytes : remote?.bytes,
        output = direction === 'download' ? remote?.bytes : local.disk.bytes
      if (!output) throw new FileOperationError('sync-invalid')
      const copy = overwritten
        ? await this.recoveries.preserve(
            review.connection.id,
            basename(local.path).slice(0, 160).toWellFormed(),
            direction === 'download' ? 'local' : 'remote',
            overwritten,
            current,
          )
        : null
      await this.repository.mutate(
        (rows) =>
          rows.map((row) =>
            row.id === review.connection.id
              ? {
                  ...row,
                  intent: {
                    direction,
                    localHash: syncHash(local.disk.bytes),
                    remoteHash: remote?.hash || null,
                    outputHash: syncHash(output),
                    recoveryId: copy?.id || null,
                  },
                }
              : row,
          ),
        current,
      )
      // Journal/recovery I/O gives local saves time to settle; check again at publication.
      const confirmed = await this.files.captureSaved(owner, review.documentId, current)
      if (confirmed.disk.fingerprint !== local.disk.fingerprint)
        throw new FileOperationError('sync-changed')
      if (direction === 'upload') await adapter.write(output, remote, signal, current)
      else {
        const latest = await adapter.read(signal, current)
        if (latest?.hash !== remote?.hash || latest?.version !== remote?.version)
          throw new FileOperationError('sync-changed')
        await this.files.replaceSaved(owner, review.documentId, local, output, current)
      }
      current()
      await this.update(review.connection, syncHash(output), current)
      this.clearReview(owner)
    })
    return this.state(owner, review.documentId, authorize)
  }
  cancel(owner: number, documentId: string): void {
    const job = this.jobs.get(owner)
    if (job && (job.documentId === documentId || job.documentId === null))
      job.controller.abort(new FileOperationError('sync-cancelled'))
    if (this.reviews.get(owner)?.documentId === documentId) this.clearReview(owner)
  }
  async disconnect(owner: number, documentId: string, authorize: () => void): Promise<SyncState> {
    await this.loaded
    const connection = this.required(owner, documentId)
    for (const job of this.jobs.values())
      if (job.key === connection.localPath)
        job.controller.abort(new FileOperationError('sync-cancelled'))
    await Promise.allSettled(
      [...this.jobs.values()]
        .filter((job) => job.key === connection.localPath)
        .map((job) => job.done),
    )
    await this.run(owner, documentId, authorize, async (current) => {
      await this.repository.mutate(
        (rows) => rows.filter((row) => row.id !== connection.id),
        current,
      )
      this.credentials.forget(connection.id)
      for (const [reviewOwner, review] of this.reviews)
        if (review.connection.id === connection.id) this.clearReview(reviewOwner)
    })
    return this.state(owner, documentId, authorize)
  }
  exportRecovery(
    owner: number,
    id: string,
    dialogs: SyncDialogs,
    authorize: () => void,
  ): Promise<boolean> {
    return this.run(owner, null, authorize, async (current) => {
      const restored = await this.recoveries.restore(id)
      current()
      return this.exportBytes(
        restored.bytes,
        restored.artifact ? 'sync-recovery-artifact.sync-copy' : 'sync-recovery.md',
        restored.artifact,
        dialogs,
        current,
      )
    })
  }
  removeRecovery(owner: number, id: string, authorize: () => void): Promise<void> {
    return this.run(owner, null, authorize, (current) => this.recoveries.remove(id, current))
  }
  closeDocument(owner: number, documentId: string): void {
    this.cancel(owner, documentId)
  }
  closeOwner(owner: number): void {
    this.jobs.get(owner)?.controller.abort(new FileOperationError('sync-cancelled'))
    this.clearReview(owner)
    // A connection's session credential may be shared only by explicit operations in this app.
    for (const row of this.repository.list()) this.credentials.forget(row.id)
  }
}
