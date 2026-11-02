import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packStreamedValueSteps, packValue, unpackValue } from '../../src/packing'
import { PackedReadScope } from '../../src/packing-capture'
import { PackedArrayInput } from '../../src/packing-input-array'
import { PackedCaptureInput } from '../../src/packing-input-capture'
import { PackedSession } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'
import { finishPackedSteps } from '../../src/packing-work'

const MiB = 1024 * 1024
const encoding = { working: 32 * MiB, nodes: 800000, depth: 512 }
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, readers: 160, captures: 8 }
function fixture(value: unknown) {
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'input',
      revision: 0,
      sourceHash: sourceHash(''),
      parserVersion: 'test',
      rendererVersion: 'test',
      options: 'test',
    },
    '',
  )
  const owner = new PackedSession(limits)
  const capture = finishPackedSteps(
    owner.stageFullSteps(owner.beginPrepared(source), packValue(value, limits.bytes)),
  )
  if (!capture) throw new Error('Missing capture')
  return { owner, capture }
}
function exact(value: unknown) {
  const { owner, capture } = fixture(value)
  const baseline = owner.stats
  const source = new PackedCaptureInput(capture)
  try {
    const output = finishPackedSteps(
      packStreamedValueSteps(source.at(), limits.bytes, encoding, [], undefined, [source]),
    )
    expect(output).toEqual(packValue(value, limits.bytes, encoding))
    expect(owner.stats).toEqual(baseline)
  } finally {
    source.return()
    capture.release()
    owner.dispose()
  }
}
describe('guarded packed value inputs', () => {
  it('opens later object fields only after the current text has completed', () => {
    const value = { first: '界😀'.repeat(10000), later: { nested: [1, 2, 3] } }
    const { owner, capture } = fixture(value)
    const baseline = owner.stats
    const source = new PackedCaptureInput(capture)
    const root = source.at()
    const fields = vi.spyOn(PackedReadScope.prototype, 'at')
    const reads = vi.spyOn(PackedReadScope.prototype, 'textSteps')
    const work = packStreamedValueSteps(root, limits.bytes, encoding, [], undefined, [source])
    try {
      for (let i = 0; i < 100 && reads.mock.calls.length === 0; i++)
        expect(work.next().done).toBe(false)
      expect(reads).toHaveBeenCalled()
      expect(fields.mock.calls.some(([path]) => path[0] === 'later')).toBe(false)
      expect(finishPackedSteps(work)).toEqual(packValue(value, limits.bytes, encoding))
      expect(fields.mock.calls.some(([path]) => path[0] === 'later')).toBe(true)
      expect(owner.stats).toEqual(baseline)
    } finally {
      work.return()
      fields.mockRestore()
      reads.mockRestore()
      source.return()
      capture.release()
      owner.dispose()
    }
  })

  it.each(['source', 'owner'] as const)(
    'revokes suspended direct children when their %s closes',
    (phase) => {
      const { owner, capture } = fixture({ first: 'x'.repeat(20000), later: { value: 42 } })
      const source = new PackedCaptureInput(capture)
      const root = source.at()
      const fields = vi.spyOn(PackedReadScope.prototype, 'at')
      const reads = vi.spyOn(PackedReadScope.prototype, 'textSteps')
      const work = packStreamedValueSteps(root, limits.bytes, encoding, [], undefined, [source])
      try {
        for (let i = 0; i < 100 && reads.mock.calls.length === 0; i++)
          expect(work.next().done).toBe(false)
        expect(reads).toHaveBeenCalled()
        if (phase === 'source') source.return()
        else owner.dispose()
        expect(() => work.next()).toThrow(/released|cancelled/)
        expect(fields.mock.calls.some(([path]) => path[0] === 'later')).toBe(false)
        expect(work.next()).toEqual({ done: true, value: undefined })
        expect(owner.stats.readers).toBe(0)
      } finally {
        work.return()
        fields.mockRestore()
        reads.mockRestore()
        source.return()
        capture.release()
        owner.dispose()
      }
    },
  )

  it('rejects reentrant source closure while opening a later child', () => {
    const { owner, capture } = fixture({ first: 1, later: { value: 42 } })
    const baseline = owner.stats
    const source = new PackedCaptureInput(capture)
    const root = source.at()
    const original = PackedReadScope.prototype.at
    const fields = vi.spyOn(PackedReadScope.prototype, 'at').mockImplementation(function (
      this: PackedReadScope,
      path,
    ) {
      const result = original.call(this, path)
      if (path[0] === 'later') source.return()
      return result
    })
    const work = packStreamedValueSteps(root, limits.bytes, encoding, [], undefined, [source])
    try {
      expect(() => finishPackedSteps(work)).toThrow(/released|cancelled/)
      expect(owner.stats).toEqual(baseline)
      expect(work.next()).toEqual({ done: true, value: undefined })
    } finally {
      work.return()
      fields.mockRestore()
      source.return()
      capture.release()
      owner.dispose()
    }
  })

  it.each(['root', 'array'] as const)('rejects bare readers in a native %s input', (location) => {
    const { owner, capture } = fixture({ value: 42 })
    const baseline = owner.stats
    const source = new PackedCaptureInput(capture)
    const array = new PackedArrayInput(
      (function* () {
        yield capture.reader
      })(),
    )
    try {
      expect(() =>
        finishPackedSteps(
          packStreamedValueSteps(
            location === 'root' ? capture.reader : array,
            limits.bytes,
            encoding,
            [array],
            undefined,
            [source],
          ),
        ),
      ).toThrow(/Non-JSON packed object/)
      expect(owner.stats).toEqual(baseline)
    } finally {
      array.return()
      source.return()
      capture.release()
      owner.dispose()
    }
  })

  it.each([{ nodes: 6 }, { depth: 3 }])(
    'keeps native and captured object traversal limits equivalent for %j',
    (restriction) => {
      const value = { a: 1, b: { c: [2, 3] }, d: true }
      const { owner, capture } = fixture(value)
      const source = new PackedCaptureInput(capture)
      const fresh = new PackedCaptureInput(capture)
      try {
        const exactBudget = { ...encoding, nodes: 7, depth: 4 }
        expect(
          finishPackedSteps(
            packStreamedValueSteps(source.at(), limits.bytes, exactBudget, [], undefined, [source]),
          ),
        ).toEqual(packValue(value, limits.bytes, exactBudget))
        const budget = { ...exactBudget, ...restriction }
        expect(() => packValue(value, limits.bytes, budget)).toThrow(/node\/depth limit/)
        expect(() =>
          finishPackedSteps(
            packStreamedValueSteps(fresh.at(), limits.bytes, budget, [], undefined, [fresh]),
          ),
        ).toThrow(/node\/depth limit/)
      } finally {
        fresh.return()
        source.return()
        capture.release()
        owner.dispose()
      }
    },
  )

  it('encodes repeated immutable records without reopening their long text for every alias', () => {
    const text = '界😀\\"\n'.repeat(3000)
    const expected = Array.from({ length: 2000 }, () => ({ text, other: text }))
    const { owner, capture } = fixture(expected)
    const source = new PackedCaptureInput(capture)
    const reads = vi.spyOn(PackedReadScope.prototype, 'textSteps')
    try {
      const output = finishPackedSteps(
        packStreamedValueSteps(source.at(), limits.bytes, encoding, [], undefined, [source]),
      )
      expect(reads.mock.calls.length).toBeLessThanOrEqual(4)
      expect(output).toEqual(packValue(expected, limits.bytes, encoding))
    } finally {
      reads.mockRestore()
      source.return()
      capture.release()
      owner.dispose()
    }
  })

  it('keeps record IDs from distinct arenas separate while sharing equal values canonically', () => {
    const { owner, capture } = fixture({ text: 'first', nested: [1, 2, 3] })
    const second = finishPackedSteps(
      owner.stageFullSteps(
        owner.beginPrepared(capture.sourceResource),
        packValue({ text: 'second', nested: [3, 2, 1] }, limits.bytes),
      ),
    )
    if (!second) throw new Error('Missing second capture')
    const firstInput = new PackedCaptureInput(capture)
    const secondInput = new PackedCaptureInput(second)
    try {
      const output = finishPackedSteps(
        packStreamedValueSteps(
          [firstInput.at(), secondInput.at(), firstInput.at(), secondInput.at()],
          limits.bytes,
          encoding,
          [],
          undefined,
          [firstInput, secondInput],
        ),
      )
      expect(output).toEqual(
        packValue(
          [
            { text: 'first', nested: [1, 2, 3] },
            { text: 'second', nested: [3, 2, 1] },
            { text: 'first', nested: [1, 2, 3] },
            { text: 'second', nested: [3, 2, 1] },
          ],
          limits.bytes,
          encoding,
        ),
      )
    } finally {
      firstInput.return()
      secondInput.return()
      second.release()
      capture.release()
      owner.dispose()
    }
  })

  it('keeps lazy position and range transforms separate for aliases of the same arena record', () => {
    const identity = (revision: number) => ({
      generation: 1,
      documentId: 'input-cache',
      revision,
      sourceHash: sourceHash(''),
      parserVersion: 'test',
      rendererVersion: 'test',
      options: 'test',
    })
    const position = {
      start: { line: 1, column: 3, offset: 2 },
      end: { line: 1, column: 4, offset: 3 },
    }
    const node = { type: 'text', value: 'same', position }
    const block = { from: 2, to: 3, nested: { from: 2, to: 3 }, position }
    const original = { nodes: [node, node], blocks: [block, block] }
    const owner = new PackedSession(limits)
    const ticket = owner.begin(identity(0), '')
    owner.commit(owner.prepareFull(ticket, identity(0), packValue(original, limits.bytes)))
    const before = owner.capture()
    const next = owner.begin(identity(1), '')
    owner.commit(
      owner.prepareDelta(next, {
        base: identity(0),
        baseSource: '',
        result: identity(1),
        operations: [
          { kind: 'offset', path: ['nodes'], start: 1, offset: 7 },
          { kind: 'range', path: ['blocks'], start: 1, offset: 5 },
        ],
        payload: packValue(null, limits.bytes),
      }),
    )
    const after = owner.capture()
    const first = new PackedCaptureInput(before)
    const second = new PackedCaptureInput(after)
    try {
      const output = finishPackedSteps(
        packStreamedValueSteps([first.at(), second.at()], limits.bytes, encoding, [], undefined, [
          first,
          second,
        ]),
      )
      expect(output).toEqual(
        packValue(
          [
            original,
            {
              nodes: [
                node,
                {
                  ...node,
                  position: {
                    start: { ...position.start, offset: 9 },
                    end: { ...position.end, offset: 10 },
                  },
                },
              ],
              blocks: [block, { ...block, from: 7, to: 8 }],
            },
          ],
          limits.bytes,
          encoding,
        ),
      )
    } finally {
      first.return()
      second.return()
      before.release()
      after.release()
      owner.dispose()
    }
  })

  it.each([
    null,
    false,
    true,
    0,
    -0,
    -1,
    0xffffffff,
    0x100000000,
    1.25,
    '',
    '界😀\ud800 \udfff\u0000\n"\\',
    [],
    {},
    [[], [], {}, {}],
    {
      position: {
        start: { line: 1, column: 2, offset: 1 },
        end: { line: 2, column: 3, offset: 8 },
      },
      value: 'a',
    },
    {
      array: [1, null, true, { nested: [{ value: 'same' }, { value: 'same' }] }],
      other: [1, null, true, { nested: [{ value: 'same' }, { value: 'same' }] }],
    },
    `${'x'.repeat(4095)}😀${'\ud800\udfff"\n'.repeat(7000)}\ud800`,
  ])('preserves the exact canonical encoding for %j', (value) => exact(value))

  it('shares native, captured and concatenated strings by full content', () => {
    const text = `${'x'.repeat(4095)}😀${'<&\ud800\n'.repeat(2000)}\udfff`
    const { owner, capture } = fixture({ value: text, other: [text] })
    const source = new PackedCaptureInput(capture)
    const array = new PackedArrayInput(
      (function* () {
        yield source.at(['value'])
        yield text
      })(),
    )
    try {
      const joined = source.text(function* () {
        yield text.slice(0, 4096)
        yield
        for (let i = 4096; i < text.length; i += 2048) yield text.slice(i, i + 2048)
      })
      const output = finishPackedSteps(
        packStreamedValueSteps(
          { native: text, captured: source.at(['value']), joined, array, whole: source.at() },
          limits.bytes,
          encoding,
          [array],
          undefined,
          [source],
        ),
      )
      expect(output).toEqual(
        packValue(
          {
            native: text,
            captured: text,
            joined: text,
            array: [text, text],
            whole: { value: text, other: [text] },
          },
          limits.bytes,
          encoding,
        ),
      )
    } finally {
      source.return()
      capture.release()
      owner.dispose()
    }
  })

  it('compares every byte when two distinct canonical strings have the same hash', () => {
    const a = 'v1j1esuh',
      b = 'v08lxrlg'
    const hash = (value: string) => {
      let result = 2166136261
      for (const byte of new TextEncoder().encode(JSON.stringify(value)))
        result = Math.imul(result ^ byte, 16777619) >>> 0
      return result
    }
    expect(hash(a)).toBe(hash(b))
    exact([a, b, a, b])
  })

  it('releases old index tables after growth while preserving exact content interning', () => {
    exact(Array.from({ length: 2500 }, (_, i) => ({ key: `string ${i}`, again: `string ${i}` })))
  })

  it.each(['queued', 'array', 'text', 'admitted', 'source', 'capture', 'dispose'] as const)(
    'revokes open readers and output after %s cancellation',
    (phase) => {
      const { owner, capture } = fixture({
        array: Array.from({ length: 2000 }, (_, i) => ({ i })),
        text: 'x'.repeat(20000),
      })
      const baseline = owner.stats
      const source = new PackedCaptureInput(capture)
      let advances = 0,
        admitted = false
      const text = source.text(function* () {
        try {
          for (let i = 0; i < 20000; i += 1000) {
            advances++
            yield 'x'.repeat(1000)
          }
        } finally {
          advances = -1
        }
      })
      const work = packStreamedValueSteps(
        { array: source.at(['array']), text },
        limits.bytes,
        encoding,
        [],
        () => {
          admitted = true
        },
        [source],
      )
      try {
        if (phase === 'array')
          while (owner.stats.readers === 0) expect(work.next().done).toBe(false)
        if (['text', 'source', 'capture', 'dispose'].includes(phase))
          while (advances === 0) expect(work.next().done).toBe(false)
        if (phase === 'admitted') while (!admitted) expect(work.next().done).toBe(false)
        if (phase === 'source') {
          source.return()
          expect(() => work.next()).toThrow(/cancelled/)
        } else if (phase === 'capture') {
          capture.release()
          work.return()
        } else if (phase === 'dispose') {
          owner.dispose()
          expect(() => work.next()).toThrow(/released|cancelled/)
        } else work.return()
        expect(work.next()).toEqual({ done: true, value: undefined })
        expect(owner.stats.readers).toBe(0)
        if (!['capture', 'dispose'].includes(phase)) expect(owner.stats).toEqual(baseline)
      } finally {
        work.return()
        source.return()
        capture.release()
        owner.dispose()
      }
    },
  )

  it('rejects mixed owners before claiming sources', () => {
    const a = fixture({ a: 1 }),
      b = fixture({ b: 2 })
    const first = new PackedCaptureInput(a.capture),
      second = new PackedCaptureInput(b.capture)
    try {
      expect(() =>
        packStreamedValueSteps(
          { a: first.at(), b: second.at() },
          limits.bytes,
          encoding,
          [],
          undefined,
          [first, second],
        ),
      ).toThrow('same owner')
      expect(
        finishPackedSteps(
          packStreamedValueSteps(first.at(), limits.bytes, encoding, [], undefined, [first]),
        ),
      ).toEqual(packValue({ a: 1 }, limits.bytes))
    } finally {
      first.return()
      second.return()
      a.capture.release()
      b.capture.release()
      a.owner.dispose()
      b.owner.dispose()
    }
  })

  it.each(['working', 'nodes', 'depth', 'wire'] as const)(
    'releases readers on a %s limit failure',
    (limit) => {
      const { owner, capture } = fixture({ a: [{ text: 'x'.repeat(10000) }] })
      const baseline = owner.stats
      const source = new PackedCaptureInput(capture)
      try {
        expect(() =>
          finishPackedSteps(
            packStreamedValueSteps(
              source.at(),
              limit === 'wire' ? 32 : limits.bytes,
              {
                ...encoding,
                ...(limit === 'wire' ? {} : { [limit]: limit === 'working' ? 1 : 2 }),
              },
              [],
              undefined,
              [source],
            ),
          ),
        ).toThrow(/limit/)
        source.return()
        expect(owner.stats).toEqual(baseline)
      } finally {
        source.return()
        capture.release()
        owner.dispose()
      }
    },
  )

  it('denies a revoked final output admission without allocating a packet', () => {
    const { owner, capture } = fixture({ value: 'x' })
    const source = new PackedCaptureInput(capture)
    const work = packStreamedValueSteps(
      source.at(),
      limits.bytes,
      encoding,
      [],
      () => source.return(),
      [source],
    )
    try {
      expect(() => finishPackedSteps(work)).toThrow('cancelled')
      expect(work.next().done).toBe(true)
    } finally {
      source.return()
      capture.release()
      owner.dispose()
    }
  })

  it('never treats an undeclared adapter as a native JSON object', () => {
    const { owner, capture } = fixture({ value: 1 })
    const source = new PackedCaptureInput(capture)
    try {
      expect(() =>
        finishPackedSteps(packStreamedValueSteps(source.at(), limits.bytes, encoding, [])),
      ).toThrow('Non-JSON')
      expect(capture.reader.scalar(['value'], { retained: 16, staging: 0 })).toBe(1)
    } finally {
      source.return()
      capture.release()
      owner.dispose()
    }
  })

  it('does not retain or coalesce unlike UTF-16 spellings', () => {
    const values = ['\ud800', '�', '😀', '\ud800\ud800', '\udc00', '"', '\\', '\n']
    const { owner, capture } = fixture(values)
    const source = new PackedCaptureInput(capture)
    try {
      const output = finishPackedSteps(
        packStreamedValueSteps(source.at(), limits.bytes, encoding, [], undefined, [source]),
      )
      if (!output) throw new Error('Missing output')
      expect(
        unpackValue(output, { bytes: limits.bytes, retained: MiB, staging: MiB }).value,
      ).toEqual(values)
    } finally {
      source.return()
      capture.release()
      owner.dispose()
    }
  })
})
