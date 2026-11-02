import { messageSize, parseMarkdown, sourceHash } from '@manuslip/core'
import { readingBlocks } from '@manuslip/renderer/reading'
import { extractTranslation, type TranslationPayload, translationLimits } from '@manuslip/translate'
import { expect, it } from 'vitest'
import examples from '../../../../../../../packages/core/test/fixtures/commonmark-0.31.2/spec.json'
import {
  decodeReadingValue,
  sharedReadingPrepared,
} from '../../../../../src/renderer/src/translation/prepared-wire'
import {
  type ReadingValue,
  readingLimits,
} from '../../../../../src/renderer/src/translation/protocol'

function prepared(source: string): Extract<ReadingValue, { kind: 'prepared' }> {
  const root = parseMarkdown(source).root
  const keys = new Map<string, string>()
  return {
    kind: 'prepared',
    units: extractTranslation(root, source).units.map((unit) => {
      let key: string | null = null
      if (unit.payload) {
        const spelling = JSON.stringify(unit.payload)
        key = keys.get(spelling) ?? `key-${keys.size}`
        keys.set(spelling, key)
      }
      return {
        occurrenceId: unit.occurrenceId,
        kind: unit.kind,
        from: unit.from,
        to: unit.to,
        hash: sourceHash(source.slice(unit.from, unit.to)),
        key,
        payload: unit.payload,
      }
    }),
    blocks: readingBlocks(root, source),
  }
}
const fixture = () =>
  prepared(
    'Hello **world**, `PRIVATE_ONE` and [label](https://private.invalid/one).\n\nHello **world**, `PRIVATE_TWO` and [label](https://private.invalid/two).',
  )

it('shares exact canonical values across independent payload objects and preserves every occurrence', () => {
  const original = fixture()
  expect(original.units[0]?.payload).not.toBe(original.units[1]?.payload)
  const response = sharedReadingPrepared(original)
  expect(response.value.payloads).toHaveLength(1)
  expect(response.value.units.map((unit) => unit.payload)).toEqual([0, 0])
  expect(JSON.stringify(response.value)).not.toMatch(/PRIVATE_|private.invalid|bindings/)
  const decoded = decodeReadingValue(structuredClone(response.value))
  expect(decoded).toEqual(original)
  if (decoded.kind !== 'prepared') throw new Error('Not prepared')
  expect(decoded.units[0]?.payload).toBe(decoded.units[1]?.payload)
  const payload = decoded.units[0]?.payload
  expect(Object.isFrozen(payload)).toBe(true)
  expect(Object.isFrozen(payload?.tokens)).toBe(true)
  expect(payload?.tokens.every(Object.isFrozen)).toBe(true)
  expect(original.units[0]?.payload).not.toBe(payload)
  expect(new Set(decoded.units.map((unit) => unit.occurrenceId)).size).toBe(2)
})
it('round-trips all pinned CommonMark examples through a real structured clone without losing unit fields', () => {
  for (const example of examples) {
    const original = prepared(example.markdown)
    const wire = sharedReadingPrepared(original)
    expect(
      decodeReadingValue(structuredClone(wire.value)),
      `CommonMark ${example.example}`,
    ).toEqual(original)
  }
})
it('keeps kind, Unicode and whitespace distinctions and source-only limited units', () => {
  const original = prepared(
    `# Hello 世界\n\nHello 世界\n\nHello  世界\n\nHello world\n\n${'x'.repeat(70000)}`,
  )
  const response = sharedReadingPrepared(original)
  expect(response.value.payloads).toHaveLength(4)
  expect(response.value.units.at(-1)?.payload).toBeNull()
  expect(decodeReadingValue(structuredClone(response.value))).toEqual(original)
})
it('uses an exact spelling rather than unit keys to distinguish payload values', () => {
  const original = prepared('First prose.\n\nSecond prose.')
  for (const unit of original.units) unit.key = 'same-key'
  expect(sharedReadingPrepared(original).value.payloads).toHaveLength(2)
})
it('admits a shared descriptor graph whose repeated JSON exceeds the unchanged cap', () => {
  const original = fixture(),
    unit = original.units[0]
  if (!unit?.payload) throw new Error('No payload')
  unit.payload.text = `${'long prose '.repeat(4000)}${unit.payload.text}`
  original.units = Array.from({ length: 200 }, (_, i) => ({ ...unit, occurrenceId: `unit-${i}` }))
  expect(messageSize(original)).toBeGreaterThan(readingLimits.message)
  const wire = sharedReadingPrepared(original)
  expect(wire.bytes).toBeLessThan(readingLimits.descriptors)
  expect(messageSize(wire.value)).toBeLessThan(readingLimits.message)
  const decoded = decodeReadingValue(structuredClone(wire.value))
  expect(decoded).toEqual(original)
  if (decoded.kind !== 'prepared') throw new Error('Not prepared')
  expect(new Set(decoded.units.map((unit) => unit.payload)).size).toBe(1)
})
it('rejects unique descriptor storage overflow and logical unit overflow despite sharing', () => {
  const original = fixture(),
    unit = original.units[0]
  if (!unit?.payload) throw new Error('No payload')
  original.units = Array.from({ length: 120 }, (_, i) => ({
    ...unit,
    occurrenceId: `unit-${i}`,
    payload: { ...unit.payload, text: `${'long prose '.repeat(4000)}${i}` } as TranslationPayload,
  }))
  expect(() => sharedReadingPrepared(original)).toThrow('translation-view-limit')
  original.units = Array.from({ length: translationLimits.units + 1 }, () => unit)
  expect(() => sharedReadingPrepared(original)).toThrow('translation-view-limit')
  const wire = sharedReadingPrepared(fixture()).value
  wire.units = Array.from(
    { length: translationLimits.units + 1 },
    () => wire.units[0],
  ) as typeof wire.units
  expect(() => decodeReadingValue(wire)).toThrow('translation-view-limit')
})
it('preserves logical aggregate payload admission even when one table entry serves every unit', () => {
  const original = fixture(),
    unit = original.units[0]
  if (!unit?.payload) throw new Error('No payload')
  unit.payload.text = `${'long prose '.repeat(4000)}${unit.payload.text}`
  original.units = [{ ...unit, occurrenceId: 'unit-0' }]
  const wire = sharedReadingPrepared(original).value
  original.units = Array.from({ length: 400 }, (_, i) => ({ ...unit, occurrenceId: `unit-${i}` }))
  expect(() => sharedReadingPrepared(original)).toThrow('translation-view-limit')
  const encoded = wire.units[0]
  if (!encoded) throw new Error('No encoded unit')
  wire.units = Array.from({ length: 400 }, (_, i) => ({ ...encoded, occurrenceId: `unit-${i}` }))
  expect(() => decodeReadingValue(wire)).toThrow('translation-view-limit')
})
it.each([
  'index',
  'fraction',
  'negative',
  'nan',
  'missing-payload',
  'missing-key',
  'kind',
  'range',
  'id',
  'block-id',
  'unused',
  'token',
  'private-payload',
  'private-unit',
  'version',
])('rejects malformed %s responses before publication', (failure) => {
  const wire = structuredClone(sharedReadingPrepared(fixture()).value),
    unit = wire.units[0],
    payload = wire.payloads[0],
    block = wire.blocks[0]
  if (!unit || !payload || !block) throw new Error('No fixture')
  if (failure === 'index') unit.payload = wire.payloads.length
  if (failure === 'fraction') unit.payload = 0.5
  if (failure === 'negative') unit.payload = -1
  if (failure === 'nan') unit.payload = Number.NaN
  if (failure === 'missing-payload') unit.payload = null
  if (failure === 'missing-key') unit.key = null
  if (failure === 'kind') unit.kind = 'heading'
  if (failure === 'range') unit.to = unit.from - 1
  if (failure === 'id') wire.units[1] = { ...unit }
  if (failure === 'block-id') wire.blocks[1] = { ...block }
  if (failure === 'unused') wire.payloads.push(structuredClone(payload))
  if (failure === 'token') payload.tokens[0] = { ...payload.tokens[0], id: 'bad' } as never
  if (failure === 'private-payload') Object.assign(payload, { bindings: ['PRIVATE'] })
  if (failure === 'private-unit') Object.assign(unit, { bindings: ['PRIVATE'] })
  if (failure === 'version') Object.assign(wire, { kind: 'prepared' })
  expect(() => decodeReadingValue(wire)).toThrow()
})
