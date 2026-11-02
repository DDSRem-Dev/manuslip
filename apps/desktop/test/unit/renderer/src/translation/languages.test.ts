import { expect, it } from 'vitest'
import { languageName } from '../../../../../src/renderer/src/translation/languages'

it('names the Chinese writing systems consistently across providers and interface languages', () => {
  for (const locale of ['en', 'zh-CN']) {
    for (const tag of ['zh-CN', 'zh-SG', 'zh-Hans', 'zh-Hans-CN'])
      expect(languageName(tag, locale)).toBe('简体中文')
    for (const tag of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-TW'])
      expect(languageName(tag, locale)).toBe('繁體中文')
  }
  expect(languageName('zh', 'en')).toBe('Chinese')
  expect(languageName('zh', 'zh-CN')).toBe('中文')
  expect(languageName('fr', 'en')).toBe('French')
  expect(languageName('not_a_tag', 'en')).toBe('not_a_tag')
})
