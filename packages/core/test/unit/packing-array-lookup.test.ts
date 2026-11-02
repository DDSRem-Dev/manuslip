import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { PackedArrayLookup } from '../../src/packing-array-lookup'
import type { PackedReadScope } from '../../src/packing-capture'
import { PackedSession } from '../../src/packing-session'
import { finishPackedSteps } from '../../src/packing-work'

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, items: 50000 }
const sessionLimits = {
  retained: 64 * MiB,
  staging: 8 * MiB,
  bytes: 8 * MiB,
  captures: 8,
  readers: 160,
}
function fixture(value: unknown) {
  const owner = new PackedSession(sessionLimits)
  const identity = {
    generation: 1,
    documentId: 'array-lookup',
    revision: 0,
    sourceHash: sourceHash('source'),
    parserVersion: 'test',
    rendererVersion: 'test',
    options: 'test',
  }
  owner.commit(
    owner.prepareFull(owner.begin(identity, 'source'), identity, packValue(value, limits.staging)),
  )
  return { owner, capture: owner.capture() }
}

describe('capture-owned cooperative array lookup', () => {
  it.each([0, 1, 60000])('indexes %i plain arena elements with admitted dense IDs', (size) => {
    const { owner, capture } = fixture({
      values: Array.from({ length: size }, (_, i) => ({ value: i })),
    })
    const before = owner.stats
    let escaped: PackedReadScope | undefined
    try {
      finishPackedSteps(
        capture.inspectArray(
          ['values'],
          { retained: MiB, staging: MiB, items: 60000, compact: true },
          function* (lookup, cost) {
            expect(cost.retainedBytes).toBe(16384 + 256 + size * 4)
            expect(lookup.length).toBe(size)
            for (const i of new Set([0, Math.floor(size / 2), size - 1]))
              if (i >= 0 && i < size) {
                const item = lookup.at(i)
                expect(item.scalar(['value'], { retained: 16, staging: 0 })).toBe(i)
                escaped = item
                yield
              }
          },
        ),
      )
      expect(owner.stats).toEqual(before)
      if (escaped) expect(() => escaped?.kind()).toThrow('closed')
    } finally {
      capture.release()
      owner.dispose()
    }
  })
  it.each(['index', 'inspect', 'capture', 'dispose'] as const)(
    'revokes compact array indexing during %s',
    (phase) => {
      const { owner, capture } = fixture({
        values: Array.from({ length: 10000 }, (_, i) => ({ value: i })),
      })
      const before = owner.stats
      let escaped: PackedReadScope | undefined
      const work = capture.inspectArray(
        ['values'],
        { ...limits, compact: true },
        function* (lookup) {
          escaped = lookup.at(9999)
          yield
          throw new Error('resumed')
        },
      )
      try {
        if (phase === 'index') expect(work.next().done).toBe(false)
        else while (!escaped) expect(work.next().done).toBe(false)
        if (phase === 'capture') capture.release()
        else if (phase === 'dispose') owner.dispose()
        else work.return()
        expect(work.next()).toEqual({ done: true, value: undefined })
        expect(owner.stats.readers).toBe(0)
        if (escaped) expect(() => escaped?.kind()).toThrow('closed')
        if (phase === 'index' || phase === 'inspect') expect(owner.stats).toEqual(before)
      } finally {
        work.return()
        capture.release()
        owner.dispose()
      }
    },
  )
  for (const primary of [false, true])
    it.each([false, true])(
      `finishes lookup workspace cleanup with primary=${primary} and undefined=%s`,
      (undefinedFailure) => {
        const { owner, capture } = fixture({ values: [{ value: 1 }, { value: 2 }] })
        const before = owner.stats
        const original = undefinedFailure ? undefined : new Error('Inspection failed')
        const failure = primary || !undefinedFailure ? new Error('Lookup close failed') : undefined
        let lookup: PackedArrayLookup | undefined
        let scope: PackedReadScope | undefined
        const work = capture.inspectArray(['values'], limits, function* (value) {
          lookup = value
          scope = value.at(0)
          yield
          if (primary) throw original
          throw new Error('Cancelled inspection resumed')
        })
        const close = PackedArrayLookup.prototype.close
        let closes = 0
        const rejectClose = vi.spyOn(PackedArrayLookup.prototype, 'close')
        try {
          while (!lookup) expect(work.next().done).toBe(false)
          rejectClose.mockImplementation(function (this: PackedArrayLookup) {
            closes++
            close.call(this)
            throw failure
          })
          let threw = false
          let caught: unknown
          try {
            if (primary) work.next()
            else work.return()
          } catch (error) {
            threw = true
            caught = error
          }
          expect(threw).toBe(true)
          expect(caught).toBe(primary ? original : failure)
          expect(owner.stats).toEqual(before)
          expect(closes).toBe(1)
          expect(() => lookup?.at(0)).toThrow('closed')
          expect(() => scope?.kind()).toThrow('closed')
          expect(work.next()).toEqual({ done: true, value: undefined })
          expect(work.return()).toEqual({ done: true, value: undefined })
          expect(closes).toBe(1)
        } finally {
          rejectClose.mockRestore()
          work.return()
          owner.dispose()
        }
      },
    )

  it.each(['return', 'release', 'dispose'] as const)(
    'closes a nested parent-owned lookup immediately during %s',
    (action) => {
      for (const phase of ['queued', 'indexing', 'inspection'] as const) {
        const context = fixture({ values: [1, 2, 3] })
        const before = context.owner.stats
        let lookup: PackedArrayLookup | undefined
        let scope: PackedReadScope | undefined
        const work = context.capture.work(
          (function* () {
            yield
            yield* context.capture.inspectArraySteps(['values'], limits, function* (value) {
              lookup = value
              scope = value.at(0)
              expect(scope.scalar([], { retained: 16, staging: 0 })).toBe(1)
              yield
              throw new Error('Resumed cancelled nested lookup')
            })
            throw new Error('Resumed cancelled parent')
          })(),
        )
        try {
          if (phase !== 'queued') {
            expect(work.next().done).toBe(false)
            expect(work.next().done).toBe(false)
            expect(context.owner.stats.readerStagingBytes).toBeGreaterThan(0)
          }
          if (phase === 'inspection') while (!lookup) expect(work.next().done).toBe(false)
          if (action === 'return') work.return()
          if (action === 'release') context.capture.release()
          if (action === 'dispose') context.owner.dispose()
          // Inspect cleanup before advancing the retained parent handle again.
          expect(context.owner.stats.readers).toBe(0)
          expect(context.owner.stats.readerStagingBytes).toBe(0)
          if (action === 'return') expect(context.owner.stats).toEqual(before)
          if (lookup) expect(() => lookup?.at(0)).toThrow(/closed/)
          if (scope) expect(() => scope?.kind()).toThrow(/closed|released/)
          expect(work.next().done).toBe(true)
          work.return()
        } finally {
          work.return()
          context.owner.dispose()
        }
      }
    },
  )
  it('uses one admitted index and revokes escaped lookup/read scopes after inspection', () => {
    const context = fixture({ values: Array.from({ length: 1000 }, (_, index) => ({ index })) })
    const before = context.owner.stats
    let escaped: PackedArrayLookup | undefined
    let scope: PackedReadScope | undefined
    const elements = vi.spyOn(PackedArena.prototype, 'elements')
    try {
      finishPackedSteps(
        context.capture.inspectArray(['values'], limits, function* (lookup, cost) {
          escaped = lookup
          expect(lookup.length).toBe(1000)
          expect(context.owner.stats.readerStagingBytes).toBe(cost.stagingBytes)
          const reads = elements.mock.calls.length
          for (const index of [999, 0, 500, 999, 1]) {
            scope = lookup.at(index).at(['index']).at([])
            expect(scope.scalar([], { retained: 16, staging: 0 })).toBe(index)
          }
          expect(elements.mock.calls.length).toBe(reads)
          yield
          expect(lookup.at(999).scalar(['index'], { retained: 16, staging: 0 })).toBe(999)
        }),
      )
      expect(() => escaped?.at(0)).toThrow(/closed/)
      expect(() => scope?.kind()).toThrow(/closed/)
      expect(context.owner.stats).toEqual(before)
    } finally {
      elements.mockRestore()
      context.owner.dispose()
    }
  })
  it.each(['retained', 'staging', 'items'] as const)(
    'preflights %s before array enumeration',
    (key) => {
      const context = fixture({ values: Array.from({ length: 1000 }, (_, index) => index) })
      const before = context.owner.stats
      const elements = vi.spyOn(PackedArena.prototype, 'elements')
      try {
        expect(() =>
          finishPackedSteps(
            context.capture.inspectArray(['values'], { ...limits, [key]: 1 }, function* () {
              yield
            }),
          ),
        ).toThrow(/limit/)
        expect(elements).not.toHaveBeenCalled()
        expect(context.owner.stats).toEqual(before)
      } finally {
        elements.mockRestore()
        context.owner.dispose()
      }
    },
  )
  it('copies path and budgets before its first advance', () => {
    const context = fixture({ values: ['a', 'b'] })
    const path = ['values']
    const budget = { ...limits }
    let inspected = false
    const work = context.capture.inspectArray(path, budget, function* (lookup) {
      expect(lookup.at(1).scalar([], { retained: 64, staging: 64 })).toBe('b')
      inspected = true
      yield
    })
    path[0] = 'missing'
    budget.items = 0
    try {
      finishPackedSteps(work)
      expect(inspected).toBe(true)
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['queued', 'indexing', 'inspection'] as const)(
    'revokes %s work and escaped scopes',
    (phase) => {
      const context = fixture({ values: [1, 2, 3] })
      const before = context.owner.stats
      let lookup: PackedArrayLookup | undefined
      const work = context.capture.inspectArray(['values'], limits, function* (value) {
        lookup = value
        yield
      })
      try {
        if (phase === 'indexing') expect(work.next().done).toBe(false)
        if (phase === 'inspection') while (!lookup) expect(work.next().done).toBe(false)
        work.return()
        expect(work.next().done).toBe(true)
        if (lookup) expect(() => lookup?.at(0)).toThrow(/closed/)
        expect(context.owner.stats).toEqual(before)
      } finally {
        work.return()
        context.owner.dispose()
      }
    },
  )
  it.each(['throw', 'release', 'dispose'] as const)('unwinds inspector %s', (action) => {
    const context = fixture({ values: [1, 2] })
    const before = context.owner.stats
    let lookup: PackedArrayLookup | undefined
    const work = context.capture.inspectArray(['values'], limits, function* (value) {
      lookup = value
      if (action === 'throw') throw new Error('Lookup inspector failed')
      if (action === 'release') context.capture.release()
      if (action === 'dispose') context.owner.dispose()
      yield
      throw new Error('Resumed revoked lookup')
    })
    try {
      expect(() => finishPackedSteps(work)).toThrow(/inspector failed|released/)
      expect(() => lookup?.at(0)).toThrow(/closed/)
      expect(context.owner.stats.readerStagingBytes).toBe(0)
      expect(context.owner.stats.readers).toBe(0)
      if (action === 'throw') expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['complete', 'cancel'] as const)('forwards lazy-prefix progress during %s', (action) => {
    const context = fixture(Array.from({ length: 20000 }, (_, index) => ({ index })))
    const base = context.capture.identity
    const result = { ...base, revision: 1 }
    const payload = packValue([], limits.staging)
    const record = PackedArena.open(payload.slice(0), sessionLimits).root
    context.owner.commit(
      context.owner.prepareDelta(context.owner.begin(result, 'source'), {
        base,
        baseSource: 'source',
        result,
        payload,
        operations: [{ kind: 'splice', path: [], start: 0, remove: 19999, record }],
      }),
    )
    const capture = context.owner.capture()
    const elements = PackedArena.prototype.elements
    let reads = 0
    let prefixes = 0
    let inspected = false
    const spy = vi.spyOn(PackedArena.prototype, 'elements').mockImplementation(function* (
      this: PackedArena,
      id: number,
    ) {
      for (const value of elements.call(this, id)) {
        reads++
        yield value
      }
    })
    const work = capture.inspectArray([], limits, function* (lookup) {
      expect(lookup.length).toBe(1)
      expect(lookup.at(0).scalar(['index'], { retained: 16, staging: 0 })).toBe(19999)
      inspected = true
      yield
    })
    try {
      while (true) {
        const before = reads
        const next = work.next()
        expect(reads - before).toBeLessThanOrEqual(256)
        if (next.done) break
        if (reads - before === 256) {
          prefixes++
          if (action === 'cancel') {
            capture.release()
            break
          }
        }
      }
      expect(prefixes).toBeGreaterThan(0)
      expect(inspected).toBe(action === 'complete')
      expect(work.next().done).toBe(true)
      expect(context.owner.stats.readers).toBe(0)
      expect(context.owner.stats.readerStagingBytes).toBe(0)
      expect(context.capture.reader.length()).toBe(20000)
    } finally {
      work.return()
      spy.mockRestore()
      context.owner.dispose()
    }
  })
})
