import { parseMarkdown, sourceHash } from '@manuslip/core'
import { readingBudgets } from '@manuslip/core/reading-limits'
import { rendererVersion } from '@manuslip/renderer'
import { expandReadingIndex, type ReadingLayout } from '@manuslip/renderer/reading'
import type { TranslationSettings } from '@manuslip/translate'
import { expect, it } from 'vitest'
import { packValue } from '../../../../../../../packages/core/src/packing'
import { renderCapturedReading } from '../../../../../src/main/exports/reading'
import { ReadingProcessor } from '../../../../../src/renderer/src/translation/engine'
import { decodeReadingValue } from '../../../../../src/renderer/src/translation/prepared-wire'
import { readingLimits } from '../../../../../src/renderer/src/translation/protocol'
import {
  parseExportProjection,
  parseExportRequest,
} from '../../../../../src/shared/export-contracts'
import type { ReadingExport } from '../../../../../src/shared/reading-export'

const options = { rawHtml: false, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
const settings: TranslationSettings = {
  provider: {
    adapter: 'ollama',
    version: '1',
    baseUrl: 'http://localhost:11434/api/chat',
    model: 'fake',
    profile: null,
    options: {},
  },
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
  glossary: [],
  formality: 'default',
  promptVersion: 'prose-translation/v1',
}

it.each(
  (['replace', 'side-by-side', 'interlinear'] as ReadingLayout[]).flatMap((layout) =>
    (['native', 'packed'] as const).map((mode) => ({ layout, mode })),
  ),
)(
  'renders and exports almost 16 MiB of CJK outputs through the $mode $layout wire',
  async ({ layout, mode }) => {
    const source = Array.from({ length: 97 }, (_, index) => `Paragraph ${index}.`).join('\n\n')
    const document = parseMarkdown(source)
    const engine = new ReadingProcessor()
    try {
      const prepared = await engine.execute(
        mode === 'native'
          ? { kind: 'prepare', root: document.root, source, settings }
          : {
              kind: 'prepare-packed',
              payload: packValue(document.root, readingLimits.message),
              source,
              settings,
              identity: {
                generation: 1,
                documentId: 'cache-size',
                revision: 0,
                sourceHash: sourceHash(source),
                parserVersion: document.parserVersion,
                rendererVersion,
                options: JSON.stringify(options),
              },
            },
      )
      if (prepared.kind !== 'prepared') throw new Error('Not prepared')
      const outputs = prepared.units.map((unit, index) => ({
        key: unit.key ?? '',
        output: `${'界'.repeat(85000)}END${index}.`,
      }))
      expect(outputs.reduce((bytes, entry) => bytes + entry.output.length * 2, 0)).toBeLessThan(
        readingBudgets.outputs,
      )
      let html = ''
      for (let start = 0; start < outputs.length; start += 27) {
        await engine.respond(
          { kind: 'render', options, layout, outputs: outputs.slice(start, start + 27) },
          start + 1,
          (response) => {
            const decoded = decodeReadingValue(structuredClone(response.value))
            if (decoded.kind !== 'rendered') throw new Error('Not rendered')
            html = expandReadingIndex(decoded.projection)
          },
        )
      }
      for (let index = 0; index < outputs.length; index++) expect(html).toContain(`END${index}.`)
      const reading: ReadingExport = {
        schema: 'mdast-reading/v1',
        layout,
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        units: outputs.map((entry, index) => ({ index, output: entry.output })),
        missing: 'reject',
        stale: false,
        confirmed: false,
      }
      const request = parseExportRequest({
        jobId: crypto.randomUUID(),
        documentId: crypto.randomUUID(),
        revision: 0,
        source,
        format: 'html',
        rawHtml: false,
        remoteImages: false,
        locale: 'en',
        reading,
      })
      const exported = parseExportProjection(
        renderCapturedReading(document.root, source, request.reading, options, 'en'),
      )
      for (let index = 0; index < outputs.length; index++)
        expect(exported.html).toContain(`END${index}.`)
      if (mode === 'packed')
        expect(engine.stats.planPeakBytes).toBeLessThanOrEqual(readingLimits.worker)
    } finally {
      engine.clear()
    }
  },
  30000,
)
