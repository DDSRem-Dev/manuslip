import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rename } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { parseId, record } from '../../shared/file-contracts'
import { atomicWrite, maybeDisk } from '../files/disk'
import { FileOperationError } from '../files/errors'
import { type FolderScope, syncFilename } from './folder'
import { webDavUrl } from './webdav'

export const syncRegistryLimits = { bytes: 1024 * 1024, connections: 32 } as const
export type SyncConfiguration =
  | { kind: 'folder'; scope: FolderScope }
  | { kind: 'webdav'; url: string }
export interface SyncIntent {
  direction: 'upload' | 'download'
  localHash: string
  remoteHash: string | null
  outputHash: string
  recoveryId: string | null
}
export interface SyncConnection {
  id: string
  localPath: string
  configuration: SyncConfiguration
  baseline: string | null
  syncedAt: number | null
  intent: SyncIntent | null
  encryptedCredential: string | null
}
function exact(value: Record<string, unknown>, names: string[]): void {
  if (Object.keys(value).sort().join() !== [...names].sort().join())
    throw new Error('Invalid sync metadata')
}
function path(input: unknown): string {
  if (
    typeof input !== 'string' ||
    !input ||
    input.length > 32768 ||
    !input.isWellFormed() ||
    input.includes('\0') ||
    !isAbsolute(input)
  )
    throw new Error('Invalid sync path')
  return input
}
function hash(input: unknown): string {
  if (typeof input !== 'string' || !/^[a-f0-9]{64}$/.test(input))
    throw new Error('Invalid sync hash')
  return input
}
export function parseSyncConnection(input: unknown): SyncConnection {
  const value = record(input)
  exact(value, [
    'id',
    'localPath',
    'configuration',
    'baseline',
    'syncedAt',
    'intent',
    'encryptedCredential',
  ])
  const adapter = record(value.configuration)
  let configuration: SyncConfiguration
  if (adapter.kind === 'folder') {
    exact(adapter, ['kind', 'scope'])
    const scope = record(adapter.scope)
    exact(scope, ['root', 'identity', 'filename'])
    if (
      typeof scope.identity !== 'string' ||
      !/^\d+:\d+$/.test(scope.identity) ||
      typeof scope.filename !== 'string'
    )
      throw new Error('Invalid folder grant')
    configuration = {
      kind: 'folder',
      scope: {
        root: path(scope.root),
        identity: scope.identity,
        filename: syncFilename(scope.filename),
      },
    }
  } else if (adapter.kind === 'webdav') {
    exact(adapter, ['kind', 'url'])
    if (typeof adapter.url !== 'string') throw new Error('Invalid remote URL')
    configuration = { kind: 'webdav', url: webDavUrl(adapter.url).href }
  } else throw new Error('Invalid sync adapter')
  let intent: SyncIntent | null = null
  if (value.intent !== null) {
    const pending = record(value.intent)
    exact(pending, ['direction', 'localHash', 'remoteHash', 'outputHash', 'recoveryId'])
    if (pending.direction !== 'upload' && pending.direction !== 'download')
      throw new Error('Invalid sync direction')
    intent = {
      direction: pending.direction,
      localHash: hash(pending.localHash),
      remoteHash: pending.remoteHash === null ? null : hash(pending.remoteHash),
      outputHash: hash(pending.outputHash),
      recoveryId: pending.recoveryId === null ? null : parseId(pending.recoveryId),
    }
  }
  if (
    value.syncedAt !== null &&
    (!Number.isSafeInteger(value.syncedAt) || (value.syncedAt as number) < 0)
  )
    throw new Error('Invalid sync timestamp')
  if (
    value.encryptedCredential !== null &&
    (typeof value.encryptedCredential !== 'string' ||
      value.encryptedCredential.length > 32768 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        value.encryptedCredential,
      ) ||
      !value.encryptedCredential)
  )
    throw new Error('Invalid encrypted credential')
  if (configuration.kind === 'folder' && value.encryptedCredential !== null)
    throw new Error('Unexpected folder credential')
  return {
    id: parseId(value.id),
    localPath: path(value.localPath),
    configuration,
    baseline: value.baseline === null ? null : hash(value.baseline),
    syncedAt: value.syncedAt as number | null,
    intent,
    encryptedCredential: value.encryptedCredential as string | null,
  }
}
function parseConnections(input: unknown): SyncConnection[] {
  if (!Array.isArray(input) || input.length > syncRegistryLimits.connections)
    throw new Error('Invalid sync connections')
  const rows = input.map(parseSyncConnection)
  if (
    new Set(rows.map((row) => row.id)).size !== rows.length ||
    new Set(rows.map((row) => row.localPath)).size !== rows.length
  )
    throw new Error('Duplicate sync connection')
  return rows
}

/** Main-owned grants and common baselines. The intent remains durable until verified publication. */
export class SyncRepository {
  private rows: SyncConnection[] = []
  private fingerprint: string | null = null
  private queue: Promise<void> = Promise.resolve()
  recovered = false
  readOnly = false
  constructor(private readonly path: string) {}
  list(): SyncConnection[] {
    return structuredClone(this.rows)
  }
  async load(): Promise<void> {
    let parsed: unknown
    try {
      const disk = await maybeDisk(this.path, syncRegistryLimits.bytes)
      if (!disk) return
      this.fingerprint = disk.fingerprint
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(disk.bytes))
    } catch {
      parsed = null
    }
    const backup = `${this.path}.backup-${randomUUID()}`
    try {
      if (
        parsed &&
        typeof parsed === 'object' &&
        'schemaVersion' in parsed &&
        typeof parsed.schemaVersion === 'number' &&
        parsed.schemaVersion > 1
      ) {
        this.readOnly = true
        await copyFile(this.path, backup)
        return
      }
      try {
        const value = record(parsed)
        exact(value, ['schemaVersion', 'connections'])
        if (value.schemaVersion !== 1) throw new Error('Invalid sync registry')
        this.rows = parseConnections(value.connections)
      } catch {
        await rename(this.path, backup)
        this.fingerprint = null
        this.recovered = true
      }
    } catch {
      this.readOnly = true
    }
  }
  mutate(
    change: (rows: SyncConnection[]) => SyncConnection[],
    authorize: () => void,
  ): Promise<void> {
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        authorize()
        if (this.readOnly) throw new FileOperationError('sync-readonly')
        const next = parseConnections(change(this.list())),
          bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, connections: next }))
        if (bytes.length > syncRegistryLimits.bytes) throw new FileOperationError('sync-limit')
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
        const disk = await atomicWrite(this.path, bytes, this.fingerprint, {
          maximumBytes: syncRegistryLimits.bytes,
          beforeWrite: async () => authorize(),
          beforeCommit: authorize,
          beforeReplace: async () => authorize(),
        })
        this.fingerprint = disk.fingerprint
        this.rows = next
      })
      .catch((error) => {
        if (
          error instanceof FileOperationError &&
          [
            'sync-readonly',
            'sync-limit',
            'file-session',
            'sync-cancelled',
            'sync-timeout',
          ].includes(error.code)
        )
          throw error
        throw new FileOperationError('sync-storage')
      })
    this.queue = operation
    return operation
  }
}
