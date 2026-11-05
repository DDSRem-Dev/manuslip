import { expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packStreamedValueSteps, packValue } from '../../src/packing'
import { PackedEncodingBudget } from '../../src/packing-encode-budget'
import { PackedCaptureInput } from '../../src/packing-input-capture'
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
      documentId: 'captured-shapes',
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
  return { owner, capture }
}

it.each([
  (index: number) => ({ a: index }),
  (index: number) => (index % 2 ? { b: index } : { a: index }),
  (index: number) => ({ [`field${index % 7}`]: index }),
  (index: number) => (index % 2 ? { a: index, b: true } : { b: false, a: index }),
  (index: number) => ({ ['__proto__']: index, constructor: index + 1 }),
  (index: number) => ({ '"\\\n界😀': index }),
  (index: number) => ({ '7': index, '2': index + 1, value: index }),
  (index: number) => (index % 2 ? {} : { nested: { value: index } }),
])('preserves canonical ordered key spelling through repeated and evicted shapes %#', (make) => {
  const value = Array.from({ length: 80 }, (_, index) => make(index))
  const { owner, capture } = fixture(value)
  const baseline = owner.stats
  const input = new PackedCaptureInput(capture, true)
  try {
    expect(
      finishPackedSteps(
        packStreamedValueSteps(input.at(), limits.bytes, encoding, [], undefined, [input]),
      ),
    ).toEqual(packValue(value, limits.bytes, encoding))
    expect(owner.stats).toEqual(baseline)
  } finally {
    input.return()
    capture.release()
    owner.dispose()
  }
})

it('shares canonical shapes across arenas with different shape numbers and key arrays', () => {
  const left = Array.from({ length: 40 }, (_, a) => ({ a, b: { value: a } }))
  const right = Array.from({ length: 40 }, (_, a) => ({ b: { value: a }, a }))
  const { owner, capture } = fixture(left)
  const second = finishPackedSteps(
    owner.stageFullSteps(
      owner.beginPrepared(capture.sourceResource),
      packValue(right, limits.bytes),
    ),
  )
  if (!second) throw new Error('Missing second capture')
  const baseline = owner.stats
  const firstInput = new PackedCaptureInput(capture, true)
  const secondInput = new PackedCaptureInput(second, true)
  try {
    expect(
      finishPackedSteps(
        packStreamedValueSteps(
          [firstInput.at(), secondInput.at(), firstInput.at()],
          limits.bytes,
          encoding,
          [],
          undefined,
          [firstInput, secondInput],
        ),
      ),
    ).toEqual(packValue([left, right, left], limits.bytes, encoding))
    expect(owner.stats).toEqual(baseline)
  } finally {
    firstInput.return()
    secondInput.return()
    second.release()
    capture.release()
    owner.dispose()
  }
})

it.each(['deny', 'close'] as const)(
  'retains key admission and revocation on a shape hit: %s',
  (mode) => {
    const { owner, capture } = fixture([{ a: 1 }, { a: 2 }])
    const baseline = owner.stats
    const input = new PackedCaptureInput(capture, true)
    const original = PackedEncodingBudget.prototype.keys
    let visits = 0
    const keys = vi.spyOn(PackedEncodingBudget.prototype, 'keys').mockImplementation(function (
      this: PackedEncodingBudget,
      fields,
    ) {
      const bytes = original.call(this, fields)
      if (++visits === 2) {
        if (mode === 'deny') throw new Error('shape admission denied')
        input.return()
      }
      return bytes
    })
    const work = packStreamedValueSteps(input.at(), limits.bytes, encoding, [], undefined, [input])
    try {
      expect(() => finishPackedSteps(work)).toThrow(
        mode === 'deny' ? /shape admission denied/ : /released|cancelled/,
      )
      expect(visits).toBe(2)
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(owner.stats).toEqual(baseline)
    } finally {
      keys.mockRestore()
      work.return()
      input.return()
      capture.release()
      owner.dispose()
    }
  },
)

it.each([1, 40, 100])('releases ownership after cancellation at progress point %i', (stop) => {
  const value = Array.from({ length: 200 }, (_, value) => ({ value, nested: { a: value } }))
  const { owner, capture } = fixture(value)
  const baseline = owner.stats
  const input = new PackedCaptureInput(capture, true)
  const work = packStreamedValueSteps(input.at(), limits.bytes, encoding, [], undefined, [input])
  try {
    for (let index = 0; index < stop; index++) expect(work.next().done).toBe(false)
    work.return()
    expect(work.next()).toEqual({ done: true, value: undefined })
    expect(owner.stats).toEqual(baseline)
  } finally {
    work.return()
    input.return()
    capture.release()
    owner.dispose()
  }
})
