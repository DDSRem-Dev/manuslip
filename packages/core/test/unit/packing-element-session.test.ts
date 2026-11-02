import { expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { PackedSession } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 8, readers: 16 }
const output = { retained: 2 * MiB, staging: 8 * MiB }
const point = (offset: number) => ({ line: 3, column: 5, offset })
const position = (offset: number) => ({ start: point(offset), end: point(offset + 1) })
const values = Array.from({ length: 4097 }, (_, index) => ({
  index,
  position: position(10 + index * 2),
}))
const inserted = packValue([values[0]], limits.bytes)
const insertionRoot = PackedArena.open(inserted.slice(0), limits).root
function source(text: string, revision: number) {
  return new PackedSource(
    {
      generation: 1,
      documentId: 'element-session',
      revision,
      sourceHash: sourceHash(text),
      parserVersion: 'test',
      rendererVersion: 'test',
      options: 'default',
    },
    text,
  )
}
function fixture() {
  const session = new PackedSession(limits),
    base = source('base', 0)
  session.commit(
    session.prepareFull(
      session.beginPrepared(base),
      base.identity,
      packValue({ rows: [{ items: values }], first: values[0] }, limits.bytes),
    ),
  )
  const edited = source('segments', 1)
  session.commit(
    session.prepareDelta(session.beginPrepared(edited), {
      base: base.identity,
      baseSource: base.text,
      result: edited.identity,
      payload: inserted.slice(0),
      operations: Array.from({ length: 256 }, (_, index) => ({
        kind: 'splice' as const,
        path: ['rows', 0, 'items'],
        start: index * 2,
        remove: 1,
        record: insertionRoot,
      })),
    }),
  )
  const old = session.capture(),
    shifted = source('shifted', 2)
  const payload = packValue(null, limits.bytes)
  const work = session.prepareDeltaSteps(session.beginPrepared(shifted), {
    base: edited.identity,
    baseSource: edited.text,
    result: shifted.identity,
    payload,
    operations: [{ kind: 'offset', path: ['rows'], start: 0, offset: 3 }],
  })
  expect(payload.byteLength).toBe(0)
  while (true) {
    const step = work.next()
    if (step.done) {
      if (!step.value) throw new Error('Cancelled element fixture')
      session.commit(step.value)
      break
    }
  }
  return { session, old, capture: session.capture() }
}
function referenceProbe() {
  let reads = 0
  const original = PackedArena.prototype.elements
  const spy = vi.spyOn(PackedArena.prototype, 'elements').mockImplementation(function* (
    this: PackedArena,
    id: number,
  ) {
    for (const value of original.call(this, id)) {
      reads++
      yield value
    }
  })
  return { count: () => reads, close: () => spy.mockRestore() }
}
function expectedIndex(index: number) {
  return index < 512 && index % 2 === 0 ? 0 : index
}

it('reads the full shifted nested overlay without changing positions, aliases or an old capture', () => {
  const { session, old, capture } = fixture(),
    probe = referenceProbe()
  try {
    const cursor = capture.reader.elementSteps(['rows', 0, 'items'])
    expect(session.stats.readers).toBe(1)
    let index = 0,
      pauses = 0
    while (true) {
      const before = probe.count(),
        step = cursor.next()
      expect(probe.count() - before).toBeLessThanOrEqual(256)
      expect(session.stats.retainedBytes).toBeLessThanOrEqual(limits.retained)
      if (step.done) break
      if (!step.value) {
        pauses++
        continue
      }
      const original = expectedIndex(index)
      expect(step.value.scalar(['index'], output)).toBe(original)
      expect(step.value.position(['position'], output)).toEqual(position(10 + original * 2 + 3))
      index++
    }
    expect(index).toBe(4097)
    expect(pauses).toBeGreaterThan(500)
    expect(old.reader.position(['rows', 0, 'items', 4096, 'position'], output)).toEqual(
      position(10 + 4096 * 2),
    )
    expect(capture.reader.position(['first', 'position'], output)).toEqual(position(10))
    expect(session.stats.readers).toBe(0)
  } finally {
    probe.close()
    old.release()
    capture.release()
    session.dispose()
  }
  expect(session.stats.retainedBytes).toBe(0)
})

for (const action of ['return', 'release', 'dispose'] as const)
  it.each([0, 1, 20, 80])(
    `revokes an actual nested array cursor on ${action} after %s advances`,
    (advances) => {
      const { session, old, capture } = fixture(),
        cursor = capture.reader.elementSteps(['rows', 0, 'items'])
      let previous: ReturnType<typeof cursor.next>['value']
      try {
        for (let index = 0; index < advances; index++) {
          const step = cursor.next()
          expect(step.done).toBe(false)
          if (step.value) previous = step.value
        }
        if (action === 'return') cursor.return()
        else if (action === 'release') capture.release()
        else session.dispose()
        expect(cursor.next()).toEqual({ done: true, value: undefined })
        expect(session.stats.readers).toBe(0)
        if (previous) expect(() => previous.scalar(['index'], output)).toThrow('scope expired')
        if (action !== 'dispose')
          expect(old.reader.position(['rows', 0, 'items', 4096, 'position'], output)).toEqual(
            position(10 + 4096 * 2),
          )
      } finally {
        cursor.return()
        capture.release()
        old.release()
        session.dispose()
      }
      expect(session.stats.retainedBytes).toBe(0)
    },
  )

for (const action of ['invalidate', 'replace', 'evict'] as const)
  it(`keeps an independent captured array readable after current-session ${action}`, () => {
    const { session, old, capture } = fixture(),
      cursor = capture.reader.elementSteps(['rows', 0, 'items'])
    try {
      if (action === 'replace') session.beginPrepared(source('newer', 3))
      else session[action]()
      let count = 0
      for (const item of cursor)
        if (item) {
          expect(item.scalar(['index'], output)).toBe(expectedIndex(count))
          count++
        }
      expect(count).toBe(4097)
      expect(session.stats.readers).toBe(0)
      expect(old.reader.position(['rows', 0, 'items', 4096, 'position'], output)).toEqual(
        position(10 + 4096 * 2),
      )
    } finally {
      cursor.return()
      old.release()
      capture.release()
      session.dispose()
    }
    expect(session.stats.retainedBytes).toBe(0)
  })

it('keeps an independently opened nested cursor alive after the parent item expires', () => {
  const { session, old, capture } = fixture(),
    rows = capture.reader.elementSteps(['rows'])
  try {
    let row = rows.next()
    while (!row.done && !row.value) row = rows.next()
    if (!row.value) throw new Error('Missing row')
    const selected = row.value,
      items = selected.elementSteps(['items'])
    rows.return()
    expect(() => selected.length(['items'])).toThrow('scope expired')
    let count = 0
    for (const item of items)
      if (item) {
        expect(item.scalar(['index'], output)).toBe(expectedIndex(count))
        count++
      }
    expect(count).toBe(4097)
    expect(session.stats.readers).toBe(0)
  } finally {
    rows.return()
    old.release()
    capture.release()
    session.dispose()
  }
  expect(session.stats.retainedBytes).toBe(0)
})
