import { messageSize, parseMarkdown, type Root, semanticLimits, utf8Bytes } from '@manuslip/core'
import { renderMarkdown } from '@manuslip/renderer'
import { expect, it } from 'vitest'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { type TranslationPlan, translationLimits } from '../../src/contracts'
import {
  extractCompactTranslation,
  extractSharedTranslation,
  extractTranslation,
} from '../../src/extract'
import { prepareTranslation } from '../../src/identity'
import { reconstructTranslation } from '../../src/reconstruct'
import { reconstructSharedTranslation } from '../../src/reconstruct-shared'
import { fixtureCapabilities, fixtureSettings } from '../fixtures/provider'

const MiB = 1024 * 1024
const limits = { retained: 32 * MiB, staging: 8 * MiB }
const options = { rawHtml: true, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
const values = (plan: TranslationPlan) =>
  new Map(
    plan.units.map((unit) => [unit.occurrenceId, unit.payload?.text.replaceAll('Hello', '你好')]),
  )
function makeId() {
  let id = 0
  return () => `unit-${id++}`
}
function plans(source: string) {
  const root = parseMarkdown(source).root
  return {
    root,
    compact: extractCompactTranslation(root, source, limits, makeId()),
    native: extractTranslation(root, source, makeId()),
  }
}
it.each(examples)('preserves all values and reconstruction for CommonMark $example', (example) => {
  const { root, compact, native } = plans(example.markdown),
    before = JSON.stringify(root)
  expect(JSON.stringify(compact.units)).toBe(JSON.stringify(native.units))
  expect(compact.payloadBytes).toBe(native.payloadBytes)
  const actual = reconstructSharedTranslation(compact, values(compact), limits),
    expected = reconstructTranslation(native, values(native))
  expect(JSON.stringify(actual.root)).toBe(JSON.stringify(expected.root))
  expect(actual.statuses).toEqual(expected.statuses)
  expect(JSON.stringify(root)).toBe(before)
})
it('stores private node references while snapshots expose exact immutable binding values', async () => {
  const source =
    'Hello **world** with `FIRST` and [label](https://first.invalid/).\n\nHello **world** with `SECOND` and [label](https://second.invalid/).'
  const { root, compact, native } = plans(source),
    shared = extractSharedTranslation(root, source, limits, makeId()),
    first = compact.units[0],
    second = compact.units[1]
  if (!first?.payload || !second?.payload) throw new Error('No prose')
  expect(first.payload).toBe(second.payload)
  expect(first.bindings).toEqual(native.units[0]?.bindings)
  expect(first.bindings).not.toBe(first.bindings)
  expect(
    first.bindings.every((binding, index) => binding.token === first.payload?.tokens[index]),
  ).toBe(true)
  expect(
    first.bindings.filter((binding) => binding.node).map((binding) => binding.node),
  ).not.toEqual(second.bindings.filter((binding) => binding.node).map((binding) => binding.node))
  for (const value of [compact, compact.units, first, first.path, first.bindings])
    expect(Object.isFrozen(value)).toBe(true)
  expect(first.bindings.every(Object.isFrozen)).toBe(true)
  expect(compact.cost.retainedBytes).toBeLessThan(shared.cost.retainedBytes)
  const prepared = await prepareTranslation(compact, fixtureSettings(), fixtureCapabilities)
  expect(prepared.jobs).toHaveLength(1)
  expect(JSON.stringify(prepared.jobs)).not.toMatch(/FIRST|SECOND|https:/)
  const descriptor = Object.getOwnPropertyDescriptor(first, 'bindings')
  expect(descriptor?.get).toBeTypeOf('function')
  const result = reconstructSharedTranslation(compact, values(compact), limits),
    expected = reconstructTranslation(native, values(native))
  expect(JSON.stringify(result.root)).toBe(JSON.stringify(expected.root))
  const html = renderMarkdown(result.root, options).html
  for (const secret of ['FIRST', 'SECOND', 'https://first.invalid/', 'https://second.invalid/'])
    expect(html).toContain(secret)
  expect(compact.root).toBe(root)
})
it('preserves grouped HTML, literals, Unicode, whitespace and source-only fallback', () => {
  const source =
    'Hello <span title="PRIVATE">body <b>inside</b></span> and **世界** at https://private.invalid/ ⟪PRIVATE⟫.\r\n\r\nHello\r\n\r\nHello `small`\r\n\r\n' +
    '界'.repeat(70000)
  const { compact, native } = plans(source)
  expect(JSON.stringify(compact.units)).toBe(JSON.stringify(native.units))
  expect(compact.units.at(-1)?.payload).toBeNull()
  for (const unit of compact.units)
    for (const binding of unit.bindings) {
      if (Array.isArray(binding.node)) expect(Object.isFrozen(binding.node)).toBe(true)
      if (binding.token.role === 'literal') expect(Object.isFrozen(binding.node)).toBe(true)
    }
  const result = reconstructSharedTranslation(compact, values(compact), limits)
  expect(JSON.stringify(result.root)).toBe(
    JSON.stringify(reconstructTranslation(native, values(native)).root),
  )
  expect(result.statuses.at(-1)?.status).toBe('limit')
})
// Keep the complete 100 × 200-binding fixture; combined admission checks took 5.6s on Intel CI.
it('enforces complete extraction admission and source reuse', () => {
  const source = `Hello ${'`PRIVATE` '.repeat(200)}\n\n`.repeat(100),
    root = parseMarkdown(source).root,
    compact = extractCompactTranslation(root, source, limits, makeId()),
    shared = extractSharedTranslation(root, source, limits, makeId()),
    before = JSON.stringify(root)
  expect(compact.cost.retainedBytes).toBeLessThan(shared.cost.retainedBytes / 2)
  expect(() =>
    extractCompactTranslation(
      root,
      source,
      {
        retained: compact.cost.peakBytes - 1,
        staging: limits.staging,
      },
      makeId(),
    ),
  ).toThrow('translation-limit')
  expect(JSON.stringify(root)).toBe(before)
  expect(extractCompactTranslation(root, source, limits).units).toHaveLength(100)
}, 30_000)
it('enforces the logical token limit despite compact storage', () => {
  const source = `Hello ${'`x` '.repeat(translationLimits.tokens + 1)}`
  const compact = extractCompactTranslation(parseMarkdown(source).root, source, limits, makeId())
  expect(compact.units[0]?.error).toBe('translation-unit-large')
})
// Parse all 10,001 paragraphs before checking admission, independently of token-heavy setup.
it('enforces the logical unit limit despite source reuse', () => {
  const source = 'Hello\n\n'.repeat(translationLimits.units + 1)
  expect(() => extractCompactTranslation(parseMarkdown(source).root, source, limits)).toThrow(
    'translation-limit',
  )
}, 30_000)
// The complete aggregate-payload/depth check took 12.6s on Intel CI.
it('retains the logical aggregate payload limit despite compact storage', () => {
  const chunk = `Hello ${'`x` '.repeat(256)}\n\n`,
    payload = extractTranslation(parseMarkdown(chunk).root, chunk).units[0]?.payload
  if (!payload) throw new Error('No payload')
  const count = Math.floor(translationLimits.plan / messageSize(payload)) + 1,
    source = chunk.repeat(count)
  expect(utf8Bytes(source)).toBeLessThan(semanticLimits.previewBytes)
  const root = parseMarkdown(source).root
  expect(() => extractCompactTranslation(root, source, limits)).toThrow('translation-limit')
  expect(() => extractTranslation(root, source)).toThrow('translation-limit')
}, 30_000)
it('retains the logical depth limit despite compact storage', () => {
  const paragraph = parseMarkdown('Hello').root.children[0]
  if (paragraph?.type !== 'paragraph') throw new Error('No prose')
  let nested: Extract<Root['children'][number], { type: 'paragraph' | 'blockquote' }> = paragraph
  for (let depth = 0; depth <= translationLimits.depth; depth++)
    nested = { type: 'blockquote', children: [nested] }
  expect(() =>
    extractCompactTranslation({ type: 'root', children: [nested] }, 'Hello', limits),
  ).toThrow('translation-limit')
})
