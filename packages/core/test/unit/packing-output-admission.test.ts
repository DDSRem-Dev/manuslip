import { describe, expect, it, vi } from 'vitest'
import { packStreamedValueSteps, packValue, packValueSteps } from '../../src/packing'
import { PackedArrayInput, packedArrayPause } from '../../src/packing-input-array'
import { finishPackedSteps, type PackedWork } from '../../src/packing-work'

const MiB = 1024 * 1024
const limits = { working: 32 * MiB, nodes: 800000, depth: 512 }

it('preserves exact array bytes and the data-node allowance across progress-only source advances', () => {
  const stream = new PackedArrayInput(
    (function* () {
      for (let i = 0; i < 1000; i++) yield packedArrayPause
      yield 1
      yield packedArrayPause
      yield 2
    })(),
  )
  const work = packStreamedValueSteps(stream, MiB, { ...limits, nodes: 3, depth: 2 }, [stream])
  const payload = finishPackedSteps(work)
  expect(payload).toEqual(packValue([1, 2], MiB, limits))
})

it('cancels a progress-only source without accepting it as an empty array', () => {
  let closed = false
  const stream = new PackedArrayInput(
    (function* () {
      try {
        while (true) yield packedArrayPause
      } finally {
        closed = true
      }
    })(),
  )
  const work = packStreamedValueSteps(stream, MiB, limits, [stream])
  for (let i = 0; i < 100; i++) expect(work.next().done).toBe(false)
  work.return()
  expect(closed).toBe(true)
  expect(finishPackedSteps(work)).toBeUndefined()
  expect(() => packValue(packedArrayPause, MiB)).toThrow('Non-JSON')
})

describe.each(['native', 'streamed'] as const)('final %s output admission', (mode) => {
  it.each(['complete', 'reject', 'cancel'] as const)(
    'runs admission and a revocation barrier before allocating the result during %s',
    (phase) => {
      const expected = packValue([1, 2], MiB, limits)
      const TypedArray = Uint8Array
      let admitted = false
      let allocations = 0
      let calls = 0
      let work: PackedWork<ArrayBuffer>
      const cancel = () => work.return()
      const failure = new Error('output denied')
      vi.stubGlobal(
        'Uint8Array',
        new Proxy(TypedArray, {
          construct(target, args, newTarget) {
            if (args[0] === expected.byteLength) {
              allocations++
              expect(admitted).toBe(true)
            }
            return Reflect.construct(target, args, newTarget)
          },
        }),
      )
      const admission = (bytes: number) => {
        expect(bytes).toBe(expected.byteLength)
        expect(allocations).toBe(0)
        admitted = true
        calls++
        if (phase === 'reject') throw failure
        if (phase === 'cancel') cancel()
      }
      try {
        if (mode === 'native') work = packValueSteps([1, 2], MiB, limits, admission)
        else {
          const stream = new PackedArrayInput(
            (function* () {
              yield 1
              yield 2
            })(),
          )
          work = packStreamedValueSteps(stream, MiB, limits, [stream], admission)
        }
        if (phase === 'reject') expect(() => finishPackedSteps(work)).toThrow(failure)
        else {
          const result = finishPackedSteps(work)
          if (phase === 'cancel') expect(result).toBeUndefined()
          else expect(result).toEqual(expected)
        }
        expect(calls).toBe(1)
        expect(allocations).toBe(phase === 'complete' ? 1 : 0)
        expect(work.next()).toEqual({ done: true, value: undefined })
      } finally {
        vi.unstubAllGlobals()
      }
    },
  )
})
