import type { Root } from '@manuslip/core'
import type { RenderOptions } from '@manuslip/renderer'
import { readingBlocks, renderReading } from '@manuslip/renderer/reading'
import {
  extractTranslation,
  reconstructTranslation,
  validateTranslation,
} from '@manuslip/translate'
import { parseReadingExport } from '../../shared/reading-export'

/** Re-extracts an immutable export capture. No renderer-supplied AST or markup is trusted. */
export function renderCapturedReading(
  root: Root,
  source: string,
  input: unknown,
  options: RenderOptions,
  locale: 'en' | 'zh-CN',
) {
  const reading = parseReadingExport(input)
  const plan = extractTranslation(root, source)
  const outputs = new Map<string, string>()
  for (const entry of reading.units) {
    const unit = plan.units[entry.index]
    if (!unit?.payload) throw new Error('export-invalid')
    outputs.set(unit.occurrenceId, validateTranslation(unit.payload, entry.output))
  }
  const rebuilt = reconstructTranslation(plan, outputs)
  const missing = rebuilt.statuses.filter((status) => status.status !== 'translated').length
  if (missing && reading.missing !== 'source') throw new Error('export-incomplete')
  const translated = new Set(
    plan.units
      .filter((unit) => outputs.has(unit.occurrenceId))
      .map((unit) => `${unit.from}:${unit.to}`),
  )
  const projection = renderReading(root, rebuilt.root, options, {
    layout: reading.layout,
    blocks: readingBlocks(root, source),
    sourceLanguage: reading.sourceLanguage,
    targetLanguage: reading.targetLanguage,
    units: plan.units,
    translated,
    labels:
      locale === 'zh-CN'
        ? { original: '原文', translation: '译文' }
        : { original: 'Original', translation: 'Translation' },
  })
  const layout =
    locale === 'zh-CN'
      ? { replace: '仅译文', 'side-by-side': '左右对照', interlinear: '逐段对照' }
      : { replace: 'Translation only', 'side-by-side': 'Side by side', interlinear: 'Interlinear' }
  const details =
    locale === 'zh-CN'
      ? `译文：${reading.targetLanguage} · ${layout[reading.layout]} · ${reading.units.length} / ${plan.units.length} 个正文单元已翻译。${missing ? '未翻译的单元保留原文。' : ''}${reading.stale ? '此副本不包含之后的原文编辑。' : ''}`
      : `Translation: ${reading.targetLanguage} · ${layout[reading.layout]} · ${reading.units.length} of ${plan.units.length} prose units translated. ${missing ? 'Untranslated units retain their source text. ' : ''}${reading.stale ? 'This copy excludes later source edits.' : ''}`
  // All variable values here are admitted language tags, fixed labels and bounded numbers.
  projection.html = `<p class="reading-export-note" lang="${locale}" role="note">${details}</p>${projection.html}`
  return projection
}
