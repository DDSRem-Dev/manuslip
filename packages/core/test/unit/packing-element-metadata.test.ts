import { expect, it, vi } from 'vitest'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { PackedMetadataBudget } from '../../src/packing-metadata-budget'
import type { PackedElementCursor } from '../../src/packing-segment-steps'
import {
  elementSteps,
  elements,
  offsetNode,
  type PackedNode,
  type PackedSegment,
  PackedView,
  rangeSegment,
} from '../../src/packing-view'

const limits = { bytes: 8 * 1024 * 1024, retained: 16 * 1024 * 1024, staging: 8 * 1024 * 1024 }
const open = (value: unknown) => PackedArena.open(packValue(value, limits.bytes), limits)
const point = (offset: number) => ({ line: 7, column: 11, offset })
const values = Array.from({ length: 4 }, (_, index) => ({
  index,
  from: index + 10,
  to: index + 12,
  text: `value-${index}😀`,
  position: { start: point(index + 10), end: point(index + 12) },
  nested: { position: { start: point(index + 10), end: point(index + 12) } },
}))
const names = [
  'arena',
  'segmented',
  'shifted',
  'ranged',
  'mixed',
  'singletons',
  'sliced',
  'empty',
  'zero-segments',
  'zero-length',
  'deep-shift',
] as const
type Name = (typeof names)[number]
function fixture(name: Name) {
  const arena = open(name === 'empty' || name === 'zero-length' ? [] : values)
  let reads = 0
  let segments: readonly PackedSegment[] = Array.from({ length: 1025 }, () =>
    Object.freeze({ arena, id: arena.root, from: 0, length: 4 }),
  )
  if (name === 'singletons') {
    const ids = [...arena.elements(arena.root)]
    segments = ids.map((id) => Object.freeze({ value: { arena, id }, length: 1 as const }))
  } else if (name === 'ranged' || name === 'mixed')
    segments = segments.map((segment) => rangeSegment(segment, 9))
  else if (name === 'zero-segments') segments = []
  else if (name === 'zero-length')
    segments = Array.from({ length: 1025 }, () => ({ arena, id: arena.root, from: 0, length: 0 }))
  else if (name === 'sliced') {
    const large = open(Array.from({ length: 4097 }, (_, index) => ({ ...values[0], index })))
    segments = [{ arena: large, id: large.root, from: 4000, length: 97 }]
  }
  const observed = new Proxy(Object.freeze(segments), {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++
      return Reflect.get(target, key, receiver)
    },
  })
  let node: PackedNode = Object.freeze({
    segments: observed,
    length: segments.reduce((sum, segment) => sum + segment.length, 0),
  })
  if (name === 'arena' || name === 'empty') node = { arena, id: arena.root }
  else if (name === 'shifted' || name === 'mixed') node = offsetNode(node, 31)
  else if (name === 'deep-shift') {
    node = { segments: observed.slice(0, 1), length: 4 }
    for (let index = 0; index < 1025; index++) node = { shifted: node, offset: 1 }
  }
  return {
    node,
    reads: () => reads,
    reset: () => {
      reads = 0
    },
  }
}
function read(view: PackedView): unknown {
  switch (view.kind()) {
    case 'scalar':
      return view.scalar()
    case 'position':
      return view.position()
    case 'array':
      return [...view.elements()].map(read)
    case 'object':
      return Object.fromEntries(view.keys().map((key) => [key, read(view.at([key]))]))
  }
}
function probe() {
  let reads = 0,
    opened = 0,
    closed = 0
  const original = PackedArena.prototype.elements
  const spy = vi.spyOn(PackedArena.prototype, 'elements').mockImplementation(function* (
    this: PackedArena,
    id: number,
  ) {
    opened++
    try {
      for (const value of original.call(this, id)) {
        reads++
        yield value
      }
    } finally {
      closed++
    }
  })
  return { reads: () => reads, open: () => opened - closed, close: () => spy.mockRestore() }
}

function cursorSteps(cursor: PackedElementCursor<PackedView>) {
  return {
    next: () => cursor.steps.next(),
    return() {
      try {
        return cursor.steps.return(undefined)
      } finally {
        cursor.revoke()
      }
    },
    throw(error: unknown) {
      try {
        return cursor.steps.throw(error)
      } finally {
        cursor.revoke()
      }
    },
  }
}
function traversal(mode: 'node' | 'view' | 'cursor', node: PackedNode) {
  if (mode === 'node') return elementSteps(node)
  const view = new PackedView(node)
  return mode === 'view' ? view.elementSteps() : cursorSteps(view.elementCursor())
}

for (const mode of ['node', 'view', 'cursor'] as const)
  it.each(names)(`lazily preserves complete ${mode} values for %s metadata`, (name) => {
    const input = fixture(name),
      expected = [...elements(input.node)].map((node) => read(new PackedView(node)))
    input.reset()
    const measured = probe()
    try {
      const work = traversal(mode, input.node)
      expect(input.reads()).toBe(0)
      expect(measured.reads()).toBe(0)
      const result: unknown[] = []
      let pauses = 0
      while (true) {
        const before = input.reads() + measured.reads(),
          step = work.next()
        expect(input.reads() + measured.reads() - before).toBeLessThanOrEqual(256)
        if (step.done) break
        if (step.value === undefined) pauses++
        else
          result.push(
            read(step.value instanceof PackedView ? step.value : new PackedView(step.value)),
          )
      }
      expect(result).toEqual(expected)
      expect(measured.open()).toBe(0)
      if (name !== 'arena' && name !== 'empty' && name !== 'zero-segments' && name !== 'singletons')
        expect(pauses).toBeGreaterThan(3)
      expect([...elements(input.node)].map((node) => read(new PackedView(node)))).toEqual(expected)
    } finally {
      measured.close()
    }
  })

it('shares an existing quota before the first metadata or reference read', () => {
  const input = fixture('segmented'),
    budget = new PackedMetadataBudget(),
    measured = probe()
  for (let index = 0; index < 256; index++) budget.advance()
  const work = elementSteps(input.node, budget)
  try {
    expect(work.next()).toEqual({ done: false, value: undefined })
    expect(input.reads()).toBe(0)
    expect(measured.reads()).toBe(0)
    expect(work.next().value).toBeDefined()
    expect(input.reads()).toBe(1)
    expect(measured.reads()).toBe(1)
  } finally {
    work.return()
    measured.close()
  }
})

for (const mode of ['node', 'view', 'cursor'] as const)
  for (const name of ['segmented', 'shifted', 'sliced', 'zero-length', 'deep-shift'] as const)
    for (const action of ['return', 'throw'] as const)
      it(`closes suspended ${mode} ${name} metadata and references on ${action}`, () => {
        const input = fixture(name),
          measured = probe()
        const work = traversal(mode, input.node)
        try {
          for (let index = 0; index < 3; index++) expect(work.next().done).toBe(false)
          if (action === 'return') work.return()
          else expect(() => work.throw(new Error('cancel metadata'))).toThrow('cancel metadata')
          const reads = input.reads() + measured.reads()
          expect(work.next()).toEqual({ done: true, value: undefined })
          expect(input.reads() + measured.reads()).toBe(reads)
          expect(measured.open()).toBe(0)
        } finally {
          work.return()
          measured.close()
        }
      })

for (const mode of ['node', 'view', 'cursor'] as const)
  it(`does not touch late ${mode} metadata before the first item and closes on a late error`, () => {
    const arena = open(values),
      segments: PackedSegment[] = Array.from({ length: 1025 }, () => ({
        arena,
        id: arena.root,
        from: 0,
        length: 4,
      }))
    Object.defineProperty(segments, 1024, {
      get() {
        throw new Error('late metadata')
      },
    })
    const node: PackedNode = { shifted: { segments, length: 4100 }, offset: 3 },
      measured = probe()
    const work = traversal(mode, node)
    try {
      expect(work.next().value).toBeDefined()
      expect(() => {
        while (!work.next().done) {
          /* Read through the complete selected array. */
        }
      }).toThrow('late metadata')
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(measured.open()).toBe(0)
    } finally {
      work.return()
      measured.close()
    }
  })
