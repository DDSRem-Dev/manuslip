export function sqliteCode(error: unknown): number {
  return error && typeof error === 'object' && 'errcode' in error ? Number(error.errcode) & 255 : 0
}

/** Contention and a full bounded database may reject a write without damaging reads. */
export function retryableCacheWrite(error: unknown): boolean {
  return [5, 6, 13].includes(sqliteCode(error))
}

export function cacheWriteError(code: number): Error & { errcode: number } {
  return Object.assign(new Error('Cache write deferred'), { errcode: code })
}
