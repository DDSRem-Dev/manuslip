import { utf8Bytes } from '@manuslip/core/text'
import type { ExportProjection } from '@manuslip/renderer/export'
import type { Locale, Result } from './contracts'
import { parseId, record } from './file-contracts'
import { type PandocOptions, parsePandocOptions } from './pandoc-contracts'
import { parseReadingExport, type ReadingExport, readingExportLimits } from './reading-export'

export const exportLimits = {
  source: 2 * 1024 * 1024,
  html: 16 * 1024 * 1024,
  output: 160 * 1024 * 1024,
  asset: 20 * 1024 * 1024,
  assets: 100 * 1024 * 1024,
  decoded: 128 * 1024 * 1024,
  images: 500,
  slots: 1200,
  pages: 2000,
  totalMs: 60_000,
  resourceMs: 15_000,
} as const
export const exportChannels = {
  start: 'manuslip:export:start',
  cancel: 'manuslip:export:cancel',
  ready: 'manuslip:export-host:ready',
  job: 'manuslip:export-host:job',
  result: 'manuslip:export-host:result',
  asset: 'manuslip:export-host:asset',
} as const
export interface ExportRequest {
  jobId: string
  documentId: string
  revision: number
  source: string
  format: 'html' | 'pdf' | 'png' | 'jpeg' | 'present' | 'pandoc'
  pandoc?: PandocOptions
  rawHtml: boolean
  remoteImages: boolean
  locale: Locale
  reading?: ReadingExport
}
export type ExportOutcome =
  | { kind: 'cancelled' }
  | { kind: 'presented'; revision: number }
  | { kind: 'exported'; path: string; revision: number }
export interface ExportBridge {
  exportDocument(request: ExportRequest): Promise<Result<ExportOutcome>>
  cancelExport(jobId: string): Promise<Result<null>>
}
export function parseExportRequest(input: unknown): ExportRequest {
  const value = record(input)
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'jobId',
          'documentId',
          'revision',
          'source',
          'format',
          'rawHtml',
          'remoteImages',
          'locale',
          'reading',
          'pandoc',
        ].includes(key),
    ) ||
    typeof value.source !== 'string' ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    typeof value.format !== 'string' ||
    !['html', 'pdf', 'png', 'jpeg', 'present', 'pandoc'].includes(value.format) ||
    typeof value.rawHtml !== 'boolean' ||
    typeof value.remoteImages !== 'boolean' ||
    typeof value.locale !== 'string' ||
    !['en', 'zh-CN'].includes(value.locale)
  )
    throw new Error('export-invalid')
  if (value.source.length > exportLimits.source || utf8Bytes(value.source) > exportLimits.source)
    throw new Error('export-limit')
  const reading = value.reading === undefined ? undefined : parseReadingExport(value.reading)
  const pandoc = value.format === 'pandoc' ? parsePandocOptions(value.pandoc) : undefined
  if (value.format !== 'pandoc' && value.pandoc !== undefined) throw new Error('export-invalid')
  if (reading && utf8Bytes(JSON.stringify(value)) > readingExportLimits.request)
    throw new Error('export-limit')
  return {
    ...value,
    jobId: parseId(value.jobId),
    documentId: parseId(value.documentId),
    ...(reading ? { reading } : {}),
    ...(pandoc ? { pandoc } : {}),
  } as unknown as ExportRequest
}
export function parseExportOutcome(input: unknown): ExportOutcome {
  const value = record(input)
  if (value.kind === 'cancelled' && Object.keys(value).length === 1) return { kind: 'cancelled' }
  if (
    value.kind === 'presented' &&
    Object.keys(value).length === 2 &&
    typeof value.revision === 'number' &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0
  )
    return { kind: 'presented', revision: value.revision }
  if (
    value.kind !== 'exported' ||
    typeof value.path !== 'string' ||
    value.path.length > 32768 ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    Object.keys(value).some((key) => !['kind', 'path', 'revision'].includes(key))
  )
    throw new Error('Invalid export outcome')
  return { kind: 'exported', path: value.path, revision: value.revision }
}
export function parseExportProjection(input: unknown): ExportProjection {
  const value = record(input)
  if (
    typeof value.html !== 'string' ||
    utf8Bytes(value.html) > exportLimits.html ||
    !Array.isArray(value.slots) ||
    value.slots.length > exportLimits.slots
  )
    throw new Error('export-limit')
  const ids = new Set<string>()
  const slots = value.slots.map((input): ExportProjection['slots'][number] => {
    const slot = record(input)
    if (
      typeof slot.id !== 'string' ||
      !/^(?:slot-\d{1,4}|(?:original|translated)-[a-f0-9-]{36}-\d{1,5})$/.test(slot.id) ||
      ids.has(slot.id) ||
      (slot.kind !== 'math' && slot.kind !== 'diagram') ||
      typeof slot.source !== 'string' ||
      slot.source.length > 65536 ||
      typeof slot.display !== 'boolean' ||
      (slot.syntax !== undefined &&
        (slot.kind !== 'diagram' ||
          typeof slot.syntax !== 'string' ||
          !['mermaid', 'sequence', 'flowchart'].includes(slot.syntax)))
    )
      throw new Error('export-invalid')
    ids.add(slot.id)
    return {
      id: slot.id,
      kind: slot.kind,
      source: slot.source,
      display: slot.display,
      ...(slot.syntax !== undefined
        ? { syntax: slot.syntax as 'mermaid' | 'sequence' | 'flowchart' }
        : {}),
    }
  })
  return { html: value.html, slots }
}
export interface PrintPayload {
  jobId: string
  title: string
  locale: Locale
  language?: string
  html: string
  appearanceCss?: string
  mode?: 'presentation' | 'raster'
  reading?: boolean
  slots: { id: string; kind: 'math' | 'diagram'; display: boolean; source: string; svg: string }[]
}
