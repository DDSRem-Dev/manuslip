import { EditMap } from 'micromark-util-edit-map'
import { expect, it } from 'vitest'

type Event = Parameters<EditMap['consume']>[0][number]
type Change = EditMap['map'][number]
const context = Object.freeze({}) as Event[2]
function event(offset: number): Event {
  return [
    'enter',
    {
      type: 'data',
      start: { line: 1, column: offset + 1, offset, _bufferIndex: offset, _index: 0 },
      end: {
        line: 1,
        column: offset + 2,
        offset: offset + 1,
        _bufferIndex: offset + 1,
        _index: 0,
      },
    },
    context,
  ]
}

/** Original 1.0.0 consume semantics, including its full prefix replay. Keeping this
 * independent oracle makes overlap and insertion order observable after the backport.
 */
function original(source: Event[], changes: readonly Change[]): Event[] {
  const result = source.slice()
  const chunks: Event[][] = []
  for (const [at, remove, add] of [...changes].sort((a, b) => b[0] - a[0])) {
    chunks.push(result.slice(at + remove), add)
    result.length = at
  }
  chunks.push(result.slice())
  result.length = 0
  for (let index = chunks.length - 1; index >= 0; index--)
    for (const value of chunks[index] ?? []) result.push(value)
  return result
}

function verify(map: EditMap, events: Event[]): void {
  const expected = original(events, map.map)
  expect(map.consume(events)).toBeUndefined()
  expect(events).toEqual(expected)
  expect(events.every((value, index) => value === expected[index])).toBe(true)
  expect(map.map).toHaveLength(0)
  expect(map.index.size).toBe(0)
}

it('preserves insertion, accumulated removal and addBefore ordering, then reuses the cleared map', () => {
  const map = new EditMap()
  const source = [event(0), event(1), event(2), event(3)]
  const [first, second, before] = [event(4), event(5), event(6)]
  if (!first || !second || !before) throw new Error('Missing test event')
  map.add(1, 1, [first])
  map.add(1, 1, [second])
  map.addBefore(1, 0, [before])
  const expected = [source[0], before, first, second, source[3]]
  verify(map, source)
  expect(source).toEqual(expected)
  for (let index = 0; index < 3; index++) {
    map.addBefore(0, 0, [event(7 + index)])
    map.add(source.length, 0, [event(10 + index)])
    verify(map, source)
  }
  verify(map, source)
})

it('preserves additions inside overlapping removals and keeps the same event-array identity', () => {
  const map = new EditMap()
  const source = Array.from({ length: 6 }, (_, index) => event(index))
  const reference = source
  const a = event(7),
    b = event(8)
  const expected = [source[0], a, b, source[4], source[5]]
  map.add(1, 3, [a])
  map.add(3, 1, [b])
  verify(map, source)
  expect(source).toBe(reference)
  expect(source).toEqual(expected)
})

it('matches original dense-array semantics across seeded unordered and overlapping edits', () => {
  let seed = 0x6d2b79f5
  const random = (size: number) => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) % size
  }
  for (let attempt = 0; attempt < 1000; attempt++) {
    const source = Array.from({ length: random(80) }, (_, index) => event(index))
    const map = new EditMap()
    for (let index = 0, count = random(24); index < count; index++) {
      const at = random(source.length + 1)
      const remove = random(source.length - at + 1)
      const add = Array.from({ length: random(6) }, () => event(random(1000)))
      if (random(2)) map.add(at, remove, add)
      else map.addBefore(at, remove, add)
    }
    verify(map, source)
  }
})

it('handles a large untouched prefix and insertions above the native argument-count limit', () => {
  const source = new Array<Event>(200000).fill(event(0))
  const map = new EditMap()
  map.add(199999, 1, new Array<Event>(150000).fill(event(1)))
  verify(map, source)
  expect(source).toHaveLength(349999)
  map.add(0, source.length, [])
  verify(map, source)
  map.addBefore(0, 0, [event(2)])
  verify(map, source)
  expect(source).toHaveLength(1)
})
