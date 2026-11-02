import { parseMarkdown } from '@manuslip/core'
import { expect, it } from 'vitest'
import { extractTranslation } from '../../src/extract'
import { projectTranslation } from '../../src/projection-translation'
import { reconstructTranslation } from '../../src/reconstruct'

const limits = { retained: 8 * 1024 * 1024, staging: 8 * 1024 * 1024 }
const captured = (source: string) => extractTranslation(parseMarkdown(source).root, source)
it('returns to path-aware reconstruction for aliased nodes including an untranslated occurrence', () => {
  const plan = captured('Hello.\n\nOther.')
  const first = plan.units[0],
    second = plan.units[1],
    node = plan.root.children[0]
  if (!first?.payload || !second || !node) throw new Error('Missing prose')
  plan.root.children[1] = node
  expect(
    projectTranslation(plan, (unit) => (unit === first ? first.payload?.text : undefined), limits),
  ).toBeNull()
})
it('captures outputs once, consumes temporary children independently, and preserves source/positions', () => {
  const plan = captured('Hello **world** with `PRIVATE`.'),
    before = JSON.stringify(plan.root)
  const projected = projectTranslation(plan, () => 'Changed ⟪M0⟫bold⟪M1⟫ with ⟪M2⟫.', limits)
  if (!projected) throw new Error('Unexpected alias')
  const node = plan.root.children[0]
  if (!node) throw new Error('Missing prose')
  const first = projected.children(node),
    second = projected.children(node)
  expect(first).toEqual(second)
  expect(first).not.toBe(second)
  expect(first?.find((node) => node.type === 'inlineCode')).toBe(
    'children' in node ? node.children.find((node) => node.type === 'inlineCode') : undefined,
  )
  expect(projected.status(0)).toBe('translated')
  expect(JSON.stringify(plan.root)).toBe(before)
})
it('rejects metadata and unit workspace before publication, preserving retry', () => {
  const plan = captured('Hello **world**.'),
    values = new Map(plan.units.map((unit) => [unit.occurrenceId, unit.payload?.text]))
  const resolve = (unit: (typeof plan.units)[number]) => values.get(unit.occurrenceId)
  const projected = projectTranslation(plan, resolve, limits)
  if (!projected) throw new Error('Unexpected alias')
  for (const budget of [0, 4096, projected.peakBytes - 1])
    expect(() => projectTranslation(plan, resolve, { ...limits, retained: budget })).toThrow(
      'translation-limit',
    )
  expect(() =>
    projectTranslation(plan, resolve, { ...limits, staging: projected.stagingBytes - 1 }),
  ).toThrow('translation-limit')
  expect(projectTranslation(plan, resolve, limits)?.status(0)).toBe('translated')
  for (const retained of [-1, NaN, Infinity, 1.5])
    expect(() => projectTranslation(plan, resolve, { ...limits, retained })).toThrow(
      'translation-invalid',
    )
})
it('preserves independent invalid/limited/missing fallback statuses', () => {
  const plan = captured('Hello **world**.\n\nKeep source.\n\nToo much.\n\nLimited.'),
    fourth = plan.units[3]
  if (!fourth) throw new Error('Missing prose')
  fourth.error = 'translation-unit-large'
  const values = new Map(
    plan.units.map((unit, index) => [
      unit.occurrenceId,
      index === 0 ? 'Broken' : index === 1 ? undefined : 'x'.repeat(256 * 1024 + 1),
    ]),
  )
  const projected = projectTranslation(plan, (unit) => values.get(unit.occurrenceId), limits)
  if (!projected) throw new Error('Unexpected alias')
  const expected = reconstructTranslation(plan, values)
  expect(plan.units.map((_, index) => projected.status(index))).toEqual(
    expected.statuses.map((s) => s.status),
  )
  for (const node of plan.root.children) expect(projected.children(node)).toBeUndefined()
})
