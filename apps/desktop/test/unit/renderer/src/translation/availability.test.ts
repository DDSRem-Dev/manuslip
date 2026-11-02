import { describe, expect, it } from 'vitest'
import {
  requiresTranslationKey,
  translationAvailability,
} from '../../../../../src/renderer/src/translation/availability'
import { emptyTranslationSettings } from '../../../../../src/renderer/src/translation/settings-draft'
import type { TranslationState } from '../../../../../src/shared/translation-contracts'

const state = (): TranslationState => ({
  settings: structuredClone(emptyTranslationSettings),
  settingsRevision: 0,
  cacheGeneration: 0,
  cache: 'idle',
  credential: 'none',
  configuration: 'ready',
})

describe('translation setup availability', () => {
  it('asks for a provider before reporting it as configured', () => {
    expect(translationAvailability({ ...state(), settings: null })).toBe('setup')
    expect(translationAvailability({ ...state(), configuration: 'read-only' })).toBe('readOnly')
  })
  it('requires a key for the hosted OpenAI endpoint and DeepL', () => {
    const value = state()
    expect(translationAvailability(value)).toBe('key')
    expect(translationAvailability({ ...value, credential: 'session' })).toBe('configured')
    expect(translationAvailability({ ...value, credential: 'stored' })).toBe('configured')
    const deepl = structuredClone(emptyTranslationSettings)
    deepl.provider.adapter = 'deepl'
    expect(requiresTranslationKey(deepl)).toBe(true)
  })
  it('keeps local and custom compatible servers available without assuming their authentication', () => {
    for (const baseUrl of [
      'http://localhost:11434/api/chat',
      'http://127.0.0.1:1234/chat',
      'https://custom.example/chat',
    ]) {
      const settings = structuredClone(emptyTranslationSettings)
      settings.provider.baseUrl = baseUrl
      expect(requiresTranslationKey(settings)).toBe(false)
      expect(translationAvailability({ ...state(), settings })).toBe('configured')
    }
  })
})
