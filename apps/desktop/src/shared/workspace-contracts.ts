import type { Result } from './contracts'
import { type FileSnapshot, parseId, record, string } from './file-contracts'

export const workspaceLimits = {
  page: 200,
  scan: 5000,
  nodes: 10000,
  catalogBytes: 16 * 1024 * 1024,
  recent: 10,
  depth: 32,
  stateBytes: 8 * 1024 * 1024,
  listingQueue: 8,
} as const
export const workspaceChannels = {
  forget: 'manuslip:workspace:forget',
  bootstrap: 'manuslip:workspace:bootstrap',
  choose: 'manuslip:workspace:choose',
  close: 'manuslip:workspace:close',
  recent: 'manuslip:workspace:recent',
  refresh: 'manuslip:workspace:refresh',
  list: 'manuslip:workspace:list',
  open: 'manuslip:workspace:open',
  restore: 'manuslip:workspace:restore',
  remember: 'manuslip:workspace:remember',
  changed: 'manuslip:workspace:changed',
} as const
export interface WorkspaceChange {
  rootId: string
  directoryId: string
}
export interface WorkspaceNode {
  id: string
  name: string
  kind: 'directory' | 'file'
}
export interface WorkspaceRoot extends WorkspaceNode {
  displayPath: string
}
export interface WorkspaceRecent {
  id: string
  name: string
  displayPath: string
}
export interface RestoreFile extends WorkspaceRecent {
  active: boolean
}
export interface WorkspaceBootstrap {
  root: WorkspaceRoot | null
  recents: WorkspaceRecent[]
  restore: RestoreFile[]
  recovered: boolean
  readOnly: boolean
  missingRoot: boolean
  persistenceError: boolean
}
export interface WorkspacePage {
  nodes: WorkspaceNode[]
  next: number | null
  truncated: boolean
  skippedLinks: boolean
}
export interface RememberDocuments {
  ids: string[]
  activeId: string | null
}
export interface WorkspaceBridge {
  forgetSessionFile(id: string): Promise<Result<null>>
  workspace(): Promise<Result<WorkspaceBootstrap>>
  chooseWorkspace(): Promise<Result<WorkspaceBootstrap | null>>
  closeWorkspace(): Promise<Result<WorkspaceBootstrap>>
  recentWorkspace(id: string): Promise<Result<WorkspaceBootstrap>>
  refreshWorkspace(): Promise<Result<WorkspaceBootstrap>>
  listWorkspace(id: string, offset?: number): Promise<Result<WorkspacePage>>
  openWorkspaceFile(id: string): Promise<Result<FileSnapshot>>
  restoreSessionFile(id: string): Promise<Result<FileSnapshot>>
  rememberDocuments(ids: string[], activeId: string | null): Promise<Result<null>>
  onWorkspaceChanged(listener: (change: WorkspaceChange) => void): () => void
}
export function parseWorkspaceChange(value: unknown): WorkspaceChange {
  const input = record(value)
  return { rootId: parseId(input.rootId), directoryId: parseId(input.directoryId) }
}
export function parseRememberDocuments(value: unknown): RememberDocuments {
  const input = record(value)
  if (
    Object.keys(input).some((key) => !['ids', 'activeId'].includes(key)) ||
    !Array.isArray(input.ids) ||
    input.ids.length > 32
  )
    throw new Error('Invalid document session')
  const ids = input.ids.map(parseId)
  const activeId = input.activeId === null ? null : parseId(input.activeId)
  if (new Set(ids).size !== ids.length || (activeId !== null && !ids.includes(activeId)))
    throw new Error('Invalid active document')
  return { ids, activeId }
}
export function parseWorkspaceList(value: unknown): { id: string; offset: number } {
  const input = record(value)
  if (
    Object.keys(input).some((key) => !['id', 'offset'].includes(key)) ||
    !Number.isSafeInteger(input.offset) ||
    (input.offset as number) < 0 ||
    (input.offset as number) > workspaceLimits.scan
  )
    throw new Error('Invalid workspace page')
  return { id: parseId(input.id), offset: input.offset as number }
}
function parseNode(value: unknown): WorkspaceNode {
  const input = record(value)
  if (input.kind !== 'directory' && input.kind !== 'file') throw new Error('Invalid workspace node')
  return { id: parseId(input.id), name: string(input.name), kind: input.kind }
}
function parseRecent(value: unknown): WorkspaceRecent {
  const input = record(value)
  return {
    id: parseId(input.id),
    name: string(input.name),
    displayPath: string(input.displayPath, 32768),
  }
}
export function parseWorkspace(value: unknown): WorkspaceBootstrap {
  const input = record(value)
  if (
    !Array.isArray(input.recents) ||
    input.recents.length > workspaceLimits.recent ||
    !Array.isArray(input.restore) ||
    input.restore.length > 32 ||
    ['recovered', 'readOnly', 'missingRoot', 'persistenceError'].some(
      (key) => typeof input[key] !== 'boolean',
    )
  )
    throw new Error('Invalid workspace response')
  const root =
    input.root === null
      ? null
      : { ...parseNode(input.root), displayPath: string(record(input.root).displayPath, 32768) }
  if (root && root.kind !== 'directory') throw new Error('Invalid workspace root')
  return {
    root,
    recents: input.recents.map(parseRecent),
    restore: input.restore.map((item) => {
      const entry = record(item)
      if (typeof entry.active !== 'boolean') throw new Error('Invalid restored document')
      return { ...parseRecent(item), active: entry.active }
    }),
    recovered: input.recovered as boolean,
    readOnly: input.readOnly as boolean,
    missingRoot: input.missingRoot as boolean,
    persistenceError: input.persistenceError as boolean,
  }
}
export function parseWorkspacePage(value: unknown): WorkspacePage {
  const input = record(value)
  if (
    !Array.isArray(input.nodes) ||
    input.nodes.length > workspaceLimits.page ||
    typeof input.truncated !== 'boolean' ||
    typeof input.skippedLinks !== 'boolean' ||
    (input.next !== null &&
      (!Number.isSafeInteger(input.next) ||
        (input.next as number) < 0 ||
        (input.next as number) > workspaceLimits.scan))
  )
    throw new Error('Invalid workspace listing')
  return {
    nodes: input.nodes.map(parseNode),
    next: input.next as number | null,
    truncated: input.truncated,
    skippedLinks: input.skippedLinks,
  }
}
