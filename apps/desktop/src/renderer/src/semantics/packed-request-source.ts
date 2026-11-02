import { messageSize, semanticLimits } from '@manuslip/core'
import { wireRecord } from '../../../../../../packages/core/src/packing-wire-values'
import { type ParseRequest, parseRequest } from './protocol'

function snapshot(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const record = wireRecord(value, keys)
  return Object.fromEntries(
    keys.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(record, key)
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
        throw new Error('Invalid packed wire data property')
      return [key, descriptor.value]
    }),
  )
}

/** Internal fixed-shape channel request. Only bounded metadata is stringified here.
 * The source's exact JSON spelling must pass jsonByteLimit in its independent source scan.
 * Legacy parseRequest/post/prepare keep their synchronous whole-request checks.
 */
export function capturePackedRequest(value: unknown): {
  readonly request: Readonly<ParseRequest>
  readonly jsonByteLimit: number
} {
  const fields = snapshot(value, [
    'kind',
    'sequence',
    'generation',
    'documentId',
    'revision',
    'source',
    'options',
    'sentAt',
  ])
  if (typeof fields.source !== 'string') throw new Error('Invalid semantic request')
  const options = Object.freeze(
    snapshot(fields.options, ['rawHtml', 'footnotesLabel', 'footnoteBackLabel']),
  )
  const metadata = parseRequest({ ...fields, options, source: '' })
  // Remove exactly the empty source string's two quotes. All other fields are bounded.
  const envelopeBytes = messageSize(metadata) - 2
  return Object.freeze({
    request: Object.freeze({ ...metadata, source: fields.source }),
    jsonByteLimit: semanticLimits.messageBytes - envelopeBytes,
  })
}
