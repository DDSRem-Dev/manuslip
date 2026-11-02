import { describe, expect, it } from 'vitest'
import { PackedWork } from '../../src/packing-work'

describe('revocable packed work advances', () => {
  it.each([false, true])(
    'releases a suspended resource when cancellation owner cleanup throws (generator throws: %s)',
    (cleanupThrows) => {
      const events: string[] = []
      const ownerFailure = new Error('owner cleanup failed')
      const generatorFailure = new Error('generator cleanup failed')
      let resourceOpen = false
      const work = new PackedWork(
        (function* () {
          resourceOpen = true
          try {
            yield
          } finally {
            resourceOpen = false
            events.push('cleanup')
            if (cleanupThrows) {
              // biome-ignore lint/correctness/noUnsafeFinally: Exercise cleanup error precedence.
              throw generatorFailure
            }
          }
        })(),
        () => {
          events.push('closed')
          throw ownerFailure
        },
      )
      work.next()
      expect(resourceOpen).toBe(true)
      expect(() => work.return()).toThrow(cleanupThrows ? generatorFailure : ownerFailure)
      expect(resourceOpen).toBe(false)
      expect(events).toEqual(['closed', 'cleanup'])
      // The closed handle remains held; cleanup cannot require a later advance.
      work.return()
      expect(events).toHaveLength(2)
      expect(work.next()).toEqual({ done: true, value: undefined })
    },
  )

  it('keeps suspension open, publishes completion once and releases the owner once', () => {
    const events: string[] = []
    const work = new PackedWork(
      (function* () {
        try {
          events.push('start')
          yield
          events.push('finish')
          return 7
        } finally {
          events.push('cleanup')
        }
      })(),
      () => events.push('closed'),
    )
    expect(work.next()).toEqual({ done: false, value: undefined })
    expect(events).toEqual(['start'])
    expect(work.next()).toEqual({ done: true, value: 7 })
    expect(events).toEqual(['start', 'finish', 'cleanup', 'closed'])
    work.return()
    expect(work.next()).toEqual({ done: true, value: undefined })
    expect(events).toEqual(['start', 'finish', 'cleanup', 'closed'])
  })

  it('closes queued work without starting its body', () => {
    const events: string[] = []
    const work = new PackedWork(
      (function* () {
        events.push('started')
        yield
      })(),
      () => events.push('closed'),
    )
    work.return()
    work.return()
    expect(work.next()).toEqual({ done: true, value: undefined })
    expect(events).toEqual(['closed'])
  })

  it('rejects a reentrant advance while letting the suspended work remain usable', () => {
    const work: PackedWork<number> = new PackedWork(
      (function* () {
        expect(() => work.next()).toThrow('Reentrant packed work')
        yield
        return 9
      })(),
      () => {},
    )
    expect(work.next()).toEqual({ done: false, value: undefined })
    expect(work.next()).toEqual({ done: true, value: 9 })
  })

  it.each(['suspend', 'complete'] as const)(
    'revokes immediately during %s and defers generator cleanup until the advance unwinds',
    (phase) => {
      const events: string[] = []
      const cancel = () => work.return()
      const work: PackedWork<number> = new PackedWork(
        (function* () {
          try {
            events.push('start')
            cancel()
            events.push('after cancellation')
            if (phase === 'suspend') yield
            return 42
          } finally {
            events.push('cleanup')
          }
        })(),
        () => events.push('closed'),
      )
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(events).toEqual(['start', 'closed', 'after cancellation', 'cleanup'])
      work.return()
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(events).toHaveLength(4)
    },
  )

  it('releases failed work and preserves its original exception', () => {
    const events: string[] = []
    const failure = new Error('body failed')
    const work = new PackedWork(
      (function* () {
        try {
          yield
          throw failure
        } finally {
          events.push('cleanup')
        }
      })(),
      () => events.push('closed'),
    )
    work.next()
    expect(() => work.next()).toThrow(failure)
    expect(events).toEqual(['cleanup', 'closed'])
    expect(work.next()).toEqual({ done: true, value: undefined })
  })

  it('keeps the reentrancy guard active while inspecting an iterator result', () => {
    const events: string[] = []
    const iterator = (function* () {
      yield
    })()
    const result: IteratorYieldResult<void> = {
      get done(): false {
        expect(() => work.next()).toThrow('Reentrant packed work')
        work.return()
        events.push('result inspected')
        return false
      },
      value: undefined,
    }
    Object.assign(iterator, {
      next: () => result,
      return: () => {
        events.push('cleanup')
        return { done: true, value: undefined } as const
      },
    })
    const work = new PackedWork(iterator, () => events.push('closed'))
    expect(work.next()).toBe(result)
    expect(events).toEqual(['closed', 'result inspected', 'cleanup'])
    expect(work.next()).toEqual({ done: true, value: undefined })
  })

  it.each([false, true])(
    'closes the generator once when owner cleanup throws (generator throws: %s)',
    (cleanupThrows) => {
      const events: string[] = []
      const ownerFailure = new Error('owner cleanup failed')
      const generatorFailure = new Error('generator cleanup failed')
      const iterator = (function* () {
        yield
        return 7
      })()
      iterator.next()
      Object.assign(iterator, {
        return: () => {
          events.push('cleanup')
          if (cleanupThrows) throw generatorFailure
          return { done: true, value: undefined } as const
        },
      })
      const work = new PackedWork(iterator, () => {
        events.push('closed')
        throw ownerFailure
      })
      expect(() => work.next()).toThrow(cleanupThrows ? generatorFailure : ownerFailure)
      expect(events).toEqual(['closed', 'cleanup'])
      work.return()
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(events).toHaveLength(2)
    },
  )
})
