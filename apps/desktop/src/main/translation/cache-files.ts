import { chmodSync, lstatSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

export const cacheFileEndings = ['', '-journal', '-wal', '-shm'] as const

export function quarantinePaths(path: string): string[] {
  const prefix = `${basename(path)}.corrupt-`
  return readdirSync(dirname(path))
    .filter(
      (name) =>
        name.startsWith(prefix) &&
        /^[a-f0-9-]{36}(?:-journal|-wal|-shm)?$/.test(name.slice(prefix.length)),
    )
    .map((name) => join(dirname(path), name))
}

/** Reject links, including dangling symlinks, before SQLite or deletion touches a file. */
export function cacheFileSize(path: string, secure = false): number {
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (!stat) return 0
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
    throw new Error('Unsafe cache file')
  if (secure && process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600)
    chmodSync(path, 0o600)
  return stat.size
}

export function inspectCacheFiles(path: string, secure = false) {
  const sizes = cacheFileEndings.map((ending) => cacheFileSize(`${path}${ending}`, secure))
  return {
    database: sizes[0] ?? 0,
    wal: sizes[2] ?? 0,
    total: sizes.reduce((sum, size) => sum + size, 0),
  }
}
