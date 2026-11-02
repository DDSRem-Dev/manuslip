import type { Result } from './contracts'
import { type FileSnapshot, parseId, parseSnapshot, record, string } from './file-contracts'

export const searchLimits = {
  results: 500,
  output: 20 * 1024 * 1024,
  record: 2 * 1024 * 1024,
  line: 65536,
  files: 10000,
  filenames: 8 * 1024 * 1024,
  batch: 50,
  query: 256,
  deadline: 15000,
} as const
export const searchChannels = {
  start: 'manuslip:search:start',
  poll: 'manuslip:search:poll',
  cancel: 'manuslip:search:cancel',
  open: 'manuslip:search:open',
} as const
export interface SearchRequest {
  id: string
  rootId: string
  query: string
  mode: 'filename' | 'text'
  matchCase: boolean
}
export interface SearchEntry {
  id: string
  path: string
  line: number
  excerpt: string
}
export interface SearchPage {
  id: string
  entries: SearchEntry[]
  cursor: number
  total: number
  state: 'running' | 'done' | 'cancelled' | 'error'
  error: string | null
  truncated: boolean
  skipped: number
}
export interface SearchAnchor {
  line: number
  from: number
  to: number
  text: string
}
export interface SearchOpened {
  file: FileSnapshot
  anchor: SearchAnchor | null
}
export interface SearchBridge {
  startSearch(request: SearchRequest): Promise<Result<null>>
  pollSearch(id: string, cursor: number): Promise<Result<SearchPage>>
  cancelSearch(id: string): Promise<Result<null>>
  openSearchResult(id: string, entryId: string): Promise<Result<SearchOpened>>
}
function integer(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max)
    throw new Error('Invalid search offset')
  return value
}
function keys(input: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new Error('Invalid search fields')
}
export function parseSearchRequest(value: unknown): SearchRequest {
  const input = record(value)
  keys(input, ['id', 'rootId', 'query', 'mode', 'matchCase'])
  const query = string(input.query, searchLimits.query)
  if (
    !query.length ||
    /[\0\r\n]/.test(query) ||
    (input.mode !== 'filename' && input.mode !== 'text') ||
    typeof input.matchCase !== 'boolean'
  )
    throw new Error('Invalid search query')
  return {
    id: parseId(input.id),
    rootId: parseId(input.rootId),
    query,
    mode: input.mode,
    matchCase: input.matchCase,
  }
}
export function parseSearchPoll(value: unknown): { id: string; cursor: number } {
  const input = record(value)
  keys(input, ['id', 'cursor'])
  return { id: parseId(input.id), cursor: integer(input.cursor, searchLimits.results) }
}
export function parseSearchOpen(value: unknown): { id: string; entryId: string } {
  const input = record(value)
  keys(input, ['id', 'entryId'])
  return { id: parseId(input.id), entryId: parseId(input.entryId) }
}
export function parseSearchPage(value: unknown): SearchPage {
  const input = record(value)
  if (
    !Array.isArray(input.entries) ||
    input.entries.length > searchLimits.batch ||
    !['running', 'done', 'cancelled', 'error'].includes(String(input.state)) ||
    typeof input.truncated !== 'boolean'
  )
    throw new Error('Invalid search page')
  return {
    id: parseId(input.id),
    entries: input.entries.map((value: unknown) => {
      const entry = record(value)
      return {
        id: parseId(entry.id),
        path: string(entry.path, 32768),
        line: integer(entry.line, Number.MAX_SAFE_INTEGER),
        excerpt: string(entry.excerpt, 2048),
      }
    }),
    cursor: integer(input.cursor, searchLimits.results),
    total: integer(input.total, searchLimits.results),
    state: input.state as SearchPage['state'],
    error: input.error === null ? null : string(input.error, 80),
    truncated: input.truncated,
    skipped: integer(input.skipped, Number.MAX_SAFE_INTEGER),
  }
}
export function parseSearchOpened(value: unknown): SearchOpened {
  const input = record(value)
  let anchor: SearchAnchor | null = null
  if (input.anchor !== null) {
    const value = record(input.anchor)
    const text = string(value.text, searchLimits.line)
    const from = integer(value.from, text.length),
      to = integer(value.to, text.length)
    if (from > to) throw new Error('Invalid match range')
    anchor = { line: integer(value.line, Number.MAX_SAFE_INTEGER), from, to, text }
  }
  return { file: parseSnapshot(input.file), anchor }
}
