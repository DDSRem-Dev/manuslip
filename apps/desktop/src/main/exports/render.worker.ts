import { parentPort } from 'node:worker_threads'
import { parseDocumentMarkdown, SemanticLimitError } from '@manuslip/core'
import { renderExport } from '@manuslip/renderer/export'
import { exportLimits, parseExportProjection } from '../../shared/export-contracts'
import { FileOperationError } from '../files/errors'
import { renderCapturedReading } from './reading'

parentPort?.on('message', (request) => {
  void (async () => {
    try {
      let value: unknown
      if (request.kind === 'parse') {
        const document = parseDocumentMarkdown(request.source, request.options.plugins)
        value = parseExportProjection(
          request.reading
            ? renderCapturedReading(
                document.root,
                request.source,
                request.reading,
                request.options,
                request.locale,
              )
            : renderExport(document.root, request.options),
        )
      } else if (request.kind === 'math') {
        const { renderMath } = await import('@manuslip/renderer/math')
        value = renderMath(request.source, request.display)
      } else if (request.kind === 'pdf') {
        const { PDFDocument } = await import('pdf-lib')
        const pdf = await PDFDocument.load(request.bytes, { updateMetadata: false })
        value = pdf.getPageCount()
        if (Number(value) > exportLimits.pages) throw new Error('export-pages')
      } else if (request.kind === 'pandoc') {
        const { inspectPandocOutput } = await import('../pandoc/output')
        value = await inspectPandocOutput(
          request.directory,
          request.format,
          Buffer.from(request.bytes.buffer, request.bytes.byteOffset, request.bytes.byteLength),
          new Set(request.images),
          new AbortController().signal,
        )
      } else throw new Error('export-invalid')
      const transfer =
        value instanceof Uint8Array &&
        value.buffer instanceof ArrayBuffer &&
        value.byteOffset === 0 &&
        value.byteLength === value.buffer.byteLength
          ? [value.buffer]
          : []
      parentPort?.postMessage({ ok: true, value }, transfer)
    } catch (error) {
      parentPort?.postMessage({
        ok: false,
        code:
          error instanceof FileOperationError &&
          ['pandoc-failed', 'pandoc-limit'].includes(error.code)
            ? error.code
            : error instanceof SemanticLimitError ||
                (error instanceof Error && ['export-limit', 'math-limit'].includes(error.message))
              ? 'export-limit'
              : error instanceof Error &&
                  ['export-pages', 'export-incomplete', 'export-invalid'].includes(error.message)
                ? error.message
                : 'export-render',
      })
    }
  })()
})
