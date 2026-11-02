import type { ProviderCapabilities, TranslationJob, TranslationSettings } from '../../src/contracts'

/** Offline test consumer of the provider contract; never sends traffic or appears as a real engine. */
export const fixtureCapabilities: ProviderCapabilities = {
  sourceDetection: true,
  glossary: true,
  formality: ['formal', 'informal'],
  streaming: false,
  credential: 'none',
}
export function fixtureSettings(): TranslationSettings {
  return {
    provider: {
      adapter: 'fixture',
      version: '1',
      baseUrl: 'http://127.0.0.1/fixture',
      model: null,
      profile: null,
      options: {},
    },
    sourceLanguage: 'auto',
    targetLanguage: 'zh-CN',
    glossary: [],
    formality: 'default',
    promptVersion: 'fixture-v1',
  }
}
export function fixtureTranslate(
  jobs: readonly TranslationJob[],
  replacements: readonly (readonly [string, string])[],
): Map<string, string> {
  return new Map(
    jobs.map((job) => {
      let output = job.payload.text
      // Replace only prose chunks; even a fixture must not rewrite opaque tokens.
      output = output
        .split(/(⟪M\d+⟫)/g)
        .map((chunk) => {
          if (/^⟪M\d+⟫$/.test(chunk)) return chunk
          for (const [from, to] of replacements) chunk = chunk.replaceAll(from, to)
          return chunk
        })
        .join('')
      return [job.key, output]
    }),
  )
}
