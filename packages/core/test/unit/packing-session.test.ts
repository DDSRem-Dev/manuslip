import { describe, expect, it } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import type { PackedReadScope } from '../../src/packing-capture'
import type { PackedResource } from '../../src/packing-resources'
import { PackedSession, type PackedSessionLimits } from '../../src/packing-session'
import { type PackedIdentity, PackedSource } from '../../src/packing-source'
import type { PackedPath } from '../../src/packing-view'
import { parseMarkdown } from '../../src/parse'
import { SemanticDependencies } from '../../src/semantic-dependencies'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 16, readers: 64 }
const outputs = { retained: 8 * MiB, staging: 8 * MiB }
const identity = (source: string, revision = 0): PackedIdentity => ({
  generation: 1,
  documentId: 'test-document',
  revision,
  sourceHash: sourceHash(source),
  parserVersion: 'parser-test',
  rendererVersion: 'renderer-test',
  options: 'default',
})
function publish(session: PackedSession, value: unknown, source = 'source', revision = 0) {
  const result = identity(source, revision)
  const ticket = session.begin(result, source)
  const prepared = session.prepareFull(ticket, result, packValue(value, limits.bytes))
  session.commit(prepared)
  return result
}
function read(reader: PackedReadScope, path: PackedPath = []): unknown {
  switch (reader.kind(path)) {
    case 'scalar':
      return reader.scalar(path, outputs)
    case 'position':
      return reader.position(path, outputs)
    case 'array': {
      const values: unknown[] = []
      for (const child of reader.elements(path)) values.push(read(child))
      return values
    }
    case 'object':
      return Object.fromEntries(
        reader.keys(path, outputs).map((key) => [key, read(reader, [...path, key])]),
      )
  }
}

describe('bounded packed snapshot sessions', () => {
  it('forks an exact independently charged capture across release, replacement and eviction', () => {
    const session = new PackedSession({ ...limits, captures: 2 })
    try {
      publish(session, { value: 'first' })
      const first = session.capture(),
        before = session.stats.retainedBytes
      const fork = first.retain()
      expect(session.stats.retainedBytes - before).toBe(256)
      expect(fork.sameRevision(first)).toBe(true)
      expect(() => first.retain()).toThrow(/capture limit/)
      first.release()
      expect(() => first.retain()).toThrow(/released/)
      publish(session, { value: 'second' }, 'changed', 1)
      session.evict()
      expect(read(fork.reader)).toEqual({ value: 'first' })
      fork.release()
      expect(session.stats.retainedBytes).toBe(256)
    } finally {
      session.dispose()
    }
  })
  it.each(['commit', 'discard', 'invalidate', 'dispose'] as const)(
    'revokes prepared capture forks on %s',
    (end) => {
      const session = new PackedSession(limits),
        id = identity('prepared')
      const prepared = session.prepareFull(
        session.begin(id, 'prepared'),
        id,
        packValue({ value: 1 }, limits.bytes),
      )
      const original = session.capturePrepared(prepared),
        fork = original.retain(),
        second = fork.retain()
      original.release()
      if (end === 'commit') session.commit(prepared)
      if (end === 'discard') session.discard(prepared)
      if (end === 'invalidate') session.invalidate()
      if (end === 'dispose') session.dispose()
      for (const capture of [fork, second]) {
        expect(() => capture.retain()).toThrow(/released/)
        expect(() => capture.reader.kind()).toThrow(/released/)
      }
      expect(session.stats.captures).toBe(0)
      session.dispose()
      expect(session.stats.retainedBytes).toBe(0)
    },
  )
  it('shares the actual validated source between derived indexes, requests and committed results', () => {
    const source = '[r]\n\n[r]: /r\n'
    const session = new PackedSession(limits)
    const checked = new PackedSource(identity(source), source)
    const request = session.beginPrepared(checked)
    session.commit(
      session.prepareFull(
        request,
        checked.identity,
        packValue(parseMarkdown(source).root, limits.bytes),
      ),
    )
    const capture = session.capture()
    expect(capture.sourceResource).toBe(checked)
    const index = SemanticDependencies.build(capture, source, [], {
      retained: 8 * MiB,
      staging: MiB,
      nodes: 800000,
      depth: 64,
    })
    expect(index.sourceResource).toBe(checked)
    const before = session.stats.retainedBytes
    const hold = session.retain(index)
    const first = session.stats.retainedBytes - before
    expect(first).toBe(index.retainedBytes - checked.retainedBytes + 192 + 256 + 2 * 64)
    const second = session.retain(index)
    expect(session.stats.retainedBytes - before - first).toBe(256 + 2 * 64)
    session.invalidate()
    expect(session.stats.holds).toBe(2)
    session.evict()
    capture.release()
    expect(index.resolve('link', 'R')?.selected).toBe(true)
    second.release()
    hold.release()
    hold.release()
    expect(session.stats.retainedBytes).toBe(256)
    expect(session.stats.holds).toBe(0)
    session.dispose()
    expect(() => session.beginPrepared(checked)).toThrow('disposed')
  })

  it('charges distinct equal source objects separately and unions true shared source references', () => {
    const source = 'same source'
    const one = new PackedSource(identity(source), source)
    const two = new PackedSource(identity(source), source)
    const session = new PackedSession(limits)
    const footprint = (value: PackedSource) => ({
      resources: () => [{ key: value, bytes: value.retainedBytes }],
    })
    const first = session.retain(footprint(one))
    const before = session.stats.retainedBytes
    const shared = session.retain(footprint(one))
    expect(session.stats.retainedBytes - before).toBe(320)
    const again = session.stats.retainedBytes
    const separate = session.retain(footprint(two))
    expect(session.stats.retainedBytes - again).toBe(320 + two.retainedBytes + 192)
    first.release()
    shared.release()
    separate.release()
    session.dispose()
  })

  it('admits derived ownership at the exact boundary and holds it through cancellation', () => {
    const resource = { key: {}, bytes: 4096 }
    const footprint = { resources: () => [resource, resource] }
    const probe = new PackedSession(limits)
    probe.retain(footprint)
    const boundary = probe.stats.retainedBytes
    probe.dispose()
    const exact = new PackedSession({ ...limits, retained: boundary })
    const hold = exact.retain(footprint)
    exact.invalidate()
    expect(exact.stats.retainedBytes).toBe(boundary)
    expect(exact.stats.holds).toBe(1)
    const tooSmall = new PackedSession({ ...limits, retained: boundary - 1 })
    const before = tooSmall.stats
    expect(() => tooSmall.retain(footprint)).toThrow('retained limit')
    expect(tooSmall.stats).toEqual(before)
    hold.release()
    expect(exact.stats.retainedBytes).toBe(256)
    exact.dispose()
    tooSmall.dispose()
  })

  it('rejects malformed or unbounded derived footprints without pinning any prefix', () => {
    const session = new PackedSession(limits)
    const key = {}
    const before = session.stats
    for (const resources of [
      [{ key, bytes: -1 }],
      [{ key, bytes: NaN }],
      [{ key, bytes: 0.5 }],
      [{ key: null, bytes: 1 }],
      [{ key: 'not an object', bytes: 1 }],
      [
        { key, bytes: 1 },
        { key, bytes: 2 },
      ],
    ]) {
      expect(() => session.retain({ resources: () => resources as PackedResource[] })).toThrow(
        'footprint',
      )
      expect(session.stats).toEqual(before)
    }
    expect(() =>
      session.retain({
        *resources() {
          while (true) yield { key, bytes: 1 }
        },
      }),
    ).toThrow('footprint')
    expect(session.stats).toEqual(before)
    const tight = new PackedSession({ ...limits, staging: 1024 })
    expect(() => tight.retain({ resources: () => [{ key, bytes: 1 }] })).toThrow('staging limit')
    expect(tight.stats.holds).toBe(0)
    tight.dispose()
    session.dispose()
  })

  it('bounds accounting handles, releases all of them on disposal and ignores later releases', () => {
    const session = new PackedSession(limits)
    const holds = Array.from({ length: 256 }, () => session.retain({ resources: () => [] }))
    expect(() => session.retain({ resources: () => [] })).toThrow('hold limit')
    session.dispose()
    for (const hold of holds) hold.release()
    expect(session.stats.holds).toBe(0)
    expect(session.stats.resources).toBe(0)
    expect(session.stats.retainedBytes).toBe(0)
  })

  it('offers pre-commit inspection and revokes that scope on discard or successful commit', () => {
    const session = new PackedSession(limits)
    publish(session, ['accepted'])
    const accepted = session.capture()
    const result = identity('next', 1)
    const request = session.begin(result, 'next')
    const before = session.stats.retainedBytes
    const prepared = session.prepareFull(request, result, packValue(['candidate'], limits.bytes))
    const inspection = session.capturePrepared(prepared)
    const iterator = inspection.reader.elements()
    expect(read(inspection.reader)).toEqual(['candidate'])
    expect(read(accepted.reader)).toEqual(['accepted'])
    session.discard(prepared)
    expect(() => inspection.reader.kind()).toThrow('released')
    expect(iterator.next().done).toBe(true)
    expect(session.stats.retainedBytes).toBe(before)
    const retry = session.prepareFull(request, result, packValue(['valid'], limits.bytes))
    const checked = session.capturePrepared(retry)
    expect(read(checked.reader)).toEqual(['valid'])
    session.commit(retry)
    expect(() => checked.reader.kind()).toThrow('released')
    expect(read(accepted.reader)).toEqual(['accepted'])
    const current = session.capture()
    expect(read(current.reader)).toEqual(['valid'])
    current.release()
    accepted.release()
    session.dispose()
  })

  it('resyncs ownership and versions without changing an explicitly captured old document', () => {
    const session = new PackedSession(limits)
    const original = publish(session, 'old-document')
    const old = session.capture()
    const result = {
      ...identity('other-source'),
      generation: 2,
      documentId: 'other-document',
      parserVersion: 'new-parser',
      rendererVersion: 'new-renderer',
      options: 'new-options',
    }
    const ticket = session.begin(result, 'other-source')
    session.commit(session.prepareFull(ticket, result, packValue('new-document', limits.bytes)))
    const current = session.capture()
    expect(current.identity).toEqual(result)
    expect(current.reader.scalar([], outputs)).toBe('new-document')
    expect(old.identity).toEqual(original)
    expect(old.reader.scalar([], outputs)).toBe('old-document')
    const before = session.stats.retainedBytes
    old.release()
    expect(session.stats.retainedBytes).toBeLessThan(before - 256)
    current.release()
    session.dispose()
  })

  it('holds outgoing reserves against later readers and admits the exact aggregate boundary', () => {
    const stage = (retained: number) => {
      const session = new PackedSession({ ...limits, retained })
      publish(session, [1])
      const capture = session.capture()
      const result = identity('next', 1)
      const request = session.begin(result, 'next')
      try {
        const prepared = session.prepareFull(request, result, packValue([2], limits.bytes), 4096)
        return { session, capture, prepared }
      } catch (error) {
        session.dispose()
        throw error
      }
    }
    const probe = stage(limits.retained)
    const boundary = probe.session.stats.retainedBytes
    probe.session.dispose()
    const exact = stage(boundary)
    expect(exact.session.stats.retainedBytes).toBe(boundary)
    expect(() => exact.capture.reader.elements()).toThrow('reader scope limit')
    expect(exact.session.stats.readers).toBe(0)
    exact.session.discard(exact.prepared)
    exact.capture.reader.elements().return()
    exact.session.dispose()
    expect(() => stage(boundary - 1)).toThrow('retained')
  })

  it('rejects request and preparation tickets from another session with equal identities', () => {
    const first = new PackedSession(limits)
    const second = new PackedSession(limits)
    const result = identity('source')
    const one = first.begin(result, 'source')
    const two = second.begin(result, 'source')
    const payload = packValue(null, limits.bytes)
    expect(() => second.prepareFull(one, result, payload)).toThrow('Stale')
    expect(payload.byteLength).toBeGreaterThan(0)
    const prepared = second.prepareFull(two, result, payload)
    expect(() => first.commit(prepared)).toThrow('Stale')
    second.commit(prepared)
    first.dispose()
    second.dispose()
  })

  it('keeps prepared results private and transfers only the exact ticket to current ownership', () => {
    const session = new PackedSession(limits)
    expect(() => session.capture()).toThrow('unavailable')
    const result = identity('source')
    const request = session.begin(result, 'source')
    const payload = packValue(['complete', 2], limits.bytes)
    const view = new Uint8Array(payload)
    const prepared = session.prepareFull(request, result, payload, 1024)
    expect(payload.byteLength).toBe(0)
    expect(view.byteLength).toBe(0)
    expect(session.stats.current).toBeNull()
    expect(session.stats.outgoingReservedBytes).toBe(1024)
    expect(() => session.commit({ identity: result })).toThrow('Stale')
    session.commit(prepared)
    expect(session.stats.outgoingReservedBytes).toBe(0)
    const capture = session.capture()
    expect(read(capture.reader)).toEqual(['complete', 2])
    expect(Object.isFrozen(prepared.identity)).toBe(true)
    expect(() => session.commit(prepared)).toThrow('Stale')
    capture.release()
    session.dispose()
    expect(session.stats).toMatchObject({ retainedBytes: 0, resources: 0, disposed: true })
  })

  it('rejects old requests/preparations even when all identity values repeat after resync', () => {
    const session = new PackedSession(limits)
    publish(session, 'accepted')
    const result = identity('next', 1)
    const old = session.begin(result, 'next')
    const prepared = session.prepareFull(old, result, packValue('stale', limits.bytes))
    const newest = session.begin(result, 'next')
    expect(() => session.commit(prepared)).toThrow('Stale')
    const stalePayload = packValue('late', limits.bytes)
    expect(() => session.prepareFull(old, result, stalePayload)).toThrow('Stale')
    expect(stalePayload.byteLength).toBeGreaterThan(0)
    session.commit(session.prepareFull(newest, result, packValue('newest', limits.bytes)))
    const capture = session.capture()
    expect(capture.reader.scalar([], outputs)).toBe('newest')
    capture.release()
    session.dispose()
  })

  it('rejects every result/base identity mismatch before consuming its payload', () => {
    const session = new PackedSession(limits)
    const base = publish(session, [1])
    const result = identity('next', 1)
    const ticket = session.begin(result, 'next')
    for (const key of Object.keys(result) as (keyof PackedIdentity)[]) {
      const wrong = { ...result, [key]: typeof result[key] === 'number' ? 9 : 'wrong' }
      const payload = packValue([2], limits.bytes)
      expect(() => session.prepareFull(ticket, wrong, payload)).toThrow('identity')
      expect(payload.byteLength).toBeGreaterThan(0)
      expect(() =>
        session.prepareDelta(ticket, {
          base: { ...base, [key]: wrong[key] },
          baseSource: 'source',
          result,
          payload,
          operations: [],
        }),
      ).toThrow('base unavailable')
      expect(payload.byteLength).toBeGreaterThan(0)
    }
    const payload = packValue([2], limits.bytes)
    expect(() =>
      session.prepareDelta(ticket, {
        base,
        baseSource: 'wrong exact source',
        result,
        payload,
        operations: [],
      }),
    ).toThrow('base unavailable')
    expect(payload.byteLength).toBeGreaterThan(0)
    session.dispose()
  })

  it('preserves captures through delta commit and charges shared arenas once', () => {
    const session = new PackedSession(limits)
    const base = publish(session, ['old', 'untouched'])
    const baseline = session.stats.retainedBytes
    const old = session.capture()
    expect(session.stats.retainedBytes - baseline).toBe(256)
    const second = session.capture()
    expect(session.stats.retainedBytes - baseline).toBe(512)
    const result = identity('next', 1)
    const request = session.begin(result, 'next')
    const prepared = session.prepareDelta(request, {
      base,
      baseSource: 'source',
      result,
      payload: packValue('new', limits.bytes),
      operations: [{ kind: 'replace', path: [0], record: 0 }],
    })
    session.commit(prepared)
    const current = session.capture()
    expect(read(current.reader)).toEqual(['new', 'untouched'])
    expect(read(old.reader)).toEqual(['old', 'untouched'])
    expect(read(second.reader)).toEqual(['old', 'untouched'])
    const before = session.stats.retainedBytes
    old.release()
    old.release()
    expect(session.stats.retainedBytes).toBe(before - 256)
    second.release()
    current.release()
    session.dispose()
    expect(session.stats.retainedBytes).toBe(0)
  })

  it('drops failed partial work but retains the accepted base and request for explicit retry', () => {
    const session = new PackedSession(limits)
    const base = publish(session, ['old'])
    const result = identity('next', 1)
    const request = session.begin(result, 'next')
    const before = session.stats
    const payload = packValue('new', limits.bytes)
    expect(() =>
      session.prepareDelta(request, {
        base,
        baseSource: 'source',
        result,
        payload,
        operations: [
          { kind: 'replace', path: [0], record: 0 },
          { kind: 'replace', path: [9], record: 0 },
        ],
      }),
    ).toThrow()
    expect(payload.byteLength).toBe(0)
    expect(session.stats).toEqual(before)
    const capture = session.capture()
    expect(read(capture.reader)).toEqual(['old'])
    capture.release()
    session.commit(
      session.prepareDelta(request, {
        base,
        baseSource: 'source',
        result,
        payload: packValue('new', limits.bytes),
        operations: [{ kind: 'replace', path: [0], record: 0 }],
      }),
    )
    session.dispose()
  })

  it('retains a prepared outgoing reserve until discard, without erasing the request', () => {
    const session = new PackedSession(limits)
    publish(session, [1])
    const result = identity('next', 1)
    const request = session.begin(result, 'next')
    const before = session.stats.retainedBytes
    const prepared = session.prepareFull(request, result, packValue([2], limits.bytes), 4096)
    expect(session.stats.retainedBytes).toBeGreaterThan(before + 4096)
    expect(session.stats.outgoingReservedBytes).toBe(4096)
    expect(() => session.prepareFull(request, result, packValue([3], limits.bytes))).toThrow(
      'already pending',
    )
    expect(session.discard({ identity: result })).toBe(false)
    expect(session.discard(prepared)).toBe(true)
    expect(session.discard(prepared)).toBe(false)
    expect(session.stats.retainedBytes).toBe(before)
    expect(session.stats.requested).toEqual(result)
    session.dispose()
  })

  it('expires iterator items on advance and revokes escaped readers on capture release', () => {
    const session = new PackedSession(limits)
    publish(session, [[1, 2], [3]])
    const capture = session.capture()
    const root = capture.reader
    const iterator = root.elements()
    const first = iterator.next()
    if (first.done) throw new Error('fixture')
    const nested = first.value.elements()
    const item = nested.next()
    if (item.done) throw new Error('fixture')
    expect(item.value.scalar([], outputs)).toBe(1)
    iterator.next()
    expect(() => first.value.length()).toThrow('expired')
    expect(item.value.scalar([], outputs)).toBe(1)
    capture.release()
    expect(session.stats.readers).toBe(0)
    expect(iterator.next().done).toBe(true)
    expect(nested.next().done).toBe(true)
    expect(() => item.value.scalar([], outputs)).toThrow('expired')
    expect(() => root.kind()).toThrow('released')
    expect(() => capture.identity).toThrow('released')
    session.dispose()
  })

  it('closes iterator scopes on early break and respects shared reader/capture limits', () => {
    const session = new PackedSession({ ...limits, captures: 2, readers: 1 })
    publish(session, [1, 2])
    const first = session.capture()
    const second = session.capture()
    expect(() => session.capture()).toThrow('capture limit')
    for (const item of first.reader.elements()) {
      expect(item.scalar([], outputs)).toBe(1)
      expect(() => second.reader.elements()).toThrow('reader scope limit')
      break
    }
    expect(session.stats.readers).toBe(0)
    const iterator = second.reader.elements()
    iterator.return()
    iterator.return()
    expect(session.stats.readers).toBe(0)
    session.dispose()
    expect(() => first.reader.kind()).toThrow('released')
    expect(session.stats).toMatchObject({ retainedBytes: 0, captures: 0, readers: 0, resources: 0 })
  })

  it('requires releasing captures before a full resync can fit a tighter cache', () => {
    const session = new PackedSession({ ...limits, retained: Math.floor(1.5 * MiB) })
    publish(session, 'a'.repeat(MiB))
    const old = session.capture()
    let result = identity('replacement', 1)
    let request = session.begin(result, 'replacement')
    const payload = packValue('b'.repeat(MiB), limits.bytes)
    expect(() => session.prepareFull(request, result, payload)).toThrow('retained')
    session.evict()
    expect(old.reader.textLength()).toBe(MiB)
    expect(session.stats.current).toBeNull()
    request = session.begin(result, 'replacement')
    expect(() => session.prepareFull(request, result, payload)).toThrow('retained')
    old.release()
    session.commit(session.prepareFull(request, result, payload))
    expect(session.stats.current).toEqual(result)
    session.evict()
    result = identity('delta-without-base', 2)
    request = session.begin(result, 'delta-without-base')
    expect(() =>
      session.prepareDelta(request, {
        base: identity('replacement', 1),
        baseSource: 'replacement',
        result,
        payload: packValue('new', limits.bytes),
        operations: [],
      }),
    ).toThrow('resync')
    session.dispose()
  })

  it('compares a complete captured parse root to its independent native tree', () => {
    const source = '# 😀\n\nRead [text][r] and note[^one].\n\n[r]: /url\n\n[^one]: Body\n'
    const expected = parseMarkdown(source).root
    const session = new PackedSession(limits)
    publish(session, expected, source)
    const capture = session.capture()
    expect(read(capture.reader)).toEqual(expected)
    const keys = capture.reader.keys([], outputs)
    capture.release()
    expect(keys).toEqual(Object.keys(expected))
    expect(Object.isFrozen(keys)).toBe(true)
    session.dispose()
  })

  it('rejects malformed buffers and source/limit admission without changing accepted data', () => {
    const session = new PackedSession(limits)
    publish(session, 'accepted')
    const result = identity('next', 1)
    const request = session.begin(result, 'next')
    const before = session.stats
    const payload = packValue([1, 2], limits.bytes).slice(0, -1)
    expect(() => session.prepareFull(request, result, payload)).toThrow()
    expect(payload.byteLength).toBeGreaterThan(0)
    expect(session.stats).toEqual(before)
    for (const reserve of [-1, NaN, Infinity, 0.5, limits.retained + 1])
      expect(() =>
        session.prepareFull(request, result, packValue(null, limits.bytes), reserve),
      ).toThrow()
    expect(() => session.begin({ ...result, sourceHash: 'false' }, 'next')).toThrow('identity')
    expect(session.stats.current).not.toBeNull()
    expect(session.stats.requested).toBeNull()
    session.dispose()
    session.dispose()
    expect(() => session.begin(result, 'next')).toThrow('disposed')
    expect(() => session.capture()).toThrow('disposed')
  })

  it('validates every required limit and permits explicitly disabled captures/readers', () => {
    for (const key of Object.keys(limits) as (keyof PackedSessionLimits)[])
      for (const value of [undefined, -1, NaN, Infinity, 0.5])
        expect(() => new PackedSession({ ...limits, [key]: value } as PackedSessionLimits)).toThrow(
          'limits',
        )
    for (const changed of [
      { bytes: 3 },
      { bytes: 9 * MiB },
      { retained: 0 },
      { retained: 65 * MiB },
      { staging: 0 },
      { staging: 9 * MiB },
      { captures: 257 },
      { readers: 257 },
    ])
      expect(() => new PackedSession({ ...limits, ...changed })).toThrow('limits')
    const session = new PackedSession({ ...limits, captures: 0, readers: 0 })
    publish(session, null)
    expect(() => session.capture()).toThrow('capture limit')
    session.dispose()
  })
})
