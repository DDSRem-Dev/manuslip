import type { Root } from 'mdast'
import { readingBudgets } from './reading-limits'
import { utf8Bytes } from './text-count'

export { utf8Bytes } from './text-count'

export const semanticLimits = {
  previewBytes: 2 * 1024 * 1024,
  blocks: 50000,
  messageBytes: 8 * 1024 * 1024,
  // Native JSON snapshots retain twice their wire size within the snapshot budget.
  snapshotMessageBytes: readingBudgets.snapshot / 2,
  workerCacheBytes: 16 * 1024 * 1024,
  rendererBytes: 64 * 1024 * 1024,
  snapshotBytes: readingBudgets.snapshot,
  widgetBytes: 16 * 1024 * 1024,
  viewportMath: 200,
  texBytes: 4096,
  mathCacheBytes: 8 * 1024 * 1024,
  mathWatchdog: 2000,
  codeBytes: 64 * 1024,
  editorInlineUnits: 32 * 1024,
  debounce: 150,
  applySlice: 1,
  maxDelay: 1000,
  watchdog: 5000,
  restarts: 3,
  restartWindow: 60000,
} as const
export const parserVersion = 'remark11-gfm4-frontmatter5-math6-inline1-deflist2/v6'
export interface SourceRange {
  from: number
  to: number
}
export interface SemanticBlock extends SourceRange {
  kind: string
  hash: string
  lines: number
}
export interface BlockOccurrence extends SemanticBlock {
  id: string
}
export interface Heading extends SourceRange {
  id?: string
  depth: number
  text: string
}
export interface ParseTimings {
  parse: number
  describe: number
}
export interface SemanticDocument {
  root: Root
  blocks: SemanticBlock[]
  outline: Heading[]
  counts: { words: number; characters: number }
  sourceHash: string
  timings: ParseTimings
  parserVersion: string
}
export class SemanticLimitError extends Error {}
export function messageSize(value: unknown): number {
  return utf8Bytes(JSON.stringify(value))
}

/** Cache identity only: consumers verify the original source on every hit. */
export function sourceHash(source: string): string {
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  for (let index = 0; index < source.length; index++) {
    a = Math.imul(a ^ source.charCodeAt(index), 0x01000193)
    b = Math.imul(b ^ source.charCodeAt(index), 0x85ebca6b)
  }
  return `${source.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`
}
