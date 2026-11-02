import { semanticLimits, utf8Bytes } from './contracts'
import type { PackedOperation } from './packing-revision'
import { type PackedIdentity, sameIdentity } from './packing-source'
import { packedToken } from './packing-token'
import {
  WireBudget,
  wireIdentity,
  wireInteger,
  wireOperations,
  wireRecord,
  wireTime,
} from './packing-wire-values'

export const packedWireVersion = 'manuslip-packed/2'
export const packedEnvelopeBytes = 64 * 1024
export type PackedResyncReason =
  | 'base-unavailable'
  | 'base-mismatch'
  | 'ownership'
  | 'capacity'
  | 'unsupported'
interface Header {
  readonly protocol: typeof packedWireVersion
  readonly sequence: number
  readonly requestToken: string
  readonly result: PackedIdentity
  readonly sentAt: number
}
interface Metadata {
  readonly cached: boolean
  readonly transportInMs: number
  readonly serializeMs: number
}
export type PackedWireMessage = Header &
  (
    | {
        readonly kind: 'full'
        readonly payload: ArrayBuffer
        readonly metadata: Metadata
        readonly resultToken: string
      }
    | {
        readonly kind: 'delta'
        readonly payload: ArrayBuffer
        readonly metadata: Metadata
        readonly base: PackedIdentity
        readonly baseToken: string
        readonly resultToken: string
        readonly operations: readonly PackedOperation[]
      }
    | { readonly kind: 'resync'; readonly reason: PackedResyncReason }
  )
export interface CheckedPackedWire {
  readonly message: PackedWireMessage
  readonly bytes: number
  readonly envelopeBytes: number
  readonly retainedBytes: number
  readonly stagingBytes: number
}
const headerFields = ['protocol', 'kind', 'sequence', 'requestToken', 'result', 'sentAt']
const reasons: readonly string[] = [
  'base-unavailable',
  'base-mismatch',
  'ownership',
  'capacity',
  'unsupported',
]

/** Validate bounded envelope/identity/operations before touching or consuming binary records.
 * Returned metadata is copied/frozen; payload ownership stays with the caller until prepare.
 * This validates wire geometry, not the semantic contents of the prepared graph.
 */
export function readPackedWire(
  value: unknown,
  expected: { sequence: number; result: PackedIdentity; requestToken: string },
): CheckedPackedWire {
  const budget = new WireBudget()
  const kindDescriptor =
    value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'kind') : undefined
  const kind: unknown =
    kindDescriptor && 'value' in kindDescriptor ? kindDescriptor.value : undefined
  const extra =
    kind === 'full'
      ? ['payload', 'metadata', 'resultToken']
      : kind === 'delta'
        ? ['payload', 'metadata', 'base', 'baseToken', 'resultToken', 'operations']
        : kind === 'resync'
          ? ['reason']
          : null
  if (!extra) throw new Error('Invalid packed wire kind')
  const input = wireRecord(value, [...headerFields, ...extra])
  if (input.protocol !== packedWireVersion) throw new Error('Unknown packed wire version')
  const sequence = wireInteger(input.sequence)
  const requestToken = packedToken(input.requestToken)
  budget.charge(136)
  const result = wireIdentity(input.result, budget)
  if (
    sequence !== expected.sequence ||
    requestToken !== expected.requestToken ||
    !sameIdentity(result, expected.result)
  )
    throw new Error('Packed wire request mismatch')
  const header: Header = {
    protocol: packedWireVersion,
    sequence,
    requestToken,
    result,
    sentAt: wireTime(input.sentAt),
  }
  let message: PackedWireMessage
  let payloadBytes = 0
  if (kind === 'resync') {
    if (typeof input.reason !== 'string' || !reasons.includes(input.reason))
      throw new Error('Invalid packed resync reason')
    message = Object.freeze({ ...header, kind, reason: input.reason as PackedResyncReason })
  } else {
    if (
      !(input.payload instanceof ArrayBuffer) ||
      input.payload.byteLength < 4 ||
      input.payload.byteLength > semanticLimits.messageBytes
    )
      throw new Error('Invalid packed wire payload')
    payloadBytes = input.payload.byteLength
    const resultToken = packedToken(input.resultToken)
    if (resultToken === requestToken) throw new Error('Packed result token must be fresh')
    budget.charge(136)
    const metadata = wireRecord(input.metadata, ['cached', 'transportInMs', 'serializeMs'])
    if (typeof metadata.cached !== 'boolean') throw new Error('Invalid packed wire metadata')
    budget.charge(256)
    const shared = {
      ...header,
      payload: input.payload,
      resultToken,
      metadata: Object.freeze({
        cached: metadata.cached,
        transportInMs: wireTime(metadata.transportInMs),
        serializeMs: wireTime(metadata.serializeMs),
      }),
    }
    if (kind === 'full') message = Object.freeze({ ...shared, kind })
    else {
      const base = wireIdentity(input.base, budget)
      const baseToken = packedToken(input.baseToken)
      if (baseToken === resultToken) throw new Error('Packed result token must advance')
      budget.charge(136)
      if (
        result.revision <= base.revision ||
        Object.keys(base).some(
          (key) =>
            key !== 'revision' &&
            key !== 'sourceHash' &&
            base[key as keyof PackedIdentity] !== result[key as keyof PackedIdentity],
        )
      )
        throw new Error('Packed wire delta ownership mismatch')
      message = Object.freeze({
        ...shared,
        kind: 'delta',
        base,
        baseToken,
        operations: wireOperations(input.operations, budget),
      })
    }
  }
  const envelope = 'payload' in message ? { ...message, payload: undefined } : message
  // Each admitted string unit needs at most six JSON characters, numeric path items
  // need at most 17, and container/property overhead is covered by normalization charges.
  // Reserve both spelling and UTF-8 work before serializing even a rejected envelope.
  const stagingBytes = 1024 + budget.retained * 10
  if (stagingBytes > semanticLimits.messageBytes)
    throw new Error('Packed wire exceeds staging limit')
  const spelling = JSON.stringify(envelope)
  const envelopeBytes = utf8Bytes(spelling)
  const bytes = payloadBytes + envelopeBytes + 1024
  if (envelopeBytes > packedEnvelopeBytes || bytes > semanticLimits.messageBytes)
    throw new Error('Packed wire exceeds message/envelope limit')
  // Normalization + JSON spelling/UTF-8 workspace are caller-owned, bounded before use.
  return Object.freeze({
    message,
    bytes,
    envelopeBytes,
    retainedBytes: budget.retained,
    stagingBytes,
  })
}
