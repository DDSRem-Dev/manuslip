import { describe, expect, it } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import type { PackedCapture } from '../../src/packing-capture'
import {
  type PackedReceived,
  PackedReceiver,
  type PackedValidator,
} from '../../src/packing-receiver'
import { PackedSource } from '../../src/packing-source'
import { newPackedToken } from '../../src/packing-token'
import { packedWireVersion } from '../../src/packing-wire'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 8, readers: 64 }
const scalar = { retained: MiB, staging: MiB }
const source = (text: string, revision = 0) =>
  new PackedSource(
    {
      generation: 1,
      documentId: 'receiver-steps',
      revision,
      sourceHash: sourceHash(text),
      parserVersion: 'parser',
      rendererVersion: 'renderer',
      options: 'options',
    },
    text,
  )
const packet = (ticket: ReturnType<PackedReceiver['begin']>, text = 'old') => ({
  protocol: packedWireVersion,
  kind: 'full',
  sequence: ticket.sequence,
  result: ticket.identity,
  requestToken: ticket.requestToken,
  resultToken: newPackedToken(),
  sentAt: 0,
  payload: packValue({ items: [text, text, text] }, 8 * MiB),
  metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
})
function drain(work: IterableIterator<void, PackedReceived | undefined>): PackedReceived {
  for (let step = 0; step < 100; step++) {
    const result = work.next()
    if (result.done && result.value) return result.value
    if (result.done) throw new Error('Cancelled work')
  }
  throw new Error('Incomplete work')
}
function advanceToInspection(
  receiver: PackedReceiver,
  work: IterableIterator<void, PackedReceived | undefined>,
) {
  for (let step = 0; step < 100; step++) {
    expect(work.next().done).toBe(false)
    if (receiver.stats.prepared) return
  }
  throw new Error('Missing prepared inspection')
}
function* validate(capture: PackedCapture, checked: PackedSource) {
  for (const item of capture.reader.elements(['items'])) {
    if (item.scalar([], scalar) !== checked.text) throw new Error('Invalid item')
    yield
  }
}
function initial(receiver: PackedReceiver) {
  const ticket = receiver.begin(1, source('old'))
  const received = drain(receiver.receiveSteps(ticket, packet(ticket)))
  if (received.kind !== 'accepted') throw new Error('Expected acceptance')
  return received.capture
}

describe('cooperative packed receipt', () => {
  it.each(['complete', 'cancel', 'replace'] as const)(
    'handles a suspended delta summary with no early acknowledgement: %s',
    (action) => {
      const receiver = new PackedReceiver(limits, () => {})
      try {
        const originalSource = source('old')
        const originalTicket = receiver.begin(1, originalSource)
        const message = {
          ...packet(originalTicket),
          payload: packValue(
            Array.from({ length: 5000 }, (_, i) => ({
              number: i,
              position: {
                start: { line: 1, column: 1, offset: i + 10 },
                end: { line: 1, column: 2, offset: i + 11 },
              },
            })),
            limits.bytes,
          ),
        }
        const original = receiver.receive(originalTicket, message)
        if (original.kind !== 'accepted') throw new Error('Missing initial capture')
        const next = source('new', 1)
        const ticket = receiver.begin(2, next)
        const delta = {
          ...packet(ticket),
          kind: 'delta',
          base: originalSource.identity,
          baseToken: original.acknowledgement.resultToken,
          operations: [{ kind: 'offset', path: [], start: 0, offset: 1 }],
          payload: packValue(null, limits.bytes),
        }
        const work = receiver.receiveSteps(ticket, delta)
        let steps = 0
        while (receiver.stats.preparingStagingBytes < 50000) {
          const step = work.next()
          expect(step.done).toBe(false)
          expect(step.value).toBeUndefined()
          expect(receiver.stats.current).toEqual(originalSource.identity)
          if (++steps > 10000) throw new Error('No suspended summary')
        }
        expect(receiver.stats.preparingPhase).toBe('revision')
        expect(receiver.stats.prepared).toBeNull()
        if (action === 'cancel') receiver.cancel(ticket)
        else if (action === 'replace') {
          const newer = receiver.begin(3, source('newer', 2))
          expect(work.next()).toEqual({ done: true, value: undefined })
          expect(receiver.cancel(ticket)).toBe(false)
          receiver.cancel(newer)
        } else {
          let accepted: PackedReceived | undefined
          for (let i = 0; i < 10000; i++) {
            const step = work.next()
            if (step.done) {
              accepted = step.value
              break
            }
            expect(receiver.stats.current).toEqual(originalSource.identity)
          }
          if (accepted?.kind !== 'accepted') throw new Error('Missing accepted delta')
          expect(accepted.acknowledgement.resultToken).toBe(delta.resultToken)
          expect(accepted.capture.reader.position([4999, 'position'], limits).start.offset).toBe(
            5010,
          )
          accepted.capture.release()
        }
        expect(work.next()).toEqual({ done: true, value: undefined })
        expect(receiver.stats.preparingBytes).toBe(0)
        expect(receiver.stats.preparingStagingBytes).toBe(0)
        expect(original.capture.reader.position([4999, 'position'], limits).start.offset).toBe(5009)
        original.capture.release()
      } finally {
        receiver.dispose()
      }
      expect(receiver.stats.retainedBytes).toBe(0)
    },
  )
  it.each(['evict', 'dispose'] as const)(
    'prevents cleanup from creating untracked work during %s',
    (action) => {
      const receiver = new PackedReceiver(limits, function* () {
        try {
          yield
        } finally {
          expect(() => receiver.begin(2, source('new', 1))).toThrow(/disposed|evicting/)
        }
      })
      try {
        const ticket = receiver.begin(1, source('old'))
        const work = receiver.receiveSteps(ticket, packet(ticket))
        advanceToInspection(receiver, work)
        work.next()
        receiver[action]()
        expect(work.next().done).toBe(true)
        expect(receiver.stats).toMatchObject({
          current: null,
          requested: null,
          prepared: null,
          readers: 0,
          captures: 0,
        })
        if (action === 'evict') {
          const retry = receiver.begin(3, source('new', 1))
          expect(receiver.cancel(retry)).toBe(true)
        }
      } finally {
        receiver.dispose()
      }
      expect(receiver.stats.retainedBytes).toBe(0)
    },
  )
  it('publishes exactly once after every validation step, preserving the original capture', () => {
    const receiver = new PackedReceiver(limits, validate)
    try {
      const old = initial(receiver)
      const next = source('new', 1)
      const ticket = receiver.begin(1, next)
      const message = packet(ticket, 'new')
      const incomingBytes = message.payload.byteLength
      const before = receiver.stats.retainedBytes
      const work = receiver.receiveSteps(ticket, message)
      expect(receiver.stats.holds).toBe(2)
      expect(receiver.stats.retainedBytes - before).toBeGreaterThan(incomingBytes)
      expect(message.payload.byteLength).toBe(0)
      message.sequence = 999
      message.metadata.cached = true
      expect(receiver.stats.current?.revision).toBe(0)
      expect(() => receiver.receiveSteps(ticket, message)).toThrow('pending')
      let done: IteratorResult<void, PackedReceived | undefined>
      let steps = 0
      while (true) {
        done = work.next()
        if (done.done) break
        expect(done.value).toBeUndefined()
        expect(receiver.stats.current?.revision).toBe(0)
        expect(old.reader.length(['items'])).toBe(3)
        expect(receiver.stats.retainedBytes).toBeLessThanOrEqual(limits.retained)
        if (++steps > 100) throw new Error('Incomplete receipt')
      }
      expect(steps).toBeGreaterThan(5)
      expect(done.done).toBe(true)
      if (!done.done || done.value?.kind !== 'accepted') throw new Error('Expected acceptance')
      expect(done.value.acknowledgement).toMatchObject({
        requestToken: ticket.requestToken,
        resultToken: message.resultToken,
      })
      expect(done.value.cached).toBe(false)
      expect(done.value.capture.reader.scalar(['items', 0], scalar)).toBe('new')
      expect(receiver.stats).toMatchObject({
        current: next.identity,
        requested: null,
        prepared: null,
        readers: 0,
        holds: 1,
      })
      expect(old.reader.scalar(['items', 0], scalar)).toBe('old')
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(work.return()).toEqual({ done: true, value: undefined })
      done.value.capture.release()
      old.release()
    } finally {
      receiver.dispose()
    }
    expect(receiver.stats.retainedBytes).toBe(0)
  })
  it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    'cancels at step %i and immediately releases preparation, iterator and queued work',
    (steps) => {
      let closed = 0
      let entered = false
      let escaped: PackedCapture | undefined
      const receiver = new PackedReceiver(limits, function* (capture, checked) {
        entered = true
        escaped = capture
        try {
          yield* validate(capture, checked)
        } finally {
          closed++
        }
      })
      try {
        const old = initial(receiver)
        closed = 0
        entered = false
        const ticket = receiver.begin(2, source('new', 1))
        const message = packet(ticket, 'new')
        const work = receiver.receiveSteps(ticket, message)
        for (let step = 0; step < steps; step++) work.next()
        const oldInspection = escaped
        expect(receiver.cancel(ticket)).toBe(true)
        expect(receiver.cancel(ticket)).toBe(false)
        expect(work.next()).toEqual({ done: true, value: undefined })
        expect(closed).toBe(entered ? 1 : 0)
        if (entered) expect(() => oldInspection?.reader.kind()).toThrow('released')
        expect(message.payload.byteLength).toBe(0)
        expect(receiver.stats).toMatchObject({
          requested: null,
          prepared: null,
          readers: 0,
          holds: 1,
          captures: 1,
        })
        expect(old.reader.scalar(['items', 0], scalar)).toBe('old')
        old.release()
      } finally {
        receiver.dispose()
      }
    },
  )
  it.each(['replace', 'evict', 'dispose'] as const)(
    'revokes suspended validation on %s',
    (action) => {
      let closed = 0
      const receiver = new PackedReceiver(limits, function* (capture, checked) {
        try {
          yield* validate(capture, checked)
        } finally {
          closed++
        }
      })
      const old = initial(receiver)
      closed = 0
      const ticket = receiver.begin(2, source('new', 1))
      const work = receiver.receiveSteps(ticket, packet(ticket, 'new'))
      advanceToInspection(receiver, work)
      work.next()
      if (action === 'replace') {
        const newer = source('newer', 2)
        const next = receiver.begin(3, newer)
        expect(receiver.stats.requested).toEqual(newer.identity)
        expect(receiver.cancel(ticket)).toBe(false)
        receiver.cancel(next)
      } else receiver[action]()
      expect(closed).toBe(1)
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(receiver.stats.readers).toBe(0)
      if (action !== 'dispose') expect(old.reader.scalar(['items', 0], scalar)).toBe('old')
      else expect(() => old.reader.kind()).toThrow('released')
      receiver.dispose()
      expect(receiver.stats.retainedBytes).toBe(0)
    },
  )
  it('closes an unstarted handle when the scheduler returns or throws after taking payload ownership', () => {
    const receiver = new PackedReceiver(limits, validate)
    try {
      for (const action of ['return', 'throw'] as const) {
        const ticket = receiver.begin(1, source('old'))
        const message = packet(ticket)
        const work = receiver.receiveSteps(ticket, message)
        if (action === 'return') work.return()
        else expect(() => work.throw(new Error('Scheduler failed'))).toThrow('Scheduler failed')
        expect(message.payload.byteLength).toBe(0)
        expect(receiver.stats).toMatchObject({
          current: null,
          requested: null,
          prepared: null,
          readers: 0,
          captures: 0,
          holds: 1,
        })
        expect(work.next().done).toBe(true)
      }
    } finally {
      receiver.dispose()
    }
  })
  it('preserves a newer request if validation reenters after a yield', () => {
    let newer: ReturnType<PackedReceiver['begin']> | undefined
    const receiver = new PackedReceiver(limits, function* (capture) {
      for (const _item of capture.reader.elements(['items'])) {
        yield
        newer = receiver.begin(3, source('newer', 2))
        return
      }
    })
    try {
      const ticket = receiver.begin(1, source('old'))
      const work = receiver.receiveSteps(ticket, packet(ticket))
      advanceToInspection(receiver, work)
      work.next()
      expect(() => work.next()).toThrow('Stale')
      expect(work.next().done).toBe(true)
      expect(receiver.stats).toMatchObject({
        current: null,
        prepared: null,
        captures: 0,
        readers: 0,
        holds: 1,
        requested: source('newer', 2).identity,
      })
      if (!newer) throw new Error('Missing replacement')
      receiver.cancel(newer)
    } finally {
      receiver.dispose()
    }
  })
  it('supports reentrant cancellation without invoking return on a running generator', () => {
    let closed = 0
    let ticket: ReturnType<PackedReceiver['begin']>
    const receiver = new PackedReceiver(limits, function* (capture) {
      try {
        for (const _item of capture.reader.elements(['items'])) {
          expect(receiver.cancel(ticket)).toBe(true)
          yield
        }
      } finally {
        closed++
      }
    })
    try {
      ticket = receiver.begin(1, source('old'))
      const work = receiver.receiveSteps(ticket, packet(ticket))
      advanceToInspection(receiver, work)
      expect(() => work.next()).toThrow('Stale')
      expect(closed).toBe(1)
      expect(receiver.stats).toMatchObject({
        current: null,
        requested: null,
        prepared: null,
        readers: 0,
        captures: 0,
        holds: 1,
      })
    } finally {
      receiver.dispose()
    }
  })
  it('cleans all resources when a late validator step or its cleanup throws', () => {
    const rejectCleanup = () => {
      throw new Error('Rejected cleanup')
    }
    for (const cleanup of [false, true]) {
      const receiver = new PackedReceiver(limits, function* (capture) {
        try {
          for (const _item of capture.reader.elements(['items'])) {
            yield
            if (!cleanup) throw new Error('Rejected schema')
          }
        } finally {
          if (cleanup) rejectCleanup()
        }
      })
      try {
        const ticket = receiver.begin(1, source('old'))
        const work = receiver.receiveSteps(ticket, packet(ticket))
        advanceToInspection(receiver, work)
        work.next()
        expect(() => (cleanup ? work.return() : work.next())).toThrow('Rejected')
        expect(receiver.stats).toMatchObject({
          current: null,
          requested: null,
          prepared: null,
          readers: 0,
          captures: 0,
          holds: 1,
        })
      } finally {
        receiver.dispose()
      }
    }
  })
  it('rejects Promise, async iterator and malformed validator results without publication', () => {
    const validators: PackedValidator[] = [
      () => Promise.resolve(),
      async function* () {
        yield
      },
      () => 1,
      function* () {
        yield 1
      },
      function* () {
        yield
        return 1
      },
      () => ({
        next: () => ({ done: true, value: undefined }),
        return: () => ({ done: false, value: undefined }),
        [Symbol.iterator]() {
          return this
        },
      }),
    ]
    for (const validator of validators) {
      const receiver = new PackedReceiver(limits, validator)
      try {
        const ticket = receiver.begin(1, source('old'))
        expect(() => drain(receiver.receiveSteps(ticket, packet(ticket)))).toThrow()
        expect(receiver.stats).toMatchObject({
          current: null,
          requested: null,
          prepared: null,
          captures: 0,
          readers: 0,
          holds: 1,
        })
      } finally {
        receiver.dispose()
      }
    }
  })
  it('keeps synchronous receipt explicit and closes a validator that requires cooperative execution', () => {
    const receiver = new PackedReceiver(limits, validate)
    try {
      const ticket = receiver.begin(1, source('old'))
      expect(() => receiver.receive(ticket, packet(ticket))).toThrow('cooperative')
      expect(receiver.stats).toMatchObject({
        current: null,
        requested: null,
        prepared: null,
        readers: 0,
        captures: 0,
        holds: 1,
      })
    } finally {
      receiver.dispose()
    }
  })
  it('rejects over-budget incoming ownership before taking the buffer or retaining queued work', () => {
    const receiver = new PackedReceiver({ ...limits, retained: 64 * 1024 }, validate)
    try {
      const ticket = receiver.begin(1, source('old'))
      const message = packet(ticket, 'x'.repeat(100000))
      expect(() => receiver.receiveSteps(ticket, message)).toThrow('retained limit')
      expect(message.payload.byteLength).toBeGreaterThan(0)
      expect(receiver.stats).toMatchObject({
        current: null,
        requested: null,
        prepared: null,
        captures: 0,
        readers: 0,
        holds: 1,
      })
    } finally {
      receiver.dispose()
    }
  })
  it('returns a completed resync handle without retaining or consuming an unrelated payload', () => {
    const receiver = new PackedReceiver(limits, validate)
    try {
      const checked = source('new', 1)
      const ticket = receiver.begin(1, checked)
      const input = packet(ticket, 'new')
      const work = receiver.receiveSteps(ticket, {
        ...input,
        kind: 'delta',
        base: source('old').identity,
        baseToken: newPackedToken(),
        operations: [{ kind: 'replace', path: ['items'], record: 0 }],
      })
      expect(work.next()).toEqual({
        done: true,
        value: { kind: 'resync', reason: 'base-unavailable' },
      })
      expect(input.payload.byteLength).toBeGreaterThan(0)
      expect(receiver.stats).toMatchObject({
        requested: null,
        prepared: null,
        readers: 0,
        holds: 1,
      })
    } finally {
      receiver.dispose()
    }
  })
})
