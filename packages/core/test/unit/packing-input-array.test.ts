import { describe, expect, it } from 'vitest'
import { packStreamedValueSteps, packValue, packValueSteps, unpackValue } from '../../src/packing'
import { PackedArrayInput } from '../../src/packing-input-array'
import { finishPackedSteps, PackedWork } from '../../src/packing-work'

const MiB = 1024 * 1024
const limits = { working: 32 * MiB, nodes: 800000, depth: 512 }
const input = (values: readonly unknown[]) =>
  new PackedArrayInput(
    (function* () {
      yield* values
    })(),
  )
const pack = (value: unknown, inputs: PackedArrayInput[]) => {
  const result = finishPackedSteps(packStreamedValueSteps(value, 8 * MiB, limits, inputs))
  if (!result) throw new Error('Missing streamed packet')
  return result
}
const caught = (action: () => unknown) => {
  try {
    action()
    return { failed: false, error: undefined }
  } catch (error) {
    return { failed: true, error }
  }
}

describe('owned arrays in complete packed values', () => {
  it('preserves the exact ordinary packet, sharing across native and nested streamed arrays', () => {
    const position = {
      start: { line: 1, column: 2, offset: 1 },
      end: { line: 2, column: 3, offset: 12 },
    }
    const text = `all UTF-16: ${String.fromCharCode(...Array.from({ length: 65536 }, (_, i) => i))}`
    const values = [{ text, position }, null, false, true, 0, -0, -3.5, '', { text, position }]
    const inner = input(values)
    const outer = input([inner, values, { position }, []])
    const expected = [[values, values, { position }, []], values]
    const packet = pack([outer, values], [outer, inner])
    expect(new Uint8Array(packet)).toEqual(new Uint8Array(packValue(expected, 8 * MiB, limits)))
    const decoded = unpackValue(packet, { bytes: 8 * MiB, retained: 32 * MiB, staging: 8 * MiB })
      .value as unknown[][]
    expect(decoded).toEqual(expected)
    expect(decoded[0]?.[0]).toBe(decoded[0]?.[1])
    expect(decoded[0]?.[0]).toBe(decoded[1])
  })

  it.each([[], [1], [[], {}, [], {}], ['x', 'x', 'x']])(
    'preserves the entire ordinary array packet for %j',
    (...values) => {
      const streamed = input(values)
      expect(new Uint8Array(pack(streamed, [streamed]))).toEqual(
        new Uint8Array(packValue(values, 8 * MiB, limits)),
      )
    },
  )

  it('uses a consumed stream again after identity memo eviction without pulling it again', () => {
    let pulls = 0
    const streamed = new PackedArrayInput(
      (function* () {
        pulls++
        yield { value: 'same' }
      })(),
    )
    const middle = Array.from({ length: 4200 }, (_, value) => ({ value }))
    const ordinary = [{ value: 'same' }]
    const packet = pack([streamed, ...middle, streamed], [streamed])
    expect(new Uint8Array(packet)).toEqual(
      new Uint8Array(packValue([ordinary, ...middle, ordinary], 8 * MiB, limits)),
    )
    expect(pulls).toBe(1)
  })

  it.each(['self', 'object', 'array'] as const)('rejects a stream cycle through %s', (kind) => {
    const child = (): unknown =>
      kind === 'self' ? streamed : kind === 'object' ? { child: streamed } : [streamed]
    const streamed = new PackedArrayInput(
      (function* () {
        yield child()
      })(),
    )
    const work = packStreamedValueSteps(streamed, MiB, limits, [streamed])
    expect(() => finishPackedSteps(work)).toThrow('Cyclic packed value')
    expect(work.next()).toEqual({ done: true, value: undefined })
  })

  it('requires explicit stream registration and preserves the ordinary JSON-only contract', () => {
    const streamed = input([1])
    expect(() => finishPackedSteps(packValueSteps(streamed, MiB, limits))).toThrow(
      'Non-JSON packed object',
    )
    expect(() => pack(streamed, [])).toThrow('Non-JSON packed object')
    expect(new Uint8Array(pack(streamed, [streamed]))).toEqual(
      new Uint8Array(packValue([1], MiB, limits)),
    )
  })

  it('admits the registry before claiming sources and validates every claim atomically', () => {
    const first = input([1])
    const consumed = input([2])
    pack(consumed, [consumed])
    expect(() => packStreamedValueSteps(first, MiB, { ...limits, working: 0 }, [first])).toThrow(
      'working limit',
    )
    expect(() => packStreamedValueSteps(first, 3, limits, [first])).toThrow('byte limit')
    expect(() => pack(first, [first, first])).toThrow('Invalid or consumed')
    expect(() => pack(first, [first, consumed])).toThrow('Invalid or consumed')
    expect(() => pack(first, [first, {} as PackedArrayInput])).toThrow('Invalid or consumed')
    expect(new Uint8Array(pack(first, [first]))).toEqual(
      new Uint8Array(packValue([1], MiB, limits)),
    )
    expect(() => pack(first, [first])).toThrow('Invalid or consumed')
  })

  it.each(['nodes', 'depth', 'working', 'wire'] as const)(
    'keeps the existing %s limit for unknown-length sources and closes on rejection',
    (kind) => {
      let closed = false
      let pulls = 0
      const streamed = new PackedArrayInput(
        (function* () {
          try {
            while (true) {
              pulls++
              yield kind === 'wire' ? 'x'.repeat(4096) : 1
            }
          } finally {
            closed = true
          }
        })(),
      )
      const bound = {
        ...limits,
        ...(kind === 'nodes' ? { nodes: 3 } : {}),
        ...(kind === 'depth' ? { depth: 1 } : {}),
        ...(kind === 'working' ? { working: 270000 } : {}),
      }
      const work = packStreamedValueSteps(streamed, kind === 'wire' ? 64 : MiB, bound, [streamed])
      expect(() => finishPackedSteps(work)).toThrow(/limit/)
      expect(pulls).toBeGreaterThan(0)
      expect(closed).toBe(true)
      expect(work.next()).toEqual({ done: true, value: undefined })
    },
  )

  it('yields after pulling a child before validating it, and before accepting final completion', () => {
    const invalid = input([Symbol('not JSON')])
    const work = packStreamedValueSteps(invalid, MiB, limits, [invalid])
    expect(work.next()).toEqual({ done: false, value: undefined })
    expect(() => work.next()).toThrow('Non-JSON packed value')
    let completed = 0
    const empty = new PackedArrayInput((function* () {})(), () => completed++)
    const final = packStreamedValueSteps(empty, MiB, limits, [empty])
    expect(final.next()).toEqual({ done: false, value: undefined })
    expect(completed).toBe(1)
    final.return()
    expect(finishPackedSteps(final)).toBeUndefined()
    expect(completed).toBe(1)
  })

  it.each(['before', 'suspended', 'complete'] as const)(
    'closes opened and unopened revocable sources after %s closure',
    (phase) => {
      const closed: string[] = []
      const source = (name: string) =>
        new PackedArrayInput(
          new PackedWork(
            (function* () {
              yield 1
            })(),
            () => closed.push(name),
          ),
        )
      const first = source('first')
      const unopened = source('unopened')
      const work = packStreamedValueSteps(first, MiB, limits, [first, unopened])
      expect(closed).toEqual([])
      if (phase === 'suspended') work.next()
      if (phase === 'complete') expect(finishPackedSteps(work)).toBeInstanceOf(ArrayBuffer)
      work.return()
      work.return()
      expect(closed).toEqual(['first', 'unopened'])
      expect(work.next()).toEqual({ done: true, value: undefined })
    },
  )

  it('does not publish a prefix after the source is externally revoked', () => {
    const streamed = input([1, 2, 3])
    const work = packStreamedValueSteps(streamed, MiB, limits, [streamed])
    expect(work.next().done).toBe(false)
    streamed.return()
    expect(() => finishPackedSteps(work)).toThrow('Packed array input cancelled')
    expect(work.next()).toEqual({ done: true, value: undefined })
  })

  it.each(['yield', 'complete', 'callback'] as const)(
    'revokes a result when the encoder is cancelled reentrantly during %s',
    (phase) => {
      const closed: string[] = []
      let work: PackedWork<ArrayBuffer>
      const cancel = () => work.return()
      const streamed = new PackedArrayInput(
        new PackedWork(
          (function* () {
            if (phase !== 'callback') cancel()
            if (phase === 'yield') yield { secret: 'unpublished' }
            return 'complete'
          })(),
          () => closed.push('parser'),
        ),
        () => {
          if (phase === 'callback') cancel()
        },
      )
      const unopened = new PackedArrayInput(
        new PackedWork((function* () {})(), () => closed.push('unopened')),
      )
      work = packStreamedValueSteps(streamed, MiB, limits, [streamed, unopened])
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(closed).toEqual(['parser', 'unopened'])
      expect(work.next()).toEqual({ done: true, value: undefined })
    },
  )

  it.each([new Error('cleanup failed'), undefined])(
    'closes every source even if the first cleanup throws %j',
    (failure) => {
      const closed: number[] = []
      const sources = [0, 1, 2].map(
        (index) =>
          new PackedArrayInput(
            new PackedWork(
              (function* () {
                yield index
              })(),
              () => {
                closed.push(index)
                if (index === 0) throw failure
                if (index === 1) throw new Error('secondary cleanup failed')
              },
            ),
          ),
      )
      const work = packStreamedValueSteps(sources[0], MiB, limits, sources)
      work.next()
      expect(caught(() => work.return())).toEqual({ failed: true, error: failure })
      expect(closed).toEqual([0, 1, 2])
      expect(work.next()).toEqual({ done: true, value: undefined })
    },
  )

  it.each([new Error('parser failed'), undefined])(
    'preserves the original source failure %j while closing unopened inputs',
    (failure) => {
      let closed = false
      const first = new PackedArrayInput(
        // biome-ignore lint/correctness/useYield: Exercise failure on the first pull without publishing a value.
        (function* () {
          throw failure
        })(),
      )
      const unopened = new PackedArrayInput(
        new PackedWork((function* () {})(), () => {
          closed = true
          throw new Error('cleanup failed')
        }),
      )
      const work = packStreamedValueSteps(first, MiB, limits, [first, unopened])
      expect(caught(() => finishPackedSteps(work))).toEqual({ failed: true, error: failure })
      expect(closed).toBe(true)
      expect(work.next()).toEqual({ done: true, value: undefined })
    },
  )
})
