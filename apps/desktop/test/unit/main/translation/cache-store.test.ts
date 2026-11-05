import { execFileSync } from 'node:child_process'
import { link, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { extractionVersion } from '@manuslip/translate'
import { afterEach, describe, expect, it } from 'vitest'
import { cacheLimits, TranslationCacheStore } from '../../../../src/main/translation/cache-store'

const directories: string[] = []
const stores: TranslationCacheStore[] = []
const payload = JSON.stringify({
  schema: extractionVersion,
  kind: 'paragraph',
  text: 'Hello world',
  tokens: [],
})
const scope = JSON.stringify({ targetLanguage: 'zh-CN', model: 'test' })
const key = 'a'.repeat(32)
async function location() {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-translation-cache-'))
  directories.push(directory)
  return { directory, path: join(directory, 'translation-cache.sqlite') }
}
function store(path: string, budget?: number, now?: () => number) {
  const value = new TranslationCacheStore(path, budget, now)
  stores.push(value)
  return value
}
afterEach(async () => {
  for (const value of stores.splice(0)) value.close()
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})
describe('isolated SQLite translation persistence', () => {
  it('rebuilds the legacy SHA-256 cache into the expiring MurmurHash schema', async () => {
    const { path } = await location()
    const legacy = new DatabaseSync(path)
    legacy.exec(`CREATE TABLE entries (key TEXT PRIMARY KEY, payload TEXT NOT NULL,
      output TEXT NOT NULL, bytes INTEGER NOT NULL, accessed INTEGER NOT NULL) STRICT;
      CREATE INDEX entries_lru ON entries(accessed,key); PRAGMA user_version=1;`)
    legacy
      .prepare('INSERT INTO entries VALUES (?,?,?,?,?)')
      .run('a'.repeat(64), payload, 'Old', 500, 1)
    legacy.close()
    const cache = store(path)
    expect(cache.execute({ kind: 'get', scope, key, payload })).toEqual({
      status: 'ready',
      output: null,
    })
    expect(cache.execute({ kind: 'put', scope, key, payload, output: 'New' }).status).toBe('ready')
    cache.close()
    expect(store(path).execute({ kind: 'get', scope, key, payload }).output).toBe('New')
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      expect(db.prepare('SELECT COUNT(*) AS count FROM entries').get()?.count).toBe(1)
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(2)
    } finally {
      db.close()
    }
  })
  it('expires entries after 30 days across restarts without extending TTL on reads', async () => {
    const { path } = await location()
    let now = Date.now()
    const start = now
    let cache = store(path, undefined, () => now)
    cache.execute({ kind: 'put', scope, key, payload, output: 'Saved' })
    now = start + cacheLimits.ttlMs - 1
    expect(cache.execute({ kind: 'get', scope, key, payload }).output).toBe('Saved')
    cache.close()
    cache = store(path, undefined, () => now)
    expect(cache.execute({ kind: 'get', scope, key, payload }).output).toBe('Saved')
    now++
    expect(cache.execute({ kind: 'get', scope, key, payload })).toEqual({
      status: 'ready',
      output: null,
    })
    cache.execute({ kind: 'put', scope, key, payload, output: 'Refreshed' })
    expect(cache.execute({ kind: 'get', scope, key, payload }).output).toBe('Refreshed')
  })
  it('sweeps expired entries in bounded batches and keeps still-valid entries', async () => {
    const { path } = await location()
    const cache = store(path)
    cache.execute({ kind: 'put', scope, key, payload, output: 'Keep' })
    cache.close()
    const db = new DatabaseSync(path)
    const insert = db.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,?)')
    db.exec('BEGIN')
    for (let index = 0; index < cacheLimits.batch + 1; index++)
      insert.run(index.toString(16).padStart(32, '0'), scope, payload, 'Expired', 500, index, 0)
    db.exec('COMMIT')
    db.close()
    const reopened = store(path)
    expect(reopened.execute({ kind: 'get', scope, key, payload }).output).toBe('Keep')
    const inspect = new DatabaseSync(path, { readOnly: true })
    try {
      expect(inspect.prepare('SELECT COUNT(*) AS count FROM entries').get()?.count).toBe(1)
    } finally {
      inspect.close()
    }
  })
  it('treats a colliding key with different settings as a miss', async () => {
    const { path } = await location()
    const cache = store(path)
    cache.execute({ kind: 'put', scope, key, payload, output: 'Chinese' })
    const other = JSON.stringify({ targetLanguage: 'ja', model: 'test' })
    expect(cache.execute({ kind: 'get', scope: other, key, payload }).output).toBeNull()
    cache.execute({ kind: 'put', scope: other, key, payload, output: 'Japanese' })
    expect(cache.execute({ kind: 'get', scope, key, payload }).output).toBeNull()
    expect(cache.execute({ kind: 'get', scope: other, key, payload }).output).toBe('Japanese')
  })
  it('allows a WAL reader to retain a snapshot while new translations commit', async () => {
    const { path } = await location()
    const cache = store(path)
    cache.execute({ kind: 'put', scope, key, payload, output: 'Before' })
    const reader = new DatabaseSync(path, { readOnly: true })
    try {
      reader.exec('BEGIN')
      expect(reader.prepare('SELECT output FROM entries WHERE key=?').get(key)?.output).toBe(
        'Before',
      )
      expect(cache.execute({ kind: 'put', scope, key, payload, output: 'After' }).status).toBe(
        'ready',
      )
      expect(reader.prepare('SELECT output FROM entries WHERE key=?').get(key)?.output).toBe(
        'Before',
      )
      reader.exec('COMMIT')
      expect(reader.prepare('SELECT output FROM entries WHERE key=?').get(key)?.output).toBe(
        'After',
      )
      expect(reader.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal')
    } finally {
      reader.close()
    }
    cache.close()
    expect(store(path).execute({ kind: 'get', scope, key, payload }).output).toBe('After')
  })
  it('pauses writes for a pinned WAL reader and recovers on the same connection', async () => {
    const { path } = await location()
    const cache = store(path)
    cache.execute({ kind: 'put', scope, key, payload, output: 'Original' })
    const reader = new DatabaseSync(path, { readOnly: true })
    try {
      reader.exec('BEGIN')
      reader.prepare('SELECT output FROM entries WHERE key=?').get(key)
      const output = 'x'.repeat(200 * 1024)
      let status = 'ready'
      for (let index = 0; index < 200 && status === 'ready'; index++) {
        status = cache.execute({
          kind: 'put',
          scope,
          key: index.toString(16).padStart(32, '0'),
          payload,
          output,
        }).status
      }
      expect(status).toBe('unavailable')
      expect((await stat(`${path}-wal`)).size).toBeGreaterThanOrEqual(cacheLimits.wal)
      expect(reader.prepare('SELECT output FROM entries WHERE key=?').get(key)?.output).toBe(
        'Original',
      )
      reader.exec('COMMIT')
    } finally {
      reader.close()
    }
    expect(cache.execute({ kind: 'get', scope, key, payload })).toEqual({
      status: 'ready',
      output: 'Original',
    })
    expect(cache.execute({ kind: 'put', scope, key, payload, output: 'Resumed' }).status).toBe(
      'ready',
    )
  }, 15000)
  it('retains 50,000 entries and evicts old entries before accepting the next one', async () => {
    const { path } = await location()
    store(path).close()
    const db = new DatabaseSync(path)
    db.prepare(`WITH RECURSIVE numbers(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM numbers WHERE i<50000)
      INSERT INTO entries SELECT printf('%032x',i),?,?,?,500,i,? FROM numbers`).run(
      scope,
      payload,
      'Cached',
      Date.now() + cacheLimits.ttlMs,
    )
    db.close()
    const cache = store(path)
    const oldest = '1'.padStart(32, '0')
    expect(cache.execute({ kind: 'get', scope, key: oldest, payload }).output).toBe('Cached')
    expect(cache.execute({ kind: 'put', scope, key, payload, output: 'Newest' }).status).toBe(
      'ready',
    )
    expect(cache.execute({ kind: 'get', scope, key: oldest, payload }).output).toBe('Cached')
    expect(
      cache.execute({ kind: 'get', scope, key: '2'.padStart(32, '0'), payload }).output,
    ).toBeNull()
    const inspect = new DatabaseSync(path, { readOnly: true })
    try {
      expect(
        Number(inspect.prepare('SELECT COUNT(*) AS count FROM entries').get()?.count),
      ).toBeLessThanOrEqual(50000)
    } finally {
      inspect.close()
    }
  })
  it('recovers committed WAL data after a writer exits without closing the database', async () => {
    const { path } = await location()
    store(path).close()
    const script = `const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(process.argv[1]);
      db.exec('PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=0');
      db.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,?)')
        .run(process.argv[2],process.argv[3],process.argv[4],'Committed',500,1,Number(process.argv[5]));
      process.exit(0);`
    execFileSync(process.execPath, [
      '-e',
      script,
      path,
      key,
      scope,
      payload,
      String(Date.now() + cacheLimits.ttlMs),
    ])
    expect((await stat(`${path}-wal`)).size).toBeGreaterThan(0)
    expect(store(path).execute({ kind: 'get', scope, key, payload })).toEqual({
      status: 'ready',
      output: 'Committed',
    })
  })
  it('rolls back a failed replacement without deleting the previous translation', async () => {
    const { path } = await location()
    const cache = store(path)
    cache.execute({ kind: 'put', scope, key, payload, output: 'Original' })
    const db = Reflect.get(cache, 'database') as DatabaseSync
    db.exec(`PRAGMA max_page_count=${Number(db.prepare('PRAGMA page_count').get()?.page_count)}`)
    expect(
      cache.execute({ kind: 'put', scope, key, payload, output: 'x'.repeat(200 * 1024) }).status,
    ).toBe('unavailable')
    expect(cache.execute({ kind: 'get', scope, key, payload }).output).toBe('Original')
  })
  it('recovers accounting after SQLite rolls back a transaction on SQLITE_FULL', async () => {
    const { path } = await location()
    const cache = store(path)
    cache.execute({ kind: 'put', scope, key, payload, output: 'Original' })
    const db = Reflect.get(cache, 'database') as DatabaseSync
    // Introduce page pressure inside INSERT, after preflight and removal of the
    // old entry. This exercises SQLite's automatic transaction rollback itself.
    db.exec(`PRAGMA max_page_count=64;
      CREATE TABLE pressure(data BLOB) STRICT;
      CREATE TRIGGER pressure_on_insert BEFORE INSERT ON entries BEGIN
        INSERT INTO pressure VALUES (zeroblob(524288)); END;`)
    expect(cache.execute({ kind: 'put', scope, key, payload, output: 'Replacement' }).status).toBe(
      'unavailable',
    )
    expect(cache.execute({ kind: 'get', scope, key, payload })).toEqual({
      status: 'ready',
      output: 'Original',
    })
    expect(Reflect.get(cache, 'rows')).toBe(
      db.prepare('SELECT COUNT(*) AS count FROM entries').get()?.count,
    )
    expect(Reflect.get(cache, 'bytes')).toBe(
      db.prepare('SELECT SUM(bytes) AS bytes FROM entries').get()?.bytes,
    )
    expect(db.prepare('SELECT COUNT(*) AS count FROM pressure').get()?.count).toBe(0)
    db.exec('DROP TRIGGER pressure_on_insert; DROP TABLE pressure')
    expect(cache.execute({ kind: 'put', scope, key, payload, output: 'Resumed' }).status).toBe(
      'ready',
    )
    expect(cache.execute({ kind: 'get', scope, key, payload }).output).toBe('Resumed')
  })
  it('refuses unsafe hard-linked WAL sidecars without modifying their target', async () => {
    const { directory, path } = await location()
    const target = join(directory, 'keep.txt')
    await writeFile(target, 'KEEP')
    await link(target, `${path}-wal`)
    expect(store(path).execute({ kind: 'get', scope, key, payload }).status).toBe('unavailable')
    expect(await readFile(target, 'utf8')).toBe('KEEP')
  })
  it('migrates, persists validated units, verifies canonical payload equality and clears across restart', async () => {
    const { path } = await location()
    let cache = store(path)
    expect(cache.execute({ kind: 'put', scope, key, payload, output: '你好世界' }).status).toBe(
      'ready',
    )
    cache.close()
    cache = store(path)
    expect(cache.execute({ kind: 'get', scope, key, payload })).toEqual({
      status: 'ready',
      output: '你好世界',
    })
    expect(
      cache.execute({ kind: 'get', scope, key, payload: payload.replace('Hello', 'Other') }).output,
    ).toBeNull()
    cache.execute({ kind: 'clear' })
    cache.close()
    expect(store(path).execute({ kind: 'get', scope, key, payload }).output).toBeNull()
  })
  it('evicts the least recently used entries in bounded batches and reuses free pages', async () => {
    const { path } = await location()
    const cache = store(path, 4500)
    for (let index = 0; index < 12; index++)
      cache.execute({
        kind: 'put',
        scope,
        key: index.toString(16).padStart(32, '0'),
        payload,
        output: `${index} ${'x'.repeat(300)}`,
      })
    expect(cache.execute({ kind: 'get', scope, key: '0'.repeat(32), payload }).output).toBeNull()
    expect(
      cache.execute({ kind: 'get', scope, key: (11).toString(16).padStart(32, '0'), payload })
        .output,
    ).toContain('11')
    cache.close()
    const db = new DatabaseSync(path)
    try {
      expect(
        Number(db.prepare('SELECT SUM(bytes) AS bytes FROM entries').get()?.bytes),
      ).toBeLessThanOrEqual(4500)
      expect(Number(db.prepare('PRAGMA user_version').get()?.user_version)).toBe(2)
    } finally {
      db.close()
    }
  })
  it('quarantines corrupt cache files without touching recovery or preferences', async () => {
    const { directory, path } = await location()
    await writeFile(path, 'corrupt sqlite')
    await writeFile(join(directory, 'recovery-important.md'), 'KEEP UNSAVED TEXT')
    const cache = store(path)
    expect(cache.execute({ kind: 'get', scope, key, payload }).status).toBe('recovered')
    expect(
      (await readdir(directory)).some((name) =>
        name.startsWith('translation-cache.sqlite.corrupt-'),
      ),
    ).toBe(true)
    expect(await readFile(join(directory, 'recovery-important.md'), 'utf8')).toBe(
      'KEEP UNSAVED TEXT',
    )
    expect(cache.execute({ kind: 'clear' }).status).toBe('ready')
    expect((await readdir(directory)).some((name) => name.includes('.corrupt-'))).toBe(false)
  })
  it('never writes to a future database schema', async () => {
    const { path } = await location()
    const db = new DatabaseSync(path)
    db.exec(
      "CREATE TABLE future(data TEXT); INSERT INTO future VALUES ('keep'); PRAGMA user_version=9",
    )
    db.close()
    const before = await readFile(path)
    const cache = store(path)
    expect(cache.execute({ kind: 'clear' }).status).toBe('future')
    expect(cache.execute({ kind: 'put', scope, key, payload, output: '世界' }).status).toBe(
      'future',
    )
    expect(await readFile(path)).toEqual(before)
  })
  it('preserves WAL hits under a writer lock and resumes writes and clearing after release', async () => {
    const { path } = await location()
    let now = Date.now()
    const cache = store(path, undefined, () => now)
    cache.execute({ kind: 'put', scope, key, payload, output: 'Original' })
    const locked = new DatabaseSync(path)
    locked.exec('BEGIN EXCLUSIVE')
    try {
      expect(cache.execute({ kind: 'get', scope, key, payload })).toEqual({
        status: 'ready',
        output: 'Original',
      })
      now += cacheLimits.touchMs
      cache.flush()
      expect(cache.execute({ kind: 'get', scope, key, payload }).output).toBe('Original')
      expect(cache.execute({ kind: 'put', scope, key, payload, output: '世界' }).status).toBe(
        'unavailable',
      )
      expect(cache.execute({ kind: 'clear' }).status).toBe('unavailable')
    } finally {
      locked.exec('ROLLBACK')
      locked.close()
    }
    cache.flush()
    expect(cache.execute({ kind: 'put', scope, key, payload, output: '世界' }).status).toBe('ready')
    expect(cache.execute({ kind: 'get', scope, key, payload }).output).toBe('世界')
    expect(cache.execute({ kind: 'clear' }).status).toBe('ready')
    expect(cache.execute({ kind: 'get', scope, key, payload }).output).toBeNull()
  })
  it('rejects an entry exceeding SQLite capacity without disabling the database', async () => {
    const { path } = await location()
    const cache = store(path)
    const database = Reflect.get(cache, 'database') as DatabaseSync
    const pages = Number(database.prepare('PRAGMA page_count').get()?.page_count)
    database.exec(`PRAGMA max_page_count=${pages}`)
    expect(
      cache.execute({ kind: 'put', scope, key, payload, output: 'x'.repeat(200 * 1024) }).status,
    ).toBe('unavailable')
    expect(cache.execute({ kind: 'get', scope, key, payload })).toEqual({
      status: 'ready',
      output: null,
    })
    expect(cache.execute({ kind: 'clear' }).status).toBe('ready')
  })
  // Exercise all 400 durable SQLite writes; this is a storage boundary, not a latency gate.
  it('evicts under physical page pressure before the logical budget is full', async () => {
    const { path } = await location()
    // Scale 256:320 MiB down to 1:1.25 MiB, including real overflow/index pages.
    const cache = store(path, 1024 * 1024)
    const db = Reflect.get(cache, 'database') as DatabaseSync
    db.exec('PRAGMA max_page_count=320')
    const output = 'x'.repeat(5500)
    for (let index = 0; index < 400; index++) {
      const entryKey = index.toString(16).padStart(32, '0')
      expect(cache.execute({ kind: 'put', scope, key: entryKey, payload, output }).status).toBe(
        'ready',
      )
      expect(cache.execute({ kind: 'get', scope, key: entryKey, payload }).output).toBe(output)
    }
    expect(cache.execute({ kind: 'get', scope, key: '0'.repeat(32), payload }).output).toBeNull()
    expect(Number(db.prepare('PRAGMA page_count').get()?.page_count)).toBeLessThanOrEqual(320)
    expect(Number(db.prepare('SELECT SUM(bytes) AS bytes FROM entries').get()?.bytes)).toBeLessThan(
      1024 * 1024,
    )
    cache.close()
    expect(
      store(path).execute({
        kind: 'get',
        scope,
        key: (399).toString(16).padStart(32, '0'),
        payload,
      }).output,
    ).toBe(output)
  }, 30000)
  it('coalesces repeated hits into one durable LRU update without extending TTL', async () => {
    const { path } = await location()
    let now = Date.now()
    const cache = store(path, undefined, () => now)
    cache.execute({ kind: 'put', scope, key, payload, output: 'Cached' })
    const db = Reflect.get(cache, 'database') as DatabaseSync
    const before = Number(db.prepare('SELECT total_changes() AS count').get()?.count)
    const expires = db.prepare('SELECT expires FROM entries WHERE key=?').get(key)?.expires
    for (let index = 0; index < 1000; index++)
      expect(cache.execute({ kind: 'get', scope, key, payload }).output).toBe('Cached')
    expect(db.prepare('SELECT total_changes() AS count').get()?.count).toBe(before)
    now += cacheLimits.touchMs
    cache.flush()
    expect(db.prepare('SELECT total_changes() AS count').get()?.count).toBe(before + 1)
    expect(db.prepare('SELECT expires FROM entries WHERE key=?').get(key)?.expires).toBe(expires)
  })
  it('never stores invalid output and discards externally corrupted cached output', async () => {
    const { path } = await location()
    const cache = store(path)
    cache.execute({ kind: 'put', scope, key, payload, output: 'Valid text' })
    cache.close()
    const db = new DatabaseSync(path)
    db.prepare('UPDATE entries SET output=? WHERE key=?').run('⟪M99⟫', key)
    db.close()
    expect(store(path).execute({ kind: 'get', scope, key, payload })).toEqual({
      status: 'ready',
      output: null,
    })
    const other = store((await location()).path)
    expect(other.execute({ kind: 'put', scope, key, payload, output: '⟪M99⟫' }).status).toBe(
      'unavailable',
    )
  })
})
