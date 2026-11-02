import { expect, it } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedSession, type PackedTicket } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'
import type { PackedWork } from '../../src/packing-work'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 8, readers: 8 }
const output = { retained: 2 * MiB, staging: 8 * MiB }
const before = 'x'.repeat(257)
function source(text: string, revision: number) {
  return new PackedSource(
    {
      generation: 1,
      documentId: 'text-session',
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
    session.prepareFull(session.beginPrepared(base), base.identity, packValue('x', limits.bytes)),
  )
  const original = source('pieces', 1),
    request = session.beginPrepared(original)
  session.commit(
    session.prepareDelta(request, {
      base: base.identity,
      baseSource: base.text,
      result: original.identity,
      payload: packValue('x', limits.bytes),
      operations: Array.from({ length: 256 }, (_, index) => ({
        kind: 'text' as const,
        path: [],
        start: index + 1,
        remove: 0,
        record: 0,
      })),
    }),
  )
  return { session, original, old: session.capture() }
}
function update(session: PackedSession, original: PackedSource, invalid = false) {
  const next = source('new', 2),
    request = session.beginPrepared(next),
    payload = packValue('😀', limits.bytes)
  const work = session.prepareDeltaSteps(
    request,
    {
      base: original.identity,
      baseSource: original.text,
      result: next.identity,
      payload,
      operations: [
        { kind: 'text', path: [], start: 257, remove: 0, record: 0 },
        { kind: 'text', path: [], start: 1, remove: 2, record: 0 },
        ...(invalid
          ? [{ kind: 'text' as const, path: ['missing'], start: 0, remove: 0, record: 0 }]
          : []),
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
      if (!step.value) throw new Error('Cancelled text preparation')
      return step.value
    }
  }
}

it('publishes ordered text copies together and preserves captured old spelling', () => {
  const { session, original, old } = initial()
  try {
    const { work, next } = update(session, original)
    let pauses = 0,
      prepared: PackedTicket | undefined
    while (true) {
      const step = work.next()
      expect(session.stats.current).toEqual(original.identity)
      expect(old.reader.scalar([], output)).toBe(before)
      expect(session.stats.retainedBytes).toBeLessThanOrEqual(limits.retained)
      expect(session.stats.preparingStagingBytes).toBeLessThanOrEqual(limits.staging)
      if (step.done) {
        prepared = step.value
        break
      }
      expect(session.stats.prepared).toBeNull()
      pauses++
    }
    expect(pauses).toBeGreaterThan(3)
    if (!prepared) throw new Error('Missing prepared text')
    session.commit(prepared)
    expect(session.stats.current).toEqual(next.identity)
    const current = session.capture()
    try {
      expect(current.reader.scalar([], output)).toBe(`x😀${'x'.repeat(254)}😀`)
      expect(old.reader.scalar([], output)).toBe(before)
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
  it.each([1, 2, 3])(`rolls back suspended text copies on ${action}, advances=%s`, (advances) => {
    const { session, original, old } = initial()
    try {
      const { work } = update(session, original)
      while (session.stats.preparingPhase !== 'revision') expect(work.next().done).toBe(false)
      for (let index = 0; index < advances; index++) expect(work.next().done).toBe(false)
      expect(session.stats.prepared).toBeNull()
      if (action === 'return') work.return()
      else if (action === 'throw')
        expect(() => work.throw(new Error('cancel text session'))).toThrow('cancel text session')
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
      else expect(old.reader.scalar([], output)).toBe(before)
    } finally {
      old.release()
      session.dispose()
    }
    expect(session.stats.retainedBytes).toBe(0)
  })

it('rolls back a late invalid path after private text copies complete', () => {
  const { session, original, old } = initial()
  try {
    const { work } = update(session, original, true)
    expect(() => finish(work)).toThrow('Packed path requires object')
    expect(work.next().done).toBe(true)
    expect(session.stats.current).toEqual(original.identity)
    expect(old.reader.scalar([], output)).toBe(before)
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
