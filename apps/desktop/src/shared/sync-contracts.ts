import type { Result } from './contracts'
import { documentLimit, parseId, parseRevision, record, string } from './file-contracts'

export const syncChannels = {
  state: 'manuslip:sync:state',
  connect: 'manuslip:sync:connect',
  credential: 'manuslip:sync:credential',
  review: 'manuslip:sync:review',
  resolve: 'manuslip:sync:resolve',
  cancel: 'manuslip:sync:cancel',
  disconnect: 'manuslip:sync:disconnect',
  export: 'manuslip:sync:export',
  remove: 'manuslip:sync:remove',
} as const
export type SyncConnectRequest = { documentId: string } & (
  | { kind: 'folder'; filename: string }
  | { kind: 'webdav'; url: string }
)
export interface SyncCredentialRequest {
  documentId: string
  username: string | null
  password: string | null
  persist: boolean
}
export type SyncChoice = 'upload' | 'download' | 'keep-both'
export interface SyncCopy {
  id: string
  name: string
  side: 'local' | 'remote' | 'unknown'
  savedAt: number
  bytes: number
  state: 'verified' | 'damaged' | 'incomplete'
}
export interface SyncReview {
  id: string
  kind: 'upload' | 'download' | 'conflict'
  reason: 'initial' | 'diverged' | 'remote-deleted' | null
  localBytes: number
  remoteBytes: number | null
  localPreview: string
  remotePreview: string | null
  canUpload: boolean
  expiresAt: number
}
export interface SyncState {
  connection: {
    id: string
    kind: 'folder' | 'webdav'
    scope: string
    syncedAt: number | null
    interrupted: boolean
    credential: 'none' | 'session' | 'stored'
  } | null
  review: SyncReview | null
  copies: SyncCopy[]
  recoveryBlocked: boolean
  recovered: boolean
  readOnly: boolean
  busy: boolean
}
export interface SyncBridge {
  syncState(documentId: string): Promise<Result<SyncState>>
  connectSync(request: SyncConnectRequest): Promise<Result<SyncState>>
  setSyncCredential(request: SyncCredentialRequest): Promise<Result<SyncState>>
  reviewSync(documentId: string): Promise<Result<SyncState>>
  resolveSync(token: string, choice: SyncChoice): Promise<Result<SyncState>>
  cancelSync(documentId: string): Promise<Result<null>>
  disconnectSync(documentId: string): Promise<Result<SyncState>>
  exportSyncRecovery(id: string): Promise<Result<boolean>>
  removeSyncRecovery(id: string): Promise<Result<null>>
}
function exact(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error('sync-invalid')
}
function text(value: unknown, maximum: number, empty = false): string {
  const output = string(value, maximum)
  if (
    (!empty && !output) ||
    !output.isWellFormed() ||
    [...output].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    throw new Error('sync-invalid')
  return output
}
export function parseSyncUrl(value: unknown): URL {
  const input = text(value, 2048),
    url = new URL(input)
  if (
    input !== input.trim() ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.endsWith('/') ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new Error('sync-invalid')
  return url
}
export function parseSyncFilename(value: unknown): string {
  const input = text(value, 160)
  if (
    !/\.(?:md|markdown|txt)$/i.test(input) ||
    input !== input.trim() ||
    input.startsWith('.') ||
    /[<>:"/\\|?*]/.test(input) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(input)
  )
    throw new Error('sync-invalid')
  return input
}
export function parseSyncConnect(value: unknown): SyncConnectRequest {
  const input = record(value),
    documentId = parseId(input.documentId)
  if (input.kind === 'folder') {
    exact(input, ['documentId', 'kind', 'filename'])
    return { documentId, kind: 'folder', filename: parseSyncFilename(input.filename) }
  }
  exact(input, ['documentId', 'kind', 'url'])
  if (input.kind !== 'webdav') throw new Error('sync-invalid')
  return { documentId, kind: 'webdav', url: parseSyncUrl(input.url).href }
}
export function parseSyncCredential(value: unknown): SyncCredentialRequest {
  const input = record(value)
  exact(input, ['documentId', 'username', 'password', 'persist'])
  if (typeof input.persist !== 'boolean' || (input.username === null) !== (input.password === null))
    throw new Error('sync-invalid')
  const username = input.username === null ? null : text(input.username, 512, true),
    password = input.password === null ? null : text(input.password, 4096, true)
  if (username?.includes(':')) throw new Error('sync-invalid')
  return { documentId: parseId(input.documentId), username, password, persist: input.persist }
}
export function parseSyncChoice(value: unknown): SyncChoice {
  if (value !== 'upload' && value !== 'download' && value !== 'keep-both')
    throw new Error('sync-invalid')
  return value
}
export function parseSyncRecoveryId(value: unknown): string {
  const input = string(value, 44)
  parseId(input.endsWith('-pending') ? input.slice(0, -8) : input)
  return input
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('sync-invalid')
  return value
}
function bytes(value: unknown, cap: number): number {
  const output = parseRevision(value)
  if (output > cap) throw new Error('sync-invalid')
  return output
}
export function parseSyncState(value: unknown): SyncState {
  const input = record(value)
  exact(input, [
    'connection',
    'review',
    'copies',
    'recoveryBlocked',
    'recovered',
    'readOnly',
    'busy',
  ])
  let connection: SyncState['connection'] = null,
    review: SyncReview | null = null
  if (input.connection !== null) {
    const row = record(input.connection)
    exact(row, ['id', 'kind', 'scope', 'syncedAt', 'interrupted', 'credential'])
    if (
      (row.kind !== 'folder' && row.kind !== 'webdav') ||
      (row.credential !== 'none' && row.credential !== 'session' && row.credential !== 'stored')
    )
      throw new Error('sync-invalid')
    connection = {
      id: parseId(row.id),
      kind: row.kind,
      scope: text(row.scope, 32768),
      syncedAt: row.syncedAt === null ? null : parseRevision(row.syncedAt),
      interrupted: boolean(row.interrupted),
      credential: row.credential,
    }
  }
  if (input.review !== null) {
    const row = record(input.review)
    exact(row, [
      'id',
      'kind',
      'reason',
      'localBytes',
      'remoteBytes',
      'localPreview',
      'remotePreview',
      'canUpload',
      'expiresAt',
    ])
    if (
      !['upload', 'download', 'conflict'].includes(row.kind as string) ||
      (row.reason !== null &&
        !['initial', 'diverged', 'remote-deleted'].includes(row.reason as string))
    )
      throw new Error('sync-invalid')
    review = {
      id: parseId(row.id),
      kind: row.kind as SyncReview['kind'],
      reason: row.reason as SyncReview['reason'],
      localBytes: bytes(row.localBytes, documentLimit),
      remoteBytes: row.remoteBytes === null ? null : bytes(row.remoteBytes, documentLimit),
      localPreview: string(row.localPreview, 16384),
      remotePreview: row.remotePreview === null ? null : string(row.remotePreview, 16384),
      canUpload: boolean(row.canUpload),
      expiresAt: parseRevision(row.expiresAt),
    }
  }
  if (!Array.isArray(input.copies) || input.copies.length > 200) throw new Error('sync-invalid')
  const copies = input.copies.map((value) => {
    const row = record(value)
    exact(row, ['id', 'name', 'side', 'savedAt', 'bytes', 'state'])
    if (
      !['local', 'remote', 'unknown'].includes(row.side as string) ||
      !['verified', 'damaged', 'incomplete'].includes(row.state as string)
    )
      throw new Error('sync-invalid')
    return {
      id: parseSyncRecoveryId(row.id),
      name: text(row.name, 160),
      side: row.side as SyncCopy['side'],
      savedAt: parseRevision(row.savedAt),
      bytes: parseRevision(row.bytes),
      state: row.state as SyncCopy['state'],
    }
  })
  return {
    connection,
    review,
    copies,
    recoveryBlocked: boolean(input.recoveryBlocked),
    recovered: boolean(input.recovered),
    readOnly: boolean(input.readOnly),
    busy: boolean(input.busy),
  }
}
