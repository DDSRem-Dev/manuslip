import { messageSize, semanticLimits } from '@manuslip/core'
import type { ReadingBlock } from '@manuslip/renderer/reading'
import { readingProjectionBytes } from '@manuslip/renderer/reading'
import {
  parseTranslationPayload,
  type TranslationPayload,
  translationLimits,
} from '@manuslip/translate'
import { type ReadingUnit, type ReadingValue, readingLimits } from './protocol'

type Prepared = Extract<ReadingValue, { kind: 'prepared' }>
export interface SharedReadingPrepared {
  kind: 'prepared-shared'
  units: (Omit<ReadingUnit, 'payload'> & { payload: number | null })[]
  payloads: TranslationPayload[]
  blocks: ReadingBlock[]
}
export type ReadingWireValue = SharedReadingPrepared | Exclude<ReadingValue, Prepared>

const invalid = (): never => {
  throw new Error('translation-view-worker')
}
const admit = (bytes: number): number => {
  if (bytes > readingLimits.descriptors) throw new Error('translation-view-limit')
  return bytes
}
const string = (value: unknown, maximum = 256): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= maximum
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    return invalid()
  return value as Record<string, unknown>
}
const unitKinds = new Set(['paragraph', 'heading', 'tableCell', 'defListTerm'])
function range(value: Record<string, unknown>): void {
  if (
    !Number.isSafeInteger(value.from) ||
    !Number.isSafeInteger(value.to) ||
    (value.from as number) < 0 ||
    (value.to as number) < (value.from as number) ||
    !string(value.kind) ||
    !string(value.hash)
  )
    invalid()
}
function counts(units: unknown[], blocks: unknown[]): void {
  if (units.length > translationLimits.units || blocks.length > semanticLimits.blocks + 1)
    throw new Error('translation-view-limit')
}
const unitBytes = (unit: Omit<ReadingUnit, 'payload'>): number =>
  512 + (unit.occurrenceId.length + unit.hash.length + (unit.key?.length ?? 0)) * 2
const blockBytes = (block: ReadingBlock): number =>
  384 + (block.id.length + block.kind.length + block.hash.length) * 2
const payloadBytes = (payload: TranslationPayload): number =>
  256 + messageSize(payload) * 2 + payload.tokens.length * 256

/** Exact-value dictionary, never an occurrence/binding dictionary. Charge descriptor/map
 * metadata and unique payloads, including token objects, before retaining the response.
 * These ownership weights still require aggregate runtime heap calibration.
 */
export function sharedReadingPrepared(prepared: Prepared): {
  value: SharedReadingPrepared
  bytes: number
} {
  counts(prepared.units, prepared.blocks)
  let bytes = 4096
  for (const unit of prepared.units) bytes = admit(bytes + unitBytes(unit))
  for (const block of prepared.blocks) bytes = admit(bytes + blockBytes(block))
  const identities = new WeakMap<TranslationPayload, number>()
  const spellings = new Map<string, number>()
  const payloads: TranslationPayload[] = []
  const sizes: number[] = []
  let logicalBytes = 0
  const units = prepared.units.map((unit) => {
    let index: number | null = null
    if (unit.payload) {
      const known = identities.get(unit.payload)
      if (known !== undefined) index = known
      else {
        const spelling = JSON.stringify(unit.payload)
        index = spellings.get(spelling) ?? null
        if (index === null) {
          bytes = admit(bytes + payloadBytes(unit.payload))
          index = payloads.length
          payloads.push(unit.payload)
          sizes.push(messageSize(unit.payload))
          spellings.set(spelling, index)
        }
        identities.set(unit.payload, index)
      }
      logicalBytes += sizes[index] ?? 0
      if (logicalBytes > translationLimits.plan) throw new Error('translation-view-limit')
    }
    // Explicit public fields prevent private plan/binding additions from crossing the wire.
    return {
      occurrenceId: unit.occurrenceId,
      kind: unit.kind,
      from: unit.from,
      to: unit.to,
      hash: unit.hash,
      key: unit.key,
      payload: index,
    }
  })
  return { value: { kind: 'prepared-shared', units, payloads, blocks: prepared.blocks }, bytes }
}

/** Materialize only occurrence records. All uses of an index share one validated immutable
 * payload; never expand a table entry into a separate token graph for every occurrence.
 */
export function decodeReadingValue(input: unknown): ReadingValue {
  if (!input || typeof input !== 'object') return invalid()
  if ('kind' in input && input.kind === 'rendered') {
    const value = input as Extract<ReadingValue, { kind: 'rendered' }>
    if (readingProjectionBytes(value.projection) > readingLimits.projection)
      throw new Error('translation-view-limit')
    return value
  }
  const value = record(input, ['kind', 'units', 'payloads', 'blocks'])
  if (
    value.kind !== 'prepared-shared' ||
    !Array.isArray(value.units) ||
    !Array.isArray(value.blocks) ||
    !Array.isArray(value.payloads) ||
    value.payloads.length > value.units.length
  )
    return invalid()
  counts(value.units, value.blocks)
  let bytes = 4096
  // Admit the receiver's complete shared representation before copying any token graph.
  for (const candidate of value.units) {
    const unit = record(candidate, ['occurrenceId', 'kind', 'from', 'to', 'hash', 'key', 'payload'])
    range(unit)
    if (
      !string(unit.occurrenceId) ||
      !unitKinds.has(unit.kind as string) ||
      !(unit.key === null || string(unit.key)) ||
      (unit.payload === null
        ? unit.key !== null
        : unit.key === null ||
          !Number.isSafeInteger(unit.payload) ||
          (unit.payload as number) < 0 ||
          (unit.payload as number) >= value.payloads.length)
    )
      return invalid()
    bytes = admit(bytes + unitBytes(unit as unknown as ReadingUnit))
  }
  for (const candidate of value.blocks) {
    const block = record(candidate, ['id', 'kind', 'from', 'to', 'hash'])
    range(block)
    if (!string(block.id)) return invalid()
    bytes = admit(bytes + blockBytes(block as unknown as ReadingBlock))
  }
  for (const candidate of value.payloads) {
    const payload = record(candidate, ['schema', 'kind', 'text', 'tokens'])
    if (!Array.isArray(payload.tokens) || payload.tokens.length > translationLimits.tokens)
      return invalid()
    bytes = admit(bytes + payloadBytes(payload as unknown as TranslationPayload))
  }
  const payloads = value.payloads.map((input) => {
    const payload = parseTranslationPayload(input)
    for (const token of payload.tokens) Object.freeze(token)
    Object.freeze(payload.tokens)
    return Object.freeze(payload)
  })
  const ids = new Set<string>()
  const used = new Set<number>()
  const sizes = payloads.map(messageSize)
  let logicalBytes = 0
  const units = value.units.map((unit): ReadingUnit => {
    if (ids.has(unit.occurrenceId)) return invalid()
    ids.add(unit.occurrenceId)
    const payload = unit.payload === null ? null : payloads[unit.payload]
    if (payload && payload.kind !== unit.kind) return invalid()
    if (unit.payload !== null) {
      used.add(unit.payload)
      logicalBytes += sizes[unit.payload] ?? 0
      if (logicalBytes > translationLimits.plan) throw new Error('translation-view-limit')
    }
    return { ...unit, payload }
  })
  if (used.size !== payloads.length) return invalid()
  ids.clear()
  for (const block of value.blocks) {
    if (ids.has(block.id)) return invalid()
    ids.add(block.id)
  }
  return { kind: 'prepared', units, blocks: value.blocks }
}
