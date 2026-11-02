import type { TranslationSettings as Settings } from '@manuslip/translate'

export const translationEndpoints = {
  'openai-compatible': 'https://api.openai.com/v1/chat/completions',
  ollama: 'http://localhost:11434/api/chat',
  deepl: 'https://api-free.deepl.com/v2/translate',
}
export const emptyTranslationSettings: Settings = {
  provider: {
    adapter: 'openai-compatible',
    version: '1',
    baseUrl: translationEndpoints['openai-compatible'],
    model: '',
    profile: null,
    options: {},
  },
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  glossary: [],
  formality: 'default',
  promptVersion: 'prose-translation/v1',
}
