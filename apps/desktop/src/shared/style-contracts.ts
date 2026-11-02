import { utf8Bytes } from '@manuslip/core/text'
import {
  type WritingTypography,
  writingLeading,
  writingMeasures,
  writingSizes,
} from '@manuslip/renderer/typography'

export {
  defaultTypography,
  type WritingTypography,
  writingLeading,
  writingMeasures,
  writingSizes,
} from '@manuslip/renderer/typography'

import type { Result } from './contracts'
import { parseId, parseRevision, record, string } from './file-contracts'

export const styleLimits = {
  input: 64 * 1024,
  output: 128 * 1024,
  rules: 128,
  selectors: 256,
  declarations: 1024,
  documents: 128,
  storage: 9 * 1024 * 1024,
} as const
export function hasStyleControls(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) return true
  }
  return false
}
export const styleChannels = {
  get: 'manuslip:style:get',
  set: 'manuslip:style:set',
  import: 'manuslip:style:import',
  reset: 'manuslip:style:reset',
} as const
export interface WritingStyle {
  typography: WritingTypography
  stylesheet: { name: string; source: string } | null
}
export interface WritingStyleState {
  version: number
  typography: WritingTypography
  name: string | null
  css: string
  storage: 'saved' | 'session' | 'read-only' | 'recovered' | 'unavailable'
  error: 'style-persist' | 'style-capacity' | 'style-readonly' | null
}
export interface StyleBridge {
  writingStyle(id: string): Promise<Result<WritingStyleState>>
  setWritingTypography(
    id: string,
    typography: WritingTypography,
  ): Promise<Result<WritingStyleState>>
  importWritingStylesheet(id: string): Promise<Result<WritingStyleState | null>>
  resetWritingStyle(id: string, stylesheetOnly: boolean): Promise<Result<WritingStyleState>>
}
function keys(input: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new Error('Invalid appearance fields')
}
export function parseTypography(value: unknown): WritingTypography {
  const input = record(value)
  keys(input, ['font', 'size', 'leading', 'measure'])
  if (
    typeof input.font !== 'string' ||
    !['default', 'serif', 'sans', 'mono'].includes(input.font) ||
    !writingSizes.includes(input.size as WritingTypography['size']) ||
    !writingLeading.includes(input.leading as WritingTypography['leading']) ||
    !writingMeasures.includes(input.measure as WritingTypography['measure'])
  )
    throw new Error('Invalid writing typography')
  return {
    font: input.font as WritingTypography['font'],
    size: input.size as WritingTypography['size'],
    leading: input.leading as WritingTypography['leading'],
    measure: input.measure as WritingTypography['measure'],
  }
}
export function parseWritingStyle(value: unknown): WritingStyle {
  const input = record(value)
  keys(input, ['typography', 'stylesheet'])
  let stylesheet: WritingStyle['stylesheet'] = null
  if (input.stylesheet !== null) {
    const item = record(input.stylesheet)
    keys(item, ['name', 'source'])
    const name = string(item.name, 100),
      source = string(item.source, styleLimits.input)
    if (
      !name.length ||
      hasStyleControls(name) ||
      /[/\\]/.test(name) ||
      utf8Bytes(source) > styleLimits.input
    )
      throw new Error('Invalid stylesheet')
    stylesheet = { name, source }
  }
  return { typography: parseTypography(input.typography), stylesheet }
}
export function parseWritingStyleState(value: unknown): WritingStyleState {
  const input = record(value)
  keys(input, ['version', 'typography', 'name', 'css', 'storage', 'error'])
  const css = string(input.css, styleLimits.output)
  if (
    utf8Bytes(css) > styleLimits.output ||
    css.includes('<') ||
    css.includes('\0') ||
    !['saved', 'session', 'read-only', 'recovered', 'unavailable'].includes(String(input.storage))
  )
    throw new Error('Invalid appearance response')
  const name = input.name === null ? null : string(input.name, 100)
  if (
    input.error !== null &&
    !['style-persist', 'style-capacity', 'style-readonly'].includes(String(input.error))
  )
    throw new Error('Invalid appearance error')
  return {
    version: parseRevision(input.version),
    typography: parseTypography(input.typography),
    name,
    css,
    storage: input.storage as WritingStyleState['storage'],
    error: input.error as WritingStyleState['error'],
  }
}
export function parseTypographyRequest(value: unknown): {
  id: string
  typography: WritingTypography
} {
  const input = record(value)
  keys(input, ['id', 'typography'])
  return { id: parseId(input.id), typography: parseTypography(input.typography) }
}
export function parseStyleReset(value: unknown): { id: string; stylesheetOnly: boolean } {
  const input = record(value)
  keys(input, ['id', 'stylesheetOnly'])
  if (typeof input.stylesheetOnly !== 'boolean') throw new Error('Invalid appearance reset')
  return { id: parseId(input.id), stylesheetOnly: input.stylesheetOnly }
}
