import { type ProviderCapabilities, type ProviderDescriptor, TranslationError } from './contracts'
import { normalizeEndpoint } from './identity'

export const chatCapabilities: ProviderCapabilities = {
  sourceDetection: true,
  glossary: true,
  formality: ['formal', 'informal'],
  streaming: false,
  credential: 'optional',
}
export function capabilitiesFor(adapter: string): ProviderCapabilities {
  if (adapter === 'deepl') return { ...chatCapabilities, glossary: false, credential: 'required' }
  if (adapter === 'openai-compatible' || adapter === 'ollama') return chatCapabilities
  throw new TranslationError('translation-settings')
}
export interface ProviderLanguage {
  tag: string
  source: boolean
  target: boolean
  formality: boolean
  glossary: boolean
  tags: boolean
}
/** Only bounded, stable feature metadata reaches UI; provider prose/names are unnecessary. */
export function parseDeepLLanguages(input: unknown): ProviderLanguage[] {
  if (!Array.isArray(input) || input.length > 512) throw new TranslationError('translation-invalid')
  const seen = new Set<string>()
  return input.flatMap((value) => {
    if (
      !value ||
      typeof value !== 'object' ||
      typeof value.lang !== 'string' ||
      value.lang.length > 64 ||
      typeof value.usable_as_source !== 'boolean' ||
      typeof value.usable_as_target !== 'boolean' ||
      !value.features ||
      typeof value.features !== 'object' ||
      Array.isArray(value.features)
    )
      throw new TranslationError('translation-invalid')
    let tag: string
    try {
      tag = Intl.getCanonicalLocales(value.lang)[0] ?? ''
    } catch {
      throw new TranslationError('translation-invalid')
    }
    if (!tag || seen.has(tag)) throw new TranslationError('translation-invalid')
    seen.add(tag)
    if (value.status !== 'stable') return []
    const feature = (name: string) => value.features[name]?.status === 'stable'
    return [
      {
        tag,
        source: value.usable_as_source,
        target: value.usable_as_target,
        formality: feature('formality'),
        glossary: feature('glossary'),
        tags: feature('tag_handling'),
      },
    ]
  })
}
export function deepLMetadataEndpoint(provider: ProviderDescriptor): string {
  const endpoint = normalizeEndpoint(
    provider.options.languagesEndpoint ??
      new URL('/v3/languages?resource=translate_text', provider.baseUrl).href,
  )
  if (new URL(endpoint).origin !== new URL(provider.baseUrl).origin)
    throw new TranslationError('translation-settings')
  return endpoint
}
export function deepLLanguage(
  input: string,
  source: boolean,
  languages: readonly ProviderLanguage[],
): ProviderLanguage {
  const aliases: Record<string, string> = source
    ? { 'zh-CN': 'zh', 'zh-TW': 'zh', 'zh-Hans': 'zh', 'zh-Hant': 'zh' }
    : {
        en: 'en-US',
        pt: 'pt-PT',
        zh: 'zh-Hans',
        'zh-CN': 'zh-Hans',
        'zh-SG': 'zh-Hans',
        'zh-TW': 'zh-Hant',
        'zh-HK': 'zh-Hant',
        'zh-MO': 'zh-Hant',
      }
  const tag = aliases[input] ?? input
  const exact =
    languages.find(
      (language) => language.tag === input && (source ? language.source : language.target),
    ) ??
    languages.find(
      (language) => language.tag === tag && (source ? language.source : language.target),
    )
  const result =
    exact ??
    (source
      ? languages.find((language) => language.tag === tag.split('-')[0] && language.source)
      : undefined)
  if (!result?.tags) throw new TranslationError('translation-settings')
  return result
}
