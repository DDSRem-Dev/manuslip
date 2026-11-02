import { PackedReader } from './packing-bytes'
import { PackedPositionSummary } from './packing-position-summary'
import type { PackedEncodedRecord, PackedEncodedReference } from './packing-record-read'
import { packedStringWorkspace } from './packing-string'
import { PackedWork } from './packing-work'

export interface PackedArenaLimits {
  bytes: number
  retained: number
  staging: number
}
export type PackedArenaAdmission = (retainedBytes: number, stagingBytes: number) => void
interface ArenaIndex {
  shapes: readonly (readonly string[])[]
  offsets: Uint32Array
  strings: Map<number, string>
  largeStrings: Map<number, { length: number; bytes: number }>
  root: number
  end: number
  retainedBytes: number
  stagingBytes: number
}
const fieldCacheBytes = 128

function validateLimits(payload: ArrayBuffer, limits: PackedArenaLimits): void {
  if (
    !(payload instanceof ArrayBuffer) ||
    !Number.isSafeInteger(limits.bytes) ||
    limits.bytes < 4 ||
    payload.byteLength > limits.bytes ||
    !Number.isSafeInteger(limits.retained) ||
    limits.retained < 0 ||
    !Number.isSafeInteger(limits.staging) ||
    limits.staging < 0
  )
    throw new Error('Invalid packed arena limits')
}

/** Validate every byte/reference before publishing a small index; no mdast graph is expanded. */
function* indexArena(
  payload: ArrayBuffer,
  limits: PackedArenaLimits,
  cooperativeKeys = false,
  admit?: PackedArenaAdmission,
): Generator<void, ArenaIndex, undefined> {
  validateLimits(payload, limits)
  const reader = new PackedReader(payload)
  for (const byte of [77, 83, 80, 50])
    if (reader.byte() !== byte) throw new Error('Unknown packed version')
  let retainedBytes = payload.byteLength + 256 + fieldCacheBytes
  let stagingBytes = 0
  let stringWorkspace = 0
  const charge = (bytes: number) => {
    retainedBytes += bytes
    if (retainedBytes > limits.retained) throw new Error('Packed arena exceeds retained limit')
    admit?.(retainedBytes, stagingBytes + stringWorkspace)
  }
  const stage = (bytes: number) => {
    stagingBytes += bytes
    if (stagingBytes + stringWorkspace > limits.staging)
      throw new Error('Packed arena exceeds staging limit')
    admit?.(retainedBytes, stagingBytes + stringWorkspace)
  }
  charge(0)
  const shapeCount = reader.uint()
  if (shapeCount > reader.remaining) throw new Error('Invalid packed shapes')
  charge(48 + shapeCount * 8)
  const shapes: (readonly string[])[] = []
  let work = 0
  for (let index = 0; index < shapeCount; index++) {
    const length = reader.uint()
    if (length > reader.remaining) throw new Error('Invalid packed shape')
    charge(48 + length * 8)
    stage(96 + length * 48)
    const keys: string[] = []
    const seen = new Set<string>()
    for (let keyIndex = 0; keyIndex < length; keyIndex++) {
      const before = reader.position
      const probe = new PackedReader(reader, before)
      const encodedBytes = probe.uint()
      stringWorkspace = Math.max(
        stringWorkspace,
        512 + (encodedBytes + probe.position - before) * 4,
      )
      stage(0)
      let key: string
      if (cooperativeKeys) {
        if (encodedBytes <= 4096) key = reader.string(limits.staging - stagingBytes)
        else {
          const workspace = 512 + encodedBytes * 4 + packedStringWorkspace
          // Shape keys are native strings. Reserve their complete spelling/output before
          // assembling a rope; lexical decoding itself still yields for every byte batch.
          stringWorkspace = Math.max(stringWorkspace, workspace)
          stage(0)
          key = ''
          for (const chunk of reader.stringSteps(limits.staging - stagingBytes)) {
            if (chunk !== undefined) key += chunk
            yield
          }
        }
      } else key = reader.string(limits.staging - stagingBytes)
      stringWorkspace = Math.max(stringWorkspace, 512 + (reader.position - before) * 4)
      stage(0)
      if (seen.has(key)) throw new Error('Duplicate packed key')
      seen.add(key)
      charge(32 + key.length * 2)
      keys.push(key)
      // A short key may still consume 4096 bytes; do not batch hundreds together.
      work = 0
      yield
    }
    shapes.push(Object.freeze(keys))
    if (++work === 256) {
      work = 0
      yield
    }
  }
  const positionCount = reader.uint()
  if (positionCount > Math.floor(reader.remaining / 7))
    throw new Error('Invalid packed position count')
  const count = reader.uint()
  if (count > reader.remaining) throw new Error('Invalid packed record count')
  charge(48 + count * 4)
  const offsets = new Uint32Array(count)
  const strings = new Map<number, string>()
  const largeStrings = new Map<number, { length: number; bytes: number }>()
  let positions = 0
  const references = function* (length: number, index: number): Generator<void> {
    if (length > reader.remaining) throw new Error('Invalid packed references')
    for (let reference = 0; reference < length; reference++) {
      if (reader.uint() >= index) throw new Error('Forward or invalid packed reference')
      if (++work === 256) {
        work = 0
        yield
      }
    }
  }
  for (let index = 0; index < count; index++) {
    offsets[index] = reader.position
    const tag = reader.uint()
    if (++work === 256) {
      work = 0
      yield
    }
    if (tag <= 2) continue
    if (tag === 3) reader.uint()
    else if (tag === 4) reader.number()
    else if (tag === 5) {
      const probe = new PackedReader(reader, reader.position)
      const bytes = probe.uint()
      stringWorkspace = Math.max(stringWorkspace, bytes <= 4096 ? 512 + bytes * 4 : 32768 + 512)
      stage(0)
      const string = yield* reader.indexedStringSteps(limits.staging - stagingBytes)
      stringWorkspace = Math.max(stringWorkspace, string.workspace)
      if (stagingBytes + stringWorkspace > limits.staging)
        throw new Error('Packed arena exceeds staging limit')
      if (string.value !== undefined) {
        charge(96 + string.length * 2)
        strings.set(index, string.value)
      } else {
        charge(160)
        largeStrings.set(index, { length: string.length, bytes: string.encodedBytes })
      }
      work = 0
      yield
    } else if (tag === 6) yield* references(reader.uint(), index)
    else if (tag === 7) {
      if (++positions > positionCount) throw new Error('Invalid packed position count')
      for (let coordinate = 0; coordinate < 6; coordinate++) reader.uint()
    } else {
      const shape = shapes[tag - 8]
      if (!shape) throw new Error('Unknown packed shape')
      yield* references(shape.length, index)
    }
  }
  const end = reader.position
  const root = reader.uint()
  if (root >= count || reader.remaining !== 0 || positions !== positionCount)
    throw new Error('Invalid packed root or trailing bytes')
  return {
    shapes: Object.freeze(shapes),
    offsets,
    strings,
    largeStrings,
    root,
    end,
    retainedBytes,
    stagingBytes: stagingBytes + stringWorkspace,
  }
}

/**
 * Experimental owned, immutable MSP2 arena. IDs belong to this arena only. Direct field/array
 * access avoids retaining expanded trees. It does not validate a semantic protocol envelope.
 */
export class PackedArena {
  readonly #recordToken = Object.freeze({})
  readonly root: number
  readonly records: number
  readonly bytes: number
  readonly retainedBytes: number
  readonly stagingBytes: number
  readonly #index: ArenaIndex
  readonly #reader: PackedReader
  #fieldReference: number | undefined
  #fieldShape: readonly string[] | undefined
  #fieldStart = 0
  #fieldNext = 0
  #fieldIndex = -1
  #fieldValue: number | undefined
  private constructor(payload: ArrayBuffer, index: ArenaIndex) {
    this.#index = index
    this.#reader = new PackedReader(payload)
    this.root = index.root
    this.records = index.offsets.length
    this.bytes = payload.byteLength
    this.retainedBytes = index.retainedBytes
    this.stagingBytes = index.stagingBytes
    Object.freeze(this)
  }
  /** On success consume the buffer by transfer. Rejected input retains its ownership. */
  static open(payload: ArrayBuffer, limits: PackedArenaLimits): PackedArena {
    const steps = indexArena(payload, limits)
    while (true) {
      const step = steps.next()
      if (step.done) {
        const owned = structuredClone(payload, { transfer: [payload] })
        return new PackedArena(owned, step.value)
      }
    }
  }
  /**
   * Seal ownership eagerly, then index through a revocable scheduler handle. Unlike open,
   * malformed input is consumed too: caller views cannot mutate suspended validation.
   * No arena is exposed until every byte, reference and root has passed validation.
   * Limits are copied before returning, so later caller mutations cannot change admission.
   * Native key hashing/freezing and index allocation remain separately measurable work.
   */
  static openSteps(
    payload: ArrayBuffer,
    limits: PackedArenaLimits,
    admit?: PackedArenaAdmission,
  ): PackedWork<PackedArena> {
    const checked = Object.freeze({
      bytes: limits.bytes,
      retained: limits.retained,
      staging: limits.staging,
    })
    validateLimits(payload, checked)
    const owned = structuredClone(payload, { transfer: [payload] })
    return new PackedWork(PackedArena.#openOwned(owned, checked, admit), () => {})
  }
  static *#openOwned(
    payload: ArrayBuffer,
    limits: PackedArenaLimits,
    admit?: PackedArenaAdmission,
  ): Generator<void, PackedArena, undefined> {
    const index = yield* indexArena(payload, limits, true, admit)
    return new PackedArena(payload, index)
  }
  #offset(reference: number): number {
    if (!Number.isSafeInteger(reference) || reference < 0 || reference >= this.records)
      throw new Error('Invalid arena record ID')
    const offset = this.#index.offsets[reference]
    if (offset === undefined) throw new Error('Invalid arena record ID')
    return offset
  }
  /** Suspended streams must retain independent cursors across arbitrary arena reads. */
  #record(reference: number): PackedReader {
    return new PackedReader(this.#reader, this.#offset(reference))
  }
  /** Only synchronous queries may share this cursor: never hold it across a yield. */
  #read(reference: number): PackedReader {
    this.#reader.seek(this.#offset(reference))
    return this.#reader
  }
  kind(reference: number): 'scalar' | 'array' | 'object' | 'position' {
    const tag = this.#read(reference).uint()
    return tag <= 5 ? 'scalar' : tag === 6 ? 'array' : tag === 7 ? 'position' : 'object'
  }
  recordToken(reference: number): object {
    this.#offset(reference)
    return this.#recordToken
  }
  /** Internal shallow import metadata. Strings still use canonical streamed spelling;
   * arbitrary valid wire spellings must never bypass exact string interning.
   */
  encodedRecord(reference: number): PackedEncodedRecord {
    const reader = this.#read(reference)
    const tag = reader.uint()
    let value: PackedEncodedRecord['value']
    let position: PackedEncodedRecord['position']
    let keys: readonly string[] | undefined
    let text: string | undefined
    let length = 0
    if (tag <= 2) value = tag === 0 ? null : tag === 2
    else if (tag === 3) value = reader.uint()
    else if (tag === 4) value = reader.number()
    else if (tag === 5) {
      text = this.#index.strings.get(reference)
      const units = text?.length ?? this.#index.largeStrings.get(reference)?.length
      if (units === undefined) throw new Error('Missing arena string metadata')
      length = units
    } else if (tag === 6) length = reader.uint()
    else if (tag === 7) {
      position = [
        reader.uint(),
        reader.uint(),
        reader.uint(),
        reader.uint(),
        reader.uint(),
        reader.uint(),
      ]
    } else if (tag > 7) {
      keys = this.#index.shapes[tag - 8]
      if (!keys) throw new Error('Unknown packed shape')
      length = keys.length
    }
    return {
      token: this.#recordToken,
      record: reference,
      offset: 0,
      range: 0,
      tag,
      next: reader.position,
      length,
      keys,
      value,
      text,
      position,
    }
  }
  /** Re-seek for every guarded edge; no shared native cursor survives a suspension. */
  encodedReference(reference: number, offset: number): PackedEncodedReference {
    const reader = this.#read(reference)
    const tag = reader.uint()
    if (tag === 6) reader.uint()
    else if (tag < 8) throw new Error('Packed record has no references')
    const end = this.#index.offsets[reference + 1] ?? this.#index.end
    if (!Number.isSafeInteger(offset) || offset < reader.position || offset >= end)
      throw new Error('Invalid packed reference offset')
    reader.seek(offset)
    const child = reader.uint()
    if (child >= reference || reader.position > end) throw new Error('Invalid packed reference')
    return { reference: child, next: reader.position }
  }
  /** Copy the complete validated encoding into independently admitted caller storage. */
  *copyEncoding(destination: ArrayBuffer): Generator<void> {
    yield* this.#reader.copySteps(destination)
  }
  scalar(reference: number): null | boolean | number | string {
    const reader = this.#read(reference)
    const tag = reader.uint()
    if (tag <= 2) return tag === 0 ? null : tag === 2
    if (tag === 3) return reader.uint()
    if (tag === 4) return reader.number()
    if (tag === 5) {
      const text = this.#index.strings.get(reference)
      // Large strings are caller-owned results, never an unbounded arena cache.
      return text === undefined ? reader.string() : text
    }
    throw new Error('Arena record is not a scalar')
  }
  scalarType(reference: number): 'null' | 'boolean' | 'number' | 'string' {
    const tag = this.#read(reference).uint()
    if (tag === 0) return 'null'
    if (tag <= 2) return 'boolean'
    if (tag <= 4) return 'number'
    if (tag === 5) return 'string'
    throw new Error('Arena record is not a scalar')
  }
  /** Admit these explicit output/workspace weights before materializing caller-owned text. */
  scalarCost(reference: number): { retained: number; workspace: number } {
    const tag = this.#read(reference).uint()
    if (tag <= 4) return { retained: 8, workspace: 0 }
    if (tag !== 5) throw new Error('Arena record is not a scalar')
    const cached = this.#index.strings.get(reference)
    if (cached !== undefined) return { retained: 32 + cached.length * 2, workspace: 0 }
    const large = this.#index.largeStrings.get(reference)
    if (!large) throw new Error('Missing arena string metadata')
    // The caller separately charges the returned value; staging holds its JSON spelling.
    return { retained: 32 + large.length * 2, workspace: 512 + large.bytes * 2 }
  }
  stringLength(reference: number): number {
    if (this.#read(reference).uint() !== 5) throw new Error('Arena record is not a string')
    const cached = this.#index.strings.get(reference)
    if (cached !== undefined) return cached.length
    const large = this.#index.largeStrings.get(reference)
    if (!large) throw new Error('Missing arena string metadata')
    return large.length
  }
  stringWorkspace(reference: number): number {
    this.stringLength(reference)
    return this.#index.strings.has(reference) ? 0 : packedStringWorkspace
  }
  /** Existing bounded index string, never a decode or a new cache entry. Its arena owner
   * already accounts storage; callers retaining it separately still admit output costs.
   */
  cachedString(reference: number): string | undefined {
    if (this.#read(reference).uint() !== 5) throw new Error('Arena record is not a string')
    return this.#index.strings.get(reference)
  }
  /** Output chunks are caller-owned; no decoded long string or chunk cache is retained. */
  *stringChunks(reference: number, workspaceLimit: number): Generator<string> {
    for (const chunk of this.stringSteps(reference, workspaceLimit))
      if (chunk !== undefined) yield chunk
  }
  *stringSteps(reference: number, workspaceLimit: number): Generator<string | undefined> {
    const reader = this.#record(reference)
    if (reader.uint() !== 5) throw new Error('Arena record is not a string')
    if (!Number.isSafeInteger(workspaceLimit) || workspaceLimit < this.stringWorkspace(reference))
      throw new Error('Packed string exceeds workspace limit')
    const cached = this.#index.strings.get(reference)
    if (cached !== undefined) {
      if (cached.length) yield cached
    } else yield* reader.stringSteps(workspaceLimit)
  }
  keys(reference: number): readonly string[] {
    const tag = this.#read(reference).uint()
    const keys = this.#index.shapes[tag - 8]
    if (!keys) throw new Error('Arena record is not an object')
    return keys
  }
  field(reference: number, key: string): number | undefined {
    let keys = this.#fieldShape
    if (reference !== this.#fieldReference || keys === undefined) {
      const reader = this.#read(reference)
      keys = this.#index.shapes[reader.uint() - 8]
      if (!keys) throw new Error('Arena record is not an object')
      this.#fieldReference = reference
      // Borrow only the already admitted immutable shape, never a failed query string.
      this.#fieldShape = keys
      this.#fieldStart = reader.position
      this.#fieldNext = reader.position
      this.#fieldIndex = -1
    }
    const index = keys.indexOf(key)
    if (index < 0) return undefined
    if (index === this.#fieldIndex) return this.#fieldValue
    // Continue ascending field queries from their saved byte offset. Other atomic reads
    // may move the shared reader; suspended streams always have independent readers.
    const forward = index > this.#fieldIndex
    const reader = this.#reader
    reader.seek(forward ? this.#fieldNext : this.#fieldStart)
    for (let before = forward ? this.#fieldIndex + 1 : 0; before < index; before++) reader.uint()
    const value = reader.uint()
    this.#fieldIndex = index
    this.#fieldNext = reader.position
    this.#fieldValue = value
    return value
  }
  /** One linear pass over fields, including wide shapes, without repeated prefix scans. */
  *fields(reference: number): Generator<readonly [string, number]> {
    const reader = this.#record(reference)
    const keys = this.#index.shapes[reader.uint() - 8]
    if (!keys) throw new Error('Arena record is not an object')
    for (const key of keys) yield [key, reader.uint()] as const
  }
  length(reference: number): number {
    const reader = this.#read(reference)
    if (reader.uint() !== 6) throw new Error('Arena record is not an array')
    return reader.uint()
  }
  /** Linear byte scan without allocating a cursor/reference object for every preceding item. */
  element(reference: number, index: number): number {
    const reader = this.#read(reference)
    if (reader.uint() !== 6) throw new Error('Arena record is not an array')
    const length = reader.uint()
    if (!Number.isSafeInteger(index) || index < 0 || index >= length)
      throw new Error('Invalid arena array index')
    for (let before = 0; before < index; before++) reader.uint()
    return reader.uint()
  }
  *elements(reference: number): Generator<number> {
    const reader = this.#record(reference)
    if (reader.uint() !== 6) throw new Error('Arena record is not an array')
    const length = reader.uint()
    for (let index = 0; index < length; index++) yield reader.uint()
  }
  position(reference: number) {
    const reader = this.#read(reference)
    if (reader.uint() !== 7) throw new Error('Arena record is not a position')
    const point = () =>
      Object.freeze({ line: reader.uint(), column: reader.uint(), offset: reader.uint() })
    return Object.freeze({ start: point(), end: point() })
  }
  /** Caller-owned scratch only. Validation must admit the full table before allocation. */
  summarizePositions(stage: (bytes: number) => void): PackedPositionSummary {
    return PackedPositionSummary.build(this.#reader, this.#index.offsets, this.#index.shapes, stage)
  }
  *summarizePositionSteps(
    stage: (bytes: number) => void,
  ): Generator<void, PackedPositionSummary, undefined> {
    return yield* PackedPositionSummary.buildSteps(
      this.#reader,
      this.#index.offsets,
      this.#index.shapes,
      stage,
    )
  }
}
