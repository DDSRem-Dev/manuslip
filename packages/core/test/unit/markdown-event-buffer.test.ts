import { expect, it } from 'vitest'
import { MarkdownEventBudget, MarkdownEventBuffer } from '../../src/markdown-event-buffer'

function finish<T>(steps: Generator<void, T>): T {
  while (true) {
    const next = steps.next()
    if (next.done) return next.value
  }
}

it('matches native array edits across 2,048 seeded gap movements, copies and replacements', () => {
  let state = 0x5eeda11
  const random = (maximum: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state % maximum
  }
  const buffer = new MarkdownEventBuffer<number>()
  const budget = new MarkdownEventBudget()
  const model = Array.from({ length: 1025 }, (_, index) => index)
  finish(buffer.load(model, budget))
  try {
    for (let edit = 0; edit < 2048; edit++) {
      const at = random(model.length + 1)
      const count = random(Math.min(70, model.length - at) + 1)
      const inserted = Array.from({ length: random(74) }, () => random(100000))
      model.splice(at, count, ...inserted)
      finish(buffer.splice(at, count, inserted, budget))
      expect(buffer.length).toBe(model.length)
      expect(finish(buffer.slice(0, buffer.length, budget))).toEqual(model)
      const from = random(model.length + 1)
      const to = from + random(model.length - from + 1)
      expect(finish(buffer.slice(from, to, budget, [-1]))).toEqual([-1, ...model.slice(from, to)])
    }
  } finally {
    buffer.close()
  }
})

it('shares the element quota across successive operations before reading insertion arrays', () => {
  const buffer = new MarkdownEventBuffer<number>()
  const budget = new MarkdownEventBudget()
  let reads = 0
  const items = new Proxy(
    Array.from({ length: 4097 }, (_, index) => index),
    {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++
        return Reflect.get(target, key, receiver)
      },
    },
  )
  function* sequence() {
    yield* buffer.load(items, budget)
    yield* buffer.splice(0, 4000, items, budget)
    yield* buffer.splice(buffer.length, 0, items, budget)
  }
  const steps = sequence()
  let pauses = 0
  try {
    while (true) {
      const before = reads
      const next = steps.next()
      expect(reads - before).toBeLessThanOrEqual(256)
      if (next.done) break
      pauses++
    }
    expect(reads).toBe(4097 * 3)
    expect(pauses).toBeGreaterThanOrEqual(Math.floor(reads / 256))
  } finally {
    steps.return(undefined)
    buffer.close()
  }
})

it.each(['return', 'throw'] as const)('revokes a partially moved gap on %s', (cancel) => {
  const buffer = new MarkdownEventBuffer<number>()
  const budget = new MarkdownEventBudget()
  const items = Array.from({ length: 4097 }, (_, index) => index)
  finish(buffer.load(items, budget))
  const steps = buffer.splice(0, 4000, [42], budget)
  expect(steps.next().done).toBe(false)
  if (cancel === 'throw') {
    const reason = new Error('cancel gap movement')
    expect(() => steps.throw(reason)).toThrow(reason)
  } else steps.return(undefined)
  expect(() => buffer.length).toThrow('Closed Markdown event buffer')
  expect(() => buffer.get(0)).toThrow('Closed Markdown event buffer')
  expect(steps.next().done).toBe(true)
  expect(items).toHaveLength(4097)
})
