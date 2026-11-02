import {
  deepLLanguage,
  deepLMetadataEndpoint,
  type ProviderLanguage,
  parseDeepLLanguages,
  type TranslationPayload,
  type TranslationSettings,
} from '@manuslip/translate'
import { decodeDeepL, encodeDeepL } from './deepl-xml'
import { TranslationFailure } from './errors'
import { type Exchange, exchange, providerRequest } from './transport'

export const deepLLimits = {
  request: 128 * 1024,
  metadata: 256 * 1024,
  languages: 512,
  metadataMs: 10_000,
  metadataAgeMs: 15 * 60_000,
} as const
function json(bytes: Buffer): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new TranslationFailure('translation-response')
  }
}
export async function loadDeepLLanguages(
  settings: TranslationSettings,
  credential: string | null,
  signal: AbortSignal,
  send: Exchange = exchange,
): Promise<ProviderLanguage[]> {
  if (!credential) throw new TranslationFailure('translation-key-required')
  const bytes = await providerRequest(
    deepLMetadataEndpoint(settings.provider),
    Buffer.alloc(0),
    credential,
    signal,
    send,
    { method: 'GET', authentication: 'deepl', responseBytes: deepLLimits.metadata },
    deepLLimits.metadataMs,
  )
  try {
    const languages = parseDeepLLanguages(json(bytes))
    if (!languages.length) throw new Error('No languages')
    return languages
  } catch {
    throw new TranslationFailure('translation-response')
  }
}
export async function translateDeepL(
  settings: TranslationSettings,
  payload: TranslationPayload,
  credential: string | null,
  signal: AbortSignal,
  send: Exchange = exchange,
  supported?: readonly ProviderLanguage[],
): Promise<string> {
  if (!credential) throw new TranslationFailure('translation-key-required')
  const languages = supported ?? (await loadDeepLLanguages(settings, credential, signal, send))
  let target: ProviderLanguage
  let source: ProviderLanguage | undefined
  try {
    target = deepLLanguage(settings.targetLanguage, false, languages)
    source =
      settings.sourceLanguage === 'auto'
        ? undefined
        : deepLLanguage(settings.sourceLanguage, true, languages)
    if (
      (settings.formality !== 'default' && !target.formality) ||
      (settings.provider.options.glossaryId && (!source?.glossary || !target.glossary))
    )
      throw new Error('Unsupported option')
  } catch {
    throw new TranslationFailure('translation-settings')
  }
  const bytes = Buffer.from(
    JSON.stringify({
      text: [encodeDeepL(payload)],
      target_lang: target.tag.toUpperCase(),
      ...(source ? { source_lang: source.tag.toUpperCase() } : {}),
      tag_handling: 'xml',
      tag_handling_version: 'v2',
      outline_detection: false,
      non_splitting_tags: ['r', 'm', 'x'],
      ignore_tags: ['x'],
      split_sentences: 'nonewlines',
      preserve_formatting: true,
      ...(settings.formality !== 'default'
        ? { formality: settings.formality === 'formal' ? 'more' : 'less' }
        : {}),
      ...(settings.provider.options.glossaryId
        ? { glossary_id: settings.provider.options.glossaryId }
        : {}),
    }),
  )
  if (bytes.length > deepLLimits.request) throw new TranslationFailure('translation-invalid')
  const result = json(
    await providerRequest(settings.provider.baseUrl, bytes, credential, signal, send, {
      method: 'POST',
      authentication: 'deepl',
    }),
  ) as { translations?: { text?: unknown }[] } | null
  if (!result || !Array.isArray(result.translations) || result.translations.length !== 1)
    throw new TranslationFailure('translation-response')
  return decodeDeepL(payload, result.translations[0]?.text)
}
