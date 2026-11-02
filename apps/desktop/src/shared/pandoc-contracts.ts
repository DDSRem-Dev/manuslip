import type { Result } from './contracts'
import { record } from './file-contracts'

export const pandocLimits = {
  input: 16 * 1024 * 1024,
  output: 160 * 1024 * 1024,
  stderr: 64 * 1024,
  version: 16 * 1024,
  executable: 256 * 1024 * 1024,
  profile: 128 * 1024,
  totalMs: 60_000,
  versionMs: 5000,
  mediaFiles: 1200,
} as const
export type PandocFormat = 'docx' | 'epub' | 'latex'
export type PandocProfile = 'document' | 'numbered'
export interface PandocOptions {
  format: PandocFormat
  profile: PandocProfile
}
export interface PandocToolState {
  tool: { name: string; version: string } | null
  persisted: boolean
  recovered: boolean
  readOnly: boolean
}
export interface PandocBridge {
  pandocTool(): Promise<Result<PandocToolState>>
  selectPandocTool(): Promise<Result<PandocToolState | null>>
  forgetPandocTool(): Promise<Result<PandocToolState>>
  retryPandocTool(): Promise<Result<PandocToolState>>
}
export const pandocChannels = {
  get: 'manuslip:pandoc:get',
  select: 'manuslip:pandoc:select',
  forget: 'manuslip:pandoc:forget',
  retry: 'manuslip:pandoc:retry',
} as const
export function parsePandocOptions(input: unknown): PandocOptions {
  const value = record(input)
  if (
    Object.keys(value).length !== 2 ||
    !['docx', 'epub', 'latex'].includes(value.format as string) ||
    !['document', 'numbered'].includes(value.profile as string)
  )
    throw new Error('pandoc-invalid')
  return { format: value.format as PandocFormat, profile: value.profile as PandocProfile }
}
export function parsePandocToolState(input: unknown): PandocToolState {
  const value = record(input)
  if (
    Object.keys(value).some(
      (key) => !['tool', 'persisted', 'recovered', 'readOnly'].includes(key),
    ) ||
    typeof value.persisted !== 'boolean' ||
    typeof value.recovered !== 'boolean' ||
    typeof value.readOnly !== 'boolean'
  )
    throw new Error('Invalid Pandoc state')
  let tool: PandocToolState['tool'] = null
  if (value.tool !== null) {
    const item = record(value.tool)
    if (
      Object.keys(item).length !== 2 ||
      typeof item.name !== 'string' ||
      item.name.length > 256 ||
      !item.name ||
      [...item.name].some(
        (character) =>
          character.charCodeAt(0) < 32 ||
          character.charCodeAt(0) === 127 ||
          character === '/' ||
          character === '\\',
      ) ||
      typeof item.version !== 'string' ||
      !/^3\.\d+(?:\.\d+){0,2}$/.test(item.version)
    )
      throw new Error('Invalid Pandoc tool')
    tool = { name: item.name, version: item.version }
  }
  return { tool, persisted: value.persisted, recovered: value.recovered, readOnly: value.readOnly }
}
