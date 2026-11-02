import { semanticLimits, utf8Bytes } from './contracts'
import { type PackedIdentity, sameIdentity } from './packing-source'
import { packedToken } from './packing-token'
import { packedEnvelopeBytes, packedWireVersion } from './packing-wire'
import { WireBudget, wireIdentity, wireInteger, wireRecord } from './packing-wire-values'

export interface PackedBase {
  readonly identity: PackedIdentity
  readonly token: string
}
export interface PackedRequest {
  readonly protocol: typeof packedWireVersion
  readonly kind: 'request'
  readonly sequence: number
  readonly identity: PackedIdentity
  readonly requestToken: string
  readonly base: PackedBase | null
}
export interface PackedAcknowledgement {
  readonly protocol: typeof packedWireVersion
  readonly kind: 'accepted'
  readonly sequence: number
  readonly result: PackedIdentity
  readonly requestToken: string
  readonly resultToken: string
}
function finish<T>(value: T, budget: WireBudget) {
  const stagingBytes = 1024 + budget.retained * 10
  if (stagingBytes > semanticLimits.messageBytes)
    throw new Error('Packed exchange exceeds staging limit')
  const bytes = utf8Bytes(JSON.stringify(value)) + 1024
  if (bytes > packedEnvelopeBytes) throw new Error('Packed exchange exceeds envelope limit')
  return Object.freeze({ value, retainedBytes: budget.retained, stagingBytes, bytes })
}
export function readPackedRequest(value: unknown, expected: PackedIdentity) {
  return requestMetadata(value, (identity) => sameIdentity(identity, expected))
}
/** Validate and snapshot the bounded envelope before a cooperative source scan. The
 * claimed hash is metadata here; it must match an independently validated source later.
 */
export function readPackedRequestMetadata(value: unknown) {
  return requestMetadata(value, () => true)
}
function requestMetadata(value: unknown, accepts: (identity: PackedIdentity) => boolean) {
  const input = wireRecord(value, [
    'protocol',
    'kind',
    'sequence',
    'identity',
    'requestToken',
    'base',
  ])
  if (input.protocol !== packedWireVersion || input.kind !== 'request')
    throw new Error('Invalid packed request protocol')
  const budget = new WireBudget()
  const identity = wireIdentity(input.identity, budget)
  if (!accepts(identity)) throw new Error('Packed request source mismatch')
  let base: PackedBase | null = null
  if (input.base !== null) {
    const record = wireRecord(input.base, ['identity', 'token'])
    budget.charge(256)
    base = Object.freeze({
      identity: wireIdentity(record.identity, budget),
      token: packedToken(record.token),
    })
  }
  budget.charge(256)
  const request: PackedRequest = Object.freeze({
    protocol: packedWireVersion,
    kind: 'request',
    sequence: wireInteger(input.sequence),
    identity,
    requestToken: packedToken(input.requestToken),
    base,
  })
  return finish(request, budget)
}
export function readPackedAcknowledgement(value: unknown, expected: PackedAcknowledgement) {
  const input = wireRecord(value, [
    'protocol',
    'kind',
    'sequence',
    'result',
    'requestToken',
    'resultToken',
  ])
  if (input.protocol !== packedWireVersion || input.kind !== 'accepted')
    throw new Error('Invalid packed acknowledgement protocol')
  const budget = new WireBudget()
  const result = wireIdentity(input.result, budget)
  const acknowledgement: PackedAcknowledgement = Object.freeze({
    protocol: packedWireVersion,
    kind: 'accepted',
    sequence: wireInteger(input.sequence),
    result,
    requestToken: packedToken(input.requestToken),
    resultToken: packedToken(input.resultToken),
  })
  budget.charge(256)
  if (
    acknowledgement.sequence !== expected.sequence ||
    acknowledgement.requestToken !== expected.requestToken ||
    acknowledgement.resultToken !== expected.resultToken ||
    !sameIdentity(result, expected.result)
  )
    throw new Error('Packed acknowledgement mismatch')
  return finish(acknowledgement, budget)
}
