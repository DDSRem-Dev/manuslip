import { parseMarkdown } from '@manuslip/core'
import { renderMarkdown } from '@manuslip/renderer'
import { describe, expect, it, vi } from 'vitest'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { extractionVersion, translationLimits } from '../../src/contracts'
import { extractSharedTranslation, extractTranslation } from '../../src/extract'
import { prepareTranslation } from '../../src/identity'
import { reconstructTranslation } from '../../src/reconstruct'
import { fixtureCapabilities, fixtureSettings } from '../fixtures/provider'

const MiB = 1024 * 1024
const limits = { retained: 32 * MiB, staging: 8 * MiB }
const options = { rawHtml: true, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
function extract(source: string) {
  const root = parseMarkdown(source).root
  let next = 0
  const shared = extractSharedTranslation(root, source, limits, () => `unit-${next++}`)
  next = 0
  const native = extractTranslation(root, source, () => `unit-${next++}`)
  return { root, shared, native }
}
it('shares canonical payload/token identities while keeping every occurrence and private binding distinct', async () => {
  const source =
    'Hello **world** with `FIRST` and [label](https://first.invalid/).\n\nHello **world** with `SECOND` and [label](https://second.invalid/).'
  const { root, shared, native } = extract(source),
    original = JSON.stringify(root)
  expect(shared.units).toEqual(native.units)
  expect(shared.payloadBytes).toBe(native.payloadBytes)
  expect(shared.root).toBe(root)
  expect(shared.cost.uniquePayloads).toBe(1)
  const first = shared.units[0],
    second = shared.units[1]
  if (!first?.payload || !second?.payload) throw new Error('Missing prose')
  expect(first.payload).toBe(second.payload)
  expect(first.bindings).not.toBe(second.bindings)
  for (const [index, binding] of first.bindings.entries()) {
    expect(binding.token).toBe(first.payload.tokens[index])
    expect(second.bindings[index]?.token).toBe(binding.token)
    if (binding.node) expect(second.bindings[index]?.node).not.toBe(binding.node)
  }
  expect(Object.isFrozen(first.payload)).toBe(true)
  expect(Object.isFrozen(first.payload.tokens)).toBe(true)
  expect(first.payload.tokens.every(Object.isFrozen)).toBe(true)
  const prepared = await prepareTranslation(shared, fixtureSettings(), fixtureCapabilities)
  expect(prepared.jobs).toHaveLength(1)
  expect(JSON.stringify(prepared.jobs)).not.toMatch(/FIRST|SECOND|https:/)
  const output = first.payload.text.replace('Hello', '你好')
  const result = reconstructTranslation(
    shared,
    new Map(shared.units.map((unit) => [unit.occurrenceId, output])),
  )
  const html = renderMarkdown(result.root, options).html
  for (const secret of ['FIRST', 'SECOND', 'https://first.invalid/', 'https://second.invalid/'])
    expect(html).toContain(secret)
  expect(html).toContain('你好')
  expect(JSON.stringify(root)).toBe(original)
})
it('hashes only canonical immutable payloads once per preparation and keeps settings-specific keys', async () => {
  const { shared } = extract('Hello `FIRST`.\n\nHello `SECOND`.\n\nHello `THIRD`.')
  const digest = vi.spyOn(crypto.subtle, 'digest')
  try {
    const first = await prepareTranslation(shared, fixtureSettings(), fixtureCapabilities)
    const count = digest.mock.calls.length
    const distinct = extractSharedTranslation(
      parseMarkdown('Hello `FIRST`.').root,
      'Hello `FIRST`.',
      limits,
    )
    digest.mockClear()
    await prepareTranslation(distinct, fixtureSettings(), fixtureCapabilities)
    expect(digest.mock.calls).toHaveLength(count)
    const second = await prepareTranslation(
      shared,
      { ...fixtureSettings(), targetLanguage: 'ja' },
      fixtureCapabilities,
    )
    expect(second.jobs[0]?.key).not.toBe(first.jobs[0]?.key)
  } finally {
    digest.mockRestore()
  }
})
it('revalidates mutable payloads and does not treat externally frozen payloads as trusted cache entries', async () => {
  const { native } = extract('Hello `FIRST`.\n\nHello `SECOND`.')
  const first = native.units[0],
    second = native.units[1]
  if (!first?.payload || !second) throw new Error('Missing prose')
  second.payload = first.payload
  const digest = vi.spyOn(crypto.subtle, 'digest')
  try {
    await prepareTranslation(native, fixtureSettings(), fixtureCapabilities)
    const mutableCalls = digest.mock.calls.length
    Object.freeze(first.payload)
    digest.mockClear()
    await prepareTranslation(native, fixtureSettings(), fixtureCapabilities)
    expect(digest.mock.calls).toHaveLength(mutableCalls)
  } finally {
    digest.mockRestore()
  }
})
it('keeps kind, whitespace, Unicode, CRLF ranges and source-private groups exact', () => {
  const source =
    '# Hello 😀\r\n\r\nHello  😀\r\nworld.\r\n\r\nHello 😀\r\nworld.\r\n\r\nHello <span title="PRIVATE">body <b>inside</b></span> at https://private.invalid/ ⟪marker⟫.\r\n'
  const { shared, native } = extract(source)
  expect(shared.units).toEqual(native.units)
  expect(shared.cost.uniquePayloads).toBe(4)
  expect(shared.units[0]?.payload?.schema).toBe(extractionVersion)
  expect(shared.units.map((unit) => source.slice(unit.from, unit.to))).toEqual(
    native.units.map((unit) => source.slice(unit.from, unit.to)),
  )
})
it('keeps unpositioned literal links atomic when the document starts with a bracket', () => {
  const source = '[Label](https://first.invalid/) and www.private.invalid.'
  const root = parseMarkdown(source).root,
    paragraph = root.children[0]
  if (paragraph?.type !== 'paragraph') throw new Error('Missing prose')
  const link = paragraph.children.find(
    (node) => node.type === 'link' && node.url.includes('www.private.invalid'),
  )
  if (link?.type !== 'link') throw new Error('Missing literal autolink')
  delete link.position
  const plan = extractSharedTranslation(root, source, limits),
    unit = plan.units[0]
  expect(
    unit?.payload?.tokens.filter((token) => token.role === 'link').map((token) => token.type),
  ).toEqual(['open', 'close', 'atom'])
  expect(JSON.stringify(unit?.payload)).not.toContain('www.private.invalid')
  expect(unit?.bindings.find((binding) => binding.token.type === 'atom')?.node).toBe(link)
})
it('rejects total admission separately from per-unit limits and leaves source reusable', () => {
  const source = 'Hello `secret`.\n\n'.repeat(150)
  const { root, shared } = extract(source),
    original = JSON.stringify(root)
  for (const retained of [
    0,
    4096,
    2 * MiB,
    extractSharedTranslation(root, source, limits).cost.peakBytes - 1,
  ])
    expect(() =>
      extractSharedTranslation(root, source, { retained, staging: limits.staging }),
    ).toThrow('translation-limit')
  expect(() =>
    extractSharedTranslation(root, source, {
      retained: limits.retained,
      staging: shared.cost.stagingBytes - 1,
    }),
  ).toThrow('translation-limit')
  expect(JSON.stringify(root)).toBe(original)
  expect(extractSharedTranslation(root, source, limits).units).toHaveLength(shared.units.length)
  for (const value of [-1, NaN, Infinity, 1.5])
    expect(() =>
      extractSharedTranslation(root, source, { retained: value, staging: limits.staging }),
    ).toThrow('translation-invalid')
})
it.each(['prose', 'tokens', 'protected-whitespace'] as const)(
  'keeps %s eligibility and individual-limit behavior exact with bounded projection work',
  (kind) => {
    const source =
      kind === 'prose'
        ? '界'.repeat(70000)
        : kind === 'tokens'
          ? `Intro ${'`x` '.repeat(257)}`
          : ['`one`', ' '.repeat(70000), '`two`'].join('')
    const { shared, native } = extract(source)
    expect(shared.units).toEqual(native.units)
    if (kind === 'protected-whitespace') expect(shared.units).toHaveLength(0)
    else expect(shared.units[0]).toMatchObject({ payload: null, error: 'translation-unit-large' })
  },
)
it('retains logical unit/payload/depth caps despite canonical sharing', () => {
  const units = 'Hello\n\n'.repeat(translationLimits.units + 1)
  expect(() => extractSharedTranslation(parseMarkdown(units).root, units, limits)).toThrow(
    'translation-limit',
  )
  const depth = `${'> '.repeat(translationLimits.depth + 1)}Hello`
  expect(() => extractSharedTranslation(parseMarkdown(depth).root, depth, limits)).toThrow(
    'translation-limit',
  )
  const payloads = `Prose ${'`x` '.repeat(200)}\n\n`.repeat(1400)
  expect(() =>
    extractSharedTranslation(parseMarkdown(payloads).root, payloads, {
      retained: 64 * MiB,
      staging: 8 * MiB,
    }),
  ).toThrow('translation-limit')
}, 15_000)
describe('canonical shared plans match pinned CommonMark extraction', () => {
  it.each(examples)('$example: $section', (example) => {
    const root = parseMarkdown(example.markdown, 'commonmark').root
    let next = 0
    const actual = extractSharedTranslation(root, example.markdown, limits, () => `id-${next++}`)
    next = 0
    const expected = extractTranslation(root, example.markdown, () => `id-${next++}`)
    expect(actual.units).toEqual(expected.units)
    expect(actual.payloadBytes).toBe(expected.payloadBytes)
    const outputs = new Map(actual.units.map((unit) => [unit.occurrenceId, unit.payload?.text]))
    expect(JSON.stringify(reconstructTranslation(actual, outputs))).toBe(
      JSON.stringify(reconstructTranslation(expected, outputs)),
    )
  })
})
