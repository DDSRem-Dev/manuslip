import type { TranslationSettings } from '@manuslip/translate'
import type { TranslationState } from '../../../shared/translation-contracts'

export function requiresTranslationKey(settings: TranslationSettings): boolean {
  if (settings.provider.adapter === 'deepl') return true
  try {
    return new URL(settings.provider.baseUrl).hostname === 'api.openai.com'
  } catch {
    return false
  }
}

export function translationAvailability(
  state: TranslationState,
): 'setup' | 'key' | 'configured' | 'readOnly' {
  if (state.configuration === 'read-only') return 'readOnly'
  if (!state.settings) return 'setup'
  if (requiresTranslationKey(state.settings) && state.credential === 'none') return 'key'
  return 'configured'
}
