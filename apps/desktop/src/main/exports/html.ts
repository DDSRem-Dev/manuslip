import { exportStyle } from '@manuslip/renderer/export-style'
import type { Locale } from '../../shared/contracts'
import type { ReadingExport } from '../../shared/reading-export'

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
export function exportHtml(
  title: string,
  locale: Locale,
  revision: number,
  html: string,
  fontStyle: string,
  reading?: ReadingExport,
  appearanceCss = '',
): string {
  const language = reading?.layout === 'replace' ? reading.targetLanguage : locale
  const metadata = reading
    ? `<meta name="manuslip-reading-layout" content="${escapeHtml(reading.layout)}"><meta name="manuslip-target-language" content="${escapeHtml(reading.targetLanguage)}"><meta name="manuslip-source-language" content="${escapeHtml(reading.sourceLanguage)}"><meta name="manuslip-stale-copy" content="${reading.stale}">`
    : ''
  return `<!doctype html>\n<html lang="${escapeHtml(language)}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'"><meta name="generator" content="Manuslip"><meta name="manuslip-source-revision" content="${revision}">${metadata}<title>${escapeHtml(title)}</title><style>${fontStyle}\n${exportStyle}\n${appearanceCss}</style></head><body><article data-document-style="export">${html}</article></body></html>\n`
}
