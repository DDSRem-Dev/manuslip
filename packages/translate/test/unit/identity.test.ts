import { parseMarkdown } from '@manuslip/core'
import { expect, it } from 'vitest'
import {
  extractTranslation,
  normalizeEndpoint,
  normalizeProvider,
  normalizeTranslationSettings,
  prepareTranslation,
  providerDescriptorHash,
  type TranslationSettings,
  translationSettingsKey,
  translationUnitKey,
} from '../../src/index'
import { fixtureCapabilities, fixtureSettings } from '../fixtures/provider'

it('preserves endpoint routing semantics while canonicalizing equivalent host/default-port spellings', async () => {
  expect(
    normalizeEndpoint('https://EXAMPLE.com:443/v1/deployments/model?api-version=3&route=a'),
  ).toBe('https://example.com/v1/deployments/model?api-version=3&route=a')
  const provider = {
    ...fixtureSettings().provider,
    baseUrl: 'https://EXAMPLE.com:443/v1?route=a&route=b',
  }
  const key = await providerDescriptorHash(provider)
  expect(key).toBe(
    await providerDescriptorHash({
      ...provider,
      baseUrl: 'https://example.com/v1?route=a&route=b',
    }),
  )
  for (const baseUrl of [
    'https://example.com/v1/?route=a&route=b',
    'https://example.com/v2?route=a&route=b',
    'https://example.com/v1?route=b&route=a',
    'https://example.com/v1?route=a&route=c',
  ])
    expect(await providerDescriptorHash({ ...provider, baseUrl })).not.toBe(key)
  for (const baseUrl of [
    'http://127.0.0.1:11434/api',
    'http://[::1]:11434/api',
    'http://localhost:11434/api',
    'http://127.0.0.2:11434/api',
  ])
    expect(normalizeEndpoint(baseUrl)).toBe(baseUrl)
})

it('rejects insecure remote endpoints and credentials in endpoint or adapter metadata', () => {
  for (const endpoint of [
    'http://example.com/api',
    'http://192.168.1.1/api',
    'file:///private',
    'https://user:pass@example.com/api',
    'https://@example.com/api',
    'https://example.com/api#fragment',
    'https://example.com/api#',
    ' https://example.com/api',
    'https://example.com/?api_key=private',
    'https://example.com/?access_token=private',
    'https://example.com/?Authorization=Bearer',
    'https://example.com/?api%252Dkey=private',
    'https://example.com/?X-Amz-Signature=private',
    'https://example.com/?client_secret=private',
    'https://example.com/?client_secret_key=private',
    'https://example.com/?oauth_token=private',
  ])
    expect(() => normalizeEndpoint(endpoint)).toThrow('translation-settings')
  const provider = fixtureSettings().provider
  for (const options of [
    { apiKey: 'private' },
    { access_token: 'private' },
    { password: 'private' },
    { nested: { secret: 'private' } },
    { temperature: NaN },
    { tooLong: 'x'.repeat(2049) },
  ])
    expect(() => normalizeProvider({ ...provider, options })).toThrow('translation-settings')
  expect(
    normalizeProvider({
      ...provider,
      options: { temperature: 0.3, max_tokens: 2048, stop: null, stream: false },
    }).options,
  ).toEqual({ temperature: 0.3, max_tokens: 2048, stop: null, stream: false })
})

it('hashes every output-affecting descriptor and settings field, and excludes reconstruction secrets', async () => {
  const settings = fixtureSettings()
  settings.provider = {
    ...settings.provider,
    baseUrl: 'https://example.com/v1?route=a',
    model: 'model-a',
    profile: 'account-a',
    options: { temperature: 0.2 },
  }
  const key = await translationSettingsKey(settings, fixtureCapabilities)
  const changes: Partial<TranslationSettings>[] = [
    { sourceLanguage: 'en' },
    { targetLanguage: 'ja' },
    { glossary: [{ source: 'book', target: '書籍' }] },
    { formality: 'formal' },
    { promptVersion: 'v2' },
    ...[
      { adapter: 'different' },
      { version: '2' },
      { baseUrl: 'https://example.com/v2?route=a' },
      { baseUrl: 'https://example.com/v1?route=b' },
      { model: 'model-b' },
      { profile: 'account-b' },
      { options: { temperature: 0.3 } },
    ].map((patch) => ({ provider: { ...settings.provider, ...patch } })),
  ]
  for (const patch of changes)
    expect(await translationSettingsKey({ ...settings, ...patch }, fixtureCapabilities)).not.toBe(
      key,
    )
  expect(key).toMatch(/^[a-f0-9]{32}$/)
  const source =
    'Read `private-one` and [label](https://private-one.example).\n\nRead `private-two` and [label](https://private-two.example).'
  const extracted = extractTranslation(parseMarkdown(source).root, source)
  const jobs = await prepareTranslation(extracted, settings, fixtureCapabilities)
  expect(jobs.jobs).toHaveLength(1)
  expect(JSON.stringify(jobs.jobs)).not.toMatch(/private-one|private-two|example/)
  const payload = extracted.units[0]?.payload
  if (!payload) throw new Error('Missing payload')
  const unitKey = await translationUnitKey(payload, key)
  expect(
    await translationUnitKey({ ...payload, text: payload.text.replace('Read', 'Read  ') }, key),
  ).not.toBe(unitKey)
  expect(await translationUnitKey({ ...payload, kind: 'heading' }, key)).not.toBe(unitKey)
  expect(
    await translationUnitKey(
      payload,
      await translationSettingsKey({ ...settings, targetLanguage: 'ja' }, fixtureCapabilities),
    ),
  ).not.toBe(unitKey)
})

it('canonicalizes option order without collapsing distinct strings, array order or source whitespace', async () => {
  const first = fixtureSettings()
  first.provider.options = { temperature: 0.2, seed: 5 }
  const second = structuredClone(first)
  second.provider.options = { seed: 5, temperature: 0.2 }
  expect(await translationSettingsKey(first, fixtureCapabilities)).toBe(
    await translationSettingsKey(second, fixtureCapabilities),
  )
  const canonical = normalizeTranslationSettings(
    { ...first, sourceLanguage: 'EN-us', targetLanguage: 'ZH-cn' },
    fixtureCapabilities,
  )
  expect(canonical).toMatchObject({ sourceLanguage: 'en-US', targetLanguage: 'zh-CN' })
  first.glossary = [
    { source: 'book', target: '本' },
    { source: 'page', target: '页' },
  ]
  second.glossary = [...first.glossary].reverse()
  expect(await translationSettingsKey(first, fixtureCapabilities)).not.toBe(
    await translationSettingsKey(second, fixtureCapabilities),
  )
})

it('rejects unsupported options explicitly instead of pretending all providers support them', () => {
  const limited = { ...fixtureCapabilities, sourceDetection: false, glossary: false, formality: [] }
  const settings = { ...fixtureSettings(), sourceLanguage: 'en' }
  expect(normalizeTranslationSettings(settings, limited)).toMatchObject({
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
  })
  for (const patch of [
    { sourceLanguage: 'auto' },
    { targetLanguage: 'auto' },
    { targetLanguage: '../invalid' },
    { formality: 'formal' },
    { glossary: [{ source: 'word', target: '词' }] },
    { apiKey: 'private' },
    { theme: 'dark' },
  ])
    expect(() => normalizeTranslationSettings({ ...settings, ...patch }, limited)).toThrow(
      'translation-settings',
    )
  expect(() =>
    normalizeTranslationSettings(
      {
        ...settings,
        glossary: Array.from({ length: 1001 }, () => ({ source: 'word', target: '词' })),
      },
      fixtureCapabilities,
    ),
  ).toThrow('translation-settings')
  expect(() =>
    normalizeTranslationSettings(
      {
        ...settings,
        provider: {
          ...settings.provider,
          options: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`option-${i}`, true])),
        },
      },
      fixtureCapabilities,
    ),
  ).toThrow('translation-settings')
})

it('reuses unchanged independent paragraphs after editing only one unit', async () => {
  const first = 'First paragraph.\n\nSecond `private` paragraph.\n\nThird paragraph.'
  const later = first.replace('First paragraph.', 'First paragraph edited.')
  const before = await prepareTranslation(
    extractTranslation(parseMarkdown(first).root, first),
    fixtureSettings(),
    fixtureCapabilities,
  )
  const after = await prepareTranslation(
    extractTranslation(parseMarkdown(later).root, later),
    fixtureSettings(),
    fixtureCapabilities,
  )
  const cached = new Set(before.jobs.map((job) => job.key))
  expect(after.jobs.filter((job) => !cached.has(job.key))).toHaveLength(1)
  expect(after.jobs.filter((job) => cached.has(job.key))).toHaveLength(2)
})
