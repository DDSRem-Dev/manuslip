import {
  messageSize,
  parseMarkdownPlugins,
  type SemanticDocument,
  semanticLimits,
} from '@manuslip/core'
import type { RenderOptions, RenderProjection } from '@manuslip/renderer'
import type { ProjectionLayout } from '../../../../../../packages/renderer/src/projection-layout'

export interface ParseRequest {
  kind: 'parse'
  sequence: number
  generation: number
  documentId: string
  revision: number
  source: string
  options: RenderOptions
  sentAt: number
}
export interface Snapshot {
  document: SemanticDocument
  projection: RenderProjection
  /** Included by the worker so packed installation can avoid a second full render. */
  layout?: ProjectionLayout
  bytes: number
  cached: boolean
  transportInMs: number
  serializeMs: number
}
export interface EncodedSnapshot {
  payload: ArrayBuffer
  bytes: number
  serializeMs: number
}
export interface EncodedResponse {
  kind: 'encoded-result'
  sequence: number
  generation: number
  documentId: string
  revision: number
  sentAt: number
  payload: ArrayBuffer
  metadata: Omit<Snapshot, 'document' | 'projection'>
}

/** One lossless whole-root message. Transferable bytes avoid cloning every AST object. */
export function encodeSnapshot(
  snapshot: Pick<Snapshot, 'document' | 'projection' | 'layout'>,
): EncodedSnapshot {
  const started = performance.now()
  const payload = new TextEncoder().encode(JSON.stringify(snapshot)).buffer
  // Reserve metadata/envelope space in both the transport and retained-snapshot ledger.
  const bytes = payload.byteLength + 1024
  if (bytes > semanticLimits.messageBytes)
    throw new Error('Semantic result exceeds transport limit')
  return { payload, bytes, serializeMs: performance.now() - started }
}
export type ParseResponse = {
  sequence: number
  generation: number
  documentId: string
  revision: number
  sentAt: number
} & (
  | { kind: 'result'; snapshot: Snapshot }
  | { kind: 'error'; code: 'semantic-limit' | 'semantic-parse' }
)

export const absoluteNow = (): number => performance.timeOrigin + performance.now()
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
export function parseRequest(value: unknown): ParseRequest {
  if (
    !object(value) ||
    value.kind !== 'parse' ||
    !integer(value.sequence) ||
    !integer(value.generation) ||
    !integer(value.revision) ||
    typeof value.documentId !== 'string' ||
    value.documentId.length > 100 ||
    typeof value.source !== 'string' ||
    typeof value.sentAt !== 'number' ||
    !Number.isFinite(value.sentAt) ||
    !object(value.options) ||
    typeof value.options.rawHtml !== 'boolean' ||
    typeof value.options.footnotesLabel !== 'string' ||
    value.options.footnotesLabel.length > 200 ||
    typeof value.options.footnoteBackLabel !== 'string' ||
    value.options.footnoteBackLabel.length > 200 ||
    messageSize(value) > semanticLimits.messageBytes
  )
    throw new Error('Invalid semantic request')
  if (value.options.plugins !== undefined) parseMarkdownPlugins(value.options.plugins)
  return value as unknown as ParseRequest
}

export function parseResponse(value: unknown, request: ParseRequest): ParseResponse {
  let encoded = false
  if (object(value) && value.kind === 'encoded-result') {
    if (
      !(value.payload instanceof ArrayBuffer) ||
      !object(value.metadata) ||
      value.payload.byteLength + 1024 > semanticLimits.messageBytes ||
      messageSize({ ...value, payload: undefined }) > 1024 ||
      value.sequence !== request.sequence ||
      value.generation !== request.generation ||
      value.documentId !== request.documentId ||
      value.revision !== request.revision
    )
      throw new Error('Invalid encoded semantic response')
    const body: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(value.payload),
    )
    if (
      !object(body) ||
      !object(body.document) ||
      !object(body.projection) ||
      value.metadata.bytes !== value.payload.byteLength + 1024
    )
      throw new Error('Invalid encoded semantic snapshot')
    value = {
      kind: 'result',
      sequence: value.sequence,
      generation: value.generation,
      documentId: value.documentId,
      revision: value.revision,
      sentAt: value.sentAt,
      snapshot: {
        ...value.metadata,
        document: body.document,
        projection: body.projection,
        ...(body.layout !== undefined ? { layout: body.layout } : {}),
      },
    }
    encoded = true
  }
  if (
    !object(value) ||
    value.sequence !== request.sequence ||
    value.documentId !== request.documentId ||
    value.revision !== request.revision ||
    value.generation !== request.generation ||
    typeof value.sentAt !== 'number' ||
    !Number.isFinite(value.sentAt) ||
    (!encoded && messageSize(value) > semanticLimits.messageBytes)
  )
    throw new Error('Invalid semantic response')
  if (
    value.kind === 'error' &&
    (value.code === 'semantic-limit' || value.code === 'semantic-parse')
  )
    return value as unknown as ParseResponse
  if (value.kind !== 'result' || !object(value.snapshot))
    throw new Error('Invalid semantic snapshot')
  const snapshot = value.snapshot
  if (
    !object(snapshot.document) ||
    !object(snapshot.projection) ||
    !object(snapshot.document.root) ||
    snapshot.document.root.type !== 'root' ||
    !Array.isArray(snapshot.document.root.children) ||
    !Array.isArray(snapshot.document.blocks) ||
    snapshot.document.blocks.length > semanticLimits.blocks ||
    !Array.isArray(snapshot.document.outline) ||
    !object(snapshot.document.counts) ||
    !integer(snapshot.document.counts.words) ||
    !integer(snapshot.document.counts.characters) ||
    !object(snapshot.document.timings) ||
    typeof snapshot.projection.html !== 'string' ||
    !Array.isArray(snapshot.projection.blocks) ||
    typeof snapshot.cached !== 'boolean' ||
    !integer(snapshot.bytes)
  )
    throw new Error('Invalid semantic snapshot')
  for (const block of [...snapshot.document.blocks, ...snapshot.projection.blocks])
    if (
      !object(block) ||
      !integer(block.from) ||
      !integer(block.to) ||
      block.to < block.from ||
      block.to > request.source.length ||
      typeof block.kind !== 'string'
    )
      throw new Error('Invalid source range')
  return value as unknown as ParseResponse
}
