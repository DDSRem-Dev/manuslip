import { expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packStreamedValueSteps, packValue } from '../../src/packing'
import { PackedEncodingBudget } from '../../src/packing-encode-budget'
import { PackedCaptureInput } from '../../src/packing-input-capture'
import { PackedRecordCache } from '../../src/packing-record-cache'
import { PackedSession } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'
import { finishPackedSteps } from '../../src/packing-work'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, readers: 160, captures: 8 }
const encoding = { working: 32 * MiB, nodes: 800000, depth: 512 }
function fixture(value: unknown) {
  const owner = new PackedSession(limits)
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'record-alias',
      revision: 0,
      sourceHash: sourceHash(''),
      parserVersion: 'test',
      rendererVersion: 'test',
      options: 'test',
    },
    '',
  )
  const capture = finishPackedSteps(
    owner.stageFullSteps(owner.beginPrepared(source), packValue(value, limits.bytes)),
  )
  if (!capture) throw new Error('Missing capture')
  const baseline = owner.stats
  const input = new PackedCaptureInput(capture, true)
  const root = input.at()
  return {
    owner,
    input,
    baseline,
    root,
    close() {
      input.return()
      capture.release()
      owner.dispose()
    },
  }
}

it('looks up only completed untransformed records without allocating on hits or misses', () => {
  const admit = vi.fn()
  const cache = new PackedRecordCache(admit)
  const token = Object.freeze({})
  expect(cache.untransformed(token, 0)).toBeUndefined()
  expect(admit).not.toHaveBeenCalled()
  const first = cache.slot({ token, record: 0, offset: 0, range: 0 }, false)
  expect(cache.untransformed(token, 0)).toBeUndefined()
  first.chunk[first.index] = 1
  const calls = admit.mock.calls.length
  expect(cache.untransformed(token, 0)).toBe(0)
  expect(cache.untransformed(token, 1024)).toBeUndefined()
  expect(cache.untransformed(Object.freeze({}), 0)).toBeUndefined()
  expect(admit).toHaveBeenCalledTimes(calls)
  cache.clear()
  expect(cache.untransformed(token, 0)).toBeUndefined()
})

it('keeps transformed containers separate while scalar aliases ignore transforms', () => {
  const cache = new PackedRecordCache(() => {})
  const token = Object.freeze({})
  const shifted = cache.slot({ token, record: 1024, offset: 10, range: 20 }, false)
  shifted.chunk[shifted.index] = 101
  expect(cache.untransformed(token, 1024)).toBeUndefined()
  const scalar = cache.slot({ token, record: 2048, offset: 10, range: 20 }, true)
  scalar.chunk[scalar.index] = 202
  expect(cache.untransformed(token, 2048)).toBe(201)
  expect(cache.untransformed(token, 2049)).toBeUndefined()
  cache.clear()
})

it.each([
  null,
  false,
  true,
  0,
  -0,
  0xffffffff,
  -3.5,
  '',
  '\ud800',
  '界😀',
  [],
  {},
  [1, true, null],
  { type: 'text', value: 'same' },
  { start: { line: 1, column: 2, offset: 1 }, end: { line: 2, column: 3, offset: 7 } },
  JSON.parse('{"__proto__":1,"constructor":false,"2":"界"}'),
  '界😀\ud800\\"\n'.repeat(5000),
])('preserves canonical bytes for repeated captured value %#', (value) => {
  const document = { head: value, aliases: Array.from({ length: 100 }, () => value), tail: value }
  const expected = packValue(document, limits.bytes, encoding)
  const state = fixture(document)
  try {
    expect(
      finishPackedSteps(
        packStreamedValueSteps(state.root, limits.bytes, encoding, [], undefined, [state.input]),
      ),
    ).toEqual(expected)
    expect(state.owner.stats).toEqual(state.baseline)
  } finally {
    state.close()
  }
})

it.each([602, 603])('charges every alias against the exact logical node boundary %i', (nodes) => {
  const document = Array.from({ length: 600 }, () => ({ value: 'same', flag: false }))
  const state = fixture(document)
  const frames = vi.spyOn(PackedEncodingBudget.prototype, 'frame')
  try {
    const run = () =>
      finishPackedSteps(
        packStreamedValueSteps(state.root, limits.bytes, { ...encoding, nodes }, [], undefined, [
          state.input,
        ]),
      )
    if (nodes === 602) expect(run).toThrow('node/depth limit')
    else {
      const actual = run()
      expect(frames.mock.calls.map(([depth]) => depth)).toEqual([
        1,
        2,
        3,
        3,
        ...Array.from({ length: 599 }, () => 2),
      ])
      frames.mockRestore()
      expect(actual).toEqual(packValue(document, limits.bytes, encoding))
    }
    expect(state.owner.stats).toEqual(state.baseline)
  } finally {
    frames.mockRestore()
    state.close()
  }
})

it.each([2, 3])('checks the current depth of a completed alias at depth limit %i', (depth) => {
  const document = { first: {}, nested: { again: {} } }
  const state = fixture(document)
  try {
    const run = () =>
      finishPackedSteps(
        packStreamedValueSteps(state.root, limits.bytes, { ...encoding, depth }, [], undefined, [
          state.input,
        ]),
      )
    if (depth === 2) expect(run).toThrow('node/depth limit')
    else expect(run()).toEqual(packValue(document, limits.bytes, encoding))
    expect(state.owner.stats).toEqual(state.baseline)
  } finally {
    state.close()
  }
})

it('retains every captured-array handoff and bounds logical visits between progress points', () => {
  const document = Array.from({ length: 1000 }, () => ({ value: true }))
  const state = fixture(document)
  const frames = vi.spyOn(PackedEncodingBudget.prototype, 'frame')
  try {
    const work = packStreamedValueSteps(state.root, limits.bytes, encoding, [], undefined, [
      state.input,
    ])
    let steps = 0,
      visits = 0
    while (true) {
      const next = work.next()
      expect(frames.mock.calls.length - visits).toBeLessThanOrEqual(64)
      visits = frames.mock.calls.length
      if (next.done) {
        expect(next.value).toBeInstanceOf(ArrayBuffer)
        break
      }
      steps++
    }
    expect(visits).toBe(1002)
    expect(steps).toBeGreaterThanOrEqual(1000)
    expect(state.owner.stats).toEqual(state.baseline)
  } finally {
    frames.mockRestore()
    state.close()
  }
})

it('retains the complete working charge for a cached child before publishing its parent edge', () => {
  const state = fixture([true, true])
  const original = PackedEncodingBudget.prototype.charge
  let capturedCharges = 0
  const charge = vi.spyOn(PackedEncodingBudget.prototype, 'charge').mockImplementation(function (
    this: PackedEncodingBudget,
    bytes,
  ) {
    if (bytes === 320 && ++capturedCharges === 4) throw new Error('alias admission denied')
    original.call(this, bytes)
  })
  try {
    expect(() =>
      finishPackedSteps(
        packStreamedValueSteps(state.root, limits.bytes, encoding, [], undefined, [state.input]),
      ),
    ).toThrow('alias admission denied')
    expect(capturedCharges).toBe(4)
    expect(state.owner.stats).toEqual(state.baseline)
  } finally {
    charge.mockRestore()
    state.close()
  }
})

it('rechecks the captured scope after reentrant admission closes a cached child', () => {
  const state = fixture([true, true])
  const original = PackedEncodingBudget.prototype.charge
  let capturedCharges = 0
  const charge = vi.spyOn(PackedEncodingBudget.prototype, 'charge').mockImplementation(function (
    this: PackedEncodingBudget,
    bytes,
  ) {
    original.call(this, bytes)
    if (bytes === 320 && ++capturedCharges === 4) state.owner.dispose()
  })
  try {
    const work = packStreamedValueSteps(state.root, limits.bytes, encoding, [], undefined, [
      state.input,
    ])
    expect(() => finishPackedSteps(work)).toThrow()
    expect(work.next()).toEqual({ done: true, value: undefined })
    expect(capturedCharges).toBe(4)
  } finally {
    charge.mockRestore()
    state.close()
  }
})
