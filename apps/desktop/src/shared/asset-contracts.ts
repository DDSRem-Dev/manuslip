import { localImagePath } from '@manuslip/renderer/urls'
import type { Result } from './contracts'
import { parseId, record } from './file-contracts'

export const assetChannels = {
  load: 'manuslip:asset:load',
  capture: 'manuslip:asset:capture',
  import: 'manuslip:asset:import',
  discard: 'manuslip:asset:discard',
  convert: 'manuslip:clipboard:convert',
} as const
export const assetLimits = {
  bytes: 20 * 1024 * 1024,
  pixels: 16_000_000,
  side: 8192,
  captureMs: 60_000,
  cache: 64 * 1024 * 1024,
  entries: 256,
  running: 4,
  queue: 32,
  html: 1024 * 1024,
  markdown: 4 * 1024 * 1024,
  conversionMs: 5000,
} as const
export interface AssetBridge {
  loadLocalImage(id: string, reference: string): Promise<Result<string>>
  captureClipboardImage(id: string): Promise<Result<string>>
  importClipboardImage(id: string, captureId: string): Promise<Result<string>>
  discardClipboardImage(id: string, captureId: string): Promise<Result<null>>
  convertClipboardHtml(id: string, html: string): Promise<Result<string>>
}
export function parseLocalRequest(input: unknown): { id: string; reference: string } {
  const value = record(input)
  if (
    Object.keys(value).some((key) => !['id', 'reference'].includes(key)) ||
    typeof value.reference !== 'string' ||
    !localImagePath(value.reference)
  )
    throw new Error('Invalid local image reference')
  return { id: parseId(value.id), reference: value.reference }
}
export function parseCaptureRequest(input: unknown): { id: string; captureId: string } {
  const value = record(input)
  if (Object.keys(value).some((key) => !['id', 'captureId'].includes(key)))
    throw new Error('Invalid image capture')
  return { id: parseId(value.id), captureId: parseId(value.captureId) }
}
export function parseHtmlRequest(input: unknown): { id: string; html: string } {
  const value = record(input)
  if (
    Object.keys(value).some((key) => !['id', 'html'].includes(key)) ||
    typeof value.html !== 'string' ||
    value.html.length > assetLimits.html
  )
    throw new Error('Invalid clipboard HTML')
  return { id: parseId(value.id), html: value.html }
}
export function parseImportedImage(input: unknown): string {
  if (typeof input !== 'string' || !/^assets\/pasted-[0-9a-f-]{36}\.png$/.test(input))
    throw new Error('Invalid imported image')
  parseId(input.slice(14, -4))
  return input
}
export function parseConvertedHtml(input: unknown): string {
  if (typeof input !== 'string' || input.length > assetLimits.markdown)
    throw new Error('Invalid clipboard Markdown')
  return input
}
