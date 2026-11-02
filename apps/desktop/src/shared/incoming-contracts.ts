import type { Result } from './contracts'
import { type FileSnapshot, parseId, record, string } from './file-contracts'

export const incomingLimit = 32
export const incomingChannels = {
  list: 'manuslip:incoming:list',
  open: 'manuslip:incoming:open',
  dismiss: 'manuslip:incoming:dismiss',
  changed: 'manuslip:incoming:changed',
  drop: 'manuslip:incoming:drop',
} as const
export interface IncomingRequest {
  id: string
  name: string
  displayPath: string
}
export interface IncomingState {
  requests: IncomingRequest[]
  issue: 'file-incoming-limit' | 'file-incoming-type' | null
}
export interface IncomingBridge {
  incomingFiles(): Promise<Result<IncomingState>>
  openIncomingFile(id: string): Promise<Result<FileSnapshot>>
  dismissIncomingFile(id: string | null): Promise<Result<null>>
  onIncomingFiles(listener: () => void): () => void
}
export function parseIncomingState(value: unknown): IncomingState {
  const input = record(value)
  if (
    !Array.isArray(input.requests) ||
    input.requests.length > incomingLimit ||
    (input.issue !== null &&
      input.issue !== 'file-incoming-limit' &&
      input.issue !== 'file-incoming-type')
  )
    throw new Error('Invalid incoming files')
  const requests = input.requests.map((item: unknown) => {
    const entry = record(item)
    return {
      id: parseId(entry.id),
      name: string(entry.name),
      displayPath: string(entry.displayPath, 32768),
    }
  })
  if (new Set(requests.map((entry) => entry.id)).size !== requests.length)
    throw new Error('Duplicate request')
  return { requests, issue: input.issue as IncomingState['issue'] }
}
