import { describe, expect, it } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedSession, type PackedTicket } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'
import { packedTextStepCost } from '../../src/packing-text-stream'
import type { PackedWork } from '../../src/packing-work'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 8, readers: 8 }
const output = { retained: 2 * MiB, staging: 2 * MiB }
const source = (text: string, revision = 0) =>
  new PackedSource(
    {
      generation: 1,
      documentId: 'preparation',
      revision,
      sourceHash: sourceHash(text),
      parserVersion: 'test',
      rendererVersion: 'test',
      options: 'default',
    },
    text,
  )
function finish(work: PackedWork<PackedTicket>): PackedTicket {
  while (true) {
    const step = work.next()
    if (step.done) {
      if (!step.value) throw new Error('Cancelled preparation')
      return step.value
    }
  }
}
function initial(session: PackedSession) {
  const original = source('old')
  const ticket = session.beginPrepared(original)
  session.commit(
    session.prepareFull(ticket, original.identity, packValue({ text: 'old' }, limits.bytes)),
  )
  return original
}

describe('owned cooperative session preparation', () => {
  it('charges queued input, reserves outgoing bytes and publishes only a complete preparation', () => {
    const session = new PackedSession(limits)
    try {
      const original = initial(session)
      const old = session.capture()
      const next = source('new', 1)
      const ticket = session.beginPrepared(next)
      const before = session.stats.retainedBytes
      const payload = packValue({ text: 'x'.repeat(100000) }, limits.bytes)
      const bytes = payload.byteLength
      const work = session.prepareFullSteps(ticket, next.identity, payload, 4096)
      expect(payload.byteLength).toBe(0)
      expect(session.stats.preparingBytes).toBe(bytes + 256 + 192 + 2048)
      expect(session.stats.retainedBytes - before).toBe(session.stats.preparingBytes + 4096)
      expect(session.stats.outgoingReservedBytes).toBe(4096)
      let count = 0
      let prepared: PackedTicket | undefined
      while (true) {
        const step = work.next()
        expect(session.stats.current).toEqual(original.identity)
        expect(session.stats.retainedBytes).toBeLessThanOrEqual(limits.retained)
        expect(old.reader.scalar(['text'], output)).toBe('old')
        if (step.done) {
          prepared = step.value
          break
        }
        expect(session.stats.prepared).toBeNull()
        expect(session.stats.preparingBytes).toBeGreaterThan(bytes)
        count++
      }
      expect(count).toBeGreaterThan(20)
      if (!prepared) throw new Error('Missing preparation')
      expect(session.stats.preparingBytes).toBe(0)
      expect(session.stats.preparingStagingBytes).toBe(0)
      expect(session.stats.outgoingReservedBytes).toBe(4096)
      const inspection = session.capturePrepared(prepared)
      expect(inspection.reader.scalar(['text'], output)).toBe('x'.repeat(100000))
      session.commit(prepared)
      expect(() => inspection.reader.kind()).toThrow('released')
      expect(session.stats.current).toEqual(next.identity)
      expect(session.stats.outgoingReservedBytes).toBe(0)
      expect(old.reader.scalar(['text'], output)).toBe('old')
      old.release()
    } finally {
      session.dispose()
    }
    expect(session.stats.retainedBytes).toBe(0)
  })

  it.each(['return', 'throw', 'invalidate', 'replace', 'evict', 'dispose'] as const)(
    'revokes started and unstarted preparation on %s',
    (action) => {
      for (const started of [false, true]) {
        const session = new PackedSession(limits)
        try {
          initial(session)
          const old = session.capture()
          const next = source('new', 1)
          const ticket = session.beginPrepared(next)
          const before = session.stats
          const work = session.prepareFullSteps(
            ticket,
            next.identity,
            packValue('x'.repeat(100000), limits.bytes),
            1024,
          )
          if (started) expect(work.next().done).toBe(false)
          if (action === 'throw') expect(() => work.throw(new Error('stop'))).toThrow('stop')
          else if (action === 'return') work.return()
          else if (action === 'replace') session.beginPrepared(source('newer', 2))
          else session[action]()
          expect(work.next()).toEqual({ done: true, value: undefined })
          expect(session.stats).toMatchObject({
            preparingBytes: 0,
            preparingStagingBytes: 0,
            outgoingReservedBytes: 0,
            prepared: null,
          })
          if (action === 'return' || action === 'throw') {
            expect(session.stats).toEqual(before)
            // Cancellation leaves the exact request available for a retry.
            const retry = session.prepareFullSteps(
              ticket,
              next.identity,
              packValue('retry', limits.bytes),
            )
            session.discard(finish(retry))
          }
          if (action !== 'dispose') expect(old.reader.scalar(['text'], output)).toBe('old')
          else expect(() => old.reader.kind()).toThrow('released')
          old.release()
        } finally {
          session.dispose()
        }
        expect(session.stats.retainedBytes).toBe(0)
      }
    },
  )

  it('rolls back late malformed input and enforces one preparation per request', () => {
    const session = new PackedSession(limits)
    try {
      const next = source('new')
      const ticket = session.beginPrepared(next)
      const before = session.stats
      const bytes = new Uint8Array(packValue('x'.repeat(100000), limits.bytes))
      bytes[bytes.length - 2] = 120
      const work = session.prepareFullSteps(ticket, next.identity, bytes.buffer)
      expect(() =>
        session.prepareFull(ticket, next.identity, packValue('other', limits.bytes)),
      ).toThrow('pending')
      expect(() =>
        session.prepareFullSteps(ticket, next.identity, packValue('other', limits.bytes)),
      ).toThrow('pending')
      expect(work.next().done).toBe(false)
      expect(() => finish(work)).toThrow('string')
      expect(work.next().done).toBe(true)
      expect(session.stats).toEqual(before)
    } finally {
      session.dispose()
    }
  })

  it('copies delta identities, operations and paths before suspending; old captures stay exact', () => {
    const session = new PackedSession(limits)
    try {
      const base = initial(session)
      const old = session.capture()
      const next = source('new', 1)
      const ticket = session.beginPrepared(next)
      const path = ['text']
      const operation = { kind: 'replace' as const, path, record: 0 }
      const delta = {
        base: { ...base.identity },
        baseSource: base.text,
        result: { ...next.identity },
        payload: packValue('x'.repeat(100000), limits.bytes),
        operations: [operation],
      }
      const work = session.prepareDeltaSteps(ticket, delta)
      path[0] = 'missing'
      operation.record = 999999
      delta.operations.length = 0
      delta.base.revision = 999
      delta.result.revision = 999
      expect(delta.payload.byteLength).toBe(0)
      const prepared = finish(work)
      const inspection = session.capturePrepared(prepared)
      expect(inspection.reader.scalar(['text'], output)).toBe('x'.repeat(100000))
      session.commit(prepared)
      expect(old.reader.scalar(['text'], output)).toBe('old')
      old.release()
    } finally {
      session.dispose()
    }
  })

  it('shares staging with active text readers and releases failed decoder admission', () => {
    const constrained = { ...limits, staging: 400000 }
    const session = new PackedSession(constrained)
    try {
      initial(session)
      const capture = session.capture()
      const stream = capture.reader.textSteps(['text'], output)
      const next = source('new', 1)
      const ticket = session.beginPrepared(next)
      const payload = packValue({ ['key'.repeat(20000)]: 1 }, limits.bytes)
      const before = session.stats
      const work = session.prepareFullSteps(ticket, next.identity, payload)
      expect(() => finish(work)).toThrow('staging')
      expect(session.stats).toEqual(before)
      stream.return()
      const retry = session.prepareFullSteps(ticket, next.identity, packValue('done', limits.bytes))
      session.discard(finish(retry))
      capture.release()
    } finally {
      session.dispose()
    }
    expect(session.stats.retainedBytes).toBe(0)
  })

  it('reserves suspended decoder workspace against subsequently opened readers', () => {
    const session = new PackedSession({
      ...limits,
      staging: 2 * packedTextStepCost.workspace + 20000,
    })
    try {
      initial(session)
      const capture = session.capture()
      const next = source('new', 1)
      const ticket = session.beginPrepared(next)
      const work = session.prepareFullSteps(
        ticket,
        next.identity,
        packValue('x'.repeat(100000), limits.bytes),
      )
      expect(work.next().done).toBe(false)
      expect(session.stats.preparingStagingBytes).toBe(33280)
      const first = capture.reader.textSteps(['text'], output)
      expect(() => capture.reader.textSteps(['text'], output)).toThrow('staging')
      expect(session.stats.readers).toBe(1)
      work.return()
      const second = capture.reader.textSteps(['text'], output)
      expect(session.stats.readers).toBe(2)
      first.return()
      second.return()
      capture.release()
    } finally {
      session.dispose()
    }
    expect(session.stats.retainedBytes).toBe(0)
  })

  it('readmits index growth after other consumers use retained capacity while decoding is suspended', () => {
    const session = new PackedSession({ ...limits, retained: MiB })
    try {
      const next = source('new')
      const ticket = session.beginPrepared(next)
      const before = session.stats.retainedBytes
      const work = session.prepareFullSteps(
        ticket,
        next.identity,
        packValue(
          Array.from({ length: 1000 }, (_, i) => `value ${i}`),
          limits.bytes,
        ),
      )
      expect(work.next().done).toBe(false)
      const hold = session.retain({
        resources: () => [{ key: {}, bytes: MiB - session.stats.retainedBytes - 768 }],
      })
      const held = session.stats.retainedBytes
      expect(() => finish(work)).toThrow('retained')
      expect(session.stats.preparingBytes).toBe(0)
      expect(session.stats.preparingStagingBytes).toBe(0)
      expect(session.stats.prepared).toBeNull()
      expect(session.stats.retainedBytes).toBeLessThan(held)
      hold.release()
      expect(session.stats.retainedBytes).toBe(before)
    } finally {
      session.dispose()
    }
    expect(session.stats.retainedBytes).toBe(0)
  })
})
