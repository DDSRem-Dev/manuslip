import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  parseDiagramHostResult,
  parseDiagramRequest,
  parseDiagramSvg,
} from '../../../src/shared/diagram-contracts'

const job = {
  jobId: randomUUID(),
  documentId: randomUUID(),
  occurrenceId: randomUUID(),
  source: 'flowchart LR\nA-->B',
  theme: 'light',
  priority: 'visible',
  retry: false,
}
describe('bounded diagram IPC contracts', () => {
  it('accepts valid identities and only the documented request fields', () => {
    expect(parseDiagramRequest(job)).toEqual(job)
    for (const syntax of ['mermaid', 'sequence', 'flowchart'])
      expect(parseDiagramRequest({ ...job, syntax })).toEqual({ ...job, syntax })
    for (const input of [
      { ...job, path: 'secret' },
      { ...job, jobId: '../file' },
      { ...job, theme: 'custom' },
      { ...job, theme: ['light'] },
      { ...job, priority: 'urgent' },
      { ...job, priority: ['visible'] },
      { ...job, retry: 'true' },
      { ...job, source: null },
      ...['seq', 'flow', 'unknown', ['sequence'], { toString: () => 'sequence' }, null].map(
        (syntax) => ({ ...job, syntax }),
      ),
    ])
      expect(() => parseDiagramRequest(input)).toThrow()
  })
  it.each([
    '%%{init: {securityLevel: "loose"}}%%\nflowchart LR\nA-->B',
    '---\nconfig:\n theme: dark\n---\nflowchart LR\nA-->B',
  ])('rejects document-controlled configuration', (source) => {
    expect(() => parseDiagramRequest({ ...job, source })).toThrow('diagram-config')
  })
  it('bounds UTF-8 input/output and rejects ambiguous or unexpected host fields', () => {
    expect(() => parseDiagramRequest({ ...job, source: '界'.repeat(22_000) })).toThrow(
      'diagram-limit',
    )
    expect(() => parseDiagramSvg(`<svg>${'界'.repeat(700_000)}</svg>`)).toThrow()
    expect(() => parseDiagramSvg('<html>not SVG</html>')).toThrow()
    expect(parseDiagramHostResult({ jobId: job.jobId, svg: '<svg/>' })).toEqual({
      jobId: job.jobId,
      svg: '<svg/>',
    })
    expect(parseDiagramHostResult({ jobId: job.jobId, error: 'diagram-unsupported' })).toEqual({
      jobId: job.jobId,
      error: 'diagram-unsupported',
    })
    for (const result of [
      { jobId: job.jobId, svg: '<svg/>', error: 'diagram-render' },
      { jobId: job.jobId, error: 'arbitrary' },
      { jobId: job.jobId, error: ['diagram-render'] },
      { jobId: job.jobId, svg: '<svg/>', script: 'x' },
    ])
      expect(() => parseDiagramHostResult(result)).toThrow()
  })
})
