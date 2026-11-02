import { semanticLimits, sourceHash } from './contracts'
import { PackedWork } from './packing-work'

export interface PackedIdentity {
  generation: number
  documentId: string
  revision: number
  sourceHash: string
  parserVersion: string
  rendererVersion: string
  options: string
}
export const identityKeys = [
  'generation',
  'documentId',
  'revision',
  'sourceHash',
  'parserVersion',
  'rendererVersion',
  'options',
] as const
export const packedIdentityStringLimits = {
  documentId: 256,
  parserVersion: 256,
  rendererVersion: 256,
  // Production labels permit 200 UTF-16 units each, including JSON-escaped controls.
  options: 4096,
} as const
export function sameIdentity(left: PackedIdentity, right: PackedIdentity): boolean {
  return !!left && !!right && identityKeys.every((key) => left[key] === right[key])
}

const sources = new WeakMap<object, number>()
/** Only constructors and the completed private source scan can grant this capability. */
export function isPackedSource(value: unknown): value is PackedSource {
  return typeof value === 'object' && value !== null && sources.has(value)
}

/** Exact code-point count from this immutable source's completed local admission scan. */
export function packedSourceCharacters(source: PackedSource): number {
  const characters = sources.get(source)
  if (characters === undefined) throw new Error('Invalid prepared packed source')
  return characters
}

export class PackedSourceJsonLimitError extends Error {}

function jsonUnitBytes(unit: number): number {
  if (unit < 0x20)
    return unit === 8 || unit === 9 || unit === 10 || unit === 12 || unit === 13 ? 2 : 6
  if (unit === 34 || unit === 92) return 2
  if (unit < 0x80) return 1
  if (unit < 0x800) return 2
  if (unit >= 0xd800 && unit <= 0xdfff) return 6
  return 3
}

function retainedSourceBytes(identity: PackedIdentity, source: string): number {
  return (
    // Keep the existing source weight and admit the independently stored count as a scalar.
    512 +
    16 +
    source.length * 2 +
    identityKeys.reduce((sum, key) => sum + String(identity[key]).length * 2, 0)
  )
}

function checkMetadata(identity: PackedIdentity): void {
  if (
    !Number.isSafeInteger(identity.generation) ||
    identity.generation < 0 ||
    !Number.isSafeInteger(identity.revision) ||
    identity.revision < 0
  )
    throw new Error('Invalid packed revision identity')
  for (const key of ['documentId', 'parserVersion', 'rendererVersion', 'options'] as const)
    if (
      typeof identity[key] !== 'string' ||
      !identity[key].length ||
      identity[key].length > packedIdentityStringLimits[key]
    )
      throw new Error('Invalid packed revision identity')
}

function completedSource(
  identity: PackedIdentity,
  source: string,
  characters: number,
): PackedSource {
  const result = Object.create(PackedSource.prototype) as PackedSource
  Object.defineProperties(result, {
    identity: { value: Object.freeze(identity), enumerable: true },
    text: { value: source, enumerable: true },
    retainedBytes: { value: retainedSourceBytes(identity, source), enumerable: true },
  })
  sources.set(result, characters)
  return Object.freeze(result)
}

export interface PackedSourceWork extends PackedWork<PackedSource> {
  /** Provisional source, immutable metadata and scan state, before any scan starts. */
  readonly retainedBytes: number
}

/** Capture metadata now; compute UTF-8, the optional JSON cap, UTF-16 hash and code-point
 * count together. Only the completed local scan can grant access to the cached count.
 * The source remains private until the complete scan succeeds. A held closed work handle
 * retains only its numeric provisional weight, not the source or metadata snapshot.
 */
export function packedSourceSteps(
  identity: Omit<PackedIdentity, 'sourceHash'>,
  source: string,
  jsonByteLimit = Number.POSITIVE_INFINITY,
): PackedSourceWork {
  if (!identity || typeof source !== 'string' || source.length > semanticLimits.previewBytes)
    throw new Error('Invalid packed revision identity')
  if (
    jsonByteLimit !== Number.POSITIVE_INFINITY &&
    (!Number.isSafeInteger(jsonByteLimit) || jsonByteLimit < 2)
  )
    throw new Error('Invalid packed source JSON limit')
  const captured = Object.freeze(
    Object.fromEntries(identityKeys.map((key) => [key, key === 'sourceHash' ? '' : identity[key]])),
  ) as unknown as PackedIdentity
  checkMetadata(captured)
  const provisionalBytes = retainedSourceBytes(captured, source) + 1664
  const work = new PackedWork(
    (function* () {
      let bytes = 0
      let jsonBytes = 2
      let characters = source.length
      let previousHigh = false
      let a = 0x811c9dc5
      let b = 0x9e3779b9
      let batch = 0
      for (let index = 0; index < source.length; index++) {
        const unit = source.charCodeAt(index)
        const low = unit >= 0xdc00 && unit <= 0xdfff
        const high = unit >= 0xd800 && unit <= 0xdbff
        if (previousHigh && low) characters--
        a = Math.imul(a ^ unit, 0x01000193)
        b = Math.imul(b ^ unit, 0x85ebca6b)
        bytes += unit < 0x80 ? 1 : unit < 0x800 ? 2 : previousHigh && low ? 1 : 3
        // Defer a high surrogate: its next unit determines four versus six JSON bytes.
        if (previousHigh) jsonBytes += low ? 4 : 6
        if (!(previousHigh && low) && !high) jsonBytes += jsonUnitBytes(unit)
        previousHigh = high
        if (bytes > semanticLimits.previewBytes) throw new Error('Invalid packed revision identity')
        if (jsonBytes > jsonByteLimit)
          throw new PackedSourceJsonLimitError('Packed request exceeds JSON limit')
        if (++batch === 4096) {
          batch = 0
          yield
        }
      }
      if (previousHigh) jsonBytes += 6
      if (jsonBytes > jsonByteLimit)
        throw new PackedSourceJsonLimitError('Packed request exceeds JSON limit')
      const hash = `${source.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`
      return completedSource({ ...captured, sourceHash: hash }, source, characters)
    })(),
    () => {},
  )
  Object.defineProperty(work, 'retainedBytes', { value: provisionalBytes, enumerable: true })
  return Object.freeze(work) as PackedSourceWork
}

// Count TextEncoder's spelling without allocating an unadmitted full-source temporary buffer.
function sourceCharacters(source: string): number | undefined {
  let bytes = 0
  let characters = source.length
  for (let index = 0; index < source.length; index++) {
    const unit = source.charCodeAt(index)
    const next = source.charCodeAt(index + 1)
    if (unit < 0x80) bytes++
    else if (unit < 0x800) bytes += 2
    else if (unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      bytes += 4
      characters--
      index++
    } else bytes += 3
    if (bytes > semanticLimits.previewBytes) return undefined
  }
  return characters
}

/** Validated immutable request source, shared by its request and resulting revision. */
export class PackedSource {
  readonly identity: PackedIdentity
  readonly text: string
  readonly retainedBytes: number
  constructor(identity: PackedIdentity, source: string) {
    if (!identity) throw new Error('Invalid packed revision identity')
    // Validate the same immutable values that are eventually branded and reused.
    const captured = Object.freeze(
      Object.fromEntries(identityKeys.map((key) => [key, identity[key]])),
    ) as unknown as PackedIdentity
    identity = captured
    if (
      !identity ||
      !Number.isSafeInteger(identity.generation) ||
      identity.generation < 0 ||
      !Number.isSafeInteger(identity.revision) ||
      identity.revision < 0 ||
      typeof source !== 'string' ||
      source.length > semanticLimits.previewBytes ||
      typeof identity.sourceHash !== 'string'
    )
      throw new Error('Invalid packed revision identity')
    const characters = sourceCharacters(source)
    if (characters === undefined || identity.sourceHash !== sourceHash(source))
      throw new Error('Invalid packed revision identity')
    for (const key of ['documentId', 'parserVersion', 'rendererVersion', 'options'] as const)
      if (
        typeof identity[key] !== 'string' ||
        !identity[key].length ||
        identity[key].length > packedIdentityStringLimits[key]
      )
        throw new Error('Invalid packed revision identity')
    this.identity = captured
    this.text = source
    this.retainedBytes = retainedSourceBytes(captured, source)
    Object.freeze(this)
    sources.set(this, characters)
  }
}
