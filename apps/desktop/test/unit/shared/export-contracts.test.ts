import { expect, it } from 'vitest'
import {
  exportLimits,
  parseExportOutcome,
  parseExportProjection,
  parseExportRequest,
} from '../../../src/shared/export-contracts'

const request = () => ({
  jobId: crypto.randomUUID(),
  documentId: crypto.randomUUID(),
  revision: 2,
  source: '# Text',
  format: 'html',
  rawHtml: false,
  remoteImages: false,
  locale: 'en',
})
it('admits only exact export requests with bounded UTF-8 snapshots and owned IDs', () => {
  expect(parseExportRequest(request()).source).toBe('# Text')
  for (const format of ['html', 'pdf', 'png', 'jpeg', 'present'])
    expect(parseExportRequest({ ...request(), format }).format).toBe(format)
  for (const patch of [
    { revision: NaN },
    { revision: -1 },
    { source: null },
    { jobId: '../x' },
    { documentId: 'doc' },
    { format: 'md' },
    { remoteImages: 1 },
    { locale: 'fr' },
    { destination: '/unsafe' },
  ])
    expect(() => parseExportRequest({ ...request(), ...patch })).toThrow()
  expect(() =>
    parseExportRequest({
      ...request(),
      source: '界'.repeat(Math.floor(exportLimits.source / 3) + 1),
    }),
  ).toThrow('export-limit')
})
it('bounds projected HTML, slot counts and identities before host admission', () => {
  const slot = { id: 'slot-0', kind: 'math', source: 'x', display: false }
  expect(parseExportProjection({ html: '<p>Text</p>', slots: [slot] }).slots).toEqual([slot])
  for (const syntax of ['mermaid', 'sequence', 'flowchart']) {
    const diagram = { ...slot, kind: 'diagram', syntax }
    expect(parseExportProjection({ html: '', slots: [diagram] }).slots).toEqual([diagram])
  }
  for (const projection of [
    { html: 'x'.repeat(exportLimits.html + 1), slots: [] },
    {
      html: '',
      slots: Array.from({ length: exportLimits.slots + 1 }, (_, i) => ({
        ...slot,
        id: `slot-${i}`,
      })),
    },
    { html: '', slots: [slot, slot] },
    { html: '', slots: [{ ...slot, id: '" onclick="bad' }] },
    { html: '', slots: [{ ...slot, source: 'x'.repeat(65537) }] },
    { html: '', slots: [{ ...slot, syntax: 'sequence' }] },
    ...['flow', ['sequence'], { toString: () => 'sequence' }, null].map((syntax) => ({
      html: '',
      slots: [{ ...slot, kind: 'diagram', syntax }],
    })),
  ])
    expect(() => parseExportProjection(projection)).toThrow()
})
it('requires fixed Pandoc options only for Pandoc and rejects path or flag injection', () => {
  const pandoc = { format: 'docx', profile: 'numbered' }
  expect(parseExportRequest({ ...request(), format: 'pandoc', pandoc }).pandoc).toEqual(pandoc)
  for (const value of [
    { ...request(), pandoc },
    { ...request(), format: 'pandoc' },
    { ...request(), format: 'pandoc', pandoc: { ...pandoc, path: 'unsafe' } },
    { ...request(), format: 'pandoc', pandoc: { format: '--filter=unsafe', profile: 'document' } },
  ])
    expect(() => parseExportRequest(value)).toThrow()
})
it('rejects malformed export outcomes instead of widening the preload API', () => {
  expect(parseExportOutcome({ kind: 'cancelled' })).toEqual({ kind: 'cancelled' })
  expect(parseExportOutcome({ kind: 'presented', revision: 3 })).toEqual({
    kind: 'presented',
    revision: 3,
  })
  for (const value of [
    { kind: 'cancelled', path: '/x' },
    { kind: 'exported', path: 7, revision: 0 },
    { kind: 'exported', path: '/x', revision: Infinity },
    { kind: 'presented', revision: -1 },
    { kind: 'presented', revision: Infinity },
    { kind: 'presented', revision: 0, path: '/unexpected' },
    { kind: 'presented', revision: 1.5 },
    { kind: 'presented' },
  ])
    expect(() => parseExportOutcome(value)).toThrow()
})
