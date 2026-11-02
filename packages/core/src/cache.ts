/** A weighted LRU. The caller includes all retained derived data in each weight. */
export class BoundedCache<K, V> {
  private readonly entries = new Map<K, { value: V; bytes: number }>()
  private used = 0
  constructor(readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid cache budget')
  }
  get(key: K): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }
  set(key: K, value: V, bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid cache weight')
    this.delete(key)
    if (bytes > this.limit) return
    while (this.used + bytes > this.limit) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.delete(oldest.value)
    }
    this.entries.set(key, { value, bytes })
    this.used += bytes
  }
  delete(key: K): void {
    const previous = this.entries.get(key)
    if (previous) this.used -= previous.bytes
    this.entries.delete(key)
  }
  clear(): void {
    this.entries.clear()
    this.used = 0
  }
  get bytes(): number {
    return this.used
  }
  get size(): number {
    return this.entries.size
  }
}
