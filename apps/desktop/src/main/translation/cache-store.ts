import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, renameSync, unlinkSync } from 'node:fs'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { isTranslationKey, parseTranslationPayload, validateTranslation } from '@manuslip/translate'
import type { CacheStatus } from '../../shared/translation-contracts'
import { cacheWriteError, retryableCacheWrite, sqliteCode } from './cache-errors'
import { cacheFileEndings, cacheFileSize, inspectCacheFiles, quarantinePaths } from './cache-files'

const MiB = 1024 * 1024
const schemaVersion = 2
export const cacheLimits = {
  logical: 256 * MiB,
  database: 320 * MiB,
  footprint: 384 * MiB,
  wal: 32 * MiB,
  rows: 50000,
  batch: 128,
  touchMs: 1000,
  pendingTouches: 512,
  ttlMs: 30 * 24 * 60 * 60 * 1000,
} as const
export type CacheOperation =
  | { kind: 'get'; key: string; scope: string; payload: string }
  | { kind: 'put'; key: string; scope: string; payload: string; output: string }
  | { kind: 'clear' }
export interface CacheReply {
  status: CacheStatus
  output: string | null
}
interface Statements {
  get: StatementSync
  touch: StatementSync
  size: StatementSync
  remove: StatementSync
  oldest: StatementSync
  expired: StatementSync
  put: StatementSync
  pages: StatementSync
  free: StatementSync
  maximum: StatementSync
}
/** Imported exclusively by the dedicated cache worker (and database tests). */
export class TranslationCacheStore {
  private database: DatabaseSync | null = null
  private statements: Statements | null = null
  private status: CacheStatus = 'unavailable'
  private bytes = 0
  private rows = 0
  private clock = 0
  private nextSweep = 0
  private quarantined = 0
  private databaseBudget: number = cacheLimits.database
  private logicalBudget = 0
  private pageSize = 4096
  private nextTouch = 0
  private readonly touches = new Map<string, number>()
  constructor(
    private readonly path: string,
    private readonly budget: number = cacheLimits.logical,
    private readonly now: () => number = Date.now,
  ) {
    try {
      this.open()
    } catch (error) {
      this.close()
      this.status = 'unavailable'
      // Lock, permission and quota errors never quarantine or remove a database.
      if (![11, 26].includes(sqliteCode(error))) return
      try {
        inspectCacheFiles(path)
        for (const file of quarantinePaths(path)) {
          cacheFileSize(file)
          unlinkSync(file)
        }
        const suffix = `.corrupt-${randomUUID()}`
        for (const ending of cacheFileEndings)
          if (existsSync(`${path}${ending}`))
            renameSync(`${path}${ending}`, `${path}${suffix}${ending}`)
        this.open()
        if (this.database) this.status = 'recovered'
      } catch {
        this.close()
        this.status = 'unavailable'
      }
    }
  }
  private open(): void {
    const files = inspectCacheFiles(this.path)
    this.quarantined = quarantinePaths(this.path).reduce(
      (sum, path) => sum + cacheFileSize(path),
      0,
    )
    this.databaseBudget = Math.min(
      cacheLimits.database,
      cacheLimits.footprint - this.quarantined - cacheLimits.wal - 4 * MiB,
    )
    if (
      this.databaseBudget < MiB ||
      files.database > this.databaseBudget ||
      files.total + this.quarantined > cacheLimits.footprint
    )
      return
    this.logicalBudget = Math.min(this.budget, Math.floor(this.databaseBudget * 0.8))
    if (existsSync(this.path)) {
      const probe = new DatabaseSync(this.path, { readOnly: true, timeout: 100 })
      try {
        if (Number(probe.prepare('PRAGMA user_version').get()?.user_version) > schemaVersion) {
          this.status = 'future'
          return
        }
        if (probe.prepare('PRAGMA quick_check(1)').get()?.quick_check !== 'ok') {
          const error = new Error('Corrupt cache') as Error & { errcode: number }
          error.errcode = 11
          throw error
        }
      } finally {
        probe.close()
      }
    }
    const db = new DatabaseSync(this.path, { timeout: 100, allowExtension: false, defensive: true })
    this.database = db
    chmodSync(this.path, 0o600)
    db.exec(
      'PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL; PRAGMA cache_size=-2048; PRAGMA temp_store=MEMORY',
    )
    if (db.prepare('PRAGMA journal_mode=WAL').get()?.journal_mode !== 'wal')
      throw new Error('WAL unavailable')
    const size = Number(db.prepare('PRAGMA page_size').get()?.page_size)
    if (!Number.isSafeInteger(size) || size < 512) throw new Error('Unsupported page size')
    this.pageSize = size
    db.exec(`PRAGMA max_page_count=${Math.floor(this.databaseBudget / size)};
      PRAGMA wal_autocheckpoint=1000; PRAGMA journal_size_limit=${cacheLimits.wal}`)
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version)
    if (version < schemaVersion) {
      // Legacy hashes lack the original settings, so they cannot be safely rekeyed.
      this.transaction(() => {
        db.exec(`DROP TABLE IF EXISTS entries;
          CREATE TABLE entries (
            key TEXT PRIMARY KEY CHECK(length(key)=32), scope TEXT NOT NULL,
            payload TEXT NOT NULL, output TEXT NOT NULL,
            bytes INTEGER NOT NULL CHECK(bytes>=0), accessed INTEGER NOT NULL CHECK(accessed>=0),
            expires INTEGER NOT NULL CHECK(expires>=0)
          ) STRICT, WITHOUT ROWID;
          CREATE INDEX entries_lru ON entries(accessed, key);
          CREATE INDEX entries_expiry ON entries(expires, key);
          PRAGMA user_version=${schemaVersion};`)
      })
    }
    this.statements = {
      get: db.prepare('SELECT scope, payload, output, expires FROM entries WHERE key=?'),
      touch: db.prepare('UPDATE entries SET accessed=? WHERE key=?'),
      size: db.prepare('SELECT bytes FROM entries WHERE key=?'),
      remove: db.prepare('DELETE FROM entries WHERE key=?'),
      oldest: db.prepare('SELECT key, bytes FROM entries ORDER BY accessed, key LIMIT ?'),
      expired: db.prepare(
        'SELECT key, bytes FROM entries WHERE expires<=? ORDER BY expires, key LIMIT ?',
      ),
      put: db.prepare(
        'INSERT INTO entries(key,scope,payload,output,bytes,accessed,expires) VALUES (?,?,?,?,?,?,?)',
      ),
      pages: db.prepare('PRAGMA page_count'),
      free: db.prepare('PRAGMA freelist_count'),
      maximum: db.prepare('PRAGMA max_page_count'),
    }
    const totals = db
      .prepare(
        'SELECT COALESCE(SUM(bytes), 0) AS bytes, COUNT(*) AS rows, COALESCE(MAX(accessed), 0) AS clock FROM entries',
      )
      .get()
    this.bytes = Number(totals?.bytes)
    this.rows = Number(totals?.rows)
    this.clock = Number(totals?.clock)
    if (
      ![this.bytes, this.rows, this.clock].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      )
    )
      throw new Error('Invalid cache accounting')
    this.pruneExpired(this.now())
    this.transaction(() => this.evict(0, 0))
    this.maintain()
    this.status = 'ready'
  }
  private transaction<T>(operation: () => T): T {
    const db = this.database
    if (!db) throw new Error('Cache closed')
    const { bytes, rows, clock } = this
    db.exec('BEGIN IMMEDIATE')
    try {
      const value = operation()
      db.exec('COMMIT')
      return value
    } catch (error) {
      // SQLITE_FULL can roll back the transaction itself. Restore the in-memory
      // accounting too, before deciding whether to retry with more free pages.
      try {
        db.exec('ROLLBACK')
      } catch {
        /* SQLite may already have rolled back. */
      }
      this.bytes = bytes
      this.rows = rows
      this.clock = clock
      throw error
    }
  }
  private checkpoint(): void {
    if (this.database?.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()?.busy !== 0)
      throw cacheWriteError(5)
  }
  private maintain(): void {
    let files = inspectCacheFiles(this.path, true)
    // journal_size_limit only bounds a reusable WAL. Pinned readers require an explicit guard.
    if (files.wal >= cacheLimits.wal) {
      this.checkpoint()
      files = inspectCacheFiles(this.path, true)
    }
    if (
      files.database > this.databaseBudget ||
      files.total + this.quarantined > cacheLimits.footprint
    )
      throw new Error('Cache file budget exceeded')
  }
  private removeRows(rows: Record<string, unknown>[]): void {
    for (const row of rows) {
      this.statements?.remove.run(String(row.key))
      this.bytes -= Number(row.bytes)
      this.rows--
      this.touches.delete(String(row.key))
    }
  }
  private pruneExpired(now: number): void {
    if (now < this.nextSweep) return
    const rows = this.statements?.expired.all(now, cacheLimits.batch) ?? []
    if (rows.length && !this.tryWrite(() => this.transaction(() => this.removeRows(rows)))) return
    this.nextSweep = rows.length === cacheLimits.batch ? now : now + 60_000
  }
  private evict(incoming: number, incomingRows = 1): void {
    if (this.bytes + incoming <= this.logicalBudget && this.rows + incomingRows <= cacheLimits.rows)
      return
    const target = Math.max(0, Math.floor(this.logicalBudget * 0.9) - incoming)
    while (this.bytes > target || this.rows + incomingRows > cacheLimits.rows) {
      const rows = this.statements?.oldest.all(cacheLimits.batch) ?? []
      if (!rows.length) break
      this.removeRows(rows)
    }
  }
  private tryWrite(operation: () => void): boolean {
    try {
      operation()
      return true
    } catch (error) {
      if (!retryableCacheWrite(error)) throw error
      return false
    }
  }
  /** Best-effort metadata is coalesced and synced once per batch, never once per hit. */
  private flushTouches(force = false): void {
    if (
      !this.touches.size ||
      (!force && this.now() < this.nextTouch && this.touches.size < cacheLimits.batch)
    )
      return
    if (
      this.tryWrite(() =>
        this.transaction(() => {
          for (const [key, accessed] of this.touches) this.statements?.touch.run(accessed, key)
        }),
      )
    ) {
      this.touches.clear()
      this.nextTouch = this.now() + cacheLimits.touchMs
    }
  }
  /** Also called by the worker's idle timer, so a quiet view persists its final batch. */
  flush(): void {
    if (!this.database || !this.touches.size) return
    try {
      this.maintain()
      this.flushTouches()
    } catch (error) {
      if (!retryableCacheWrite(error)) {
        this.close()
        this.status = 'unavailable'
      }
    }
  }
  private touch(key: string): void {
    if (!this.touches.size) this.nextTouch = this.now() + cacheLimits.touchMs
    this.touches.delete(key)
    this.touches.set(key, ++this.clock)
    this.flushTouches()
    // A writer may hold its lock for arbitrarily long. LRU metadata stays bounded.
    if (this.touches.size > cacheLimits.pendingTouches) {
      const oldest = this.touches.keys().next().value
      if (oldest !== undefined) this.touches.delete(oldest)
    }
  }
  private physicalPages(incoming: number): number {
    // WITHOUT ROWID prose rows use overflow pages; leave room for index/leaf splits.
    return Math.ceil((incoming * 2) / this.pageSize) + 16
  }
  private evictPhysical(required: number): void {
    const statements = this.statements
    if (!statements) throw new Error('Cache closed')
    const maximum = Number(statements.maximum.get()?.max_page_count)
    const available = () =>
      maximum -
      Number(statements.pages.get()?.page_count) +
      Number(statements.free.get()?.freelist_count)
    if (available() >= required) return
    const target = required + Math.ceil(maximum * 0.05)
    while (available() < target) {
      const rows = statements.oldest.all(16)
      if (!rows.length) break
      this.removeRows(rows)
    }
    if (available() < required) throw cacheWriteError(13)
  }
  private put(operation: Extract<CacheOperation, { kind: 'put' }>, now: number): void {
    const statements = this.statements
    if (!statements) throw new Error('Cache closed')
    const bytes =
      Buffer.byteLength(operation.scope) +
      Buffer.byteLength(operation.payload) +
      Buffer.byteLength(operation.output) +
      256
    if (bytes > this.logicalBudget * 0.9) return
    const pages = this.physicalPages(bytes)
    // An entry that cannot fit even in an empty database must not evict good data.
    if (pages + 4 > Number(statements.maximum.get()?.max_page_count)) throw cacheWriteError(13)
    this.flushTouches(true)
    for (let attempt = 0; ; attempt++) {
      try {
        this.transaction(() => {
          this.remove(operation.key)
          this.evict(bytes)
          this.evictPhysical(pages * (attempt + 1))
          statements.put.run(
            operation.key,
            operation.scope,
            operation.payload,
            operation.output,
            bytes,
            ++this.clock,
            now + cacheLimits.ttlMs,
          )
          this.bytes += bytes
          this.rows++
        })
        return
      } catch (error) {
        if (sqliteCode(error) !== 13 || attempt >= 2) throw error
      }
    }
  }
  execute(operation: CacheOperation): CacheReply {
    const db = this.database,
      statements = this.statements
    if (!db || !statements) return { status: this.status, output: null }
    try {
      const writable = this.tryWrite(() => this.maintain())
      if (operation.kind === 'clear') {
        // A pinned WAL reader must not observe its files being deleted underneath it.
        this.checkpoint()
        this.close()
        for (const path of [
          ...cacheFileEndings.map((ending) => `${this.path}${ending}`),
          ...quarantinePaths(this.path),
        ]) {
          cacheFileSize(path)
          if (existsSync(path)) unlinkSync(path)
        }
        this.bytes = this.rows = this.clock = this.nextSweep = 0
        this.status = 'unavailable'
        this.open()
        return { status: this.status, output: null }
      }
      if (
        !isTranslationKey(operation.key) ||
        !operation.scope ||
        Buffer.byteLength(operation.scope) > 256 * 1024 ||
        Buffer.byteLength(operation.payload) > 64 * 1024
      )
        throw new Error('Invalid cache entry')
      const now = this.now()
      if (writable) this.pruneExpired(now)
      const payload = parseTranslationPayload(JSON.parse(operation.payload))
      let output: string | null = null
      if (operation.kind === 'get') {
        const row = statements.get.get(operation.key)
        if (row && (!Number.isSafeInteger(row.expires) || Number(row.expires) <= now)) {
          if (writable) this.tryWrite(() => this.transaction(() => this.remove(operation.key)))
        } else if (
          row?.scope === operation.scope &&
          row.payload === operation.payload &&
          typeof row.output === 'string'
        ) {
          try {
            validateTranslation(payload, row.output)
            output = row.output
          } catch {
            // Externally modified/obsolete entries are misses; never restore markup.
            if (writable) this.tryWrite(() => this.transaction(() => this.remove(operation.key)))
          }
          if (output !== null && writable) this.touch(operation.key)
        }
      } else {
        validateTranslation(payload, operation.output)
        if (!writable || !this.tryWrite(() => this.put(operation, now)))
          return { status: 'unavailable', output: null }
      }
      const maintained = this.tryWrite(() => this.maintain())
      return {
        status: maintained || operation.kind === 'get' ? this.status : 'unavailable',
        output,
      }
    } catch (error) {
      if (retryableCacheWrite(error)) return { status: 'unavailable', output: null }
      this.close()
      this.status = 'unavailable'
      return { status: this.status, output: null }
    }
  }
  private remove(key: string): void {
    const row = this.statements?.size.get(key)
    if (row) this.removeRows([{ key, bytes: row.bytes }])
  }
  close(): void {
    const db = this.database
    // Access times may be lost on a crash; validated payload commits remain FULL sync.
    try {
      this.flushTouches(true)
    } catch {
      /* Derived LRU metadata is expendable. */
    }
    this.database = null
    this.statements = null
    this.touches.clear()
    if (!db) return
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      // SQLite retains a busy WAL for recovery; never unlink it on a failed checkpoint.
    }
    try {
      db.close()
    } catch {
      /* Derived persistence may be discarded. */
    }
  }
}
