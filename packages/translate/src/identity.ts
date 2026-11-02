import { utf8Bytes } from '@manuslip/core/text'
import {
  extractionVersion,
  type PreparedTranslation,
  type ProviderCapabilities,
  type ProviderDescriptor,
  reconstructionVersion,
  TranslationError,
  type TranslationPayload,
  type TranslationPlan,
  type TranslationSettings,
  translationLimits,
} from './contracts'
import { isCanonicalPayload } from './extraction-memory'
import { parseTranslationPayload } from './payload'

function record(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (keys && Object.keys(value).some((key) => !keys.includes(key)))
  )
    throw new TranslationError('translation-settings')
  return value as Record<string, unknown>
}
const controls = (value: string): boolean =>
  [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
function bounded(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value || value.length > maximum || controls(value))
    throw new TranslationError('translation-settings')
  return value
}
function sensitive(key: string): boolean {
  let decoded = key
  for (let i = 0; i < 3; i++) {
    try {
      decoded = decodeURIComponent(decoded)
    } catch {
      break
    }
  }
  const normalized = decoded.toLowerCase().replace(/[^a-z0-9]/g, '')
  return (
    /secret|password|passwd|credential|authorization|signature/.test(normalized) ||
    /^(?:api|access|refresh|id|bearer|auth|oauth|session|client|xapi|xamz|xgoog)?(?:key|token)s?$|^auth$|^sig$|^accesskeyid$/.test(
      normalized,
    )
  )
}
export function normalizeEndpoint(input: unknown): string {
  const source = bounded(input, translationLimits.endpoint)
  if (source.trim() !== source) throw new TranslationError('translation-settings')
  let url: URL
  try {
    url = new URL(source)
  } catch {
    throw new TranslationError('translation-settings')
  }
  const authority = source.split('://')[1]?.split(/[/?#]/, 1)[0] || ''
  const loopback =
    url.hostname === 'localhost' ||
    url.hostname === '[::1]' ||
    /^127\.\d+\.\d+\.\d+$/.test(url.hostname)
  if (
    url.username ||
    url.password ||
    authority.includes('@') ||
    source.includes('#') ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  )
    throw new TranslationError('translation-settings')
  let count = 0
  for (const [key, value] of url.searchParams) {
    if (
      ++count > translationLimits.options ||
      key.length > 128 ||
      value.length > translationLimits.optionValue ||
      controls(key) ||
      controls(value) ||
      sensitive(key)
    )
      throw new TranslationError('translation-settings')
  }
  return url.href
}
export function normalizeProvider(input: unknown): ProviderDescriptor {
  const value = record(input, ['adapter', 'version', 'baseUrl', 'model', 'profile', 'options'])
  const adapter = bounded(value.adapter, 64)
  const version = bounded(value.version, 64)
  if (!/^[a-z0-9._/-]+$/i.test(adapter) || !/^[a-z0-9._/-]+$/i.test(version))
    throw new TranslationError('translation-settings')
  const options = record(value.options)
  if (Object.keys(options).length > translationLimits.options)
    throw new TranslationError('translation-settings')
  const checked: ProviderDescriptor['options'] = Object.create(null)
  for (const [key, option] of Object.entries(options)) {
    bounded(key, 128)
    if (
      sensitive(key) ||
      !(
        option === null ||
        typeof option === 'boolean' ||
        (typeof option === 'number' && Number.isFinite(option)) ||
        (typeof option === 'string' &&
          option.length <= translationLimits.optionValue &&
          !controls(option))
      )
    )
      throw new TranslationError('translation-settings')
    checked[key] = option
  }
  return {
    adapter,
    version,
    baseUrl: normalizeEndpoint(value.baseUrl),
    model: value.model === null ? null : bounded(value.model, 256),
    profile: value.profile === null ? null : bounded(value.profile, 128),
    options: checked,
  }
}
function language(input: unknown, auto: boolean): string {
  if (auto && input === 'auto') return 'auto'
  if (input === 'auto') throw new TranslationError('translation-settings')
  const value = bounded(input, 64)
  try {
    const canonical = Intl.getCanonicalLocales(value)[0]
    if (canonical) return canonical
  } catch {}
  throw new TranslationError('translation-settings')
}
export function normalizeTranslationSettings(
  input: unknown,
  capabilities: ProviderCapabilities,
): TranslationSettings {
  const value = record(input, [
    'provider',
    'sourceLanguage',
    'targetLanguage',
    'glossary',
    'formality',
    'promptVersion',
  ])
  const provider = normalizeProvider(value.provider)
  const sourceLanguage = language(value.sourceLanguage, true)
  const targetLanguage = language(value.targetLanguage, false)
  if (sourceLanguage === 'auto' && !capabilities.sourceDetection)
    throw new TranslationError('translation-settings')
  if (
    value.formality !== 'default' &&
    value.formality !== 'formal' &&
    value.formality !== 'informal'
  )
    throw new TranslationError('translation-settings')
  if (value.formality !== 'default' && !capabilities.formality.includes(value.formality))
    throw new TranslationError('translation-settings')
  if (
    !Array.isArray(value.glossary) ||
    value.glossary.length > translationLimits.glossary ||
    (!capabilities.glossary && value.glossary.length)
  )
    throw new TranslationError('translation-settings')
  const glossary = value.glossary.map((input) => {
    const term = record(input, ['source', 'target'])
    return { source: bounded(term.source, 2048), target: bounded(term.target, 2048) }
  })
  if (utf8Bytes(JSON.stringify(glossary)) > translationLimits.glossaryBytes)
    throw new TranslationError('translation-settings')
  return {
    provider,
    sourceLanguage,
    targetLanguage,
    glossary,
    formality: value.formality,
    promptVersion: bounded(value.promptVersion, 64),
  }
}

/** Sorted object keys, ordered arrays, and unmodified strings preserve actual prompt inputs. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`
}
async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
export async function providerDescriptorHash(provider: ProviderDescriptor): Promise<string> {
  return digest(canonical(normalizeProvider(provider)))
}
export async function translationSettingsKey(
  settings: TranslationSettings,
  capabilities: ProviderCapabilities,
): Promise<string> {
  const normalized = normalizeTranslationSettings(settings, capabilities)
  return digest(
    canonical({
      ...normalized,
      provider: await providerDescriptorHash(normalized.provider),
      extractionVersion,
      reconstructionVersion,
    }),
  )
}
export async function translationUnitKey(
  payload: TranslationPayload,
  settingsKey: string,
): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(settingsKey)) throw new TranslationError('translation-settings')
  return digest(
    canonical({
      payload: parseTranslationPayload(payload),
      settingsKey,
      extractionVersion,
      reconstructionVersion,
    }),
  )
}
/** The only shared jobs omit local AST bindings, source ranges and occurrence IDs. */
export async function prepareTranslation(
  plan: TranslationPlan,
  settings: TranslationSettings,
  capabilities: ProviderCapabilities,
): Promise<PreparedTranslation> {
  const settingsKey = await translationSettingsKey(settings, capabilities)
  const jobs = new Map<string, TranslationPayload>()
  const occurrences = new Map<string, string>()
  const keys = new WeakMap<TranslationPayload, string>()
  for (const unit of plan.units) {
    if (!unit.payload) continue
    let key = isCanonicalPayload(unit.payload) ? keys.get(unit.payload) : undefined
    if (!key) {
      key = await translationUnitKey(unit.payload, settingsKey)
      if (isCanonicalPayload(unit.payload)) keys.set(unit.payload, key)
    }
    occurrences.set(unit.occurrenceId, key)
    if (!jobs.has(key)) jobs.set(key, structuredClone(unit.payload))
  }
  return { jobs: [...jobs].map(([key, payload]) => ({ key, payload })), occurrences }
}

/** Worker-only preparation for trusted immutable interned payloads. Keep an index per
 * canonical provider value, with no occurrence-ID map. Private bindings never enter jobs.
 * Mutable or externally frozen payloads must use ordinary preparation and revalidation.
 */
export async function prepareCanonicalTranslation(
  plan: { readonly units: readonly { readonly payload: TranslationPayload | null }[] },
  settings: TranslationSettings,
  capabilities: ProviderCapabilities,
  active: () => void = () => {},
): Promise<{
  jobs: PreparedTranslation['jobs']
  keys: Map<TranslationPayload, string>
}> {
  const settingsKey = await translationSettingsKey(settings, capabilities)
  active()
  const jobs = new Map<string, TranslationPayload>()
  const keys = new Map<TranslationPayload, string>()
  for (const unit of plan.units) {
    active()
    const payload = unit.payload
    if (!payload) continue
    if (!isCanonicalPayload(payload)) throw new TranslationError('translation-invalid')
    if (keys.has(payload)) continue
    const key = await translationUnitKey(payload, settingsKey)
    active()
    keys.set(payload, key)
    if (!jobs.has(key)) jobs.set(key, structuredClone(payload))
  }
  return { jobs: [...jobs].map(([key, payload]) => ({ key, payload })), keys }
}
