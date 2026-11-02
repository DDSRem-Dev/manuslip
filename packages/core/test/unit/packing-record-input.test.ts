import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packStreamedValueSteps, packValue, unpackValue } from '../../src/packing'
import { PackedWriter } from '../../src/packing-bytes'
import { PackedReadScope } from '../../src/packing-capture'
import { PackedCaptureInput } from '../../src/packing-input-capture'
import { PackedSession } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'
import { finishPackedSteps } from '../../src/packing-work'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, readers: 160, captures: 8 }
const encoding = { working: 32 * MiB, nodes: 800000, depth: 512 }
const identity = (revision = 0) => ({
  generation: 1,
  documentId: 'record-import',
  revision,
  sourceHash: sourceHash(''),
  parserVersion: 'test',
  rendererVersion: 'test',
  options: 'test',
})
function fixture(value: unknown, payload = packValue(value, limits.bytes)) {
  const owner = new PackedSession(limits)
  const capture = finishPackedSteps(
    owner.stageFullSteps(owner.beginPrepared(new PackedSource(identity(), '')), payload),
  )
  if (!capture) throw new Error('Missing capture')
  const baseline = owner.stats
  const source = new PackedCaptureInput(capture, true)
  const close = () => {
    source.return()
    capture.release()
    owner.dispose()
  }
  return { owner, capture, source, baseline, close }
}
function exact(value: unknown) {
  const state = fixture(value)
  try {
    const output = finishPackedSteps(
      packStreamedValueSteps(state.source.at(), limits.bytes, encoding, [], undefined, [
        state.source,
      ]),
    )
    expect(output).toEqual(packValue(value, limits.bytes, encoding))
    if (!output) throw new Error('Missing encoding')
    expect(
      unpackValue(output, { bytes: limits.bytes, retained: 16 * MiB, staging: 8 * MiB }).value,
    ).toEqual(value)
    expect(state.owner.stats).toEqual(state.baseline)
  } finally {
    state.close()
  }
}

describe('guarded immutable record import', () => {
  it('accepts the same exact logical node/depth boundary as native traversal', () => {
    const value = { a: 1, b: { c: [2, 3] }, d: true }
    const state = fixture(value)
    try {
      const budget = { ...encoding, nodes: 7, depth: 4 }
      expect(
        finishPackedSteps(
          packStreamedValueSteps(state.source.at(), limits.bytes, budget, [], undefined, [
            state.source,
          ]),
        ),
      ).toEqual(packValue(value, limits.bytes, budget))
      expect(state.owner.stats).toEqual(state.baseline)
    } finally {
      state.close()
    }
  })
  it.each([
    null,
    false,
    true,
    0,
    -0,
    -3.5,
    0xffffffff,
    0x100000000,
    '',
    '\ud800',
    '\udc00',
    '😀',
    '\\"\n界',
    [],
    {},
    [1, true, null],
    JSON.parse('{"__proto__":{"value":1},"constructor":2,"10":3,"2":4}'),
    {
      position: {
        start: { line: 1, column: 2, offset: 1 },
        end: { line: 2, column: 3, offset: 7 },
      },
    },
    { position: { start: { line: 0, column: 0 }, end: { line: 2, column: 3 } } },
    { text: '界😀\ud800\\"\n'.repeat(5000), tail: Array.from({ length: 2000 }, (_, i) => ({ i })) },
    Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`field-${i}`, { i }])),
  ])('matches the complete native canonical encoding for case %#', (value) => exact(value))

  it('shares equal values across different arenas and native subtrees', () => {
    const state = fixture({ text: 'first', nested: [1, 2, 3] })
    const other = finishPackedSteps(
      state.owner.stageFullSteps(
        state.owner.beginPrepared(state.capture.sourceResource),
        packValue({ text: 'second', nested: [3, 2, 1] }, limits.bytes),
      ),
    )
    if (!other) throw new Error('Missing second capture')
    const second = new PackedCaptureInput(other, true)
    try {
      const a = { text: 'first', nested: [1, 2, 3] },
        b = { text: 'second', nested: [3, 2, 1] }
      expect(
        finishPackedSteps(
          packStreamedValueSteps(
            [state.source.at(), second.at(), a, b, state.source.at(), second.at()],
            limits.bytes,
            encoding,
            [],
            undefined,
            [state.source, second],
          ),
        ),
      ).toEqual(packValue([a, b, a, b, a, b], limits.bytes, encoding))
    } finally {
      second.return()
      other.release()
      state.close()
    }
  })

  it('imports records without per-child paths and reuses completed long strings', () => {
    const value = Array.from({ length: 2000 }, () => ({
      text: '界😀'.repeat(5000),
      tail: [1, 2, 3],
    }))
    const state = fixture(value)
    const root = state.source.at()
    const paths = vi.spyOn(PackedReadScope.prototype, 'at')
    const records = vi.spyOn(PackedReadScope.prototype, 'encodedRecord')
    const strings = vi.spyOn(PackedReadScope.prototype, 'encodedTextSteps')
    try {
      expect(
        finishPackedSteps(
          packStreamedValueSteps(root, limits.bytes, encoding, [], undefined, [state.source]),
        ),
      ).toEqual(packValue(value, limits.bytes, encoding))
      expect(records).toHaveBeenCalled()
      expect(paths).not.toHaveBeenCalled()
      expect(strings.mock.calls.length).toBeLessThanOrEqual(4)
    } finally {
      paths.mockRestore()
      records.mockRestore()
      strings.mockRestore()
      state.close()
    }
  })

  it('canonicalizes valid alternate JSON string spellings before sharing', () => {
    const writer = new PackedWriter(limits.bytes)
    for (const byte of [77, 83, 80, 50]) writer.byte(byte)
    writer.uint(0) // shapes
    writer.uint(0) // positions
    writer.uint(1) // records
    writer.uint(5)
    const bytes = new TextEncoder().encode('"\\u0061\\/\\uD800"')
    writer.uint(bytes.length)
    writer.writeBytes(bytes)
    writer.uint(0)
    const state = fixture('a/\ud800', writer.finish())
    try {
      expect(
        finishPackedSteps(
          packStreamedValueSteps(
            [state.source.at(), 'a/\ud800'],
            limits.bytes,
            encoding,
            [],
            undefined,
            [state.source],
          ),
        ),
      ).toEqual(packValue(['a/\ud800', 'a/\ud800'], limits.bytes, encoding))
    } finally {
      state.close()
    }
  })

  it('keeps all lazy position and range transforms when importing a composite revision', () => {
    const point = {
      start: { line: 1, column: 3, offset: 2 },
      end: { line: 1, column: 4, offset: 3 },
    }
    const node = { type: 'text', value: 'same', position: point }
    const block = { from: 2, to: 3, nested: { from: 2, to: 3 }, position: point }
    const original = { nodes: [node, node], blocks: [block, block] }
    const owner = new PackedSession(limits)
    owner.commit(
      owner.prepareFull(owner.begin(identity(), ''), identity(), packValue(original, limits.bytes)),
    )
    const before = owner.capture()
    owner.commit(
      owner.prepareDelta(owner.begin(identity(1), ''), {
        base: identity(),
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
    const a = new PackedCaptureInput(before, true),
      b = new PackedCaptureInput(after, true)
    try {
      const expected = {
        nodes: [
          node,
          {
            ...node,
            position: {
              start: { ...point.start, offset: 9 },
              end: { ...point.end, offset: 10 },
            },
          },
        ],
        blocks: [block, { ...block, from: 7, to: 8 }],
      }
      expect(
        finishPackedSteps(
          packStreamedValueSteps([a.at(), b.at()], limits.bytes, encoding, [], undefined, [a, b]),
        ),
      ).toEqual(packValue([original, expected], limits.bytes, encoding))
    } finally {
      a.return()
      b.return()
      before.release()
      after.release()
      owner.dispose()
    }
  })

  it.each([{ nodes: 6 }, { depth: 3 }])(
    'preserves logical traversal limits for %j',
    (restriction) => {
      const value = { a: 1, b: { c: [2, 3] }, d: true }
      const state = fixture(value)
      try {
        const budget = { ...encoding, nodes: 7, depth: 4, ...restriction }
        expect(() => packValue(value, limits.bytes, budget)).toThrow(/node\/depth limit/)
        expect(() =>
          finishPackedSteps(
            packStreamedValueSteps(state.source.at(), limits.bytes, budget, [], undefined, [
              state.source,
            ]),
          ),
        ).toThrow(/node\/depth limit/)
        expect(state.owner.stats).toEqual(state.baseline)
      } finally {
        state.close()
      }
    },
  )

  it.each(['working', 'nodes', 'depth', 'wire'] as const)(
    'releases imports after a %s limit',
    (limit) => {
      const state = fixture({ a: [{ text: 'x'.repeat(10000) }] })
      try {
        expect(() =>
          finishPackedSteps(
            packStreamedValueSteps(
              state.source.at(),
              limit === 'wire' ? 32 : limits.bytes,
              {
                ...encoding,
                ...(limit === 'wire' ? {} : { [limit]: limit === 'working' ? 1 : 2 }),
              },
              [],
              undefined,
              [state.source],
            ),
          ),
        ).toThrow(/limit/)
        state.source.return()
        expect(state.owner.stats).toEqual(state.baseline)
      } finally {
        state.close()
      }
    },
  )

  it.each(['queued', 'edge', 'text', 'source', 'owner', 'throw', 'output'] as const)(
    'revokes suspended record work at %s',
    (phase) => {
      const state = fixture(['界😀'.repeat(10000), Array.from({ length: 2000 }, (_, i) => ({ i }))])
      let opened = false
      const original = PackedReadScope.prototype.encodedTextSteps
      const stream = vi
        .spyOn(PackedReadScope.prototype, 'encodedTextSteps')
        .mockImplementation(function (this: PackedReadScope, ...args) {
          opened = true
          return original.apply(this, args)
        })
      const work = packStreamedValueSteps(
        state.source.at(),
        limits.bytes,
        encoding,
        [],
        phase === 'output' ? () => state.source.return() : undefined,
        [state.source],
      )
      try {
        if (phase === 'edge') expect(work.next().done).toBe(false)
        if (['text', 'source', 'owner', 'throw'].includes(phase))
          while (!opened) expect(work.next().done).toBe(false)
        if (phase === 'source') {
          state.source.return()
          expect(() => work.next()).toThrow(/cancelled|released/)
        } else if (phase === 'owner') {
          state.owner.dispose()
          expect(() => work.next()).toThrow(/cancelled|released/)
        } else if (phase === 'throw') {
          expect(() => work.throw(new Error('stop import'))).toThrow('stop import')
        } else if (phase === 'output') {
          expect(() => finishPackedSteps(work)).toThrow(/cancelled|released/)
        } else work.return()
        expect(work.next()).toEqual({ done: true, value: undefined })
        expect(state.owner.stats.readers).toBe(0)
        if (phase !== 'owner') expect(state.owner.stats).toEqual(state.baseline)
      } finally {
        work.return()
        stream.mockRestore()
        state.close()
      }
    },
  )

  it('rejects reentrant owner closure during a guarded record edge', () => {
    const state = fixture({ a: 1, later: { value: 42 } })
    const original = PackedReadScope.prototype.encodedReference
    const edges = vi
      .spyOn(PackedReadScope.prototype, 'encodedReference')
      .mockImplementation(function (this: PackedReadScope, ...args) {
        const result = original.apply(this, args)
        state.source.return()
        return result
      })
    const work = packStreamedValueSteps(state.source.at(), limits.bytes, encoding, [], undefined, [
      state.source,
    ])
    try {
      expect(() => finishPackedSteps(work)).toThrow(/cancelled|released/)
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(state.owner.stats).toEqual(state.baseline)
    } finally {
      work.return()
      edges.mockRestore()
      state.close()
    }
  })

  it('expires record capabilities with their array item and capture', () => {
    const state = fixture([{ a: 1 }, { b: 2 }])
    const iterator = state.capture.reader.elements()
    try {
      const first = iterator.next().value
      if (!first) throw new Error('Missing array item')
      const record = first.encodedRecord()
      expect(record?.keys).toEqual(['a'])
      iterator.next()
      expect(() => first.encodedRecord()).toThrow(/expired/)
      state.capture.release()
      expect(() => state.capture.reader.encodedRecord()).toThrow(/released/)
    } finally {
      iterator.return()
      state.close()
    }
  })
})
