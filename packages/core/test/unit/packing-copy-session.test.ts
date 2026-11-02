import { expect, it } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { PackedSession, type PackedTicket } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'
import type { PackedWork } from '../../src/packing-work'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 8, readers: 8 }
const output = { retained: 2 * MiB, staging: 2 * MiB }
const wide = Object.fromEntries(Array.from({ length: 4097 }, (_, i) => [`field-${i}`, i]))
function source(text: string, revision: number) {
  return new PackedSource(
    {
      generation: 1,
      documentId: 'copy-session',
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
    original = source('old', 0)
  const ticket = session.beginPrepared(original)
  session.commit(
    session.prepareFull(
      ticket,
      original.identity,
      packValue({ wide, list: [0, 1, 2, 3] }, limits.bytes),
    ),
  )
  return { session, original, old: session.capture() }
}
function update(session: PackedSession, original: PackedSource, invalid = false) {
  const next = source('new', 1),
    ticket = session.beginPrepared(next)
  const payload = packValue({ items: ['A', 'B'], value: 99 }, limits.bytes)
  const arena = PackedArena.open(payload.slice(0), limits)
  const items = arena.field(arena.root, 'items'),
    value = arena.field(arena.root, 'value')
  if (items === undefined || value === undefined) throw new Error('Missing fixture records')
  const operations = [
    { kind: 'splice' as const, path: ['list'], start: 1, remove: 1, record: items },
    { kind: 'replace' as const, path: ['list', 3], record: value },
    { kind: 'replace' as const, path: ['wide', 'field-4096'], record: value },
    ...(invalid ? [{ kind: 'replace' as const, path: ['missing'], record: value }] : []),
  ]
  const work = session.prepareDeltaSteps(
    ticket,
    {
      base: original.identity,
      baseSource: original.text,
      result: next.identity,
      payload,
      operations,
    },
    1024,
  )
  expect(payload.byteLength).toBe(0)
  return { work, next }
}
function finish(work: PackedWork<PackedTicket>): PackedTicket {
  while (true) {
    const step = work.next()
    if (step.done) {
      if (!step.value) throw new Error('Cancelled update')
      return step.value
    }
  }
}

it('publishes ordered array and wide-object copies together while old captures stay immutable', () => {
  const { session, original, old } = initial()
  try {
    const { work, next } = update(session, original)
    let pauses = 0,
      prepared: PackedTicket | undefined
    while (true) {
      const step = work.next()
      expect(session.stats.current).toEqual(original.identity)
      expect(old.reader.scalar(['wide', 'field-4096'], output)).toBe(4096)
      expect(old.reader.scalar(['list', 3], output)).toBe(3)
      expect(session.stats.retainedBytes).toBeLessThanOrEqual(limits.retained)
      expect(session.stats.preparingStagingBytes).toBeLessThanOrEqual(limits.staging)
      if (step.done) {
        prepared = step.value
        break
      }
      expect(session.stats.prepared).toBeNull()
      pauses++
    }
    expect(pauses).toBeGreaterThan(40)
    if (!prepared) throw new Error('Missing prepared update')
    session.commit(prepared)
    expect(session.stats.current).toEqual(next.identity)
    const current = session.capture()
    try {
      expect(current.reader.scalar(['wide', 'field-4096'], output)).toBe(99)
      expect([0, 1, 2, 3, 4].map((i) => current.reader.scalar(['list', i], output))).toEqual([
        0,
        'A',
        'B',
        99,
        3,
      ])
      expect(old.reader.scalar(['wide', 'field-4096'], output)).toBe(4096)
      expect(old.reader.scalar(['list', 3], output)).toBe(3)
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
  it.each([1, 20, 40])(
    `rolls back suspended metadata copies on ${action}, revision advances=%s`,
    (advances) => {
      const { session, original, old } = initial()
      try {
        const { work } = update(session, original)
        while (session.stats.preparingPhase !== 'revision') expect(work.next().done).toBe(false)
        for (let i = 0; i < advances; i++) expect(work.next().done).toBe(false)
        expect(session.stats.prepared).toBeNull()
        if (action === 'return') work.return()
        else if (action === 'throw')
          expect(() => work.throw(new Error('cancel copy session'))).toThrow('cancel copy session')
        else if (action === 'replace') session.beginPrepared(source('newer', 2))
        else session[action]()
        expect(work.next()).toEqual({ done: true, value: undefined })
        expect(session.stats).toMatchObject({
          preparingBytes: 0,
          preparingStagingBytes: 0,
          outgoingReservedBytes: 0,
          prepared: null,
        })
        if (action === 'dispose') expect(() => old.reader.kind()).toThrow('released')
        else {
          expect(old.reader.scalar(['wide', 'field-4096'], output)).toBe(4096)
          expect(old.reader.scalar(['list', 3], output)).toBe(3)
        }
      } finally {
        old.release()
        session.dispose()
      }
      expect(session.stats.retainedBytes).toBe(0)
    },
  )

it('rolls back a late bad path after the complete private wide-field replacement', () => {
  const { session, original, old } = initial()
  try {
    const { work } = update(session, original, true)
    expect(() => finish(work)).toThrow('Missing or invalid packed path')
    expect(work.next().done).toBe(true)
    expect(session.stats.current).toEqual(original.identity)
    expect(session.stats).toMatchObject({
      preparingBytes: 0,
      preparingStagingBytes: 0,
      outgoingReservedBytes: 0,
      prepared: null,
    })
    expect(old.reader.scalar(['wide', 'field-4096'], output)).toBe(4096)
    expect(old.reader.scalar(['list', 3], output)).toBe(3)
  } finally {
    old.release()
    session.dispose()
  }
})
