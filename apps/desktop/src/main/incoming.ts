import { randomUUID } from 'node:crypto'
import { basename, extname, isAbsolute, resolve } from 'node:path'
import type { FileSnapshot } from '../shared/file-contracts'
import { type IncomingState, incomingLimit } from '../shared/incoming-contracts'
import { FileOperationError } from './files/errors'

function validPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 32768 &&
    !value.includes('\0') &&
    isAbsolute(value)
  )
}
function supported(path: string): boolean {
  return ['.md', '.markdown', '.mdown', '.txt'].includes(extname(path).toLowerCase())
}
/** Only native argv reaches this parser; no renderer can submit a command line. */
export function launchPaths(argv: readonly string[], cwd: string, defaultApp: boolean): string[] {
  const paths: string[] = []
  let literal = false
  for (let index = defaultApp ? 2 : 1; index < argv.length; index++) {
    const value = argv[index] || ''
    if (!literal && value === '--') {
      literal = true
      continue
    }
    if (!literal && value.startsWith('-')) {
      if (
        [
          '--user-data-dir',
          '--js-flags',
          '--inspect',
          '--inspect-brk',
          '--remote-debugging-port',
        ].includes(value)
      )
        index++
      continue
    }
    if (
      !value ||
      value.includes('\0') ||
      value.length > 32768 ||
      /^[a-z][a-z\d+.-]*:\/\//i.test(value)
    )
      continue
    const path = resolve(cwd, value)
    if (validPath(path) && supported(path)) paths.push(path)
    if (paths.length > incomingLimit) break
  }
  return paths
}
export function parseDroppedPaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > incomingLimit + 1 || !value.every(validPath))
    throw new Error('Invalid native drop')
  return value
}

/** Paths remain in main. One file is read at a time, with no body retained in this queue. */
export class IncomingFiles {
  private readonly requests = new Map<string, { path: string; owner: number | null }>()
  private issue: IncomingState['issue'] = null
  private busy = false
  constructor(private readonly changed: () => void) {}
  enqueue(paths: readonly string[]): void {
    if (paths.length > incomingLimit) this.issue = 'file-incoming-limit'
    else
      for (const path of paths) {
        if (!validPath(path) || !supported(path)) {
          this.issue = 'file-incoming-type'
          continue
        }
        if ([...this.requests.values()].some((entry) => entry.path === path)) continue
        if (this.requests.size >= incomingLimit) {
          this.issue = 'file-incoming-limit'
          break
        }
        this.requests.set(randomUUID(), { path, owner: null })
      }
    this.changed()
  }
  list(owner: number): IncomingState {
    const requests: IncomingState['requests'] = []
    for (const [id, entry] of this.requests) {
      if (entry.owner !== null && entry.owner !== owner) continue
      entry.owner = owner
      requests.push({ id, name: basename(entry.path), displayPath: entry.path })
    }
    return { requests, issue: this.issue }
  }
  async open(
    owner: number,
    id: string,
    load: (path: string) => Promise<FileSnapshot>,
  ): Promise<FileSnapshot> {
    const entry = this.owned(owner, id)
    if (this.busy) throw new FileOperationError('file-incoming-busy')
    this.busy = true
    try {
      const snapshot = await load(entry.path)
      if (this.requests.get(id) !== entry) throw new FileOperationError('file-session')
      this.requests.delete(id)
      return snapshot
    } finally {
      this.busy = false
    }
  }
  dismiss(owner: number, id: string | null): void {
    if (id === null) this.issue = null
    else {
      this.owned(owner, id)
      if (this.busy) throw new FileOperationError('file-incoming-busy')
      this.requests.delete(id)
    }
    this.changed()
  }
  private owned(owner: number, id: string): { path: string; owner: number | null } {
    const entry = this.requests.get(id)
    if (!entry || entry.owner !== owner) throw new FileOperationError('file-session')
    return entry
  }
  closeOwner(owner: number): void {
    // Closing a window also dismisses its unaccepted/failed external open requests.
    for (const [id, entry] of this.requests) if (entry.owner === owner) this.requests.delete(id)
    this.issue = null
  }
}
