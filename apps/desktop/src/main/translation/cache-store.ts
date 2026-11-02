import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseTranslationPayload, validateTranslation } from '@manuslip/translate'
import type { CacheStatus } from '../../shared/translation-contracts'

export const cacheLimits = {
  logical: 96 * 1024 * 1024,
  database: 120 * 1024 * 1024,
  rows: 20000,
  batch: 128,
} as const
export type CacheOperation =
  | { kind: 'get'; key: string; payload: string }
  | { kind: 'put'; key: string; payload: string; output: string }
  | { kind: 'clear' }
export interface CacheReply {
  status: CacheStatus
  output: string | null
}
/** Imported exclusively by the dedicated cache worker (and database tests). */
export class TranslationCacheStore {
  private database: DatabaseSync | null = null
  private status: CacheStatus = 'unavailable'
  private bytes = 0
  private rows = 0
  private clock = 0
  private databaseBudget: number = cacheLimits.database
  private logicalBudget = 0
  constructor(
    private readonly path: string,
    private readonly budget: number = cacheLimits.logical,
  ) {
    this.logicalBudget = budget
    try {
      this.open()
    } catch (error) {
      this.close()
      this.status = 'unavailable'
      // Only database corruption is quarantined. Locked/read-only/full files stay untouched.
      const code =
        error && typeof error === 'object' && 'errcode' in error ? Number(error.errcode) & 255 : 0
      if (![11, 26].includes(code)) return
      try {
        for (const file of this.quarantines()) unlinkSync(file)
        const suffix = `.corrupt-${randomUUID()}`
        for (const ending of ['', '-journal', '-wal', '-shm']) {
          if (existsSync(`${path}${ending}`))
            renameSync(`${path}${ending}`, `${path}${suffix}${ending}`)
        }
        this.open()
        if (this.database) this.status = 'recovered'
      } catch {
        this.close()
        this.status = 'unavailable'
      }
    }
  }
  private quarantines(): string[] {
    const prefix = `${basename(this.path)}.corrupt-`
    return readdirSync(dirname(this.path))
      .filter(
        (name) =>
          name.startsWith(prefix) &&
          /^[a-f0-9-]{36}(?:-journal|-wal|-shm)?$/.test(name.slice(prefix.length)),
      )
      .map((name) => join(dirname(this.path), name))
  }
  private open(): void {
    const quarantined = this.quarantines().reduce((sum, path) => sum + lstatSync(path).size, 0)
    this.databaseBudget = Math.min(
      cacheLimits.database,
      Math.floor((256 * 1024 * 1024 - quarantined - 4 * 1024 * 1024) / 2),
    )
    if (this.databaseBudget < 1024 * 1024) return
    this.logicalBudget = Math.min(this.budget, Math.floor(this.databaseBudget * 0.8))
    for (const ending of ['', '-journal', '-wal', '-shm']) {
      const path = `${this.path}${ending}`
      if (!existsSync(path)) continue
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) return
    }
    if (existsSync(this.path)) {
      if (statSync(this.path).size > this.databaseBudget) return
      const probe = new DatabaseSync(this.path, { readOnly: true, timeout: 100 })
      let version: unknown
      try {
        version = probe.prepare('PRAGMA user_version').get()?.user_version
        if (Number(version) > 1) {
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
      'PRAGMA journal_mode=TRUNCATE; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF; PRAGMA cache_size=-2048; PRAGMA temp_store=MEMORY',
    )
    const size = Number(db.prepare('PRAGMA page_size').get()?.page_size)
    if (!Number.isSafeInteger(size) || size < 512) throw new Error('Unsupported page size')
    db.exec(`PRAGMA max_page_count=${Math.floor(this.databaseBudget / size)}`)
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version)
    if (version === 0) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE entries (key TEXT PRIMARY KEY, payload TEXT NOT NULL, output TEXT NOT NULL, bytes INTEGER NOT NULL, accessed INTEGER NOT NULL) STRICT;
        CREATE INDEX entries_lru ON entries(accessed, key);
        PRAGMA user_version=1; COMMIT;`)
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
    this.status = 'ready'
    this.evict(0)
  }
  private evict(incoming: number): void {
    const db = this.database
    if (!db || (this.bytes + incoming <= this.logicalBudget && this.rows < cacheLimits.rows)) return
    const target = Math.max(0, Math.floor(this.logicalBudget * 0.9) - incoming)
    while (this.bytes > target || this.rows >= cacheLimits.rows) {
      const rows = db
        .prepare('SELECT key, bytes FROM entries ORDER BY accessed, key LIMIT ?')
        .all(cacheLimits.batch)
      if (!rows.length) break
      db.exec('BEGIN IMMEDIATE')
      try {
        const remove = db.prepare('DELETE FROM entries WHERE key=?')
        for (const row of rows) {
          remove.run(String(row.key))
          this.bytes -= Number(row.bytes)
          this.rows--
        }
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
  }
  execute(operation: CacheOperation): CacheReply {
    const db = this.database
    if (!db) return { status: this.status, output: null }
    try {
      if (operation.kind === 'clear') {
        this.close()
        for (const path of [
          this.path,
          `${this.path}-journal`,
          `${this.path}-wal`,
          `${this.path}-shm`,
          ...this.quarantines(),
        ]) {
          if (!existsSync(path)) continue
          const metadata = lstatSync(path)
          if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1)
            throw new Error('Cache file changed')
          unlinkSync(path)
        }
        this.bytes = 0
        this.rows = 0
        this.clock = 0
        this.status = 'unavailable'
        this.open()
        return { status: this.status, output: null }
      }
      if (!/^[a-f0-9]{64}$/.test(operation.key) || Buffer.byteLength(operation.payload) > 64 * 1024)
        throw new Error('Invalid cache entry')
      const payload = parseTranslationPayload(JSON.parse(operation.payload))
      if (operation.kind === 'get') {
        const row = db.prepare('SELECT payload, output FROM entries WHERE key=?').get(operation.key)
        if (row?.payload === operation.payload && typeof row.output === 'string') {
          try {
            validateTranslation(payload, row.output)
          } catch {
            // Treat externally modified/obsolete entries as cache misses; never restore markup.
            this.remove(operation.key)
            return { status: this.status, output: null }
          }
          db.prepare('UPDATE entries SET accessed=? WHERE key=?').run(++this.clock, operation.key)
          return { status: this.status, output: row.output }
        }
      } else {
        validateTranslation(payload, operation.output)
        const bytes =
          Buffer.byteLength(operation.payload) + Buffer.byteLength(operation.output) + 256
        if (bytes <= this.logicalBudget * 0.9) {
          this.remove(operation.key)
          this.evict(bytes)
          db.prepare(
            'INSERT INTO entries(key,payload,output,bytes,accessed) VALUES (?,?,?,?,?)',
          ).run(operation.key, operation.payload, operation.output, bytes, ++this.clock)
          this.bytes += bytes
          this.rows++
        }
      }
      return { status: this.status, output: null }
    } catch {
      this.close()
      this.status = 'unavailable'
      return { status: this.status, output: null }
    }
  }
  private remove(key: string): void {
    const db = this.database
    const row = db?.prepare('SELECT bytes FROM entries WHERE key=?').get(key)
    if (row) {
      db?.prepare('DELETE FROM entries WHERE key=?').run(key)
      this.bytes -= Number(row.bytes)
      this.rows--
    }
  }
  close(): void {
    try {
      this.database?.close()
    } catch {
      /* Derived persistence may be discarded. */
    }
    this.database = null
  }
}
