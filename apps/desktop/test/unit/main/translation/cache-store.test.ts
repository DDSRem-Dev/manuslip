import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { extractionVersion } from '@manuslip/translate'
import { afterEach, describe, expect, it } from 'vitest'
import { TranslationCacheStore } from '../../../../src/main/translation/cache-store'

const directories: string[] = []
const stores: TranslationCacheStore[] = []
const payload = JSON.stringify({
  schema: extractionVersion,
  kind: 'paragraph',
  text: 'Hello world',
  tokens: [],
})
const key = 'a'.repeat(64)
async function location() {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-translation-cache-'))
  directories.push(directory)
  return { directory, path: join(directory, 'translation-cache.sqlite') }
}
function store(path: string, budget?: number) {
  const value = new TranslationCacheStore(path, budget)
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
  it('migrates, persists validated units, verifies canonical payload equality and clears across restart', async () => {
    const { path } = await location()
    let cache = store(path)
    expect(cache.execute({ kind: 'put', key, payload, output: '你好世界' }).status).toBe('ready')
    cache.close()
    cache = store(path)
    expect(cache.execute({ kind: 'get', key, payload })).toEqual({
      status: 'ready',
      output: '你好世界',
    })
    expect(
      cache.execute({ kind: 'get', key, payload: payload.replace('Hello', 'Other') }).output,
    ).toBeNull()
    cache.execute({ kind: 'clear' })
    cache.close()
    expect(store(path).execute({ kind: 'get', key, payload }).output).toBeNull()
  })
  it('evicts the least recently used entries in bounded batches and reuses free pages', async () => {
    const { path } = await location()
    const cache = store(path, 4500)
    for (let index = 0; index < 12; index++)
      cache.execute({
        kind: 'put',
        key: index.toString(16).padStart(64, '0'),
        payload,
        output: `${index} ${'x'.repeat(300)}`,
      })
    expect(cache.execute({ kind: 'get', key: '0'.repeat(64), payload }).output).toBeNull()
    expect(
      cache.execute({ kind: 'get', key: (11).toString(16).padStart(64, '0'), payload }).output,
    ).toContain('11')
    cache.close()
    const db = new DatabaseSync(path)
    try {
      expect(
        Number(db.prepare('SELECT SUM(bytes) AS bytes FROM entries').get()?.bytes),
      ).toBeLessThanOrEqual(4500)
      expect(Number(db.prepare('PRAGMA user_version').get()?.user_version)).toBe(1)
    } finally {
      db.close()
    }
  })
  it('quarantines corrupt cache files without touching recovery or preferences', async () => {
    const { directory, path } = await location()
    await writeFile(path, 'corrupt sqlite')
    await writeFile(join(directory, 'recovery-important.md'), 'KEEP UNSAVED TEXT')
    const cache = store(path)
    expect(cache.execute({ kind: 'get', key, payload }).status).toBe('recovered')
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
    expect(cache.execute({ kind: 'put', key, payload, output: '世界' }).status).toBe('future')
    expect(await readFile(path)).toEqual(before)
  })
  it('disables persistence on lock/storage errors while leaving the database intact', async () => {
    const { path } = await location()
    const cache = store(path)
    const locked = new DatabaseSync(path)
    locked.exec('BEGIN EXCLUSIVE')
    try {
      expect(cache.execute({ kind: 'put', key, payload, output: '世界' }).status).toBe(
        'unavailable',
      )
    } finally {
      locked.exec('ROLLBACK')
      locked.close()
    }
    expect(store(path).execute({ kind: 'get', key, payload }).status).toBe('ready')
  })
  it('disables persistence on actual SQLite quota exhaustion without accepting a partial entry', async () => {
    const { path } = await location()
    const cache = store(path)
    const database = Reflect.get(cache, 'database') as DatabaseSync
    const pages = Number(database.prepare('PRAGMA page_count').get()?.page_count)
    database.exec(`PRAGMA max_page_count=${pages}`)
    expect(
      cache.execute({ kind: 'put', key, payload, output: 'x'.repeat(200 * 1024) }).status,
    ).toBe('unavailable')
    expect(store(path).execute({ kind: 'get', key, payload }).output).toBeNull()
  })
  it('never stores invalid output and discards externally corrupted cached output', async () => {
    const { path } = await location()
    const cache = store(path)
    cache.execute({ kind: 'put', key, payload, output: 'Valid text' })
    cache.close()
    const db = new DatabaseSync(path)
    db.prepare('UPDATE entries SET output=? WHERE key=?').run('⟪M99⟫', key)
    db.close()
    expect(store(path).execute({ kind: 'get', key, payload })).toEqual({
      status: 'ready',
      output: null,
    })
    const other = store((await location()).path)
    expect(other.execute({ kind: 'put', key, payload, output: '⟪M99⟫' }).status).toBe('unavailable')
  })
})
