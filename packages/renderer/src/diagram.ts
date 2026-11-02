import { utf8Bytes } from '@manuslip/core/text'

export const diagramLimits = {
  source: 64 * 1024,
  svg: 2 * 1024 * 1024,
  nodes: 2000,
  elements: 20_000,
  edges: 4000,
  pending: 4,
  consumers: 200,
  timeout: 3000,
  restarts: 3,
  restartWindow: 60_000,
  cache: 8 * 1024 * 1024,
} as const
export interface DiagramRequest {
  jobId: string
  documentId: string
  occurrenceId: string
  source: string
  syntax?: DiagramSyntax
  theme: 'light' | 'dark'
  priority: 'visible' | 'nearby'
  retry: boolean
}
export type DiagramSyntax = 'mermaid' | 'sequence' | 'flowchart'

export function diagramSyntax(language: string | null | undefined): DiagramSyntax | undefined {
  const name = language?.toLowerCase()
  if (name === 'mermaid') return 'mermaid'
  if (name === 'sequence' || name === 'seq') return 'sequence'
  if (name === 'flowchart' || name === 'flow') return 'flowchart'
  return undefined
}
export function checkDiagramSource(source: string): void {
  if (source.length > diagramLimits.source || utf8Bytes(source) > diagramLimits.source)
    throw new Error('diagram-limit')
  if (/%%\s*\{/.test(source) || /^\s*---(?:\s|$)/.test(source)) throw new Error('diagram-config')
}
