import { searchLimits } from '../../shared/search-contracts'

/** Delimited native search output. A false return asks the caller to stop the child. */
export class SearchRecordStream {
  private pending = Buffer.alloc(0)
  private length = 0
  constructor(private readonly delimiter: 0 | 10) {}

  push(chunk: Buffer, accept: (record: Buffer) => boolean): boolean {
    let start = 0
    while (start < chunk.length) {
      // Search only new bytes; a record can arrive in thousands of small chunks.
      const end = chunk.indexOf(this.delimiter, start)
      const stop = end === -1 ? chunk.length : end
      const length = this.length + stop - start
      if (length > searchLimits.record) {
        this.clear()
        return false
      }
      if (end === -1) {
        this.append(chunk.subarray(start))
        return true
      }
      const record = this.length
        ? Buffer.concat([this.pending.subarray(0, this.length), chunk.subarray(start, end)], length)
        : chunk.subarray(start, end)
      this.clear()
      if (!accept(record)) return false
      start = end + 1
    }
    return true
  }

  finish(accept: (record: Buffer) => boolean): boolean {
    const pending = this.pending.subarray(0, this.length)
    this.clear()
    return !pending.length || accept(pending)
  }

  clear(): void {
    this.pending = Buffer.alloc(0)
    this.length = 0
  }

  private append(chunk: Buffer): void {
    const length = this.length + chunk.length
    if (length > this.pending.length) {
      const capacity = Math.min(
        searchLimits.record,
        Math.max(1024, length, this.pending.length * 2),
      )
      const buffer = Buffer.allocUnsafe(capacity)
      this.pending.copy(buffer, 0, 0, this.length)
      this.pending = buffer
    }
    chunk.copy(this.pending, this.length)
    this.length = length
  }
}
