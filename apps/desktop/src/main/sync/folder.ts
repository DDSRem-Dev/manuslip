import { lstat, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parseSyncFilename } from '../../shared/sync-contracts'
import { atomicWrite, maybeDisk } from '../files/disk'
import { FileOperationError } from '../files/errors'
import { type RemoteSnapshot, SyncAdapterFailure, syncHash } from './webdav'

export interface FolderScope {
  root: string
  identity: string
  filename: string
}
export function syncFilename(value: string): string {
  try {
    return parseSyncFilename(value)
  } catch {
    throw new SyncAdapterFailure('sync-invalid')
  }
}
export async function chooseFolderScope(root: string, filename: string): Promise<FolderScope> {
  const canonical = await realpath(root),
    metadata = await stat(canonical, { bigint: true })
  if (!metadata.isDirectory()) throw new SyncAdapterFailure('sync-invalid')
  return {
    root: canonical,
    identity: `${metadata.dev}:${metadata.ino}`,
    filename: syncFilename(filename),
  }
}
/** Root identity and the single direct child are rechecked on every action/publication. */
export class FolderAdapter {
  constructor(
    private readonly scope: FolderScope,
    private readonly protectDestination: (path: string) => Promise<void>,
  ) {
    syncFilename(scope.filename)
    if (!/^\d+:\d+$/.test(scope.identity)) throw new SyncAdapterFailure('sync-invalid')
  }
  private async path(signal: AbortSignal, current: () => void): Promise<string> {
    current()
    signal.throwIfAborted()
    const canonical = await realpath(this.scope.root),
      metadata = await stat(canonical, { bigint: true })
    current()
    signal.throwIfAborted()
    if (
      canonical !== this.scope.root ||
      !metadata.isDirectory() ||
      `${metadata.dev}:${metadata.ino}` !== this.scope.identity
    )
      throw new SyncAdapterFailure('sync-changed')
    const path = join(canonical, this.scope.filename)
    const existing = await lstat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink > 1n))
      throw new SyncAdapterFailure('sync-invalid')
    await this.protectDestination(path)
    current()
    signal.throwIfAborted()
    return path
  }
  async read(signal: AbortSignal, current: () => void): Promise<RemoteSnapshot | null> {
    const path = await this.path(signal, current),
      snapshot = await maybeDisk(path)
    current()
    signal.throwIfAborted()
    await this.path(signal, current)
    return snapshot
      ? { bytes: snapshot.bytes, hash: syncHash(snapshot.bytes), version: snapshot.fingerprint }
      : null
  }
  async write(
    bytes: Buffer,
    expected: RemoteSnapshot | null,
    signal: AbortSignal,
    current: () => void,
  ): Promise<RemoteSnapshot> {
    const path = await this.path(signal, current)
    try {
      const written = await atomicWrite(path, bytes, expected?.version || null, {
        beforeWrite: async () => {
          await this.path(signal, current)
        },
        beforeCommit: () => {
          current()
          signal.throwIfAborted()
        },
        beforeReplace: async () => {
          await this.path(signal, current)
        },
      })
      current()
      signal.throwIfAborted()
      return { bytes: written.bytes, hash: syncHash(written.bytes), version: written.fingerprint }
    } catch (error) {
      if (error instanceof FileOperationError && error.code === 'file-changed')
        throw new SyncAdapterFailure('sync-changed')
      throw error
    }
  }
}
