import { parseMarkdown, type Root } from '@manuslip/core'
import { renderMarkdown } from '@manuslip/renderer'
import { describe, expect, it, vi } from 'vitest'
import { packValue, unpackValue } from '../../../core/src/packing'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { extractTranslation } from '../../src/extract'
import { reconstructTranslation } from '../../src/reconstruct'
import { reconstructSharedTranslation } from '../../src/reconstruct-shared'

const MiB = 1024 * 1024
const limits = { retained: 32 * MiB, staging: 8 * MiB }
const options = { rawHtml: true, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
const captured = (source: string) => extractTranslation(parseMarkdown(source).root, source)
const outputs = (plan: ReturnType<typeof captured>) =>
  new Map(
    plan.units.map((unit) => [unit.occurrenceId, unit.payload?.text.replaceAll('Hello', '你好')]),
  )
const canonical = (value: unknown) => JSON.stringify(value)

it('resolves outputs using complete occurrence units without an ID index', () => {
  const plan = captured('Hello **first**.\n\nHello **second**.'),
    values = outputs(plan),
    resolve = vi.fn((unit: (typeof plan.units)[number]) => values.get(unit.occurrenceId))
  const actual = reconstructSharedTranslation(plan, resolve, limits),
    expected = reconstructTranslation(plan, values)
  expect(resolve.mock.calls.map(([unit]) => unit)).toEqual(plan.units)
  expect(canonical(actual.root)).toBe(canonical(expected.root))
  expect(actual.statuses).toEqual(expected.statuses)
})

it('shares exact generated text values while retaining independent paths and protected nodes', () => {
  const plan = captured('Hello `FIRST` same.\n\nHello `SECOND` same.\n\nHello  distinct.'),
    result = reconstructSharedTranslation(plan, outputs(plan), limits),
    expected = reconstructTranslation(plan, outputs(plan))
  expect(canonical(result.root)).toBe(canonical(expected.root))
  expect(result.statuses).toEqual(expected.statuses)
  const first = result.root.children[0],
    second = result.root.children[1],
    third = result.root.children[2]
  if (first?.type !== 'paragraph' || second?.type !== 'paragraph' || third?.type !== 'paragraph')
    throw new Error('No prose')
  expect(first).not.toBe(second)
  expect(first.children).not.toBe(second.children)
  expect(first.children[0]).toBe(second.children[0])
  expect(first.children[2]).toBe(second.children[2])
  expect(first.children[1]).not.toBe(second.children[1])
  expect(third.children[0]).not.toBe(first.children[0])
  expect(Object.isFrozen(first.children[0])).toBe(true)
  expect(Reflect.set(first.children[0] as object, 'value', 'Changed')).toBe(false)
})

it('resolves outputs on demand once per logical occurrence without requiring a copied map', () => {
  const plan = captured('Hello **first**.\n\nHello `PRIVATE`.\n\nKeep source.'),
    values = outputs(plan),
    get = vi.fn((id: string) => values.get(id))
  values.delete(plan.units[2]?.occurrenceId ?? '')
  const actual = reconstructSharedTranslation(plan, { get }, limits),
    expected = reconstructTranslation(plan, values)
  expect(get.mock.calls.map(([id]) => id)).toEqual(plan.units.map((unit) => unit.occurrenceId))
  expect(canonical(actual.root)).toBe(canonical(expected.root))
  expect(actual.statuses).toEqual(expected.statuses)
  expect(actual.statuses.map((status) => status.status)).toEqual([
    'translated',
    'translated',
    'missing',
  ])
})

it('shares untouched subtrees and protected values, copying each changed container once', () => {
  const source =
    '# Heading\n\n> Hello *world* and `PRIVATE`.\n>\n> Hello [label][ref].\n\n```ts\nPRIVATE_BLOCK\n```\n\n[ref]: https://private.invalid/\n\nHello note[^n].\n\n[^n]: Hello footnote.\n'
  const plan = captured(source),
    original = canonical(plan.root),
    result = reconstructSharedTranslation(plan, outputs(plan), limits)
  const detached = reconstructTranslation(plan, outputs(plan))
  expect(canonical(result.root)).toBe(canonical(detached.root))
  expect(result.statuses).toEqual(detached.statuses)
  expect(result.root).not.toBe(plan.root)
  const quote = result.root.children[1],
    old = plan.root.children[1]
  expect(quote?.type).toBe('blockquote')
  if (quote?.type !== 'blockquote' || old?.type !== 'blockquote') throw new Error('Missing quote')
  expect(quote).not.toBe(old)
  expect(quote.children[0]).not.toBe(old.children[0])
  expect(quote.children[1]).not.toBe(old.children[1])
  const inline = quote.children[0],
    prior = old.children[0]
  if (inline?.type !== 'paragraph' || prior?.type !== 'paragraph') throw new Error('Missing prose')
  expect(inline.children.find((node) => node.type === 'inlineCode')).toBe(
    prior.children.find((node) => node.type === 'inlineCode'),
  )
  expect(result.root.children[2]).toBe(plan.root.children[2])
  expect(result.root.children[3]).toBe(plan.root.children[3])
  expect(Object.isFrozen(result.root)).toBe(true)
  expect(Object.isFrozen(result.root.children)).toBe(true)
  expect(Object.isFrozen(inline.children)).toBe(true)
  expect(Object.isFrozen(inline.children[0])).toBe(true)
  expect(canonical(plan.root)).toBe(original)
  expect(result.retainedBytes).toBeLessThan(limits.retained)
})
it('keeps packed positions as original accessors without invoking or expanding them', () => {
  const source = '> Hello **world**.\n\nKeep this.\n'
  const root = unpackValue(packValue(parseMarkdown(source).root, 8 * MiB), {
    bytes: 8 * MiB,
    retained: 32 * MiB,
    staging: 8 * MiB,
  }).value as Root
  const plan = extractTranslation(root, source),
    unit = plan.units[0]
  if (!unit?.payload) throw new Error('Missing unit')
  const prototype = Object.getPrototypeOf(root),
    descriptor = Object.getOwnPropertyDescriptor(root, 'position')
  const result = reconstructSharedTranslation(
    plan,
    new Map([[unit.occurrenceId, unit.payload.text.replace('Hello', '你好')]]),
    limits,
  )
  expect(Object.getPrototypeOf(result.root)).toBe(prototype)
  expect(Object.getOwnPropertyDescriptor(result.root, 'position')).toEqual(descriptor)
  expect(result.root.position).toEqual(root.position)
  expect(canonical(result.root)).toBe(
    canonical(
      reconstructTranslation(
        plan,
        new Map([[unit.occurrenceId, unit.payload.text.replace('Hello', '你好')]]),
      ).root,
    ),
  )
  expect(result.root.children[1]).toBe(root.children[1])
})
it('does not call position getters while constructing changed branches', () => {
  const plan = captured('Hello **world**.')
  const unit = plan.units[0],
    paragraph = plan.root.children[0]
  if (!unit?.payload || paragraph?.type !== 'paragraph') throw new Error('Missing prose')
  const read = vi.fn(() => {
    throw new Error('Position expanded')
  })
  for (const node of [
    plan.root,
    paragraph,
    paragraph.children.find((node) => node.type === 'strong'),
  ]) {
    if (node)
      Object.defineProperty(node, 'position', { get: read, enumerable: true, configurable: true })
  }
  const result = reconstructSharedTranslation(plan, outputs(plan), limits)
  expect(result.statuses[0]?.status).toBe('translated')
  expect(read).not.toHaveBeenCalled()
})
it('keeps separate paths when immutable source nodes have shared identity', () => {
  const plan = captured('Hello first.\n\nHello second.')
  const first = plan.root.children[0],
    second = plan.units[1],
    initial = plan.units[0]
  if (!first || !initial?.payload || !second?.payload) throw new Error('Missing prose')
  plan.root.children[1] = first
  const result = reconstructSharedTranslation(
    plan,
    new Map([
      [initial.occurrenceId, 'One'],
      [second.occurrenceId, 'Two'],
    ]),
    limits,
  )
  expect(result.root.children[0]).toMatchObject({ children: [{ value: 'One' }] })
  expect(result.root.children[1]).toMatchObject({ children: [{ value: 'Two' }] })
  expect(result.root.children[0]).not.toBe(result.root.children[1])
  expect(plan.root.children[0]).toBe(plan.root.children[1])
})
it('retains a prior reconstruction unchanged through later output updates', () => {
  const plan = captured('Hello `private`.\n\nSecond.')
  const unit = plan.units[0]
  if (!unit?.payload) throw new Error('Missing prose')
  const first = reconstructSharedTranslation(
      plan,
      new Map([[unit.occurrenceId, unit.payload.text.replace('Hello', '你好')]]),
      limits,
    ),
    prior = canonical(first.root)
  const second = reconstructSharedTranslation(
    plan,
    new Map([[unit.occurrenceId, unit.payload.text.replace('Hello', 'Later')]]),
    limits,
  )
  expect(canonical(first.root)).toBe(prior)
  expect(canonical(second.root)).toContain('Later')
  expect(first.root.children[1]).toBe(second.root.children[1])
})
it.each(['missing', 'invalid', 'large', 'bad-path', 'bad-kind', 'limited'] as const)(
  'preserves exact source for %s units',
  (failure) => {
    const plan = captured('Hello **world**.'),
      unit = plan.units[0]
    if (!unit?.payload) throw new Error('Missing prose')
    const values = outputs(plan)
    if (failure === 'missing') values.clear()
    if (failure === 'invalid') values.set(unit.occurrenceId, 'broken placeholders')
    if (failure === 'large') values.set(unit.occurrenceId, 'x'.repeat(256 * 1024 + 1))
    if (failure === 'bad-path') unit.path = [100]
    if (failure === 'bad-kind') unit.kind = 'heading'
    if (failure === 'limited') {
      unit.error = 'translation-unit-large'
      unit.payload = null
    }
    const actual = reconstructSharedTranslation(plan, values, limits),
      expected = reconstructTranslation(plan, values)
    expect(actual.root).toBe(plan.root)
    expect(actual.statuses).toEqual(expected.statuses)
  },
)
it('admits every allocation before capacity failure and permits retry with the same source', () => {
  const plan = captured('Hello **world** with `code`.\n\n> Hello quote.')
  const original = canonical(plan.root)
  const success = reconstructSharedTranslation(plan, outputs(plan), limits)
  for (const budget of [0, 4096, 10000, success.retainedBytes - 1]) {
    expect(() =>
      reconstructSharedTranslation(plan, outputs(plan), {
        retained: budget,
        staging: limits.staging,
      }),
    ).toThrow('translation-limit')
    expect(canonical(plan.root)).toBe(original)
  }
  expect(() =>
    reconstructSharedTranslation(plan, outputs(plan), {
      retained: limits.retained,
      staging: success.stagingBytes - 1,
    }),
  ).toThrow('translation-limit')
  expect(
    reconstructSharedTranslation(plan, outputs(plan), {
      retained: success.retainedBytes,
      staging: success.stagingBytes,
    }).root,
  ).toEqual(success.root)
  for (const retained of [-1, NaN, Infinity, 1.5])
    expect(() =>
      reconstructSharedTranslation(plan, outputs(plan), { retained, staging: limits.staging }),
    ).toThrow('translation-invalid')
})
it('never clones an untouched deeply nested root or expands its positions', () => {
  const source = `${'> '.repeat(60)}Hello\n\nKeep.`
  const root: Root = parseMarkdown(source).root
  const plan = extractTranslation(root, source)
  const clone = vi.spyOn(globalThis, 'structuredClone')
  try {
    const result = reconstructSharedTranslation({ ...plan, units: [] }, new Map(), limits)
    expect(result.root).toBe(root)
    expect(clone).not.toHaveBeenCalled()
  } finally {
    clone.mockRestore()
  }
})
it('preserves own extension descriptors and safe prototype keys on changed branches', () => {
  const plan = captured('Hello'),
    node = plan.root.children[0]
  if (!node) throw new Error('Missing prose')
  const metadata = Object.freeze({ exact: true }),
    key = Symbol('metadata')
  Object.defineProperty(node, '__proto__', { value: 'safe', enumerable: true })
  Object.defineProperty(node, key, { value: metadata })
  const result = reconstructSharedTranslation(plan, outputs(plan), limits)
  expect(Object.getOwnPropertyDescriptor(result.root.children[0], '__proto__')?.value).toBe('safe')
  expect(Object.getOwnPropertyDescriptor(result.root.children[0], key)?.value).toBe(metadata)
  expect(Object.getPrototypeOf(result.root.children[0])).toBe(Object.prototype)
})
it('preserves protected HTML groups and sibling token reordering without sharing changed prose', () => {
  const source = 'Hello <span title="PRIVATE">hidden <b>body</b></span> with `code` and **bold**.'
  const plan = captured(source),
    unit = plan.units[0]
  if (!unit?.payload) throw new Error('Missing prose')
  const original = canonical(plan.root),
    atom = unit.bindings.find((binding) => Array.isArray(binding.node))
  expect(atom).toBeDefined()
  const actual = reconstructSharedTranslation(plan, outputs(plan), limits),
    expected = reconstructTranslation(plan, outputs(plan))
  expect(canonical(actual.root)).toBe(canonical(expected.root))
  expect(renderMarkdown(actual.root, options).html).toContain(
    '<span title="PRIVATE">hidden <b>body</b></span>',
  )
  const paragraph = actual.root.children[0]
  if (paragraph?.type !== 'paragraph' || !Array.isArray(atom?.node))
    throw new Error('Missing protected group')
  for (const node of atom.node) expect(paragraph.children).toContain(node)
  expect(canonical(plan.root)).toBe(original)

  const reordered = captured('Read **bold `code`** and [link](https://private.invalid).'),
    first = reordered.units[0]
  if (!first?.payload) throw new Error('Missing reorder prose')
  const values = new Map([[first.occurrenceId, '⟪M3⟫链接⟪M4⟫，阅读 ⟪M0⟫加粗 ⟪M1⟫⟪M2⟫。']])
  const shared = reconstructSharedTranslation(reordered, values, limits),
    cloned = reconstructTranslation(reordered, values)
  expect(shared.statuses[0]?.status).toBe('translated')
  expect(canonical(shared.root)).toBe(canonical(cloned.root))
})
describe('shared reconstruction preserves complete CommonMark values', () => {
  it.each(examples)('$example: $section', (example) => {
    const root = parseMarkdown(example.markdown, 'commonmark').root,
      plan = extractTranslation(root, example.markdown)
    const values = new Map(plan.units.map((unit) => [unit.occurrenceId, unit.payload?.text]))
    const actual = reconstructSharedTranslation(plan, values, limits),
      expected = reconstructTranslation(plan, values)
    expect(canonical(actual.root)).toBe(canonical(expected.root))
    expect(actual.statuses).toEqual(expected.statuses)
    expect(renderMarkdown(actual.root, options).html).toBe(
      renderMarkdown(expected.root, options).html,
    )
  })
})
