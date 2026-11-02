import { utf8Bytes } from '@manuslip/core/text'

export const documentLimit = 50 * 1024 * 1024
export const fileChannels = {
  create: 'manuslip:file:new',
  open: 'manuslip:file:open',
  save: 'manuslip:file:save',
  reload: 'manuslip:file:reload',
  close: 'manuslip:file:close',
  changed: 'manuslip:file:changed',
  command: 'manuslip:command',
  confirmClose: 'manuslip:file:confirm-close',
  closeWindow: 'manuslip:close-window',
  checkpoint: 'manuslip:recovery:checkpoint',
  clearRecovery: 'manuslip:recovery:clear',
  recoveries: 'manuslip:recovery:list',
  restoreRecovery: 'manuslip:recovery:restore',
  discardRecovery: 'manuslip:recovery:discard',
} as const

export type Newline = 'lf' | 'crlf' | 'cr' | 'mixed'
export interface FileInfo {
  id: string
  name: string
  displayPath: string | null
  fingerprint: string | null
  encoding: string
  bom: boolean
  newline: Newline
  unsafeDecoding: boolean
}
export interface FileSnapshot {
  info: FileInfo
  text: string
}
export interface SaveRequest {
  id: string
  text: string
  revision: number
  expectedFingerprint: string | null
  action: 'save' | 'save-as' | 'save-copy' | 'overwrite'
  normalize: 'lf' | 'crlf' | null
  utf8: boolean
}
export type SaveOutcome =
  | { kind: 'cancelled' }
  | { kind: 'saved'; info: FileInfo; revision: number }
  | { kind: 'copy'; displayPath: string; revision: number }
export type DocumentCommand =
  | 'next-document'
  | 'previous-document'
  | 'export-html'
  | 'export-pdf'
  | 'open-folder'
  | 'find-file'
  | 'search-workspace'
  | 'new'
  | 'open'
  | 'save'
  | 'save-as'
  | 'save-copy'
  | 'close-document'
  | 'close-window'
export interface RecoveryEntry {
  id: string
  name: string
  displayPath: string | null
  savedAt: number
  revision: number
  bytes: number
}
export interface CheckpointRequest {
  id: string
  revision: number
  text: string
}
export interface FileBridge {
  newDocument(): Promise<import('./contracts').Result<FileSnapshot>>
  openDocument(): Promise<import('./contracts').Result<FileSnapshot | null>>
  saveDocument(request: SaveRequest): Promise<import('./contracts').Result<SaveOutcome>>
  reloadDocument(id: string, encoding?: string): Promise<import('./contracts').Result<FileSnapshot>>
  closeDocument(id: string): Promise<import('./contracts').Result<null>>
  confirmDocumentClose(
    id: string,
  ): Promise<import('./contracts').Result<'save' | 'discard' | 'cancel'>>
  closeWindow(proceed?: boolean): Promise<import('./contracts').Result<null>>
  checkpoint(request: CheckpointRequest): Promise<import('./contracts').Result<null>>
  clearRecovery(id: string, revision: number): Promise<import('./contracts').Result<null>>
  listRecoveries(): Promise<import('./contracts').Result<RecoveryEntry[]>>
  restoreRecovery(id: string): Promise<import('./contracts').Result<FileSnapshot>>
  discardRecovery(id: string): Promise<import('./contracts').Result<null>>
  onFileChanged(listener: (id: string) => void): () => void
  onCommand(listener: (command: DocumentCommand) => void): () => void
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Expected object')
  return value as Record<string, unknown>
}
export function string(value: unknown, max = 4096): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Expected string')
  return value
}
export function parseId(value: unknown): string {
  const id = string(value, 36)
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))
    throw new Error('Invalid session id')
  return id
}
export function parseFileInfo(value: unknown): FileInfo {
  const input = record(value)
  if (
    typeof input.bom !== 'boolean' ||
    typeof input.unsafeDecoding !== 'boolean' ||
    typeof input.newline !== 'string' ||
    !['lf', 'crlf', 'cr', 'mixed'].includes(input.newline)
  )
    throw new Error('Invalid file metadata')
  return {
    id: parseId(input.id),
    name: string(input.name),
    displayPath: input.displayPath === null ? null : string(input.displayPath, 32768),
    fingerprint: input.fingerprint === null ? null : string(input.fingerprint, 128),
    encoding: string(input.encoding, 80),
    bom: input.bom,
    newline: input.newline as Newline,
    unsafeDecoding: input.unsafeDecoding,
  }
}
export function parseSnapshot(value: unknown): FileSnapshot {
  const input = record(value)
  const text = string(input.text, documentLimit)
  if (utf8Bytes(text) > documentLimit) throw new Error('Document is too large')
  return { info: parseFileInfo(input.info), text }
}
export function parseRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 0)
    throw new Error('Invalid revision')
  return value
}
export function parseSaveRequest(value: unknown): SaveRequest {
  const input = record(value)
  if (
    Object.keys(input).some(
      (key) =>
        !['id', 'text', 'revision', 'expectedFingerprint', 'action', 'normalize', 'utf8'].includes(
          key,
        ),
    ) ||
    typeof input.action !== 'string' ||
    !['save', 'save-as', 'save-copy', 'overwrite'].includes(input.action) ||
    (input.normalize !== null && input.normalize !== 'lf' && input.normalize !== 'crlf') ||
    typeof input.utf8 !== 'boolean'
  )
    throw new Error('Invalid save request')
  const text = string(input.text, documentLimit)
  if (utf8Bytes(text) > documentLimit) throw new Error('Document is too large')
  return {
    id: parseId(input.id),
    text,
    revision: parseRevision(input.revision),
    expectedFingerprint:
      input.expectedFingerprint === null ? null : string(input.expectedFingerprint, 128),
    action: input.action as SaveRequest['action'],
    normalize: input.normalize as SaveRequest['normalize'],
    utf8: input.utf8,
  }
}
export function parseSaveOutcome(value: unknown): SaveOutcome {
  const input = record(value)
  if (input.kind === 'cancelled') return { kind: 'cancelled' }
  const revision = parseRevision(input.revision)
  if (input.kind === 'saved') return { kind: 'saved', revision, info: parseFileInfo(input.info) }
  if (input.kind === 'copy')
    return { kind: 'copy', revision, displayPath: string(input.displayPath, 32768) }
  throw new Error('Invalid save response')
}
export function parseCommand(value: unknown): DocumentCommand {
  if (
    typeof value !== 'string' ||
    ![
      'new',
      'open',
      'open-folder',
      'find-file',
      'search-workspace',
      'next-document',
      'previous-document',
      'save',
      'save-as',
      'save-copy',
      'export-html',
      'export-pdf',
      'close-document',
      'close-window',
    ].includes(value)
  )
    throw new Error('Invalid document command')
  return value as DocumentCommand
}

export function parseCheckpoint(value: unknown): CheckpointRequest {
  const input = record(value)
  if (Object.keys(input).some((key) => !['id', 'revision', 'text'].includes(key)))
    throw new Error('Invalid checkpoint')
  const text = string(input.text, documentLimit)
  if (utf8Bytes(text) > documentLimit) throw new Error('Document is too large')
  return { id: parseId(input.id), revision: parseRevision(input.revision), text }
}

export function parseRecoveries(value: unknown): RecoveryEntry[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Invalid recovery list')
  return value.map((item: unknown) => {
    const input = record(item)
    const bytes = parseRevision(input.bytes)
    if (bytes > documentLimit) throw new Error('Invalid recovery size')
    return {
      id: parseId(input.id),
      name: string(input.name),
      displayPath: input.displayPath === null ? null : string(input.displayPath, 32768),
      revision: parseRevision(input.revision),
      savedAt: parseRevision(input.savedAt),
      bytes,
    }
  })
}
