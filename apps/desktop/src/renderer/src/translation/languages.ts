/** Suggestions for model providers, whose language support depends on the selected model. */
export const translationLanguages = [
  'en',
  'en-US',
  'en-GB',
  'zh-CN',
  'zh-TW',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'pt',
  'pt-BR',
  'it',
  'nl',
  'ru',
  'uk',
  'pl',
  'cs',
  'sk',
  'sl',
  'bg',
  'ro',
  'hu',
  'el',
  'tr',
  'sv',
  'da',
  'nb',
  'fi',
  'et',
  'lv',
  'lt',
  'is',
  'ar',
  'he',
  'fa',
  'hi',
  'bn',
  'ta',
  'te',
  'ur',
  'id',
  'ms',
  'th',
  'vi',
  'fil',
  'sw',
  'ca',
  'eu',
  'gl',
] as const

export function languageName(tag: string, locale: string): string {
  try {
    const language = new Intl.Locale(tag)
    if (language.language === 'zh' && (language.script || language.region)) {
      const script = language.maximize().script
      if (script === 'Hans') return '简体中文'
      if (script === 'Hant') return '繁體中文'
    }
    return new Intl.DisplayNames([locale], { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}
