import { expect, it } from 'vitest'
import { type SlideBoundary, slideGroups } from '../../src/slide-groups'

const group = (kinds: SlideBoundary[], maximum?: number) =>
  slideGroups(
    kinds.map((kind, index) => ({ kind, index })),
    (row) => row.kind,
    maximum,
  ).map((rows) => rows.map((row) => row.index))

it('uses thematic breaks as the complete slide plan, ignoring empty edges', () => {
  expect(
    group([
      'break',
      'blank',
      'heading',
      'content',
      'heading',
      'break',
      'break',
      'content',
      'break',
    ]),
  ).toEqual([[2, 3, 4], [7]])
})
it('starts a slide at each level-one heading when explicit breaks are absent', () => {
  expect(group(['blank', 'heading', 'content', 'content', 'heading', 'content'])).toEqual([
    [1, 2, 3],
    [4, 5],
  ])
  expect(group(['content', 'heading', 'content'])).toEqual([[0], [1, 2]])
})
it('keeps opaque content rows, including bilingual pairs, indivisible and in source order', () => {
  const pair = {
    kind: 'heading' as const,
    original: '# Original',
    translation: '# 译文',
    id: 'same',
  }
  const rows = [pair, { ...pair, kind: 'content' as const, id: 'table' }]
  const groups = slideGroups(rows, (row) => row.kind)
  expect(groups).toHaveLength(1)
  expect(groups[0]?.[0]).toBe(pair)
  expect(groups[0]?.[1]).toBe(rows[1])
  expect(rows).toHaveLength(2)
})
it('admits the exact slide count and rejects the next without returning a partial deck', () => {
  const kinds = Array.from({ length: 200 }, () => 'heading' as const)
  expect(group(kinds)).toHaveLength(200)
  expect(() => group([...kinds, 'heading'])).toThrow('presentation-limit')
  expect(group(['heading', 'content'], 1)).toEqual([[0, 1]])
  expect(() => group(['heading', 'heading'], 1)).toThrow('presentation-limit')
})
it('reports empty content instead of presenting an apparently successful empty slide', () => {
  for (const kinds of [[], ['blank'], ['break', 'blank', 'break']] as SlideBoundary[][])
    expect(() => group(kinds)).toThrow('presentation-empty')
})
