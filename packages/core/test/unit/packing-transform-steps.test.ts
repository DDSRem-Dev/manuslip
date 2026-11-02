import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { PackedReader } from '../../src/packing-bytes'
import { offsetSuffixSteps } from '../../src/packing-offsets'
import type { PackedPositionSummary } from '../../src/packing-position-summary'
import { rangeSuffixSteps } from '../../src/packing-ranges'
import { type PackedOperation, PackedRevision } from '../../src/packing-revision'
import { PackedSession, type PackedTicket } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'
import { childSteps } from '../../src/packing-traversal'
import { type PackedNode, PackedView } from '../../src/packing-view'
import { finishPackedSteps, type PackedWork } from '../../src/packing-work'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB }
const sessionLimits = { ...limits, captures: 8, readers: 8 }
const source = (text: string, revision = 0) =>
  new PackedSource(
    {
      generation: 1,
      documentId: 'transform-steps',
      revision,
      sourceHash: sourceHash(text),
      parserVersion: 'test',
      rendererVersion: 'test',
      options: 'test',
    },
    text,
  )
const open = (value: unknown) => PackedArena.open(packValue(value, limits.bytes), limits)
function close<T>(work: Pick<Generator<void, T | undefined, undefined>, 'return'>) {
  work.return(undefined)
}
const position = (from: number, to = from + 1) => ({
  start: { line: 2, column: 3, offset: from },
  end: { line: 2, column: 4, offset: to },
})
function read(view: PackedView): unknown {
  switch (view.kind()) {
    case 'scalar':
      return view.readScalar(limits)
    case 'position':
      return view.position()
    case 'array':
      return [...view.elements()].map(read)
    case 'object':
      return Object.fromEntries(view.keys().map((key) => [key, read(view.at([key]))]))
  }
}
function finish(work: PackedWork<PackedTicket>) {
  while (true) {
    const step = work.next()
    if (step.done) {
      if (!step.value) throw new Error('Cancelled')
      return step.value
    }
  }
}
function beginDelta(
  session: PackedSession,
  operations: readonly PackedOperation[],
  value: unknown = null,
) {
  const base = source('old')
  const result = source('new', 1)
  const ticket = session.beginPrepared(result)
  return session.prepareDeltaSteps(
    ticket,
    {
      base: base.identity,
      baseSource: base.text,
      result: result.identity,
      operations,
      payload: packValue(value, limits.bytes),
    },
    2048,
  )
}
function initialize(session: PackedSession, value: unknown) {
  const base = source('old')
  const ticket = session.beginPrepared(base)
  session.commit(session.prepareFull(ticket, base.identity, packValue(value, limits.bytes)))
}
function toRevision(
  session: PackedSession,
  work: PackedWork<PackedTicket>,
  predicate = () => true,
) {
  for (let i = 0; i < 10000; i++) {
    const step = work.next()
    if (step.done) throw new Error('Unexpected completed preparation')
    if (session.stats.preparingPhase === 'revision' && predicate()) return
  }
  throw new Error('Missing suspended revision')
}

describe('cooperative packed position and range transforms', () => {
  it('builds the complete DAG summary in bounded record/reference work, including one large array', () => {
    const arena = open(
      Array.from({ length: 20000 }, (_, i) => ({ number: i, position: position(i + 10) })),
    )
    const expected = arena.summarizePositions(() => {})
    const work = arena.summarizePositionSteps(() => {})
    const uint = vi.spyOn(PackedReader.prototype, 'uint')
    let actual: PackedPositionSummary | undefined
    let steps = 0
    try {
      while (true) {
        uint.mockClear()
        const step = work.next()
        expect(uint.mock.calls.length).toBeLessThanOrEqual(1800)
        if (step.done) {
          actual = step.value
          break
        }
        steps++
      }
    } finally {
      uint.mockRestore()
      close(work)
    }
    expect(steps).toBeGreaterThan(200)
    if (!actual) throw new Error('Missing summary')
    expect(actual.stagingBytes).toBe(expected.stagingBytes)
    for (let id = 0; id < arena.records; id++) expect(actual.at(id)).toEqual(expected.at(id))
    expect(actual.at(arena.root)).toMatchObject({
      minimum: 10,
      maximum: 20010,
      depth: 2,
      visits: 60001,
    })
  })

  it('admits the full summary before record reads and cancels without scanning the remainder', () => {
    const arena = open(Array.from({ length: 20000 }, (_, i) => position(i)))
    const uint = vi.spyOn(PackedReader.prototype, 'uint')
    try {
      const rejected = arena.summarizePositionSteps(() => {
        throw new Error('no scratch')
      })
      expect(() => rejected.next()).toThrow('no scratch')
      expect(uint).not.toHaveBeenCalled()
      const work = arena.summarizePositionSteps(() => {})
      expect(work.next().done).toBe(false)
      const calls = uint.mock.calls.length
      expect(calls).toBeLessThan(1800)
      close(work)
      expect(work.next().done).toBe(true)
      expect(uint.mock.calls.length).toBe(calls)
    } finally {
      uint.mockRestore()
    }
  })

  it('yields through discarded array prefixes and wide object paths', () => {
    for (const value of [
      Array.from({ length: 20000 }, (_, i) => i),
      Object.fromEntries(Array.from({ length: 20000 }, (_, i) => [`key${i}`, i])),
    ]) {
      const arena = open(value)
      const path = Array.isArray(value) ? 19999 : 'key19999'
      const work = childSteps({ arena, id: arena.root }, path)
      const uint = vi.spyOn(PackedReader.prototype, 'uint')
      let result: PackedNode | undefined
      let steps = 0
      try {
        while (true) {
          uint.mockClear()
          const step = work.next()
          expect(uint.mock.calls.length).toBeLessThanOrEqual(280)
          if (step.done) {
            result = step.value
            break
          }
          steps++
        }
      } finally {
        uint.mockRestore()
        close(work)
      }
      expect(steps).toBeGreaterThan(70)
      if (!result) throw new Error('Missing selected value')
      expect(new PackedView(result).scalar()).toBe(19999)
    }
  })

  it.each(['offset', 'range'] as const)(
    'yields through a late %s suffix without touching unselected invalid data',
    (kind) => {
      const values = Array.from({ length: 20000 }, (_, i) => ({
        from: i + 10,
        to: i + 11,
        position: position(i + 10),
      }))
      values[0] = { from: 0, to: 0, position: position(0, 0) }
      const arena = open(values)
      const build = vi.spyOn(PackedArena.prototype, 'summarizePositionSteps')
      const work = (kind === 'offset' ? offsetSuffixSteps : rangeSuffixSteps)(
        { arena, id: arena.root },
        19999,
        -1,
        () => {},
        () => {},
      )
      const uint = vi.spyOn(PackedReader.prototype, 'uint')
      let result: PackedNode | undefined
      let steps = 0
      try {
        while (true) {
          uint.mockClear()
          const step = work.next()
          expect(uint.mock.calls.length).toBeLessThan(300)
          if (step.done) {
            result = step.value
            break
          }
          steps++
        }
        expect(build).not.toHaveBeenCalled()
      } finally {
        uint.mockRestore()
        build.mockRestore()
        close(work)
      }
      expect(steps).toBeGreaterThan(70)
      if (!result) throw new Error('Missing suffix')
      const view = new PackedView(result)
      expect(read(view.at([0]))).toEqual(values[0])
      const expected =
        kind === 'offset'
          ? { ...values[19999], position: position(20008) }
          : { ...values[19999], from: 20008, to: 20009 }
      expect(read(view.at([19999]))).toEqual(expected)
    },
  )

  it('matches exact ordered transforms, replacements and reversals against an independent native value', () => {
    const original = Array.from({ length: 3000 }, (_, i) => ({
      from: i + 20,
      to: i + 21,
      position: position(i + 20),
      text: `value${i}`,
    }))
    const baseSource = source('old')
    const base = PackedRevision.fullPrepared(open(original), baseSource, limits)
    const replacement = { from: 80, to: 90, position: position(80), text: 'absolute' }
    const arena = open(replacement)
    const operations: PackedOperation[] = [
      { kind: 'offset', path: [], start: 1, offset: 5 },
      { kind: 'range', path: [], start: 1, offset: 3 },
      { kind: 'replace', path: [2200], record: arena.root },
      { kind: 'offset', path: [], start: 2, offset: -2 },
      { kind: 'range', path: [], start: 2, offset: -1 },
    ]
    const result = source('new', 1)
    const update = {
      base: base.identity,
      baseSource: base.source,
      result: result.identity,
      source: result.text,
      arena,
      operations,
    }
    let admitted = 0
    const next = finishPackedSteps(
      base.applyPreparedSteps(update, result, limits, (bytes) => {
        admitted = bytes
      }),
    )
    const expected = original.map((item, i) =>
      i === 2200
        ? { ...replacement, from: 79, to: 89, position: position(78) }
        : {
            ...item,
            from: item.from + (i === 0 ? 0 : i === 1 ? 3 : 2),
            to: item.to + (i === 0 ? 0 : i === 1 ? 3 : 2),
            position: position(i + 20 + (i === 0 ? 0 : i === 1 ? 5 : 3)),
          },
    )
    expect(read(next.root)).toEqual(expected)
    expect(read(base.root)).toEqual(original)
    const sync = base.applyPrepared(update, result, limits)
    expect(next.retainedBytes).toBe(sync.retainedBytes)
    expect(next.stagingBytes).toBe(sync.stagingBytes)
    expect(admitted).toBe(
      [...next.resources()]
        .filter(({ key }) => !(key instanceof PackedArena) && !(key instanceof PackedSource))
        .reduce((sum, resource) => sum + resource.bytes, 0),
    )
  })

  it('does not batch wide immediate-range scans into one large scheduler advance', () => {
    const value = {
      ...Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`key${i}`, i])),
      from: 10,
      to: 20,
    }
    const arena = open(Array(300).fill(value))
    const work = rangeSuffixSteps(
      { arena, id: arena.root },
      0,
      1,
      () => {},
      () => {},
    )
    const uint = vi.spyOn(PackedReader.prototype, 'uint')
    let result: PackedNode | undefined
    let steps = 0
    try {
      while (true) {
        uint.mockClear()
        const step = work.next()
        expect(uint.mock.calls.length).toBeLessThan(530)
        if (step.done) {
          result = step.value
          break
        }
        steps++
      }
    } finally {
      uint.mockRestore()
      close(work)
    }
    expect(steps).toBeGreaterThanOrEqual(300)
    if (!result) throw new Error('Missing ranges')
    expect(new PackedView(result).at([299, 'from']).scalar()).toBe(11)
    expect(new PackedView(result).at([299, 'to']).scalar()).toBe(21)
  })

  it.each(['from first', 'to first'] as const)(
    'reads distant range fields in one bounded forward scan with %s',
    (order) => {
      const keys = Object.fromEntries(Array.from({ length: 20000 }, (_, i) => [`key${i}`, i]))
      const value =
        order === 'from first' ? { from: 10, ...keys, to: 20 } : { to: 20, ...keys, from: 10 }
      const arena = open([value])
      const work = rangeSuffixSteps(
        { arena, id: arena.root },
        0,
        1,
        () => {},
        () => {},
      )
      const uint = vi.spyOn(PackedReader.prototype, 'uint')
      const fields = vi.spyOn(PackedArena.prototype, 'fields')
      let result: PackedNode | undefined,
        steps = 0
      try {
        while (true) {
          uint.mockClear()
          const next = work.next()
          expect(uint.mock.calls.length).toBeLessThanOrEqual(280)
          if (next.done) {
            result = next.value
            break
          }
          steps++
        }
        expect(fields).toHaveBeenCalledTimes(1)
      } finally {
        fields.mockRestore()
        uint.mockRestore()
        close(work)
      }
      expect(steps).toBeGreaterThan(70)
      if (!result) throw new Error('Missing ranges')
      expect(new PackedView(result).at([0, 'from']).scalar()).toBe(11)
      expect(new PackedView(result).at([0, 'to']).scalar()).toBe(21)
      expect(arena.scalar(arena.field(arena.element(arena.root, 0), 'from') as number)).toBe(10)
    },
  )

  it.each(['underflow', 'overflow', 'depth', 'aliases'] as const)(
    'rejects late %s after yielding with no partial publication',
    (failure) => {
      let invalid: unknown
      let offset = 1
      if (failure === 'underflow') {
        invalid = position(0, 0)
        offset = -1
      } else if (failure === 'overflow') invalid = position(0xfffffffe, 0xffffffff)
      else {
        invalid = position(10)
        for (let i = 0; i < (failure === 'depth' ? 260 : 20); i++)
          invalid = failure === 'depth' ? [invalid] : [invalid, invalid]
      }
      const arena = open([...Array(5000).fill({ position: position(20) }), invalid])
      const work = offsetSuffixSteps(
        { arena, id: arena.root },
        0,
        offset,
        () => {},
        () => {},
      )
      let yielded = 0
      expect(() => {
        while (true) {
          const step = work.next()
          if (step.done) break
          yielded++
        }
      }).toThrow(
        failure === 'depth' ? 'depth limit' : failure === 'aliases' ? 'node limit' : 'offset range',
      )
      expect(yielded).toBeGreaterThan(20)
      expect(work.next().done).toBe(true)
      const id = arena.field(arena.element(arena.root, 0), 'position')
      if (id === undefined) throw new Error('Missing original position')
      expect(arena.position(id)).toEqual(position(20))
    },
  )

  it.each(['return', 'throw', 'invalidate', 'replace', 'evict', 'dispose'] as const)(
    'releases a suspended wide range scan on %s',
    (action) => {
      const session = new PackedSession(sessionLimits)
      const fields = vi.spyOn(PackedArena.prototype, 'fields')
      try {
        initialize(session, [
          {
            from: 10,
            ...Object.fromEntries(Array.from({ length: 20000 }, (_, i) => [`key${i}`, i])),
            to: 20,
          },
        ])
        const old = session.capture()
        const work = beginDelta(session, [{ kind: 'range', path: [], start: 0, offset: 1 }])
        toRevision(session, work, () => fields.mock.calls.length > 0)
        expect(session.stats.prepared).toBeNull()
        expect(session.stats.outgoingReservedBytes).toBe(2048)
        if (action === 'return') work.return()
        else if (action === 'throw') expect(() => work.throw(new Error('stop'))).toThrow('stop')
        else if (action === 'replace') session.beginPrepared(source('newer', 2))
        else session[action]()
        expect(work.next()).toEqual({ done: true, value: undefined })
        expect(session.stats).toMatchObject({
          preparingBytes: 0,
          preparingStagingBytes: 0,
          preparingPhase: null,
          outgoingReservedBytes: 0,
          prepared: null,
        })
        if (action !== 'dispose') {
          expect(old.reader.scalar([0, 'from'], limits)).toBe(10)
          expect(old.reader.scalar([0, 'to'], limits)).toBe(20)
        } else expect(() => old.reader.kind()).toThrow('released')
        old.release()
      } finally {
        fields.mockRestore()
        session.dispose()
      }
      expect(session.stats.retainedBytes).toBe(0)
    },
  )

  it.each(['return', 'throw', 'invalidate', 'replace', 'evict', 'dispose'] as const)(
    'releases suspended summary and overlay ownership on %s',
    (action) => {
      const session = new PackedSession(sessionLimits)
      try {
        initialize(
          session,
          Array.from({ length: 5000 }, (_, i) => ({ position: position(i + 20), number: i })),
        )
        const old = session.capture()
        const work = beginDelta(session, [{ kind: 'offset', path: [], start: 0, offset: 1 }])
        toRevision(session, work, () => session.stats.preparingStagingBytes > 50000)
        expect(session.stats.preparingBytes).toBeGreaterThan(2048)
        expect(session.stats.outgoingReservedBytes).toBe(2048)
        expect(session.stats.prepared).toBeNull()
        if (action === 'return') work.return()
        else if (action === 'throw') expect(() => work.throw(new Error('stop'))).toThrow('stop')
        else if (action === 'replace') session.beginPrepared(source('newer', 2))
        else session[action]()
        expect(work.next()).toEqual({ done: true, value: undefined })
        expect(session.stats).toMatchObject({
          preparingBytes: 0,
          preparingStagingBytes: 0,
          preparingPhase: null,
          outgoingReservedBytes: 0,
          prepared: null,
        })
        if (action !== 'dispose')
          expect(old.reader.position([4999, 'position'], limits)).toEqual(position(5019))
        else expect(() => old.reader.kind()).toThrow('released')
        old.release()
      } finally {
        session.dispose()
      }
      expect(session.stats.retainedBytes).toBe(0)
    },
  )

  it('reserves transform scratch against new readers and rolls back retained pressure after a yield', () => {
    const session = new PackedSession({ ...sessionLimits, staging: 400000, retained: 2 * MiB })
    try {
      initialize(
        session,
        Array.from({ length: 6000 }, (_, i) => ({
          from: i + 20,
          to: i + 21,
          position: position(i + 20),
          text: 'value',
        })),
      )
      const old = session.capture()
      const operations: PackedOperation[] = [
        { kind: 'offset', path: [], start: 0, offset: 1 },
        { kind: 'range', path: [], start: 0, offset: 1 },
      ]
      const work = beginDelta(session, operations)
      toRevision(session, work, () => session.stats.preparingStagingBytes > 100000)
      expect(() => old.reader.textSteps([0, 'text'], limits)).toThrow('staging')
      const heldBytes = 2 * MiB - session.stats.retainedBytes - 768
      const hold = session.retain({ resources: () => [{ key: {}, bytes: heldBytes }] })
      expect(() => finish(work)).toThrow('retained')
      expect(session.stats).toMatchObject({
        preparingBytes: 0,
        preparingStagingBytes: 0,
        prepared: null,
      })
      hold.release()
      const prepared = finish(beginDelta(session, operations))
      const inspection = session.capturePrepared(prepared)
      expect(inspection.reader.position([5999, 'position'], limits)).toEqual(position(6020))
      session.commit(prepared)
      expect(old.reader.position([5999, 'position'], limits)).toEqual(position(6019))
      old.release()
    } finally {
      session.dispose()
    }
    expect(session.stats.retainedBytes).toBe(0)
  })
})
