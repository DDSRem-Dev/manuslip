import { translationLimits } from '@manuslip/translate'
import { expect, it } from 'vitest'
import { parseReadingExport, type ReadingExport } from '../../../src/shared/reading-export'

const reading = (): ReadingExport => ({
  schema: 'mdast-reading/v1',
  layout: 'interlinear',
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  units: [{ index: 0, output: '你好' }],
  missing: 'reject',
  stale: false,
  confirmed: false,
})
it('requires explicit permission for stale captures and source fallback with exact bounded output records', () => {
  expect(parseReadingExport(reading())).toEqual(reading())
  for (const patch of [
    { layout: 'lines' },
    { targetLanguage: 'auto' },
    { sourceLanguage: '<en>' },
    { stale: true },
    { missing: 'source' },
    { extra: true },
    { units: [{ index: -1, output: 'x' }] },
    {
      units: [
        { index: 0, output: 'x' },
        { index: 0, output: 'y' },
      ],
    },
    { units: [{ index: 0, output: 'x', html: '<b>' }] },
  ])
    expect(() => parseReadingExport({ ...reading(), ...patch })).toThrow('export-invalid')
  expect(
    parseReadingExport({ ...reading(), confirmed: true, missing: 'source', stale: true }),
  ).toMatchObject({ confirmed: true })
  expect(() =>
    parseReadingExport({
      ...reading(),
      units: [{ index: 0, output: '界'.repeat(Math.floor(translationLimits.output / 3) + 1) }],
    }),
  ).toThrow('export-limit')
  expect(() =>
    parseReadingExport({
      ...reading(),
      units: Array.from({ length: 17 }, (_, index) => ({
        index,
        output: 'a'.repeat(translationLimits.output / 2),
      })),
    }),
  ).toThrow('export-limit')
})
