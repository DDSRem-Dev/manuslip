import { readingBudgets } from '@manuslip/core/reading-limits'
import { utf8Bytes } from '@manuslip/core/text'
import type { ReadingLayout } from '@manuslip/renderer/reading'
import { translationLimits } from '@manuslip/translate/transport'
import { record } from './file-contracts'

export const readingExportLimits = {
  request: readingBudgets.exportRequest,
  outputs: readingBudgets.outputs,
} as const
export interface ReadingExport {
  schema: 'mdast-reading/v1'
  layout: ReadingLayout
  sourceLanguage: string
  targetLanguage: string
  units: { index: number; output: string }[]
  missing: 'reject' | 'source'
  stale: boolean
  confirmed: boolean
}
function language(input: unknown, auto: boolean): string {
  if (auto && input === 'auto') return 'auto'
  if (
    typeof input !== 'string' ||
    input.length > 100 ||
    !/^[A-Za-z0-9-]+$/.test(input) ||
    input === 'auto'
  )
    throw new Error('export-invalid')
  try {
    const result = Intl.getCanonicalLocales(input)[0]
    if (result) return result
  } catch {}
  throw new Error('export-invalid')
}
export function parseReadingExport(input: unknown): ReadingExport {
  const value = record(input)
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'schema',
          'layout',
          'sourceLanguage',
          'targetLanguage',
          'units',
          'missing',
          'stale',
          'confirmed',
        ].includes(key),
    ) ||
    value.schema !== 'mdast-reading/v1' ||
    !['replace', 'side-by-side', 'interlinear'].includes(value.layout as string) ||
    !['reject', 'source'].includes(value.missing as string) ||
    typeof value.stale !== 'boolean' ||
    typeof value.confirmed !== 'boolean' ||
    ((value.stale || value.missing === 'source') && !value.confirmed) ||
    !Array.isArray(value.units) ||
    value.units.length > translationLimits.units
  )
    throw new Error('export-invalid')
  const indices = new Set<number>()
  let bytes = 0
  const units = value.units.map((input) => {
    const unit = record(input)
    if (
      Object.keys(unit).some((key) => !['index', 'output'].includes(key)) ||
      typeof unit.index !== 'number' ||
      !Number.isSafeInteger(unit.index) ||
      unit.index < 0 ||
      unit.index >= translationLimits.units ||
      indices.has(unit.index) ||
      typeof unit.output !== 'string'
    )
      throw new Error('export-invalid')
    bytes += unit.output.length * 2
    if (
      unit.output.length > translationLimits.output ||
      utf8Bytes(unit.output) > translationLimits.output ||
      bytes > readingExportLimits.outputs
    )
      throw new Error('export-limit')
    indices.add(unit.index)
    return { index: unit.index, output: unit.output }
  })
  return {
    schema: 'mdast-reading/v1',
    layout: value.layout as ReadingLayout,
    sourceLanguage: language(value.sourceLanguage, true),
    targetLanguage: language(value.targetLanguage, false),
    units,
    missing: value.missing as ReadingExport['missing'],
    stale: value.stale,
    confirmed: value.confirmed,
  }
}
