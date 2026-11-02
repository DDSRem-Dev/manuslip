import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { PackedItemSteps } from '../../src/packing-capture'
import { inspectPackedNative as inspectMeasured } from '../../src/packing-native-steps'
import { inspectPackedNativeStream } from '../../src/packing-native-stream'
import { PackedSession } from '../../src/packing-session'
import { packedTextStepCost } from '../../src/packing-text-stream'
import { PackedWordBuffer } from '../../src/packing-word-buffer'
import { finishPackedSteps } from '../../src/packing-work'

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const sessionLimits = { ...limits, retained: 64 * MiB, bytes: 8 * MiB, captures: 8, readers: 160 }
function fixture(value: unknown) {
  const owner = new PackedSession(sessionLimits)
  const identity = {
    generation: 1,
    documentId: 'native-steps',
    revision: 0,
    sourceHash: sourceHash('source'),
    parserVersion: 'test',
    rendererVersion: 'test',
    options: 'test',
  }
  owner.commit(
    owner.prepareFull(owner.begin(identity, 'source'), identity, packValue(value, 8 * MiB)),
  )
  return { owner, capture: owner.capture() }
}
function immutable(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) immutable(child)
}

describe.each([
  ['measured', inspectMeasured],
  ['incremental', inspectPackedNativeStream],
] as const)('cooperative transient native inspection (%s)', (_, inspectPackedNative) => {
  it('preserves own descriptors, prototypes and ordering for common and arbitrary records', () => {
    const position = {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 4, offset: 3 },
    }
    const value = [
      { type: 'paragraph', children: [{ type: 'text', value: '界😀', position }], position },
      { type: 'text', value: '', position },
      { type: 'arbitrary', value: [null, false, 7], position: null },
      { position: null, value: 'different order', type: 'text' },
      { type: 'text', value: 'extra field', position, extra: true },
      JSON.parse(
        '{"type":"text","value":"hostile","position":null,"__proto__":{"safe":true},"constructor":"ordinary"}',
      ),
    ]
    const expected = structuredClone(value)
    const freeze = (item: unknown): void => {
      if (item && typeof item === 'object') {
        for (const child of Object.values(item)) freeze(child)
        Object.freeze(item)
      }
    }
    freeze(expected)
    const context = fixture(value)
    let result: unknown
    try {
      finishPackedSteps(
        inspectPackedNative(context.capture, context.capture.reader, limits, function* (copy) {
          result = copy
          yield
        }),
      )
      const compare = (actual: unknown, expected: unknown): void => {
        expect(actual).toEqual(expected)
        if (!actual || typeof actual !== 'object' || !expected || typeof expected !== 'object')
          return
        expect(Object.getPrototypeOf(actual)).toBe(Object.getPrototypeOf(expected))
        expect(Object.keys(actual)).toEqual(Object.keys(expected))
        expect(Object.getOwnPropertyDescriptors(actual)).toEqual(
          Object.getOwnPropertyDescriptors(expected),
        )
        for (const key of Object.keys(expected))
          compare(Reflect.get(actual, key), Reflect.get(expected, key))
      }
      compare(result, expected)
      expect(value).toEqual(expected)
      expect(context.owner.stats.readers).toBe(0)
    } finally {
      context.owner.dispose()
    }
  })

  it('fills common records without invoking inherited setters', () => {
    const value = {
      type: 'root',
      children: [{ type: 'text', value: 'Own slots.', position: null }],
      position: null,
    }
    const context = fixture(value)
    const keys = ['type', 'children', 'position']
    const previous = keys.map((key) => Object.getOwnPropertyDescriptor(Object.prototype, key))
    let result: unknown
    try {
      try {
        for (const key of keys)
          Object.defineProperty(Object.prototype, key, {
            configurable: true,
            set() {
              throw new Error('Inherited setter invoked')
            },
          })
        finishPackedSteps(
          inspectPackedNative(context.capture, context.capture.reader, limits, function* (copy) {
            result = copy
            yield
          }),
        )
      } finally {
        for (const [index, key] of keys.entries()) {
          const descriptor = previous[index]
          if (descriptor) Object.defineProperty(Object.prototype, key, descriptor)
          else Reflect.deleteProperty(Object.prototype, key)
        }
      }
      expect(result).toEqual(value)
      immutable(result)
      expect(context.owner.stats.readers).toBe(0)
    } finally {
      context.owner.dispose()
    }
  })

  it('restores object paths and sibling arrays across deeply mixed containers', () => {
    let value: unknown = JSON.parse('{"__proto__":{"safe":true},"leaf":"界😀\\ud800"}')
    for (let level = 0; level < 20; level++)
      value = {
        before: [false, level],
        wrapped: [{ next: value, empty: [] }, { text: `sibling ${level}` }],
        after: { value: level },
      }
    const context = fixture(value)
    const before = context.owner.stats
    const scalar = vi.spyOn(PackedArena.prototype, 'scalar')
    let inspected = false
    const work = inspectPackedNative(
      context.capture,
      context.capture.reader,
      limits,
      function* (copy) {
        expect(copy).toEqual(value)
        immutable(copy)
        inspected = true
        yield
      },
    )
    try {
      while (true) {
        const reads = scalar.mock.calls.length
        const step = work.next()
        expect(scalar.mock.calls.length - reads).toBeLessThanOrEqual(16)
        if (step.done) break
      }
      expect(inspected).toBe(true)
      expect(context.owner.stats).toEqual(before)
    } finally {
      work.return()
      scalar.mockRestore()
      context.owner.dispose()
    }
  })

  it('preserves independent siblings when arrays, generic objects and common records alternate', () => {
    const value = [
      { before: [{ nested: [1, 2] }], after: { marker: 'first' } },
      [[{ marker: 'second', empty: {} }], [], [null]],
      { type: 'text', value: 'third', position: null },
      { children: [false], marker: 'fourth' },
      [],
      {},
      { type: 'root', children: [{ type: 'text', value: 'last', position: null }], position: null },
    ]
    const context = fixture(value)
    const before = context.owner.stats
    try {
      finishPackedSteps(
        inspectPackedNative(context.capture, context.capture.reader, limits, function* (copy) {
          expect(copy).toEqual(value)
          immutable(copy)
          const output = copy as typeof value
          expect(output[0]).not.toBe(output[3])
          expect(Object.keys(output[2] ?? {})).toEqual(['type', 'value', 'position'])
          expect(Object.keys(output[3] ?? {})).toEqual(['children', 'marker'])
          expect(output[4]).toEqual([])
          expect(output[5]).toEqual({})
          yield
        }),
      )
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })

  it.each(['return', 'dispose'] as const)(
    'stops after completed siblings on %s without reading later siblings',
    (action) => {
      const context = fixture([
        { first: [{ nested: [1, 2] }], empty: {} },
        [[7331, 7332]],
        { later: [99992] },
      ])
      const before = context.owner.stats
      const scalar = vi.spyOn(PackedArena.prototype, 'scalar')
      let inspected = false
      const work = inspectPackedNative(
        context.capture,
        context.capture.reader,
        limits,
        function* () {
          inspected = true
          yield
        },
      )
      try {
        let advances = 0
        while (!scalar.mock.results.some((result) => result.value === 7331)) {
          expect(work.next().done).toBe(false)
          expect(++advances).toBeLessThan(10000)
        }
        expect(scalar.mock.results.some((result) => result.value === 7332)).toBe(false)
        const reads = scalar.mock.calls.length
        if (action === 'return') work.return()
        else context.owner.dispose()
        expect(work.next().done).toBe(true)
        expect(scalar.mock.calls.length).toBe(reads)
        expect(inspected).toBe(false)
        expect(context.owner.stats.readers).toBe(0)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
        if (action === 'return') expect(context.owner.stats).toEqual(before)
      } finally {
        work.return()
        scalar.mockRestore()
        context.owner.dispose()
      }
    },
  )

  it('counts every aliased occurrence and keeps exact node/depth admission at nested frames', () => {
    const leaf = { value: 'leaf' }
    const branch = { first: [leaf, leaf], second: [leaf] }
    const value = [branch, branch]
    const context = fixture(value)
    const before = context.owner.stats
    let inspected = 0
    try {
      for (const [nodes, depth] of [
        [18, 4],
        [19, 3],
        [19, 4],
      ] as const) {
        const work = inspectPackedNative(
          context.capture,
          context.capture.reader,
          { ...limits, nodes, depth },
          function* (copy, cost) {
            expect(copy).toEqual(value)
            expect(cost.nodes).toBe(19)
            inspected++
            yield
          },
        )
        if (nodes === 19 && depth === 4) finishPackedSteps(work)
        else expect(() => finishPackedSteps(work)).toThrow(/node\/depth/)
        expect(context.owner.stats).toEqual(before)
      }
      expect(inspected).toBe(1)
    } finally {
      context.owner.dispose()
    }
  })

  it.each(['error', 'undefined'] as const)(
    'closes all open parent arrays when an inner close throws %s',
    (failure) => {
      const context = fixture([[[[Array.from({ length: 100 }, (_, index) => index)]]]])
      const before = context.owner.stats
      const scalar = vi.spyOn(PackedArena.prototype, 'scalar')
      let inspected = false
      const work = inspectPackedNative(
        context.capture,
        context.capture.reader,
        limits,
        function* () {
          inspected = true
          yield
        },
      )
      let close: ReturnType<typeof vi.spyOn> | undefined
      try {
        let advances = 0
        while (!scalar.mock.calls.length) {
          expect(work.next().done).toBe(false)
          expect(++advances).toBeLessThan(10000)
        }
        expect(inspected).toBe(false)
        const original = PackedItemSteps.prototype.return
        const error = failure === 'error' ? new Error('Inner close failure') : undefined
        let thrown = false
        close = vi.spyOn(PackedItemSteps.prototype, 'return').mockImplementation(function (
          this: PackedItemSteps,
        ) {
          const result = original.call(this)
          if (!thrown) {
            thrown = true
            throw error
          }
          return result
        })
        let caught = false
        try {
          work.return()
        } catch (received) {
          caught = true
          expect(received).toBe(error)
        }
        expect(caught).toBe(true)
        expect(close).toHaveBeenCalledTimes(5)
        expect(work.next().done).toBe(true)
        expect(context.owner.stats).toEqual(before)
      } finally {
        close?.mockRestore()
        scalar.mockRestore()
        work.return()
        context.owner.dispose()
      }
    },
  )

  it('keeps private field paths relative to composed and iterator-owned scopes', () => {
    const position = {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 2, column: 3, offset: 9 },
    }
    const value = {
      left: {
        children: [
          { nested: { text: '界😀\ud800\n'.repeat(1200), position } },
          [{ constructor: { safe: true }, text: 'second' }, null, false],
        ],
      },
      right: { text: 'sibling' },
    }
    const context = fixture({ selected: [value, { text: 'unselected' }], text: 'outside' })
    const before = context.owner.stats
    const items = context.capture.reader.at(['selected']).elementSteps()
    try {
      let item = items.next()
      while (!item.done && item.value === undefined) item = items.next()
      if (item.done || item.value === undefined) throw new Error('fixture')
      const selected = item.value.at(['left']).at([])
      let inspected = false
      finishPackedSteps(
        inspectPackedNative(context.capture, selected, limits, function* (copy) {
          expect(copy).toEqual(value.left)
          immutable(copy)
          inspected = true
          yield
        }),
      )
      expect(inspected).toBe(true)
      items.next()
      expect(() => selected.kind()).toThrow('expired')
      items.return()
      expect(context.owner.stats).toEqual(before)
    } finally {
      items.return()
      context.owner.dispose()
    }
  })

  it.each([1024, 1025])('preserves the per-field path limit for a %i-unit key', (length) => {
    const value = { nested: { ['x'.repeat(length)]: { text: 'complete' } } }
    const context = fixture(value)
    const before = context.owner.stats
    let inspected = false
    const work = inspectPackedNative(
      context.capture,
      context.capture.reader,
      limits,
      function* (copy) {
        expect(copy).toEqual(value)
        inspected = true
        yield
      },
    )
    try {
      if (length === 1024) finishPackedSteps(work)
      else expect(() => finishPackedSteps(work)).toThrow('Invalid packed reader path')
      expect(inspected).toBe(length === 1024)
      expect(context.owner.stats).toEqual(before)
    } finally {
      work.return()
      context.owner.dispose()
    }
  })

  it.each(['complete', 'cancel'] as const)(
    'bounds flat object copying between advances during %s',
    (action) => {
      const value = Object.fromEntries(
        Array.from({ length: 64 }, (_, index) => [`k${index}`, index]),
      )
      const context = fixture(value)
      const before = context.owner.stats
      const scalar = vi.spyOn(PackedArena.prototype, 'scalar')
      let partial = false
      let inspected = false
      const work = inspectPackedNative(
        context.capture,
        context.capture.reader,
        limits,
        function* (copy) {
          expect(copy).toEqual(value)
          immutable(copy)
          inspected = true
          yield
        },
      )
      try {
        while (true) {
          const reads = scalar.mock.calls.length
          const step = work.next()
          expect(scalar.mock.calls.length - reads).toBeLessThanOrEqual(16)
          if (step.done) break
          if (scalar.mock.calls.length > 0 && scalar.mock.calls.length < 64) {
            partial = true
            if (action === 'cancel') {
              work.return()
              break
            }
          }
        }
        expect(partial).toBe(true)
        expect(inspected).toBe(action === 'complete')
        expect(work.next().done).toBe(true)
        expect(context.owner.stats).toEqual(before)
      } finally {
        work.return()
        scalar.mockRestore()
        context.owner.dispose()
      }
    },
  )
  it('streams even a short string after a real packed text edit and preserves its old capture', () => {
    const context = fixture({ text: 'old界😀' })
    const base = context.capture.identity
    const result = { ...base, revision: 1 }
    const payload = packValue('new', limits.staging)
    const record = PackedArena.open(payload.slice(0), sessionLimits).root
    context.owner.commit(
      context.owner.prepareDelta(context.owner.begin(result, 'source'), {
        base,
        baseSource: 'source',
        result,
        payload,
        operations: [{ kind: 'text', path: ['text'], start: 0, remove: 3, record }],
      }),
    )
    const capture = context.owner.capture()
    const before = context.owner.stats
    const collect = vi.spyOn(PackedWordBuffer, 'create')
    try {
      expect(context.capture.reader.cachedText(['text'])).toBe('old界😀')
      expect(capture.reader.cachedText(['text'])).toBeUndefined()
      finishPackedSteps(
        inspectPackedNative(capture, capture.reader, limits, function* (copy) {
          expect(copy).toEqual({ text: 'new界😀' })
          yield
        }),
      )
      expect(collect).toHaveBeenCalledOnce()
      expect(context.owner.stats).toEqual(before)
      expect(context.capture.reader.cachedText(['text'])).toBe('old界😀')
    } finally {
      collect.mockRestore()
      context.owner.dispose()
    }
  })
  it('borrows already admitted short arena strings without allocating collectors or decoders', () => {
    const value = { text: '界😀\ud800\n', kind: 'text', values: ['same', 'same'] }
    const context = fixture(value)
    const before = context.owner.stats
    const collect = vi.spyOn(PackedWordBuffer, 'create')
    const decode = vi.spyOn(PackedArena.prototype, 'stringSteps')
    let inspected = false
    try {
      finishPackedSteps(
        inspectPackedNative(
          context.capture,
          context.capture.reader,
          limits,
          function* (copy, cost) {
            expect(copy).toEqual(value)
            immutable(copy)
            expect(cost.retainedBytes).toBeGreaterThan(value.text.length * 2)
            expect(context.owner.stats.readerStagingBytes).toBe(cost.stagingBytes)
            inspected = true
            yield
            expect(context.capture.reader.cachedText(['text'])).toBe(value.text)
          },
        ),
      )
      expect(inspected).toBe(true)
      expect(collect).not.toHaveBeenCalled()
      expect(decode).not.toHaveBeenCalled()
      expect(context.owner.stats).toEqual(before)
      context.capture.release()
      expect(() => context.capture.reader.cachedText(['text'])).toThrow(/released/)
    } finally {
      collect.mockRestore()
      decode.mockRestore()
      context.owner.dispose()
    }
  })
  it('copies exact values and hostile keys and holds admission throughout suspended inspection', () => {
    const value = JSON.parse(
      '{"__proto__":{"safe":true},"constructor":"own","values":[null,false,0,-2.5,"界😀\\ud800"]}',
    )
    value.position = {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 4, offset: 3 },
    }
    const context = fixture(value)
    const before = context.owner.stats
    let inspected = false
    const work = inspectPackedNative(
      context.capture,
      context.capture.reader,
      limits,
      function* (copy, cost) {
        expect(copy).toEqual(value)
        immutable(copy)
        expect(Object.hasOwn(copy as object, '__proto__')).toBe(true)
        expect(cost.retainedBytes).toBeGreaterThan(0)
        expect(cost.copyStagingBytes).toBeGreaterThan(cost.stagingBytes)
        expect(context.owner.stats.readerStagingBytes).toBe(cost.stagingBytes)
        inspected = true
        yield
        expect(context.owner.stats.readerStagingBytes).toBe(cost.stagingBytes)
      },
    )
    try {
      while (!inspected) expect(work.next().done).toBe(false)
      expect(context.owner.stats.retainedBytes).toBeGreaterThan(before.retainedBytes)
      finishPackedSteps(work)
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })
  it('streams a long scalar without whole-scalar decoding', () => {
    const value = '界😀\ud800\n'.repeat(30000)
    const context = fixture({ value })
    const before = context.owner.stats
    const scalar = vi.spyOn(PackedArena.prototype, 'scalar')
    expect(context.capture.reader.cachedText(['value'])).toBeUndefined()
    let steps = 0
    let peak = 0
    const work = inspectPackedNative(
      context.capture,
      context.capture.reader,
      limits,
      function* (copy) {
        expect(copy).toEqual({ value })
        yield
      },
    )
    try {
      while (!work.next().done) {
        steps++
        peak = Math.max(peak, context.owner.stats.readerStagingBytes)
      }
      expect(steps).toBeGreaterThan(100)
      expect(peak).toBeGreaterThan(value.length * 4)
      expect(peak).toBeLessThan(limits.staging)
      for (const result of scalar.mock.results)
        if (result.type === 'return' && typeof result.value === 'string')
          expect(result.value.length).toBeLessThan(4096)
      expect(context.owner.stats).toEqual(before)
    } finally {
      scalar.mockRestore()
      context.owner.dispose()
    }
  })
  it.each(['retained', 'staging', 'nodes', 'depth'] as const)(
    'rejects %s limits before inspection and restores accounting',
    (field) => {
      const context = fixture({ nested: { text: 'large'.repeat(10000) } })
      const before = context.owner.stats
      let called = false
      const work = inspectPackedNative(
        context.capture,
        context.capture.reader,
        { ...limits, [field]: 1 },
        function* () {
          called = true
          yield
        },
      )
      try {
        expect(() => finishPackedSteps(work)).toThrow()
        expect(called).toBe(false)
        expect(context.owner.stats).toEqual(before)
      } finally {
        context.owner.dispose()
      }
    },
  )
  it('preflights a huge string before native decoding', () => {
    const context = fixture('x'.repeat(500000))
    const spy = vi.spyOn(PackedArena.prototype, 'scalar')
    const before = context.owner.stats
    try {
      expect(() =>
        finishPackedSteps(
          inspectPackedNative(
            context.capture,
            context.capture.reader,
            { ...limits, staging: MiB },
            function* () {
              yield
            },
          ),
        ),
      ).toThrow('workspace')
      expect(spy).not.toHaveBeenCalled()
      expect(context.owner.stats).toEqual(before)
    } finally {
      spy.mockRestore()
      context.owner.dispose()
    }
  })
  it('includes the separately charged live decoder in local staging admission', () => {
    const context = fixture('x'.repeat(100000))
    const before = context.owner.stats
    let reserved = 0
    try {
      finishPackedSteps(
        inspectPackedNative(context.capture, context.capture.reader, limits, function* (_, cost) {
          reserved = cost.copyStagingBytes
          yield
        }),
      )
      // Incremental reservations can round up. The admission boundary is the actual
      // complete output plus collector/decoder cost, independently of that rounding.
      const required =
        16384 + limits.depth * 1024 + 32 + 200000 + PackedWordBuffer.collectionBytes(100000, 100001)
      expect(reserved).toBeGreaterThanOrEqual(required)
      const staging = required + packedTextStepCost.workspace
      expect(() =>
        finishPackedSteps(
          inspectPackedNative(
            context.capture,
            context.capture.reader,
            { ...limits, staging: staging - 1 },
            function* () {
              yield
            },
          ),
        ),
      ).toThrow('workspace')
      expect(context.owner.stats).toEqual(before)
      const work = inspectPackedNative(
        context.capture,
        context.capture.reader,
        { ...limits, staging },
        function* () {
          yield
        },
      )
      while (!work.next().done)
        expect(context.owner.stats.readerStagingBytes).toBeLessThanOrEqual(staging)
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['retained', 'staging'] as const)(
    'fits an exact session %s budget including the live decoder',
    (field) => {
      const value = 'x'.repeat(100000)
      const context = fixture(value)
      const before = context.owner.stats
      const required =
        16384 +
        limits.depth * 1024 +
        32 +
        value.length * 2 +
        PackedWordBuffer.collectionBytes(value.length, value.length + 1)
      // Four reader slots: blocker, inspection work, native workspace and live decoder.
      const blocker = context.capture.workspace(
        field === 'retained'
          ? sessionLimits.retained -
              before.retainedBytes -
              required -
              packedTextStepCost.retained -
              packedTextStepCost.workspace -
              4 * 512
          : 0,
        field === 'staging' ? sessionLimits.staging - required - packedTextStepCost.workspace : 0,
      )
      const blocked = context.owner.stats
      let inspected = false
      try {
        finishPackedSteps(
          inspectPackedNative(context.capture, context.capture.reader, limits, function* (copy) {
            expect(copy).toBe(value)
            inspected = true
            yield
          }),
        )
        expect(inspected).toBe(true)
        expect(context.owner.stats).toEqual(blocked)
        blocker.release()
        expect(context.owner.stats).toEqual(before)
      } finally {
        context.owner.dispose()
      }
    },
  )
  const phases = ['unstarted', 'scan', 'read', 'inspect'] as const
  it.each(
    phases.flatMap((phase) =>
      (['return', 'release', 'dispose'] as const).map((action) => ({ phase, action })),
    ),
  )('releases $phase work on $action without advancing the escaped handle', ({ phase, action }) => {
    const context = fixture({ value: 'x'.repeat(50000) })
    const before = context.owner.stats
    let inspected = false
    const work = inspectPackedNative(context.capture, context.capture.reader, limits, function* () {
      inspected = true
      yield
    })
    try {
      if (phase === 'scan') expect(work.next().done).toBe(false)
      else if (phase !== 'unstarted') {
        let steps = 0
        while (phase === 'inspect' ? !inspected : context.owner.stats.readerStagingBytes < 500000) {
          expect(work.next().done).toBe(false)
          if (++steps > 10000) throw new Error('Missing checkpoint')
        }
      }
      if (action === 'return') work.return()
      else if (action === 'release') context.capture.release()
      else context.owner.dispose()
      expect(context.owner.stats.readers).toBe(0)
      expect(context.owner.stats.readerStagingBytes).toBe(0)
      if (action === 'return') expect(context.owner.stats).toEqual(before)
      expect(work.next().done).toBe(true)
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['throw', 'release'] as const)(
    'unwinds allocated copies when the inspector causes %s',
    (action) => {
      const context = fixture({ value: 'x'.repeat(50000) })
      const before = context.owner.stats
      const work = inspectPackedNative(
        context.capture,
        context.capture.reader,
        limits,
        function* () {
          if (action === 'throw') throw new Error('Inspector failure')
          context.capture.release()
          yield
        },
      )
      try {
        expect(() => finishPackedSteps(work)).toThrow(
          action === 'throw' ? 'Inspector failure' : 'released',
        )
        expect(context.owner.stats.readers).toBe(0)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
        if (action === 'throw') expect(context.owner.stats).toEqual(before)
        expect(work.next().done).toBe(true)
      } finally {
        context.owner.dispose()
      }
    },
  )
  it('revokes inspection when its borrowed item expires', () => {
    const context = fixture([{ value: 'first' }, { value: 'second' }])
    const items = context.capture.reader.elementSteps()
    const first = items.next().value
    if (!first) throw new Error('Missing fixture')
    let inspected = false
    const work = inspectPackedNative(context.capture, first, limits, function* () {
      inspected = true
      yield
    })
    try {
      while (!inspected) expect(work.next().done).toBe(false)
      items.next()
      expect(() => work.next()).toThrow('expired')
      items.return()
      expect(context.owner.stats.readers).toBe(0)
      expect(context.owner.stats.readerStagingBytes).toBe(0)
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['advance', 'return', 'release'] as const)(
    'unwinds when the inspector causes %s of a different capture’s borrowed scope',
    (action) => {
      const context = fixture([{ nested: { value: 'first' } }, { nested: { value: 'second' } }])
      const before = context.owner.stats
      const borrowed = context.capture.retain()
      const items = borrowed.reader.elementSteps()
      const first = items.next().value
      if (!first) throw new Error('Missing fixture')
      const selected = first.at(['nested'])
      let inspected = false,
        closed = false
      const work = inspectPackedNative(context.capture, selected, limits, function* (copy) {
        try {
          expect(copy).toEqual({ value: 'first' })
          inspected = true
          if (action === 'advance') items.next()
          else if (action === 'return') items.return()
          else borrowed.release()
          yield
        } finally {
          closed = true
        }
      })
      try {
        expect(() => finishPackedSteps(work)).toThrow('expired')
        expect(inspected).toBe(true)
        expect(closed).toBe(true)
        expect(work.next().done).toBe(true)
        expect(context.capture.identity.documentId).toBe('native-steps')
        items.return()
        borrowed.release()
        expect(context.owner.stats).toEqual(before)
      } finally {
        borrowed.release()
        context.owner.dispose()
      }
    },
  )
  it.each(['complete', 'cancel'] as const)(
    'forwards real discarded-prefix scans during %s',
    (action) => {
      const value = Array.from({ length: 20000 }, (_, index) => ({ index }))
      const context = fixture(value)
      const base = context.capture.identity
      const result = { ...base, revision: 1 }
      const payload = packValue([], 8 * MiB)
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
      let reads = 0
      let prefix = 0
      const elements = PackedArena.prototype.elements
      const spy = vi.spyOn(PackedArena.prototype, 'elements').mockImplementation(function* (
        this: PackedArena,
        id: number,
      ) {
        for (const item of elements.call(this, id)) {
          reads++
          yield item
        }
      })
      let inspected = false
      const work = inspectPackedNative(capture, capture.reader, limits, function* (copy) {
        expect(copy).toEqual([{ index: 19999 }])
        inspected = true
        yield
      })
      try {
        while (true) {
          const before = reads
          const step = work.next()
          expect(reads - before).toBeLessThanOrEqual(256)
          if (step.done) break
          if (reads - before === 256) {
            prefix++
            if (action === 'cancel') {
              capture.release()
              break
            }
          }
        }
        expect(prefix).toBeGreaterThan(0)
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
    },
  )
})
