import { messageSize, type Root } from '@manuslip/core'
import type { RenderOptions } from '@manuslip/renderer'
import type { ReadingBlock, ReadingLayout, ReadingProjection } from '@manuslip/renderer/reading'
import type { TranslationPayload, TranslationSettings, UnitKind } from '@manuslip/translate'
import type { PackedIdentity } from '../../../../../../packages/core/src/packing-source'
import { readingJsonBytes } from '../../../../../../packages/renderer/src/reading-bytes'

export const readingLimits = {
  message: 8 * 1024 * 1024,
  worker: 32 * 1024 * 1024,
  descriptors: 8 * 1024 * 1024,
  outputs: 4 * 1024 * 1024,
  projection: 8 * 1024 * 1024,
  watchdog: 5000,
  progressMs: 100,
  renderMs: 500,
} as const
export interface ReadingUnit {
  occurrenceId: string
  kind: UnitKind
  from: number
  to: number
  hash: string
  key: string | null
  payload: TranslationPayload | null
}
export type ReadingOperation =
  | { kind: 'prepare'; root: Root; source: string; settings: TranslationSettings }
  | {
      kind: 'prepare-packed'
      payload: ArrayBuffer
      identity: PackedIdentity
      source: string
      settings: TranslationSettings
    }
  | {
      kind: 'render'
      outputs: { key: string; output: string }[]
      options: RenderOptions
      layout?: ReadingLayout
      blocks?: ReadingBlock[]
      labels?: { original: string; translation: string }
    }
export type ReadingValue =
  | { kind: 'prepared'; units: ReadingUnit[]; blocks: ReadingBlock[] }
  | { kind: 'rendered'; projection: ReadingProjection }
export interface ReadingEngine {
  request(operation: ReadingOperation): Promise<ReadingValue>
  dispose(): void
}

/** Count actual binary bytes plus its ordinary envelope; ArrayBuffer JSON is only {}. */
export function readingOperationBytes(operation: ReadingOperation): number {
  if (operation.kind !== 'prepare-packed')
    return operation.kind === 'render' ? readingJsonBytes(operation) : messageSize(operation)
  if (
    !(operation.payload instanceof ArrayBuffer) ||
    operation.payload.byteLength < 4 ||
    operation.payload.byteLength > readingLimits.message
  )
    return Infinity
  return (
    operation.payload.byteLength + readingJsonBytes({ ...operation, payload: undefined }) + 1024
  )
}
