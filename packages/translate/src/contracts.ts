import type { Nodes, Root, SourceRange } from '@manuslip/core'
import { readingBudgets } from '@manuslip/core/reading-limits'

export const extractionVersion = 'mdast-prose-tokens/v3-deflist1'
export const reconstructionVersion = 'mdast-text-only/v3-deflist1'
export const translationLimits = {
  units: 10000,
  depth: 256,
  tokens: 256,
  payload: 64 * 1024,
  output: 256 * 1024,
  plan: 16 * 1024 * 1024,
  // A 16 MiB UTF-16 buffer can contain 24 MiB of UTF-8 CJK text.
  reconstructed: readingBudgets.reconstructed,
  endpoint: 8192,
  options: 32,
  optionValue: 2048,
  glossary: 1000,
  glossaryBytes: 64 * 1024,
} as const

export type UnitKind = 'paragraph' | 'heading' | 'tableCell' | 'defListTerm'
export type TokenRole =
  | 'code'
  | 'math'
  | 'image'
  | 'html'
  | 'reference'
  | 'break'
  | 'literal'
  | 'protected'
  | 'emphasis'
  | 'strong'
  | 'delete'
  | 'link'
  | 'subscript'
  | 'superscript'
  | 'emoji'
export interface TranslationToken {
  id: string
  type: 'atom' | 'open' | 'close'
  role: TokenRole
  parent: string | null
  pair: string | null
}
/** Only this canonical object, never a TranslationUnit, may be sent to a provider or cached. */
export interface TranslationPayload {
  schema: typeof extractionVersion
  kind: UnitKind
  text: string
  tokens: TranslationToken[]
}
export interface TokenBinding {
  token: TranslationToken
  node: Nodes | Nodes[] | null
}
export interface TranslationUnit extends SourceRange {
  occurrenceId: string
  kind: UnitKind
  path: number[]
  payload: TranslationPayload | null
  bindings: TokenBinding[]
  error: 'translation-unit-large' | null
}
export interface TranslationPlan {
  root: Root
  units: TranslationUnit[]
  payloadBytes: number
}
export class TranslationError extends Error {
  constructor(
    readonly code:
      | 'translation-limit'
      | 'translation-invalid'
      | 'translation-settings'
      | 'translation-placeholders'
      | 'translation-output-large',
  ) {
    super(code)
  }
}
export type TranslationStatus = 'translated' | 'missing' | 'invalid' | 'limit'
export interface ReconstructedDocument {
  root: Root
  statuses: { occurrenceId: string; status: TranslationStatus }[]
}

export type Formality = 'default' | 'formal' | 'informal'
export interface ProviderCapabilities {
  sourceDetection: boolean
  glossary: boolean
  formality: readonly Exclude<Formality, 'default'>[]
  streaming: boolean
  credential: 'required' | 'optional' | 'none'
}
export type AdapterOption = string | number | boolean | null
export interface ProviderDescriptor {
  adapter: string
  version: string
  baseUrl: string
  model: string | null
  profile: string | null
  options: Record<string, AdapterOption>
}
export interface TranslationSettings {
  provider: ProviderDescriptor
  sourceLanguage: string
  targetLanguage: string
  glossary: { source: string; target: string }[]
  formality: Formality
  promptVersion: string
}
export interface TranslationJob {
  key: string
  payload: TranslationPayload
}
export interface PreparedTranslation {
  jobs: TranslationJob[]
  occurrences: Map<string, string>
}
