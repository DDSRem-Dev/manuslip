import { utf8Bytes } from '@manuslip/core/text'
import { checkDiagramSource, type DiagramRequest, diagramLimits } from '@manuslip/renderer/diagram'
import type { Result } from './contracts'
import { parseId, record } from './file-contracts'

export const diagramChannels = {
  render: 'manuslip:diagram:render',
  cancel: 'manuslip:diagram:cancel',
  capacity: 'manuslip:diagram:capacity',
  ready: 'manuslip:diagram-host:ready',
  job: 'manuslip:diagram-host:job',
  result: 'manuslip:diagram-host:result',
} as const
export interface DiagramBridge {
  renderDiagram(request: DiagramRequest): Promise<Result<string>>
  cancelDiagram(jobId: string): Promise<Result<null>>
  onDiagramCapacity(listener: () => void): () => void
}
export function parseDiagramRequest(input: unknown): DiagramRequest {
  const value = record(input)
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'jobId',
          'documentId',
          'occurrenceId',
          'source',
          'syntax',
          'theme',
          'priority',
          'retry',
        ].includes(key),
    ) ||
    typeof value.source !== 'string' ||
    typeof value.theme !== 'string' ||
    !['light', 'dark'].includes(value.theme) ||
    typeof value.priority !== 'string' ||
    !['visible', 'nearby'].includes(value.priority) ||
    typeof value.retry !== 'boolean' ||
    (value.syntax !== undefined &&
      (typeof value.syntax !== 'string' ||
        !['mermaid', 'sequence', 'flowchart'].includes(value.syntax)))
  )
    throw new Error('Invalid diagram job')
  checkDiagramSource(value.source)
  return {
    jobId: parseId(value.jobId),
    documentId: parseId(value.documentId),
    occurrenceId: parseId(value.occurrenceId),
    source: value.source,
    ...(value.syntax !== undefined ? { syntax: value.syntax as DiagramRequest['syntax'] } : {}),
    theme: value.theme as DiagramRequest['theme'],
    priority: value.priority as DiagramRequest['priority'],
    retry: value.retry,
  }
}
export function parseDiagramSvg(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input.length > diagramLimits.svg ||
    utf8Bytes(input) > diagramLimits.svg ||
    !/^<svg(?:\s|\/?>)/.test(input)
  )
    throw new Error('Invalid diagram SVG')
  return input
}
export type DiagramHostResult = { jobId: string } & (
  | { svg: string }
  | { error: 'diagram-render' | 'diagram-limit' | 'diagram-config' | 'diagram-unsupported' }
)
export function parseDiagramHostResult(input: unknown): DiagramHostResult {
  const value = record(input)
  const jobId = parseId(value.jobId)
  if (Object.keys(value).some((key) => !['jobId', 'svg', 'error'].includes(key)))
    throw new Error('Invalid diagram result')
  if (
    typeof value.error === 'string' &&
    value.svg === undefined &&
    ['diagram-render', 'diagram-limit', 'diagram-config', 'diagram-unsupported'].includes(
      value.error,
    )
  )
    return {
      jobId,
      error: value.error as
        | 'diagram-render'
        | 'diagram-limit'
        | 'diagram-config'
        | 'diagram-unsupported',
    }
  if (value.error !== undefined) throw new Error('Invalid diagram result')
  return { jobId, svg: parseDiagramSvg(value.svg) }
}
