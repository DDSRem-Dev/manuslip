import { parseMarkdown } from '@manuslip/core'
import { expect, it, vi } from 'vitest'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { extractCompactTranslation, extractTranslation } from '../../src/extract'
import { prepareCanonicalTranslation, prepareTranslation } from '../../src/identity'
import { fixtureCapabilities, fixtureSettings } from '../fixtures/provider'

const limits = { retained: 32 * 1024 * 1024, staging: 8 * 1024 * 1024 }
const compact = (source: string) =>
  extractCompactTranslation(parseMarkdown(source).root, source, limits)
it('keeps one provider key per canonical value while preserving occurrence jobs and private boundaries', async () => {
  const source = 'Hello **world** `FIRST`.\n\nHello **world** `SECOND`.\n\nOther prose.',
    plan = compact(source),
    settings = fixtureSettings()
  const actual = await prepareCanonicalTranslation(plan, settings, fixtureCapabilities),
    expected = await prepareTranslation(plan, settings, fixtureCapabilities)
  expect(actual.jobs).toEqual(expected.jobs)
  expect(actual.keys.size).toBe(2)
  expect('occurrences' in actual).toBe(false)
  for (const unit of plan.units)
    expect(unit.payload && actual.keys.get(unit.payload)).toBe(
      expected.occurrences.get(unit.occurrenceId),
    )
  expect(JSON.stringify(actual.jobs)).not.toMatch(/FIRST|SECOND|bindings|occurrenceId/)
  expect(actual.jobs[0]?.payload).not.toBe(plan.units[0]?.payload)
})
it('matches ordinary prepared keys and complete payloads for every pinned CommonMark example', async () => {
  for (const example of examples) {
    const plan = compact(example.markdown),
      settings = fixtureSettings()
    const actual = await prepareCanonicalTranslation(plan, settings, fixtureCapabilities),
      expected = await prepareTranslation(plan, settings, fixtureCapabilities)
    expect(actual.jobs, `CommonMark ${example.example}`).toEqual(expected.jobs)
    for (const unit of plan.units)
      if (unit.payload)
        expect(actual.keys.get(unit.payload), `CommonMark ${example.example}`).toBe(
          expected.occurrences.get(unit.occurrenceId),
        )
  }
})
it('hashes repeated immutable values once and keeps settings-specific keys distinct', async () => {
  const one = compact('Hello `PRIVATE`.'),
    repeated = compact('Hello `PRIVATE`.\n\n'.repeat(200)),
    digest = vi.spyOn(crypto.subtle, 'digest')
  try {
    await prepareCanonicalTranslation(one, fixtureSettings(), fixtureCapabilities)
    const count = digest.mock.calls.length
    digest.mockClear()
    const first = await prepareCanonicalTranslation(
      repeated,
      fixtureSettings(),
      fixtureCapabilities,
    )
    expect(digest.mock.calls).toHaveLength(count)
    expect(first.keys.size).toBe(1)
    const second = await prepareCanonicalTranslation(
      repeated,
      { ...fixtureSettings(), targetLanguage: 'ja' },
      fixtureCapabilities,
    )
    expect(first.jobs[0]?.key).not.toBe(second.jobs[0]?.key)
  } finally {
    digest.mockRestore()
  }
})
it.each([false, true])(
  'rejects untrusted provider values even when externally frozen=%s',
  async (frozen) => {
    const plan = extractTranslation(parseMarkdown('Hello `PRIVATE`.').root, 'Hello `PRIVATE`.')
    if (frozen && plan.units[0]?.payload) Object.freeze(plan.units[0].payload)
    await expect(
      prepareCanonicalTranslation(plan, fixtureSettings(), fixtureCapabilities),
    ).rejects.toThrow('translation-invalid')
    await expect(
      prepareTranslation(plan, fixtureSettings(), fixtureCapabilities),
    ).resolves.toHaveProperty('jobs')
  },
)
it('keeps source-only limited units outside the key and job indexes', async () => {
  const plan = compact('x'.repeat(70000)),
    result = await prepareCanonicalTranslation(plan, fixtureSettings(), fixtureCapabilities)
  expect(plan.units).toHaveLength(1)
  expect(result.jobs).toEqual([])
  expect(result.keys.size).toBe(0)
})
