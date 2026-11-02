import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { PackedReadScope } from '../../src/packing-capture'
import { copyPackedNative } from '../../src/packing-native-copy'
import { inspectPackedNativeStream } from '../../src/packing-native-stream'
import { PackedSession } from '../../src/packing-session'
import { finishPackedSteps } from '../../src/packing-work'

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const sessionLimits = { ...limits, retained: 64 * MiB, bytes: 8 * MiB, captures: 8, readers: 160 }
const position = {
  start: { line: 2, column: 3, offset: 10 },
  end: { line: 3, column: 4, offset: 20 },
}
function fixture(value: unknown) {
  const owner = new PackedSession(sessionLimits)
  const identity = {
    generation: 1,
    revision: 0,
    documentId: 'native-records',
    sourceHash: sourceHash('source'),
    parserVersion: 'test',
    rendererVersion: 'test',
    options: 'test',
  }
  owner.commit(
    owner.prepareFull(owner.begin(identity, 'source'), identity, packValue(value, 8 * MiB)),
  )
  const capture = owner.capture()
  return { owner, capture }
}
function immutable(value: unknown): void {
  if (!value || typeof value !== 'object') return
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) immutable(child)
}
function inspect(context: ReturnType<typeof fixture>, records: boolean, budget = limits) {
  let result: unknown, cost: unknown
  finishPackedSteps(
    inspectPackedNativeStream(
      context.capture,
      context.capture.reader,
      budget,
      function* (value, plan) {
        result = value
        cost = plan
        immutable(value)
        yield
      },
      records,
    ),
  )
  return { result, cost }
}

describe('guarded record reads during native projection copies', () => {
  it.each([
    null,
    false,
    true,
    0,
    -0,
    -5.5,
    0x100000000,
    '',
    '界😀\ud800\\"\n',
    '界😀\ud800\\"\n'.repeat(10000),
    [],
    {},
    position,
    { before: position, after: [position, false] },
    JSON.parse('{"__proto__":{"safe":true},"constructor":"own","10":3,"2":4}'),
    { type: 'root', children: [{ type: 'text', value: 'value', position }], position },
    { position: null, children: [], type: 'root' },
    { a: [{ b: [1, 2, { c: true }] }, { type: 'text', value: 'last', position: null }], z: [] },
  ])('preserves complete native values and allocation weights for case %#', (value) => {
    const context = fixture(value),
      before = context.owner.stats
    try {
      const native = inspect(context, false),
        records = inspect(context, true)
      expect(records.result).toEqual(value)
      expect(records).toEqual(native)
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })

  it('retains own descriptors and distinct copied identities for equal records', () => {
    const value = { type: 'text', value: 'same', position }
    const context = fixture([value, value, JSON.parse('{"__proto__":{"safe":true}}')])
    try {
      const normal = inspect(context, false).result as object[],
        direct = inspect(context, true).result as object[]
      expect(direct).toEqual(normal)
      expect(direct[0]).not.toBe(direct[1])
      for (const [index, copy] of direct.entries()) {
        expect(Object.getPrototypeOf(copy)).toBe(Object.getPrototypeOf(normal[index]))
        expect(Object.getOwnPropertyDescriptors(copy)).toEqual(
          Object.getOwnPropertyDescriptors(normal[index]),
        )
      }
    } finally {
      context.owner.dispose()
    }
  })

  it('rechecks ownership after admission before constructing any record kind', () => {
    for (const value of [
      null,
      'cached',
      'long'.repeat(10000),
      position,
      [],
      { type: 'text', value: 'x', position },
    ]) {
      const context = fixture(value)
      try {
        const copy = copyPackedNative(
          context.capture.reader,
          undefined,
          () => context.owner.dispose(),
          true,
        )
        expect(() => finishPackedSteps(copy)).toThrow(/released|expired/)
        expect(copy.next().done).toBe(true)
      } finally {
        context.owner.dispose()
      }
    }
  })

  it('keeps the sixteen-value batch bound and stops before later siblings after cancellation', () => {
    const context = fixture({
      before: Array.from({ length: 1000 }, (_, i) => ({ i })),
      after: 99999,
    })
    const records = vi.spyOn(PackedReadScope.prototype, 'encodedRecord')
    let inspected = false
    const work = inspectPackedNativeStream(
      context.capture,
      context.capture.reader,
      limits,
      function* () {
        inspected = true
        yield
      },
      true,
    )
    try {
      for (let step = 0; step < 20; step++) {
        const before = records.mock.calls.length
        expect(work.next().done).toBe(false)
        expect(records.mock.calls.length - before).toBeLessThanOrEqual(16)
      }
      expect(records.mock.results.some((row) => row.value?.value === 99999)).toBe(false)
      const reads = records.mock.calls.length
      work.return()
      expect(work.next().done).toBe(true)
      expect(records.mock.calls.length).toBe(reads)
      expect(inspected).toBe(false)
      expect(context.owner.stats.readers).toBe(0)
    } finally {
      work.return()
      records.mockRestore()
      context.owner.dispose()
    }
  })

  it.each(['nodes', 'depth', 'retained', 'staging'] as const)(
    'keeps complete %s admission failures',
    (restriction) => {
      const context = fixture({ first: [1, { position }], text: '界'.repeat(10000) }),
        before = context.owner.stats
      try {
        expect(() =>
          inspect(context, true, {
            ...limits,
            [restriction]: restriction === 'retained' ? 16384 : 1,
          }),
        ).toThrow(/limit/)
        expect(context.owner.stats).toEqual(before)
      } finally {
        context.owner.dispose()
      }
    },
  )

  it.each(['return', 'release', 'dispose', 'throw'] as const)(
    'closes a suspended text copy on %s',
    (action) => {
      const context = fixture({ text: '界😀'.repeat(10000), later: { value: 99999 } })
      const text = vi.spyOn(PackedReadScope.prototype, 'encodedTextSteps')
      let inspected = false
      const work = inspectPackedNativeStream(
        context.capture,
        context.capture.reader,
        limits,
        function* () {
          inspected = true
          yield
        },
        true,
      )
      try {
        while (!text.mock.calls.length) expect(work.next().done).toBe(false)
        if (action === 'return') work.return()
        else if (action === 'release') context.capture.release()
        else if (action === 'dispose') context.owner.dispose()
        else expect(() => work.throw(new Error('stop native copy'))).toThrow('stop native copy')
        expect(work.next().done).toBe(true)
        expect(context.owner.stats.readers).toBe(0)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
        expect(inspected).toBe(false)
      } finally {
        work.return()
        text.mockRestore()
        context.owner.dispose()
      }
    },
  )

  it('expires the original borrowed scope during native inspection', () => {
    const context = fixture([{ value: 'first' }, { value: 'second' }])
    const items = context.capture.reader.elementSteps(),
      scope = items.next().value
    if (!scope) throw new Error('Missing item')
    let inspected = false
    const work = inspectPackedNativeStream(
      context.capture,
      scope,
      limits,
      function* () {
        inspected = true
        yield
      },
      true,
    )
    try {
      while (!inspected) expect(work.next().done).toBe(false)
      items.next()
      expect(() => work.next()).toThrow(/expired/)
      expect(work.next().done).toBe(true)
    } finally {
      work.return()
      items.return()
      context.owner.dispose()
    }
  })

  it('preserves all position and range transforms in composite revisions', () => {
    const value = {
      nodes: [{ position }, { position }],
      ranges: [
        { from: 10, to: 20 },
        { from: 10, to: 20 },
      ],
    }
    const context = fixture(value),
      base = context.capture.identity,
      result = { ...base, revision: 1 }
    context.owner.commit(
      context.owner.prepareDelta(context.owner.begin(result, 'source'), {
        base,
        baseSource: 'source',
        result,
        payload: packValue(null, 8 * MiB),
        operations: [
          { kind: 'offset', path: ['nodes'], start: 1, offset: 7 },
          { kind: 'range', path: ['ranges'], start: 1, offset: 5 },
        ],
      }),
    )
    const moved = context.owner.capture()
    try {
      const expected = {
        nodes: [
          { position },
          {
            position: {
              start: { ...position.start, offset: 17 },
              end: { ...position.end, offset: 27 },
            },
          },
        ],
        ranges: [
          { from: 10, to: 20 },
          { from: 15, to: 25 },
        ],
      }
      let actual: unknown
      finishPackedSteps(
        inspectPackedNativeStream(
          moved,
          moved.reader,
          limits,
          function* (value) {
            actual = value
            immutable(value)
            yield
          },
          true,
        ),
      )
      expect(actual).toEqual(expected)
    } finally {
      moved.release()
      context.owner.dispose()
    }
  })

  it.each(['complete', 'cancel'] as const)(
    'keeps discarded-prefix scans bounded during %s',
    (action) => {
      const context = fixture(Array.from({ length: 20000 }, (_, index) => ({ index })))
      const base = context.capture.identity,
        result = { ...base, revision: 1 },
        payload = packValue([], 8 * MiB)
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
      const capture = context.owner.capture(),
        original = PackedArena.prototype.elements
      let reads = 0,
        checkpoints = 0,
        inspected = false
      const elements = vi.spyOn(PackedArena.prototype, 'elements').mockImplementation(function* (
        this: PackedArena,
        id,
      ) {
        for (const child of original.call(this, id)) {
          reads++
          yield child
        }
      })
      const work = inspectPackedNativeStream(
        capture,
        capture.reader,
        limits,
        function* (value) {
          expect(value).toEqual([{ index: 19999 }])
          inspected = true
          yield
        },
        true,
      )
      try {
        while (true) {
          const before = reads,
            step = work.next()
          expect(reads - before).toBeLessThanOrEqual(256)
          if (step.done) break
          if (reads - before === 256) {
            checkpoints++
            if (action === 'cancel') {
              capture.release()
              break
            }
          }
        }
        expect(checkpoints).toBeGreaterThan(0)
        expect(inspected).toBe(action === 'complete')
        expect(work.next().done).toBe(true)
        expect(context.owner.stats.readers).toBe(0)
      } finally {
        work.return()
        elements.mockRestore()
        capture.release()
        context.owner.dispose()
      }
    },
  )
})

describe('bounded private array-copy cursors', () => {
  const shapes = [
    Array.from({ length: 257 }, (_, i) => i),
    Array.from({ length: 65 }, (_, i) => ({ children: [i, [i + 1, [i + 2]]], position })),
    Array.from({ length: 257 }, (_, i) => [i % 2 === 0, { value: `text ${i}`, position }, []]),
    Array.from({ length: 33 }, (_, i) =>
      Object.fromEntries(Array.from({ length: 64 }, (_, j) => [`field${j}`, i + j])),
    ),
  ]
  it.each(shapes.map((value) => ({ value })))(
    'preserves the 16-value and 256-reference bounds for shape %#',
    ({ value }) => {
      const context = fixture(value)
      const baseline = context.owner.stats
      const reads = vi.spyOn(PackedReadScope.prototype, 'encodedRecord')
      const refs = vi.spyOn(PackedReadScope.prototype, 'encodedReference')
      const work = copyPackedNative(context.capture.reader, undefined, undefined, true)
      let result: unknown
      try {
        while (true) {
          const before = reads.mock.calls.length,
            beforeRefs = refs.mock.calls.length
          const step = work.next()
          expect(reads.mock.calls.length - before).toBeLessThanOrEqual(16)
          expect(refs.mock.calls.length - beforeRefs).toBeLessThanOrEqual(256)
          if (step.done) {
            result = step.value
            break
          }
        }
        expect(result).toEqual(value)
        immutable(result)
        expect(context.owner.stats).toEqual(baseline)
      } finally {
        work.return(undefined)
        reads.mockRestore()
        refs.mockRestore()
        context.capture.release()
        context.owner.dispose()
      }
    },
  )

  it.each(['cancel', 'release', 'dispose'] as const)(
    'stops before copying later values after %s',
    (action) => {
      const context = fixture(Array.from({ length: 1000 }, (_, i) => ({ value: i })))
      let allocations = 0,
        inspected = false
      const scope = context.capture.reader
      const raw = copyPackedNative(
        scope,
        undefined,
        () => {
          if (++allocations === 25) {
            if (action === 'cancel') work.return()
            else if (action === 'release') context.capture.release()
            else context.owner.dispose()
          }
        },
        true,
      )
      const work = context.capture.work(
        (function* () {
          yield* raw
          inspected = true
        })(),
      )
      try {
        try {
          finishPackedSteps(work)
        } catch (error) {
          expect(String(error)).toMatch(/released|cancelled/)
        }
        if (action === 'cancel') {
          // The active private advance unwinds within its existing sixteen-value batch.
          expect(allocations).toBeGreaterThanOrEqual(25)
          expect(allocations).toBeLessThanOrEqual(25 + 16)
        } else expect(allocations).toBe(25)
        expect(inspected).toBe(false)
        expect(work.next()).toEqual({ done: true, value: undefined })
      } finally {
        work.return()
        context.capture.release()
        context.owner.dispose()
      }
    },
  )

  it.each(['release', 'dispose'] as const)(
    'guards reentrant %s from an indexed setter',
    (action) => {
      const context = fixture([1, 2, 3])
      const NativeArray = globalThis.Array
      let changed = false,
        result: unknown,
        failure: unknown,
        arrays = 0
      const raw = copyPackedNative(context.capture.reader, undefined, undefined, true)
      const ProxyArray = new Proxy(NativeArray, {
        construct(target, args, newTarget) {
          const array = Reflect.construct(target, args, newTarget)
          if (!arrays++)
            Object.setPrototypeOf(
              array,
              Object.create(NativeArray.prototype, {
                0: {
                  set(this: unknown[], value: unknown) {
                    Object.defineProperty(this, '0', {
                      value,
                      writable: true,
                      configurable: true,
                      enumerable: true,
                    })
                    changed = true
                    if (action === 'release') context.capture.release()
                    else context.owner.dispose()
                  },
                  configurable: true,
                },
              }),
            )
          return array
        },
      })
      try {
        globalThis.Array = ProxyArray
        try {
          result = finishPackedSteps(raw)
        } catch (error) {
          failure = error
        }
      } finally {
        globalThis.Array = NativeArray
        raw.return(undefined)
      }
      try {
        expect(changed).toBe(true)
        expect(result).toBeUndefined()
        expect(String(failure)).toMatch(/released/)
      } finally {
        context.capture.release()
        context.owner.dispose()
      }
    },
  )
})
