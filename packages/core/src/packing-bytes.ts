import { PackedStringScanner, packedStringWorkspace } from './packing-string'

const chunkSize = 65536

export interface PackedStringIndex {
  value?: string
  length: number
  encodedBytes: number
  workspace: number
}

/** Bounded byte staging for the experimental semantic value codec. */
export class PackedWriter {
  private readonly chunks: Uint8Array[] = []
  private used = 0
  constructor(
    private readonly limit: number,
    private readonly allocate?: (bytes: number) => void,
  ) {}
  get length(): number {
    return this.used
  }
  /** Internal encoder closure. All published packets are independent copies. */
  discard(): void {
    this.chunks.length = 0
    this.used = 0
  }
  /** Read only already emitted bytes; no backing buffer escapes. */
  byteAt(offset: number): number {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= this.used)
      throw new Error('Invalid packed writer offset')
    const value = this.chunks[Math.floor(offset / chunkSize)]?.[offset % chunkSize]
    if (value === undefined) throw new Error('Missing byte chunk')
    return value
  }
  byte(value: number): void {
    if (this.used >= this.limit) throw new Error('Packed value exceeds byte limit')
    const index = Math.floor(this.used / chunkSize)
    if (!this.chunks[index]) {
      this.allocate?.(chunkSize + 64)
      this.chunks.push(new Uint8Array(chunkSize))
    }
    const chunk = this.chunks[index]
    if (!chunk) throw new Error('Missing byte chunk')
    chunk[this.used++ % chunkSize] = value
  }
  /** Copy one bounded lexical batch without repeating byte admission and chunk lookup.
   * New chunks retain the same admission order as byte(); a limit failure retains only
   * the prefix that byte-by-byte writing would have accepted.
   */
  writeBytes(bytes: Uint8Array): void {
    let from = 0
    while (from < bytes.length) {
      const offset = this.used % chunkSize
      const length = Math.min(chunkSize - offset, bytes.length - from)
      if (this.used + length > this.limit) {
        for (const byte of bytes.subarray(from)) this.byte(byte)
        return
      }
      const index = Math.floor(this.used / chunkSize)
      if (!this.chunks[index]) {
        this.allocate?.(chunkSize + 64)
        this.chunks.push(new Uint8Array(chunkSize))
      }
      const chunk = this.chunks[index]
      if (!chunk) throw new Error('Missing byte chunk')
      chunk.set(bytes.subarray(from, from + length), offset)
      this.used += length
      from += length
    }
  }
  /** Compare against emitted bytes only; no writer storage or cursor escapes. */
  matchesBytes(offset: number, bytes: Uint8Array): boolean {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > this.used ||
      bytes.length > this.used - offset
    )
      throw new Error('Invalid packed writer offset')
    let from = 0
    while (from < bytes.length) {
      const index = Math.floor(offset / chunkSize)
      const at = offset % chunkSize
      const length = Math.min(chunkSize - at, bytes.length - from)
      const chunk = this.chunks[index]
      if (!chunk) throw new Error('Missing byte chunk')
      for (let i = 0; i < length; i++) if (chunk[at + i] !== bytes[from + i]) return false
      offset += length
      from += length
    }
    return true
  }
  /** Hash at most 4096 emitted bytes per progress point without exposing chunks. */
  *hashSteps(offset: number, length: number): Generator<void, number, undefined> {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      length > this.used - offset
    )
      throw new Error('Invalid packed writer offset')
    let hash = 2166136261
    let remaining = length
    while (remaining) {
      const chunk = this.chunks[Math.floor(offset / chunkSize)]
      if (!chunk) throw new Error('Missing byte chunk')
      const start = offset % chunkSize
      const count = Math.min(remaining, chunkSize - start, 4096)
      for (let i = start; i < start + count; i++)
        hash = Math.imul(hash ^ (chunk[i] ?? 0), 16777619) >>> 0
      offset += count
      remaining -= count
      yield
    }
    return hash
  }
  uint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
      throw new Error('Invalid packed integer')
    do {
      const rest = Math.floor(value / 128)
      this.byte((value % 128) | (rest ? 128 : 0))
      value = rest
    } while (value)
  }
  number(value: number): void {
    const bytes = new Uint8Array(8)
    new DataView(bytes.buffer).setFloat64(0, value, true)
    for (const byte of bytes) this.byte(byte)
  }
  string(value: string): void {
    // JSON string spelling preserves lone UTF-16 surrogates; direct UTF-8 would replace them.
    const bytes = new TextEncoder().encode(JSON.stringify(value))
    this.uint(bytes.length)
    this.writeBytes(bytes)
  }
  /** Exact JSON spelling in bounded chunks, including surrogate pairs at chunk edges. */
  *stringSteps(value: string): Generator<void> {
    if (value.length <= 4096) {
      this.string(value)
      return
    }
    const encoder = new TextEncoder()
    const piece = (from: number) => {
      let to = Math.min(from + 4096, value.length)
      const last = value.charCodeAt(to - 1),
        next = value.charCodeAt(to)
      if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) to--
      return { to, bytes: encoder.encode(JSON.stringify(value.slice(from, to)).slice(1, -1)) }
    }
    let length = 2
    for (let from = 0; from < value.length; ) {
      const chunk = piece(from)
      length += chunk.bytes.length
      if (length > this.limit - this.used) throw new Error('Packed value exceeds byte limit')
      from = chunk.to
      yield
    }
    this.uint(length)
    this.byte(34)
    for (let from = 0; from < value.length; ) {
      const chunk = piece(from)
      this.writeBytes(chunk.bytes)
      from = chunk.to
      yield
    }
    this.byte(34)
  }
  /** Both writers must remain stable until completion/cancellation. Admission covers
   * the combined output before allocation; copies yield once per 64 KiB source chunk.
   */
  *finishSteps(
    prefix?: PackedWriter,
    admitOutput?: (bytes: number) => void,
    suffix?: PackedWriter,
    allocateOutput = this.allocate,
  ): Generator<void, ArrayBuffer, undefined> {
    const length = this.used + (prefix?.used ?? 0) + (suffix?.used ?? 0)
    if (length > this.limit) throw new Error('Packed value exceeds byte limit')
    allocateOutput?.(length + 64)
    if (admitOutput) {
      admitOutput(length)
      // A trusted owner may revoke work while admitting the result. Suspend before
      // allocating, so the enclosing revocable handle can discard that advance.
      yield
    }
    const result = new Uint8Array(length)
    let offset = 0
    for (const writer of [...(prefix ? [prefix] : []), this, ...(suffix ? [suffix] : [])]) {
      for (let index = 0; index < writer.chunks.length; index++) {
        const chunk = writer.chunks[index]
        const used = Math.min(chunkSize, writer.used - index * chunkSize)
        if (chunk) result.set(chunk.subarray(0, used), offset)
        offset += used
        yield
      }
    }
    return result.buffer
  }
  finish(): ArrayBuffer {
    this.allocate?.(this.used + 64)
    const result = new Uint8Array(this.used)
    for (let index = 0; index < this.chunks.length; index++) {
      const chunk = this.chunks[index]
      if (chunk)
        result.set(
          chunk.subarray(0, Math.min(chunkSize, this.used - index * chunkSize)),
          index * chunkSize,
        )
    }
    return result.buffer
  }
}

export class PackedReader {
  private offset: number
  private readonly bytes: Uint8Array
  private readonly view: DataView
  constructor(buffer: ArrayBuffer | PackedReader, offset = 0) {
    const length = buffer instanceof PackedReader ? buffer.view.byteLength : buffer.byteLength
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > length)
      throw new Error('Invalid packed offset')
    this.offset = offset
    this.bytes = buffer instanceof PackedReader ? buffer.bytes : new Uint8Array(buffer)
    this.view = buffer instanceof PackedReader ? buffer.view : new DataView(buffer)
  }
  /** Reset an atomic cursor; independent forks keep their own lexical position. */
  seek(offset: number): void {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > this.bytes.length)
      throw new Error('Invalid packed offset')
    this.offset = offset
  }
  byte(): number {
    const value = this.bytes[this.offset++]
    if (value === undefined) throw new Error('Truncated packed value')
    return value
  }
  uint(): number {
    const first = this.byte()
    if (first < 128) return first
    let value = first & 127
    for (let shift = 7; shift < 35; shift += 7) {
      const byte = this.byte()
      if (shift === 28 && byte > 15) throw new Error('Invalid packed integer')
      value |= (byte & 127) << shift
      if (!(byte & 128)) {
        if (byte === 0) throw new Error('Noncanonical packed integer')
        // The fifth group may set bit 31. The wire value is unsigned, including
        // the full 0xffffffff boundary; bitwise assembly must not expose a sign.
        return value >>> 0
      }
    }
    throw new Error('Invalid packed integer')
  }
  number(): number {
    if (this.offset + 8 > this.bytes.length) throw new Error('Truncated packed number')
    const value = this.view.getFloat64(this.offset, true)
    this.offset += 8
    if (!Number.isFinite(value)) throw new Error('Invalid packed number')
    return value
  }
  string(workspaceLimit = Number.MAX_SAFE_INTEGER, outputCharged = false): string {
    const length = this.uint()
    if (length > this.bytes.length - this.offset) throw new Error('Truncated packed string')
    if (512 + length * (outputCharged ? 2 : 4) > workspaceLimit)
      throw new Error('Packed string exceeds workspace limit')
    const encoded = new TextDecoder('utf-8', { fatal: true }).decode(
      this.bytes.subarray(this.offset, this.offset + length),
    )
    this.offset += length
    const value: unknown = JSON.parse(encoded)
    if (typeof value !== 'string') throw new Error('Invalid packed string')
    return value
  }
  /** Validate large strings in small chunks; callers may retain only short scalar values. */
  indexedString(workspaceLimit: number): PackedStringIndex {
    const steps = this.indexedStringSteps(workspaceLimit)
    while (true) {
      const step = steps.next()
      if (step.done) return step.value
    }
  }
  /** Same validation/index as indexedString, with at most 4096 encoded bytes per advance. */
  *indexedStringSteps(workspaceLimit: number): Generator<void, PackedStringIndex, undefined> {
    const start = this.offset
    const bytes = this.uint()
    if (bytes > this.remaining) throw new Error('Truncated packed string')
    const workspace = bytes <= 4096 ? 512 + bytes * 4 : 32768 + 512
    if (workspace > workspaceLimit) throw new Error('Packed string exceeds workspace limit')
    if (bytes <= 4096) {
      this.offset = start
      const value = this.string(workspaceLimit)
      return { value, length: value.length, encodedBytes: bytes, workspace }
    }
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const scanner = new PackedStringScanner()
    const end = this.offset + bytes
    while (this.offset < end) {
      const next = Math.min(this.offset + 4096, end)
      scanner.consume(decoder.decode(this.bytes.subarray(this.offset, next), { stream: true }))
      this.offset = next
      yield
    }
    scanner.consume(decoder.decode())
    scanner.complete()
    return { length: scanner.length, encodedBytes: bytes, workspace }
  }
  /**
   * Decode in bounded UTF-16 chunks. This streaming primitive may yield a prefix before a
   * malformed suffix rejects; owned arenas validate the entire value before exposing it.
   */
  *stringChunks(workspaceLimit: number): Generator<string> {
    for (const chunk of this.stringSteps(workspaceLimit)) if (chunk !== undefined) yield chunk
  }
  /** Each advance consumes at most one 4096-byte lexical batch, including JSON padding. */
  *stringSteps(workspaceLimit: number): Generator<string | undefined> {
    const length = this.uint()
    if (length > this.remaining) throw new Error('Truncated packed string')
    if (!Number.isSafeInteger(workspaceLimit) || workspaceLimit < packedStringWorkspace)
      throw new Error('Packed string exceeds workspace limit')
    const end = this.offset + length
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const scanner = new PackedStringScanner()
    while (this.offset < end) {
      const next = Math.min(this.offset + 4096, end)
      const value = scanner.consume(
        decoder.decode(this.bytes.subarray(this.offset, next), { stream: true }),
        true,
      )
      this.offset = next
      yield value
    }
    const value = scanner.consume(decoder.decode(), true)
    scanner.complete()
    if (value !== undefined) yield value
  }
  get remaining(): number {
    return this.bytes.length - this.offset
  }
  get position(): number {
    return this.offset
  }
  /** Copy owned bytes into a separately admitted exact-size destination; never expose a
   * mutable view of this reader's storage. Does not change the lexical cursor.
   */
  *copySteps(destination: ArrayBuffer): Generator<void> {
    if (destination.byteLength !== this.bytes.byteLength)
      throw new Error('Invalid packed copy destination')
    const output = new Uint8Array(destination)
    for (let at = 0; at < output.length; at += chunkSize) {
      output.set(this.bytes.subarray(at, Math.min(at + chunkSize, output.length)), at)
      yield
    }
  }
}
