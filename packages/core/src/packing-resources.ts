export interface PackedResource {
  key: object
  bytes: number
}

/** Weighted live-resource union. Keys use actual owned object identity, never content hashes. */
export class PackedResources {
  #entries = new Map<object, { bytes: number; references: number }>()
  #bytes = 0
  static readonly entryBytes = 192
  get bytes() {
    return this.#bytes
  }
  get size() {
    return this.#entries.size
  }
  pin(resources: () => Iterable<PackedResource>, available: number): void {
    let added = 0
    for (const { key, bytes } of resources()) {
      const entry = this.#entries.get(key)
      if (entry && entry.bytes !== bytes) throw new Error('Inconsistent packed resource weight')
      if (!entry) added += bytes + PackedResources.entryBytes
    }
    if (added > available) throw new Error('Packed session exceeds retained limit')
    for (const { key, bytes } of resources()) {
      const entry = this.#entries.get(key)
      if (entry) entry.references++
      else {
        this.#entries.set(key, { bytes, references: 1 })
        this.#bytes += bytes + PackedResources.entryBytes
      }
    }
  }
  unpin(resources: Iterable<PackedResource>): void {
    for (const { key } of resources) {
      const entry = this.#entries.get(key)
      if (!entry) throw new Error('Missing packed resource ownership')
      if (--entry.references === 0) {
        this.#entries.delete(key)
        this.#bytes -= entry.bytes + PackedResources.entryBytes
      }
    }
  }
}
