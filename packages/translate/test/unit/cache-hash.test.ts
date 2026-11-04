import { parseMarkdown } from '@manuslip/core'
import { afterEach, expect, it, vi } from 'vitest'
import * as cacheHash from '../../src/cache-hash'
import {
  extractTranslation,
  prepareTranslation,
  translationSettingsIdentity,
} from '../../src/index'
import { fixtureCapabilities, fixtureSettings } from '../fixtures/provider'

afterEach(() => vi.restoreAllMocks())

// Independent SMHasher-compatible mmh3 x86_128 vectors (seed 0, little-endian words).
it.each([
  ['', '00000000000000000000000000000000'],
  ['a', 'a794933c5556b01b5556b01b5556b01b'],
  ['ab', '158451df25be301025be301025be3010'],
  ['abc', '75cdc6d1a2b006a5a2b006a5a2b006a5'],
  ['abcd', '96b6ccaa45afc62e45afc62e45afc62e'],
  ['abcde', 'c5402efb5d24c5bc5a7201775a720177'],
  ['abcdefgh', 'aef41136adb11487fa6c8092fa6c8092'],
  ['abcdefghi', 'ad058c1c2206596f14d27d10dd94417c'],
  ['abcdefghijkl', '738503fef48224c027d4dfadd28ce553'],
  ['abcdefghijklmno', 'ee6d1d694a1ad5ae84ce1457ada761a8'],
  ['abcdefghijklmnop', '9fd2762790b91256e4ce8b21d193ba45'],
  ['abcdefghijklmnopq', '0445a4d364515c6fd96ddc2a1d11079d'],
  ['Hello 世界 😀', '1016b5489fe7ad22f81f6701332af0b3'],
  ['\ud800', '15861a9639dfc32639dfc32639dfc326'],
])('matches the reference UTF-8 MurmurHash3 digest for %j', async (value, expected) => {
  expect(await cacheHash.murmurHash128(value)).toBe(expected)
})

it('refuses to deduplicate different payloads when a hash collision is forced', async () => {
  vi.spyOn(cacheHash, 'murmurHash128').mockResolvedValue('a'.repeat(32))
  const source = 'First paragraph.\n\nOther paragraph.'
  await expect(
    prepareTranslation(
      extractTranslation(parseMarkdown(source).root, source),
      fixtureSettings(),
      fixtureCapabilities,
    ),
  ).rejects.toThrow('translation-invalid')
})

it('preserves exact settings scopes even when every hash collides', () => {
  vi.spyOn(cacheHash, 'murmurHash128').mockResolvedValue('a'.repeat(32))
  const first = fixtureSettings(),
    second = { ...first, targetLanguage: 'ja' }
  expect(translationSettingsIdentity(first, fixtureCapabilities)).not.toBe(
    translationSettingsIdentity(second, fixtureCapabilities),
  )
})
