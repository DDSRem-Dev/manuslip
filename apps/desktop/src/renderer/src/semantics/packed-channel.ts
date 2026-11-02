import { packedToken } from '../../../../../../packages/core/src/packing-token'
import { packedWireVersion } from '../../../../../../packages/core/src/packing-wire'
import {
  wireInteger,
  wireRecord,
  wireTime,
} from '../../../../../../packages/core/src/packing-wire-values'

export interface PackedCorrelation {
  readonly sequence: number
  readonly requestToken: string
}
export interface PackedChannelError extends PackedCorrelation {
  readonly protocol: typeof packedWireVersion
  readonly kind: 'semantic-error'
  readonly code: 'semantic-limit' | 'semantic-parse'
  readonly sentAt: number
}
export function packedCorrelation(value: unknown): PackedCorrelation {
  const input = wireRecord(value, ['sequence', 'requestToken'])
  return Object.freeze({
    sequence: wireInteger(input.sequence),
    requestToken: packedToken(input.requestToken),
  })
}
export function sameCorrelation(a: PackedCorrelation | undefined, b: PackedCorrelation): boolean {
  return !!a && a.sequence === b.sequence && a.requestToken === b.requestToken
}
export function readPackedChannelError(value: unknown): PackedChannelError {
  const input = wireRecord(value, [
    'protocol',
    'kind',
    'sequence',
    'requestToken',
    'code',
    'sentAt',
  ])
  if (
    input.protocol !== packedWireVersion ||
    input.kind !== 'semantic-error' ||
    (input.code !== 'semantic-limit' && input.code !== 'semantic-parse')
  )
    throw new Error('Invalid packed semantic error')
  return Object.freeze({
    protocol: packedWireVersion,
    kind: 'semantic-error',
    ...packedCorrelation({ sequence: input.sequence, requestToken: input.requestToken }),
    code: input.code,
    sentAt: wireTime(input.sentAt),
  })
}
/** Inspect a clone-data discriminator without invoking getters on malformed input. */
export function packedChannelKind(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined
  const field = Object.getOwnPropertyDescriptor(value, 'kind')
  return field && 'value' in field ? field.value : undefined
}
