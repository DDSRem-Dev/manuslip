import { afterEach, describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../../../../../../packages/core/src/contracts'
import { packValue } from '../../../../../../../packages/core/src/packing'
import {
  type PackedReceived,
  PackedReceiver,
} from '../../../../../../../packages/core/src/packing-receiver'
import { PackedSource } from '../../../../../../../packages/core/src/packing-source'
import { newPackedToken } from '../../../../../../../packages/core/src/packing-token'
import { packedWireVersion } from '../../../../../../../packages/core/src/packing-wire'
import {
  browserRuntime,
  SlicedWork,
  type SliceRuntime,
  type SliceStats,
} from '../../../../../src/renderer/src/semantics/sliced-work'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('schedules optional work at background priority without requesting a foreground yield', async () => {
  const run = vi.fn()
  const postTask = vi.fn(async (callback: () => void) => callback())
  const yieldTask = vi.fn()
  vi.stubGlobal('scheduler', { postTask, yield: yieldTask })
  browserRuntime.deferBackground?.(run)
  await Promise.resolve()
  expect(postTask).toHaveBeenCalledWith(expect.any(Function), { priority: 'background' })
  expect(yieldTask).not.toHaveBeenCalled()
  expect(run).toHaveBeenCalledTimes(1)
})

it.each(['absent', 'without-postTask', 'rejected'])(
  'keeps optional work available with a timer when scheduling is %s',
  async (mode) => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'scheduler',
      mode === 'absent'
        ? undefined
        : mode === 'rejected'
          ? { postTask: () => Promise.reject(new Error('Unavailable scheduler')) }
          : {},
    )
    const run = vi.fn()
    browserRuntime.deferBackground?.(run)
    expect(run).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect(run).toHaveBeenCalledTimes(1)
  },
)

it('surfaces a background callback failure without retrying the failed work', async () => {
  vi.useFakeTimers()
  const failure = new Error('Background work failed')
  const run = vi.fn(() => {
    throw failure
  })
  const errors: (() => void)[] = []
  vi.stubGlobal('queueMicrotask', (callback: () => void) => errors.push(callback))
  vi.stubGlobal('scheduler', { postTask: async (callback: () => void) => callback() })
  browserRuntime.deferBackground?.(run)
  await Promise.resolve()
  await vi.runAllTimersAsync()
  expect(run).toHaveBeenCalledTimes(1)
  expect(errors).toHaveLength(1)
  expect(errors[0]).toThrow(failure)
})

function runtime() {
  let time = 0
  const queued: (() => void)[] = []
  const clock: SliceRuntime = { now: () => time, defer: (run) => queued.push(run) }
  return {
    clock,
    queued,
    spend: (ms: number) => {
      time += ms
    },
  }
}

it.each(['complete', 'cancel', 'invalid', 'reject'] as const)(
  'retains a prepared result until its input barrier settles: %s',
  async (action) => {
    const environment = runtime()
    let valid = true
    let resolve!: () => void
    let reject!: (error: Error) => void
    const barrier = new Promise<void>((done, fail) => {
      resolve = done
      reject = fail
    })
    const value = { prepared: true }
    const options = {
      valid: () => valid,
      beforeComplete: () => barrier,
      discard: vi.fn(),
      complete: vi.fn(),
      finished: vi.fn(),
      failed: vi.fn(),
      measured: vi.fn(),
    }
    const work = new SlicedWork(
      (function* () {
        yield
        return value
      })(),
      options,
      environment.clock,
    )
    work.run()
    expect(options.complete).not.toHaveBeenCalled()
    expect(options.finished).not.toHaveBeenCalled()
    if (action === 'cancel') {
      work.cancel()
      work.cancel()
    }
    if (action === 'invalid') valid = false
    const failure = new Error('Input synchronization failed')
    if (action === 'reject') reject(failure)
    else resolve()
    await barrier.catch(() => {})
    await Promise.resolve()
    if (action === 'complete') {
      expect(options.complete).toHaveBeenCalledExactlyOnceWith(value)
      expect(options.finished).toHaveBeenCalledTimes(1)
      expect(options.discard).not.toHaveBeenCalled()
    } else {
      expect(options.complete).not.toHaveBeenCalled()
      expect(options.finished).not.toHaveBeenCalled()
      expect(options.discard).toHaveBeenCalledExactlyOnceWith(value)
    }
    if (action === 'reject') expect(options.failed).toHaveBeenCalledExactlyOnceWith(failure)
    else expect(options.failed).not.toHaveBeenCalled()
    expect(options.measured).toHaveBeenCalledTimes(1)
  },
)

it.each(['barrier', 'complete'] as const)(
  'keeps prepared ownership explicit when %s throws',
  (stage) => {
    const failure = new Error('Installation failed')
    const value = { prepared: true }
    const options = {
      valid: () => true,
      beforeComplete: () => {
        if (stage === 'barrier') throw failure
        return undefined
      },
      discard: vi.fn(),
      complete: vi.fn(() => {
        throw failure
      }),
      finished: vi.fn(),
      failed: vi.fn(),
      measured: vi.fn(),
    }
    const work = new SlicedWork(
      (function* () {
        yield
        return value
      })(),
      options,
      runtime().clock,
    )
    work.run()
    expect(options.failed).toHaveBeenCalledExactlyOnceWith(failure)
    expect(options.finished).not.toHaveBeenCalled()
    if (stage === 'barrier') {
      expect(options.discard).toHaveBeenCalledExactlyOnceWith(value)
      expect(options.complete).not.toHaveBeenCalled()
    } else {
      expect(options.complete).toHaveBeenCalledExactlyOnceWith(value)
      expect(options.discard).not.toHaveBeenCalled()
    }
  },
)

describe('cooperative preparation work', () => {
  it.each(['complete', 'cancel', 'invalid', 'before-run'] as const)(
    'runs a charged packed receipt through the real scheduler contract: %s',
    (action) => {
      const environment = runtime()
      const MiB = 1024 * 1024
      const limits = {
        bytes: 8 * MiB,
        retained: 16 * MiB,
        staging: 8 * MiB,
        captures: 8,
        readers: 64,
      }
      let closed = 0
      const receiver = new PackedReceiver(limits, function* (capture) {
        try {
          for (const item of capture.reader.elements(['items'])) {
            expect(item.scalar([], limits)).toBe('value')
            environment.spend(1.1)
            yield
          }
        } finally {
          closed++
        }
      })
      try {
        const checked = new PackedSource(
          {
            generation: 1,
            documentId: 'scheduler',
            revision: 0,
            sourceHash: sourceHash('value'),
            parserVersion: 'parser',
            rendererVersion: 'renderer',
            options: 'options',
          },
          'value',
        )
        const ticket = receiver.begin(1, checked)
        const message = {
          protocol: packedWireVersion,
          kind: 'full',
          sequence: 1,
          result: checked.identity,
          requestToken: ticket.requestToken,
          resultToken: newPackedToken(),
          sentAt: 0,
          payload: packValue({ items: ['value', 'value', 'value'] }, 8 * MiB),
          metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
        }
        const handle = receiver.receiveSteps(ticket, message)
        const completed: PackedReceived[] = []
        let valid = true
        let stats: SliceStats | undefined
        const failures: unknown[] = []
        const work = new SlicedWork(
          handle,
          {
            valid: () => valid,
            complete: (value) => completed.push(value),
            finished: (value) => {
              stats = value
            },
            failed: (error) => failures.push(error),
            measured: () => {},
          },
          environment.clock,
        )
        expect(receiver.stats.holds).toBe(2)
        if (action === 'before-run') work.cancel()
        work.run()
        expect(completed).toHaveLength(0)
        expect(receiver.stats.current).toBeNull()
        if (action !== 'before-run') expect(environment.queued).toHaveLength(1)
        if (action === 'cancel') work.cancel()
        if (action === 'invalid') valid = false
        while (environment.queued.length) environment.queued.shift()?.()
        expect(failures).toHaveLength(0)
        expect(receiver.stats).toMatchObject({
          requested: null,
          prepared: null,
          readers: 0,
          holds: 1,
        })
        expect(closed).toBe(action === 'before-run' ? 0 : 1)
        if (action === 'complete') {
          expect(completed).toHaveLength(1)
          expect(stats?.slices).toBe(4)
          const result = completed[0]
          if (result?.kind !== 'accepted') throw new Error('Expected acceptance')
          expect(result.acknowledgement.requestToken).toBe(ticket.requestToken)
          result.capture.release()
        } else {
          expect(completed).toHaveLength(0)
          expect(receiver.stats.current).toBeNull()
        }
      } finally {
        receiver.dispose()
      }
      expect(receiver.stats.retainedBytes).toBe(0)
    },
  )
  it('yields to queued tasks and measures preparation plus the final install', () => {
    const environment = runtime()
    let completed = 0
    let stats: SliceStats | undefined
    const starts: number[] = []
    function* prepare() {
      for (let index = 0; index < 4; index++) {
        environment.spend(0.6)
        yield
      }
      return { answer: 42 }
    }
    const work = new SlicedWork(
      prepare(),
      {
        valid: () => true,
        complete: (value) => {
          expect(value.answer).toBe(42)
          environment.spend(0.2)
          completed++
        },
        finished: (value) => {
          stats = value
        },
        failed: (error) => {
          throw error
        },
        measured: (start) => starts.push(start),
      },
      environment.clock,
    )
    work.run()
    expect(completed).toBe(0)
    expect(environment.queued).toHaveLength(1)
    while (environment.queued.length) environment.queued.shift()?.()
    expect(completed).toBe(1)
    expect(stats?.slices).toBe(3)
    expect(stats?.maxSliceMs).toBeCloseTo(1.2)
    expect(stats?.activeMs).toBeCloseTo(2.6)
    expect(starts).toHaveLength(3)
    work.run()
    expect(completed).toBe(1)
  })

  it.each(['cancel', 'invalid'] as const)('releases an interrupted generator on %s', (reason) => {
    const environment = runtime()
    let valid = true
    let closed = 0
    let completed = false
    function* prepare() {
      try {
        while (true) {
          environment.spend(2)
          yield
        }
      } finally {
        closed++
      }
      return {}
    }
    const work = new SlicedWork(
      prepare(),
      {
        valid: () => valid,
        complete: () => {
          completed = true
        },
        finished: () => {
          throw new Error('Cancelled work finished')
        },
        failed: (error) => {
          throw error
        },
        measured: () => {},
      },
      environment.clock,
    )
    work.run()
    expect(environment.queued).toHaveLength(1)
    if (reason === 'cancel') work.cancel()
    else valid = false
    environment.queued.shift()?.()
    expect(closed).toBe(1)
    expect(completed).toBe(false)
    expect(environment.queued).toHaveLength(0)
    work.cancel()
    expect(closed).toBe(1)
  })

  it('reports preparation and install failures without scheduling more work', () => {
    for (const phase of ['prepare', 'install']) {
      const environment = runtime()
      const failure = new Error(phase)
      const failures: unknown[] = []
      function* prepare() {
        if (phase === 'prepare') throw failure
        yield
        return {}
      }
      new SlicedWork(
        prepare(),
        {
          valid: () => true,
          complete: () => {
            throw failure
          },
          finished: () => {
            throw new Error('Failed work finished')
          },
          failed: (error) => failures.push(error),
          measured: () => {},
        },
        environment.clock,
      ).run()
      expect(failures).toEqual([failure])
      expect(environment.queued).toHaveLength(0)
    }
  })
})
