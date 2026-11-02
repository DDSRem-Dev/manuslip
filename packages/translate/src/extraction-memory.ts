import type { TokenBinding, TranslationPayload } from './contracts'

const canonicalPayloads = new WeakSet<TranslationPayload>()
export const isCanonicalPayload = (payload: TranslationPayload): boolean =>
  canonicalPayloads.has(payload)

/** Distinct from an individually oversized unit: total admission must abort extraction. */
export class ExtractionMemoryLimit extends Error {
  constructor() {
    super('translation-limit')
  }
}
export interface ExtractionCost {
  retainedBytes: number
  stagingBytes: number
  uniquePayloads: number
  payloadBytes: number
  peakBytes: number
}
/** Root nodes/strings are owned separately by the immutable capture. Count new unit/path/
 * binding storage, canonical payloads and their exact-string lookup keys before retaining.
 * One bounded projection plus traversal stack is admitted as workspace. These are weighted
 * ownership estimates requiring runtime calibration, not a portable heap guarantee.
 */
export class ExtractionMemory {
  private retained = 4096
  private pendingBytes = 0
  private peakStaging = 0
  private canonicalBytes = 0
  private peak = 0
  private readonly payloads = new Map<string, TranslationPayload>()
  constructor(
    private readonly limits: { retained: number; staging: number },
    readonly compactBindings = false,
    private readonly admit?: (retained: number) => void,
  ) {
    for (const value of [limits.retained, limits.staging])
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('translation-invalid')
    this.check()
  }
  private check() {
    const staging = 2 * 1024 * 1024 + this.pendingBytes
    if (staging > this.limits.staging || this.retained + staging > this.limits.retained)
      throw new ExtractionMemoryLimit()
    // An enclosing owner admits persistent output before intern() stores new data.
    this.admit?.(this.retained)
    this.peakStaging = Math.max(this.peakStaging, staging)
    this.peak = Math.max(this.peak, this.retained + staging)
  }
  charge(bytes: number): void {
    this.retained += bytes
    this.check()
  }
  pending(depth: number, direction: 1 | -1): void {
    this.pendingBytes += direction * (192 + (depth + 1) * 8)
    this.check()
  }
  intern(
    payload: TranslationPayload,
    spelling: string,
    bindings: TokenBinding[],
  ): TranslationPayload {
    const prior = this.payloads.get(spelling)
    if (prior) {
      for (let index = 0; index < bindings.length; index++) {
        const binding = bindings[index],
          token = prior.tokens[index]
        if (!binding || !token) throw new Error('translation-invalid')
        binding.token = token
      }
      return prior
    }
    // Token strings are charged per field, even when the runtime might intern them.
    const bytes =
      512 +
      spelling.length * 2 +
      payload.text.length * 2 +
      payload.tokens.reduce(
        (sum, token) =>
          sum +
          256 +
          Object.values(token).reduce(
            (size, value) => size + (typeof value === 'string' ? 32 + value.length * 2 : 8),
            0,
          ),
        0,
      )
    this.charge(bytes)
    this.canonicalBytes += bytes
    for (const token of payload.tokens) Object.freeze(token)
    Object.freeze(payload.tokens)
    Object.freeze(payload)
    canonicalPayloads.add(payload)
    this.payloads.set(spelling, payload)
    return payload
  }
  get cost(): ExtractionCost {
    return Object.freeze({
      retainedBytes: this.retained,
      stagingBytes: this.peakStaging,
      uniquePayloads: this.payloads.size,
      payloadBytes: this.canonicalBytes,
      peakBytes: this.peak,
    })
  }
}
