import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { workspaceLimits } from '../../shared/workspace-contracts'
import { FileOperationError } from '../files/errors'

export interface WorkspaceState {
  schemaVersion: 1
  root: string | null
  recents: string[]
  documents: string[]
  activePath: string | null
}
function parsePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 32768 ||
    value.includes('\0') ||
    !isAbsolute(value)
  )
    throw new Error('Invalid stored path')
  return value
}
function parseState(value: unknown): WorkspaceState {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1
  )
    throw new Error('Invalid workspace state')
  const input = value as Record<string, unknown>
  if (
    Object.keys(input).some(
      (key) => !['schemaVersion', 'root', 'recents', 'documents', 'activePath'].includes(key),
    ) ||
    !Array.isArray(input.recents) ||
    input.recents.length > workspaceLimits.recent ||
    !Array.isArray(input.documents) ||
    input.documents.length > 32
  )
    throw new Error('Invalid workspace state')
  const documents = input.documents.map(parsePath)
  const activePath = input.activePath === null ? null : parsePath(input.activePath)
  if (activePath && !documents.includes(activePath)) throw new Error('Invalid active path')
  return {
    schemaVersion: 1,
    root: input.root === null ? null : parsePath(input.root),
    recents: [...new Set(input.recents.map(parsePath))],
    documents: [...new Set(documents)],
    activePath,
  }
}

/** Private path metadata only. One running atomic write and one latest desired state. */
export class WorkspaceStateRepository {
  private current: WorkspaceState = {
    schemaVersion: 1,
    root: null,
    recents: [],
    documents: [],
    activePath: null,
  }
  private desired: WorkspaceState | null = null
  private writing: Promise<void> | null = null
  recovered = false
  readOnly = false
  persistenceError = false
  constructor(private readonly path: string) {}
  get(): WorkspaceState {
    return structuredClone(this.current)
  }
  async load(): Promise<void> {
    let file: Awaited<ReturnType<typeof open>>
    try {
      file = await open(this.path, 'r')
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
        return
      this.persistenceError = true
      return
    }
    let parsed: unknown
    try {
      const metadata = await file.stat()
      if (metadata.size > workspaceLimits.stateBytes) throw new Error('Workspace state too large')
      const buffer = Buffer.alloc(metadata.size + 1)
      let length = 0
      while (length < buffer.length) {
        const result = await file.read(buffer, length, buffer.length - length)
        if (!result.bytesRead) break
        length += result.bytesRead
      }
      if (length > metadata.size) throw new Error('Workspace state changed')
      parsed = JSON.parse(buffer.subarray(0, length).toString('utf8'))
    } catch {
      parsed = null
    } finally {
      await file.close()
    }
    const backup = `${this.path}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`
    try {
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'schemaVersion' in parsed &&
        typeof parsed.schemaVersion === 'number' &&
        parsed.schemaVersion > 1
      ) {
        await copyFile(this.path, backup)
        this.readOnly = true
        return
      }
      try {
        this.current = parseState(parsed)
      } catch {
        await rename(this.path, backup)
        this.recovered = true
      }
    } catch {
      this.readOnly = true
      this.persistenceError = true
    }
  }
  save(patch: Partial<Omit<WorkspaceState, 'schemaVersion'>>): Promise<void> {
    if (this.readOnly) return Promise.reject(new FileOperationError('workspace-readonly'))
    this.current = parseState({ ...this.current, ...patch })
    this.desired = this.get()
    this.writing ??= this.drain().finally(() => {
      this.writing = null
    })
    return this.writing
  }
  private async drain(): Promise<void> {
    try {
      while (this.desired) {
        const next = this.desired
        this.desired = null
        const text = JSON.stringify(next)
        if (Buffer.byteLength(text) > workspaceLimits.stateBytes)
          throw new Error('Workspace state too large')
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
        const temporary = `${this.path}.${randomUUID()}.tmp`
        try {
          const file = await open(temporary, 'wx', 0o600)
          try {
            await file.writeFile(text, 'utf8')
            await file.sync()
          } finally {
            await file.close()
          }
          await rename(temporary, this.path)
        } finally {
          await rm(temporary, { force: true }).catch(() => {})
        }
      }
      this.persistenceError = false
    } catch {
      this.persistenceError = true
      throw new FileOperationError('workspace-persist')
    }
  }
}
