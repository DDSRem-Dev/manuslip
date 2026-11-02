import { join } from 'node:path'
import fuzzysort from 'fuzzysort'
import type { SearchOpened, SearchPage, SearchRequest } from '../../shared/search-contracts'
import { searchLimits } from '../../shared/search-contracts'
import { FileOperationError, fileError } from '../files/errors'
import type { FileSessions } from '../files/sessions'
import { authorizeWorkspaceFile, type RootGrant, verifyRoot } from '../workspace/paths'
import { searchBinary } from './binary'
import { runSearchProcess } from './process'
import { filenameEntry, matchEntries, relativeFile, type StoredEntry } from './records'

interface Job {
  owner: number
  request: SearchRequest
  grant: RootGrant
  abort: AbortController
  entries: StoredEntry[]
  bytes: number
  state: SearchPage['state']
  error: string | null
  truncated: boolean
  skipped: number
}
type Runner = typeof runSearchProcess
/** One process running, one latest pending job; only the current job can be polled/opened. */
export class SearchRepository {
  private current: Job | null = null
  private pending: Job | null = null
  private running = false
  constructor(
    private readonly files: FileSessions,
    private readonly binary = searchBinary,
    private readonly run: Runner = runSearchProcess,
  ) {}
  start(owner: number, request: SearchRequest, grant: RootGrant): void {
    if (this.current?.request.id === request.id) throw new FileOperationError('search-session')
    this.current?.abort.abort()
    const job: Job = {
      owner,
      request,
      grant,
      abort: new AbortController(),
      entries: [],
      bytes: 0,
      state: 'running',
      error: null,
      truncated: false,
      skipped: 0,
    }
    this.current = job
    this.pending = job
    if (!this.running) void this.pump()
  }
  poll(owner: number, id: string, cursor: number): SearchPage {
    const job = this.owned(owner, id)
    if (cursor > job.entries.length) throw new FileOperationError('search-session')
    const entries = job.entries.slice(cursor, cursor + searchLimits.batch).map((item) => item.entry)
    return {
      id,
      entries,
      cursor: cursor + entries.length,
      total: job.entries.length,
      state: job.state,
      error: job.error,
      truncated: job.truncated,
      skipped: job.skipped,
    }
  }
  cancel(owner: number, id: string): void {
    const job = this.owned(owner, id)
    job.state = 'cancelled'
    job.abort.abort()
  }
  closeOwner(owner: number): void {
    if (this.current?.owner !== owner) return
    this.current.abort.abort()
    this.current = null
    this.pending = null
  }
  async open(owner: number, id: string, entryId: string): Promise<SearchOpened> {
    const job = this.owned(owner, id)
    const result = job.entries.find((item) => item.entry.id === entryId)
    if (!result) throw new FileOperationError('search-session')
    const path = join(job.grant.path, result.relative)
    const file = await this.files.open(
      owner,
      path,
      undefined,
      true,
      authorizeWorkspaceFile(job.grant, path),
      job.grant,
    )
    // A new query can revoke this result during the disk read. The opened file remains
    // an explicit grant to this window; return it without a now-obsolete location anchor.
    return { file, anchor: this.current === job ? result.anchor : null }
  }
  private owned(owner: number, id: string): Job {
    if (!this.current || this.current.owner !== owner || this.current.request.id !== id)
      throw new FileOperationError('search-session')
    return this.current
  }
  private add(job: Job, result: StoredEntry): boolean {
    const weight =
      256 +
      (result.relative.length + result.entry.excerpt.length + (result.anchor?.text.length || 0)) * 2
    if (job.entries.length >= searchLimits.results || job.bytes + weight > searchLimits.output)
      return false
    job.entries.push(result)
    job.bytes += weight
    return true
  }
  private async pump(): Promise<void> {
    this.running = true
    try {
      while (this.pending) {
        const job = this.pending
        this.pending = null
        if (!job.abort.signal.aborted) await this.execute(job)
      }
    } finally {
      this.running = false
    }
  }
  private async execute(job: Job): Promise<void> {
    try {
      await verifyRoot(job.grant)
      const binary = await this.binary()
      if (job.abort.signal.aborted) return
      const candidates: string[] = []
      let candidateBytes = 0
      const outcome = await this.run(
        binary,
        job.grant.path,
        job.request,
        job.abort.signal,
        (record) => {
          if (job.abort.signal.aborted || this.current !== job) return false
          if (job.request.mode === 'text') {
            const parsed = matchEntries(job.grant.path, record, (entry) => this.add(job, entry))
            job.skipped += parsed.skipped
            return parsed.keep
          }
          let path: string | null
          try {
            path = relativeFile(
              job.grant.path,
              new TextDecoder('utf-8', { fatal: true }).decode(record),
            )
          } catch {
            path = null
          }
          if (!path) {
            job.skipped++
            return true
          }
          candidateBytes += 128 + path.length * 2
          if (candidates.length >= searchLimits.files || candidateBytes > searchLimits.filenames)
            return false
          candidates.push(path)
          return true
        },
      )
      if (job.abort.signal.aborted || this.current !== job) return
      await verifyRoot(job.grant)
      job.truncated = outcome.truncated
      if (job.request.mode === 'filename') {
        const results = fuzzysort.go(job.request.query, candidates, {
          limit: searchLimits.results + 1,
          threshold: 0,
        })
        for (const match of results)
          if (!this.add(job, filenameEntry(match.target))) {
            job.truncated = true
            break
          }
      }
      job.state = outcome.failed ? 'error' : 'done'
      job.error = outcome.failed ? 'search-io' : null
    } catch (error) {
      if (job.abort.signal.aborted || this.current !== job) return
      job.state = 'error'
      job.error = error instanceof FileOperationError ? error.code : fileError(error).code
    }
  }
}
