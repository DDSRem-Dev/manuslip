import { utf8Bytes } from '@manuslip/core/text'
import {
  capabilitiesFor,
  deepLMetadataEndpoint,
  normalizeTranslationSettings,
  type ProviderCapabilities,
  parseTranslationPayload,
  type TranslationPayload,
  type TranslationSettings,
  translationLimits,
} from '@manuslip/translate/transport'
import type { Result } from './contracts'
import { parseId, record } from './file-contracts'

export const translationChannels = {
  languages: 'manuslip:translation:languages',
  state: 'manuslip:translation:state',
  configure: 'manuslip:translation:configure',
  credential: 'manuslip:translation:credential',
  unit: 'manuslip:translation:unit',
  cancel: 'manuslip:translation:cancel',
  clear: 'manuslip:translation:clear',
  changed: 'manuslip:translation:changed',
} as const
export const transportLimits = {
  active: 2,
  waiting: 32,
  subscriptions: 128,
  request: 256 * 1024,
  response: 2 * 1024 * 1024,
  deadlineMs: 60_000,
  redirects: 3,
  retries: 2,
  cachePending: 32,
  cacheQueueBytes: 8 * 1024 * 1024,
  cacheDeadlineMs: 5000,
  credentialBytes: 4096,
} as const
export const providerCapabilities: ProviderCapabilities = {
  sourceDetection: true,
  glossary: true,
  formality: ['formal', 'informal'],
  streaming: false,
  credential: 'optional',
}
export type CacheStatus = 'idle' | 'ready' | 'recovered' | 'unavailable' | 'future'
export interface TranslationState {
  languages?: import('@manuslip/translate/transport').ProviderLanguage[]
  settings: TranslationSettings | null
  settingsRevision: number
  cacheGeneration: number
  cache: CacheStatus
  credential: 'none' | 'session' | 'stored'
  configuration: 'ready' | 'recovered' | 'read-only'
}
export interface CredentialRequest {
  settingsRevision: number
  key: string | null
  persist: boolean
}
export interface TranslationRequest {
  requestId: string
  documentId: string
  occurrenceId: string
  sessionGeneration: number
  settingsRevision: number
  cacheGeneration: number
  unitKey: string
  payload: TranslationPayload
  network: boolean
}
export interface TranslationOutcome {
  requestId: string
  documentId: string
  occurrenceId: string
  sessionGeneration: number
  settingsRevision: number
  cacheGeneration: number
  unitKey: string
  output: string | null
  cached: boolean
  cache: CacheStatus
}
export interface TranslationBridge {
  loadTranslationLanguages?(): Promise<Result<TranslationState>>
  translationState(): Promise<Result<TranslationState>>
  configureTranslation(settings: TranslationSettings): Promise<Result<TranslationState>>
  setTranslationCredential(request: CredentialRequest): Promise<Result<TranslationState>>
  translateUnit(request: TranslationRequest): Promise<Result<TranslationOutcome>>
  cancelTranslation(requestId: string): Promise<Result<null>>
  clearTranslationCache(): Promise<Result<TranslationState>>
  onTranslationChanged(listener: () => void): () => void
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('translation-invalid')
  return value
}
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  const input = record(value)
  if (Object.keys(input).some((key) => !keys.includes(key))) throw new Error('translation-invalid')
  return input
}
export function parseTranslationSettings(value: unknown): TranslationSettings {
  const adapter = record(record(value).provider).adapter
  if (typeof adapter !== 'string') throw new Error('translation-settings')
  const settings = normalizeTranslationSettings(value, capabilitiesFor(adapter))
  const provider = settings.provider
  if (
    !['openai-compatible', 'ollama', 'deepl'].includes(provider.adapter) ||
    provider.version !== '1' ||
    (provider.adapter === 'deepl' ? provider.model !== null : !provider.model) ||
    settings.promptVersion !== 'prose-translation/v1'
  )
    throw new Error('translation-settings')
  if (provider.adapter === 'deepl') {
    for (const [key, value] of Object.entries(provider.options))
      if (
        key === 'glossaryId'
          ? typeof value !== 'string' ||
            !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value) ||
            settings.sourceLanguage === 'auto'
          : key !== 'languagesEndpoint' || typeof value !== 'string'
      )
        throw new Error('translation-settings')
    deepLMetadataEndpoint(provider)
    return settings
  }
  for (const [key, value] of Object.entries(provider.options)) {
    if (
      (key !== 'temperature' && key !== 'maxOutputTokens') ||
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      (key === 'temperature' && (value < 0 || value > 2)) ||
      (key === 'maxOutputTokens' && (!Number.isInteger(value) || value < 1 || value > 16384))
    )
      throw new Error('translation-settings')
  }
  return settings
}
export function parseCredentialRequest(value: unknown): CredentialRequest {
  const input = exact(value, ['settingsRevision', 'key', 'persist'])
  if (
    typeof input.persist !== 'boolean' ||
    (input.key !== null &&
      (typeof input.key !== 'string' ||
        !/^[\x21-\x7e]+$/.test(input.key) ||
        input.key.length > transportLimits.credentialBytes)) ||
    (input.key === null && input.persist)
  )
    throw new Error('translation-invalid')
  return {
    settingsRevision: integer(input.settingsRevision),
    key: input.key as string | null,
    persist: input.persist,
  }
}
function context(input: Record<string, unknown>) {
  if (typeof input.unitKey !== 'string' || !/^[a-f0-9]{64}$/.test(input.unitKey))
    throw new Error('translation-invalid')
  return {
    requestId: parseId(input.requestId),
    documentId: parseId(input.documentId),
    occurrenceId: parseId(input.occurrenceId),
    sessionGeneration: integer(input.sessionGeneration),
    settingsRevision: integer(input.settingsRevision),
    cacheGeneration: integer(input.cacheGeneration),
    unitKey: input.unitKey,
  }
}
const contextKeys = [
  'requestId',
  'documentId',
  'occurrenceId',
  'sessionGeneration',
  'settingsRevision',
  'cacheGeneration',
  'unitKey',
]
export function parseTranslationRequest(value: unknown): TranslationRequest {
  const input = exact(value, [...contextKeys, 'payload', 'network'])
  if (typeof input.network !== 'boolean') throw new Error('translation-invalid')
  return {
    ...context(input),
    payload: parseTranslationPayload(input.payload),
    network: input.network,
  }
}
export function parseTranslationOutcome(value: unknown): TranslationOutcome {
  const input = exact(value, [...contextKeys, 'output', 'cached', 'cache'])
  if (
    (input.output !== null &&
      (typeof input.output !== 'string' || utf8Bytes(input.output) > translationLimits.output)) ||
    typeof input.cached !== 'boolean'
  )
    throw new Error('translation-invalid')
  return {
    ...context(input),
    output: input.output as string | null,
    cached: input.cached,
    cache: cacheStatus(input.cache),
  }
}
function cacheStatus(value: unknown): CacheStatus {
  if (
    typeof value !== 'string' ||
    !['idle', 'ready', 'recovered', 'unavailable', 'future'].includes(value)
  )
    throw new Error('translation-invalid')
  return value as CacheStatus
}
export function parseTranslationState(value: unknown): TranslationState {
  const input = exact(value, [
    'settings',
    'languages',
    'settingsRevision',
    'cacheGeneration',
    'cache',
    'credential',
    'configuration',
  ])
  if (
    typeof input.credential !== 'string' ||
    !['none', 'session', 'stored'].includes(input.credential) ||
    typeof input.configuration !== 'string' ||
    !['ready', 'recovered', 'read-only'].includes(input.configuration)
  )
    throw new Error('translation-invalid')
  return {
    ...(input.languages === undefined
      ? {}
      : { languages: parseProviderLanguages(input.languages) }),
    settings: input.settings === null ? null : parseTranslationSettings(input.settings),
    settingsRevision: integer(input.settingsRevision),
    cacheGeneration: integer(input.cacheGeneration),
    cache: cacheStatus(input.cache),
    credential: input.credential as TranslationState['credential'],
    configuration: input.configuration as TranslationState['configuration'],
  }
}

function parseProviderLanguages(input: unknown): import('@manuslip/translate').ProviderLanguage[] {
  if (!Array.isArray(input) || input.length > 512) throw new Error('translation-invalid')
  const seen = new Set<string>()
  return input.map((value) => {
    const item = exact(value, ['tag', 'source', 'target', 'formality', 'glossary', 'tags'])
    if (
      typeof item.tag !== 'string' ||
      item.tag.length > 64 ||
      seen.has(item.tag) ||
      ['source', 'target', 'formality', 'glossary', 'tags'].some(
        (key) => typeof item[key] !== 'boolean',
      )
    )
      throw new Error('translation-invalid')
    try {
      if (Intl.getCanonicalLocales(item.tag)[0] !== item.tag) throw new Error('Noncanonical')
    } catch {
      throw new Error('translation-invalid')
    }
    seen.add(item.tag)
    return item as unknown as import('@manuslip/translate').ProviderLanguage
  })
}
