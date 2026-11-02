export const translationMessages = {
  'translation-key-required':
    'DeepL requires an API key. Set one in Translation settings before translating.',
  'translation-quota': 'The provider quota is exhausted. Check the account limit before retrying.',
  'translation-invalid': 'The translation request is invalid.',
  'translation-settings': 'Check the translation endpoint, model and language settings.',
  'translation-stale': 'Translation settings or cache changed. Refresh the translated view.',
  'translation-cancelled': 'Translation was cancelled.',
  'translation-busy': 'Translation is busy. Wait for current requests or cancel them.',
  'translation-timeout': 'The provider took too long. Retry the failed units.',
  'translation-network': 'The provider could not be reached. Check its address or retry.',
  'translation-auth': 'The provider rejected the credential. Enter a valid key.',
  'translation-rate': 'The provider rate limit was reached. Wait before retrying.',
  'translation-provider': 'The provider rejected the request. Check its model and settings.',
  'translation-incomplete':
    'The provider returned an incomplete translation. Retry or increase the output limit.',
  'translation-response':
    'The provider returned an invalid translation. Source content is retained.',
  'translation-storage': 'Translation settings could not be saved. Check storage and retry.',
  'translation-key-store':
    'The OS key store is unavailable. Use a session-only key or unlock it and retry.',
} as const
export type TranslationFailureCode = keyof typeof translationMessages
export class TranslationFailure extends Error {
  constructor(readonly code: TranslationFailureCode) {
    super(translationMessages[code])
  }
}
