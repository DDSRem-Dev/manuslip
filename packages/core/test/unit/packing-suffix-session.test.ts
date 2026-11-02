import { expect, it } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { PackedSession, type PackedTicket } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'
import type { PackedWork } from '../../src/packing-work'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 8, readers: 8 }
const output = { retained: 2 * MiB, staging: 8 * MiB }
const point = (offset: number) => ({ line: 3, column: 5, offset })
const position = (offset: number) => ({ start: point(offset), end: point(offset + 1) })
const values = Array.from({ length: 4097 }, (_, index) => ({
  from: 10 + index * 2,
  to: 11 + index * 2,
  position: position(10 + index * 2),
}))
const insertionPayload = packValue([values[0]], limits.bytes)
const insertionRoot = PackedArena.open(insertionPayload.slice(0), limits).root
function source(text: string, revision: number) {
  return new PackedSource(
    {
      generation: 1,
      documentId: 'suffix-session',
      revision,
      sourceHash: sourceHash(text),
      parserVersion: 'test',
      rendererVersion: 'test',
      options: 'default',
    },
    text,
  )
}
function initial() {
  const session = new PackedSession(limits),
    base = source('base', 0)
  session.commit(
    session.prepareFull(
      session.beginPrepared(base),
      base.identity,
      packValue({ items: values, first: values[0] }, limits.bytes),
    ),
  )
  const original = source('segments', 1)
  session.commit(
    session.prepareDelta(session.beginPrepared(original), {
      base: base.identity,
      baseSource: base.text,
      result: original.identity,
      payload: insertionPayload.slice(0),
      operations: Array.from({ length: 256 }, (_, index) => ({
        kind: 'splice' as const,
        path: ['items'],
        start: index * 2,
        remove: 1,
        record: insertionRoot,
      })),
    }),
  )
  return { session, original, old: session.capture() }
}
function update(session: PackedSession, original: PackedSource, invalid = false) {
  const next = source('new', 2),
    payload = packValue(null, limits.bytes)
  const work = session.prepareDeltaSteps(
    session.beginPrepared(next),
    {
      base: original.identity,
      baseSource: original.text,
      result: next.identity,
      payload,
      operations: [
        { kind: 'offset', path: ['items'], start: 0, offset: 3 },
        { kind: 'range', path: ['items'], start: 1, offset: 5 },
        { kind: 'offset', path: ['items'], start: 4096, offset: -1 },
        ...(invalid ? [{ kind: 'range' as const, path: ['missing'], start: 0, offset: 1 }] : []),
      ],
    },
    1024,
  )
  expect(payload.byteLength).toBe(0)
  return { work, next }
}
function finish(work: PackedWork<PackedTicket>) {
  while (true) {
    const step = work.next()
    if (step.done) {
      if (!step.value) throw new Error('Cancelled suffix update')
      return step.value
    }
  }
}

it('publishes ordered position/range copies together without changing aliases or old captures', () => {
  const { session, original, old } = initial()
  try {
    const { work, next } = update(session, original)
    let pauses = 0,
      prepared: PackedTicket | undefined
    while (true) {
      const step = work.next()
      expect(session.stats.current).toEqual(original.identity)
      expect(session.stats.retainedBytes).toBeLessThanOrEqual(limits.retained)
      expect(session.stats.preparingStagingBytes).toBeLessThanOrEqual(limits.staging)
      if (step.done) {
        prepared = step.value
        break
      }
      expect(session.stats.prepared).toBeNull()
      pauses++
    }
    expect(pauses).toBeGreaterThan(100)
    if (!prepared) throw new Error('Missing prepared suffix')
    session.commit(prepared)
    expect(session.stats.current).toEqual(next.identity)
    const current = session.capture()
    try {
      expect(current.reader.position(['items', 4096, 'position'], output)).toEqual(
        position(10 + 4096 * 2 + 2),
      )
      expect(current.reader.scalar(['items', 4096, 'from'], output)).toBe(10 + 4096 * 2 + 5)
      expect(current.reader.position(['first', 'position'], output)).toEqual(position(10))
      expect(old.reader.position(['items', 4096, 'position'], output)).toEqual(
        position(10 + 4096 * 2),
      )
      expect(old.reader.scalar(['items', 4096, 'from'], output)).toBe(10 + 4096 * 2)
    } finally {
      current.release()
    }
  } finally {
    old.release()
    session.dispose()
  }
  expect(session.stats.retainedBytes).toBe(0)
})

for (const action of ['return', 'throw', 'invalidate', 'replace', 'evict', 'dispose'] as const)
  it.each([1, 20, 80])(`rolls back suspended suffix work on ${action}, advances=%s`, (advances) => {
    const { session, original, old } = initial()
    try {
      const { work } = update(session, original)
      while (session.stats.preparingPhase !== 'revision') expect(work.next().done).toBe(false)
      for (let index = 0; index < advances; index++) expect(work.next().done).toBe(false)
      expect(session.stats.prepared).toBeNull()
      if (action === 'return') work.return()
      else if (action === 'throw')
        expect(() => work.throw(new Error('cancel suffix session'))).toThrow(
          'cancel suffix session',
        )
      else if (action === 'replace') session.beginPrepared(source('newer', 3))
      else session[action]()
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(session.stats).toMatchObject({
        preparingBytes: 0,
        preparingStagingBytes: 0,
        outgoingReservedBytes: 0,
        prepared: null,
      })
      if (action === 'dispose') expect(() => old.reader.kind()).toThrow('released')
      else
        expect(old.reader.position(['items', 4096, 'position'], output)).toEqual(
          position(10 + 4096 * 2),
        )
    } finally {
      old.release()
      session.dispose()
    }
    expect(session.stats.retainedBytes).toBe(0)
  })

it('rolls back a late missing path after all private suffix copies complete', () => {
  const { session, original, old } = initial()
  try {
    const { work } = update(session, original, true)
    expect(() => finish(work)).toThrow('Missing or invalid packed path')
    expect(work.next().done).toBe(true)
    expect(session.stats.current).toEqual(original.identity)
    expect(old.reader.position(['items', 4096, 'position'], output)).toEqual(
      position(10 + 4096 * 2),
    )
    expect(session.stats).toMatchObject({
      preparingBytes: 0,
      preparingStagingBytes: 0,
      outgoingReservedBytes: 0,
      prepared: null,
    })
  } finally {
    old.release()
    session.dispose()
  }
})
