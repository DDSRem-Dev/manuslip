import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import {
  type PackedAcknowledgement,
  type PackedRequest,
  readPackedAcknowledgement,
  readPackedRequest,
} from '../../src/packing-exchange'
import { PackedHold } from '../../src/packing-hold'
import { PackedPublisher } from '../../src/packing-publisher'
import { PackedReceiver } from '../../src/packing-receiver'
import { PackedSession } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'
import { newPackedToken } from '../../src/packing-token'
import { PackedValue } from '../../src/packing-value'
import { packedWireVersion, readPackedWire } from '../../src/packing-wire'
import { finishPackedSteps, PackedWork } from '../../src/packing-work'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 8, readers: 64 }
const scalarLimits = { retained: MiB, staging: MiB }
const source = (text: string, revision = 0) =>
  new PackedSource(
    {
      generation: 1,
      documentId: 'publisher-tests',
      revision,
      sourceHash: sourceHash(text),
      parserVersion: 'parser',
      rendererVersion: 'renderer',
      options: 'options',
    },
    text,
  )
const transfer = <T>(message: T): Promise<T> =>
  new Promise((resolve, reject) => {
    const { port1, port2 } = new MessageChannel()
    const close = () => {
      port1.close()
      port2.close()
    }
    port2.once('message', (message) => {
      close()
      resolve(message)
    })
    port2.once('messageerror', (error) => {
      close()
      reject(error)
    })
    const payload =
      message && typeof message === 'object' && 'payload' in message ? message.payload : undefined
    try {
      port1.postMessage(message, payload instanceof ArrayBuffer ? [payload] : [])
    } catch (error) {
      close()
      reject(error)
    }
  })
function fixture() {
  const owner = new PackedSession(limits)
  const publisher = new PackedPublisher(owner)
  const receiver = new PackedReceiver(limits, (capture, checked) => {
    if (capture.reader.scalar(['value'], scalarLimits) !== checked.text)
      throw new Error('Rejected schema')
  })
  const prepare = (
    request: PackedRequest,
    checked: PackedSource,
    delta = false,
    reserve?: number,
  ) => {
    const input = packValue(delta ? checked.text : { value: checked.text }, 8 * MiB)
    const payload = input.slice(0)
    const header = {
      protocol: packedWireVersion,
      sequence: request.sequence,
      requestToken: request.requestToken,
      resultToken: newPackedToken(),
      result: checked.identity,
      sentAt: 0,
      payload,
      metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
    }
    const base = owner.stats.current
    const operations = [{ kind: 'replace' as const, path: ['value'], record: 0 }]
    const wire = readPackedWire(
      delta
        ? { ...header, kind: 'delta', base, baseToken: request.base?.token, operations }
        : { ...header, kind: 'full' },
      {
        sequence: request.sequence,
        result: checked.identity,
        requestToken: request.requestToken,
      },
    )
    const ticket = owner.beginPrepared(checked)
    const outgoing = reserve ?? wire.bytes + wire.retainedBytes + 8192
    let prepared: ReturnType<PackedSession['prepareFull']>
    if (delta) {
      const capture = owner.capture()
      const previous = capture.sourceResource
      capture.release()
      prepared = owner.prepareDelta(
        ticket,
        {
          base: previous.identity,
          baseSource: previous.text,
          result: checked.identity,
          payload: input,
          operations,
        },
        outgoing,
      )
    } else prepared = owner.prepareFull(ticket, checked.identity, input, outgoing)
    return { prepared, wire: wire.message, payload }
  }
  const offer = (request: PackedRequest, checked: PackedSource, delta = false) => {
    const transaction = prepare(request, checked, delta)
    return publisher.offer(
      structuredClone(request),
      checked,
      transaction.prepared,
      transaction.wire,
    )
  }
  const publish = async (checked: PackedSource, delta = false) => {
    const ticket = receiver.begin(1, checked)
    const wire = offer(await transfer(ticket), checked, delta)
    const accepted = receiver.receive(ticket, await transfer(wire))
    if (accepted.kind !== 'accepted') throw new Error('Expected acceptance')
    publisher.acknowledge(await transfer(accepted.acknowledgement))
    return accepted
  }
  return {
    owner,
    publisher,
    receiver,
    prepare,
    offer,
    publish,
    close() {
      publisher.dispose()
      receiver.dispose()
      owner.dispose()
      expect(owner.stats.retainedBytes).toBe(0)
      expect(receiver.stats.retainedBytes).toBe(0)
    },
  }
}

describe('acknowledged packed publication', () => {
  it('commits only exact receipts through MessagePorts while preserving original captures over repeated sequence IDs', async () => {
    const context = fixture()
    try {
      const first = await context.publish(source('first'))
      const original = context.owner.capture()
      for (let step = 1; step <= 20; step++) {
        const checked = source(`value 中文😀 ${step}`, step)
        const request = context.receiver.begin(1, checked)
        const previous = context.owner.stats.current
        expect(context.publisher.base(await transfer(request), checked)?.identity).toEqual(previous)
        const transaction = context.prepare(request, checked, true)
        const wire = context.publisher.offer(
          request,
          checked,
          transaction.prepared,
          transaction.wire,
        )
        expect(context.owner.stats.current).toEqual(previous)
        expect(() =>
          context.publisher.offer(request, checked, transaction.prepared, transaction.wire),
        ).toThrow('pending')
        const accepted = context.receiver.receive(request, await transfer(wire))
        if (accepted.kind !== 'accepted') throw new Error('Expected acceptance')
        expect(context.owner.stats.current).toEqual(previous)
        context.publisher.acknowledge(await transfer(accepted.acknowledgement))
        expect(context.owner.stats.current).toEqual(checked.identity)
        expect(original.reader.scalar(['value'], scalarLimits)).toBe('first')
        expect(first.capture.reader.scalar(['value'], scalarLimits)).toBe('first')
        expect(context.owner.stats.retainedBytes).toBeLessThanOrEqual(limits.retained)
        accepted.capture.release()
        expect('payload' in wire && wire.payload.byteLength).toBe(0)
      }
      original.release()
      first.capture.release()
    } finally {
      context.close()
    }
  })
  it('requires transfer and rejects every mismatched receipt without discarding pending work', async () => {
    const context = fixture()
    try {
      const checked = source('value')
      const ticket = context.receiver.begin(1, checked)
      const wire = context.offer(ticket, checked)
      if (wire.kind !== 'full') throw new Error('fixture')
      const expected: PackedAcknowledgement = {
        protocol: packedWireVersion,
        kind: 'accepted',
        sequence: 1,
        result: checked.identity,
        requestToken: ticket.requestToken,
        resultToken: wire.resultToken,
      }
      expect(() => context.publisher.acknowledge(expected)).toThrow('transfer')
      const accepted = context.receiver.receive(ticket, await transfer(wire))
      if (accepted.kind !== 'accepted') throw new Error('Expected acceptance')
      for (const bad of [
        { sequence: 2 },
        { requestToken: newPackedToken() },
        { resultToken: newPackedToken() },
        { result: { ...checked.identity, options: 'other' } },
        { extra: true },
      ]) {
        expect(() =>
          context.publisher.acknowledge({ ...accepted.acknowledgement, ...bad }),
        ).toThrow()
        expect(context.owner.stats.current).toBeNull()
        expect(context.owner.stats.prepared).toEqual(checked.identity)
      }
      context.publisher.acknowledge(await transfer(accepted.acknowledgement))
      expect(() => context.publisher.acknowledge(accepted.acknowledgement)).toThrow('pending')
      accepted.capture.release()
    } finally {
      context.close()
    }
  })
  it('revokes escaped outgoing buffers on cancellation and ignores their late acknowledgements', async () => {
    const context = fixture()
    try {
      const checked = source('same')
      const ticket = context.receiver.begin(1, checked)
      const wire = context.offer(ticket, checked)
      if (wire.kind !== 'full') throw new Error('fixture')
      const stale = {
        protocol: packedWireVersion,
        kind: 'accepted',
        sequence: 1,
        result: checked.identity,
        requestToken: ticket.requestToken,
        resultToken: wire.resultToken,
      }
      expect(context.publisher.cancel()).toBe(true)
      expect(wire.payload.byteLength).toBe(0)
      expect(context.publisher.cancel()).toBe(false)
      expect(context.owner.stats).toMatchObject({
        requested: null,
        prepared: null,
        outgoingReservedBytes: 0,
      })
      const retry = context.receiver.begin(1, checked)
      const offered = context.offer(retry, checked)
      expect(() => context.publisher.acknowledge(stale)).toThrow('mismatch')
      const accepted = context.receiver.receive(retry, await transfer(offered))
      if (accepted.kind !== 'accepted') throw new Error('Expected acceptance')
      context.publisher.acknowledge(accepted.acknowledgement)
      accepted.capture.release()
    } finally {
      context.close()
    }
  })
  it('requires full resync after a lost acknowledgement instead of reusing an identity-only base', async () => {
    const context = fixture()
    try {
      const initial = await context.publish(source('old'))
      initial.capture.release()
      const next = source('next', 1)
      const ticket = context.receiver.begin(1, next)
      const received = context.receiver.receive(
        ticket,
        await transfer(context.offer(ticket, next, true)),
      )
      if (received.kind !== 'accepted') throw new Error('Expected acceptance')
      context.publisher.cancel() // Receipt was lost after the receiver committed.
      const after = source('after', 2)
      const request = context.receiver.begin(1, after)
      expect(context.publisher.base(request, after)).toBeUndefined()
      const delta = context.prepare(request, after, true)
      expect(() => context.publisher.offer(request, after, delta.prepared, delta.wire)).toThrow(
        'full resync',
      )
      context.owner.invalidate()
      const full = context.offer(request, after)
      const accepted = context.receiver.receive(request, await transfer(full))
      if (accepted.kind !== 'accepted') throw new Error('Expected acceptance')
      expect(() => context.publisher.acknowledge(received.acknowledgement)).toThrow('mismatch')
      context.publisher.acknowledge(await transfer(accepted.acknowledgement))
      expect(context.owner.stats.current).toEqual(after.identity)
      received.capture.release()
      accepted.capture.release()
    } finally {
      context.close()
    }
  })
  it('cannot mistake an independently recreated equal source or an evicted base for its acknowledged object', async () => {
    const context = fixture()
    try {
      const checked = source('same')
      const accepted = await context.publish(checked)
      accepted.capture.release()
      const next = source('next', 1)
      const request = context.receiver.begin(1, next)
      expect(context.publisher.base(request, next)).toBe(checked)
      context.owner.evict()
      expect(context.publisher.base(request, next)).toBeUndefined()
      context.owner.commit(
        context.owner.prepareFull(
          context.owner.begin(checked.identity, checked.text),
          checked.identity,
          packValue({ value: checked.text }, MiB),
        ),
      )
      expect(context.publisher.base(request, next)).toBeUndefined()
      context.publisher.reset()
      expect(context.owner.stats.holds).toBe(1)
    } finally {
      context.close()
    }
  })
  it('preserves newer session work when a pending offer becomes stale', async () => {
    const context = fixture()
    try {
      const checked = source('old')
      const request = context.receiver.begin(1, checked)
      const wire = context.offer(request, checked)
      const received = context.receiver.receive(request, await transfer(wire))
      if (received.kind !== 'accepted') throw new Error('Expected acceptance')
      const newer = source('newer', 1)
      const ticket = context.owner.beginPrepared(newer)
      expect(() => context.publisher.acknowledge(received.acknowledgement)).toThrow('Stale')
      context.publisher.cancel()
      expect(context.owner.stats.requested).toEqual(newer.identity)
      context.owner.commit(
        context.owner.prepareFull(ticket, newer.identity, packValue({ value: newer.text }, MiB)),
      )
      received.capture.release()
    } finally {
      context.close()
    }
  })
  it('rejects an unreserved outgoing message and a preparation using a different source object', () => {
    const context = fixture()
    try {
      const checked = source('value')
      const request = context.receiver.begin(1, checked)
      let transaction = context.prepare(request, checked, false, 0)
      expect(() =>
        context.publisher.offer(request, checked, transaction.prepared, transaction.wire),
      ).toThrow('reserve')
      transaction = context.prepare(request, checked)
      expect(() =>
        context.publisher.offer(request, source('value'), transaction.prepared, transaction.wire),
      ).toThrow('preparation mismatch')
      expect(context.owner.stats.current).toBeNull()
    } finally {
      context.close()
    }
  })
  it.each([false, true])(
    'disposes pending state and escaped buffers when session was already disposed: %s',
    (disposeOwner) => {
      const context = fixture()
      const checked = source('value')
      const request = context.receiver.begin(1, checked)
      const offered = context.offer(request, checked)
      if (offered.kind !== 'full') throw new Error('fixture')
      if (disposeOwner) context.owner.dispose()
      context.publisher.dispose()
      expect(offered.payload.byteLength).toBe(0)
      expect(context.owner.stats.holds).toBe(0)
      expect(() => context.publisher.base(request, checked)).toThrow('disposed')
      context.close()
    },
  )
})

describe('packed publisher failure cleanup', () => {
  const serialization = {
    bytes: limits.bytes,
    workspace: limits.staging - 65536,
    nodes: 800000,
    depth: 128,
  }
  const cases = ['return', 'cancel', 'reset', 'dispose'] as const
  for (const action of cases)
    it.each([false, true])(
      `finishes ${action} after a resync child close throws (undefined: %s)`,
      async (undefinedFailure) => {
        const context = fixture()
        const checked = source('resync content '.repeat(1000))
        const accepted = await context.publish(checked)
        accepted.capture.release()
        const original = context.owner.capture()
        const before = context.owner.stats
        const request = context.receiver.begin(1, checked)
        const work = context.publisher.offerCurrentSteps(request, checked, serialization)
        const failure = undefinedFailure ? undefined : new Error('resync child cleanup failed')
        let faulted = false
        const realReturn = PackedWork.prototype.return
        const close = vi.spyOn(PackedWork.prototype, 'return').mockImplementation(function (
          this: PackedWork<unknown>,
        ) {
          const result = realReturn.call(this)
          if (this !== work && !faulted) {
            faulted = true
            throw failure
          }
          return result
        })
        try {
          expect(work.next().done).toBe(false)
          expect(context.owner.stats.captures).toBeGreaterThan(before.captures)
          let threw = false
          try {
            if (action === 'return') work.return()
            else context.publisher[action]()
          } catch (error) {
            threw = true
            expect(error).toBe(failure)
          }
          expect(threw).toBe(true)
          expect(faulted).toBe(true)
          close.mockRestore()
          expect(context.owner.stats.captures).toBe(before.captures)
          expect(context.owner.stats.readers).toBe(before.readers)
          expect(context.owner.stats.readerStagingBytes).toBe(before.readerStagingBytes)
          expect(context.owner.stats.holds).toBe(
            action === 'dispose' ? 0 : action === 'reset' ? 1 : before.holds,
          )
          if (action === 'return' || action === 'cancel')
            expect(context.owner.stats).toEqual(before)
          expect(original.reader.scalar(['value'], scalarLimits)).toBe(checked.text)
          const after = context.owner.stats
          expect(work.next()).toEqual({ done: true, value: undefined })
          work.return()
          expect(context.owner.stats).toEqual(after)
          if (action === 'dispose')
            expect(() => context.publisher.base(request, checked)).toThrow('disposed')
          else
            expect(context.publisher.base(request, checked)).toBe(
              action === 'reset' ? undefined : checked,
            )
        } finally {
          close.mockRestore()
          original.release()
          context.close()
        }
      },
    )

  for (const action of ['cancel', 'reset', 'dispose'] as const)
    it.each([false, true])(
      `finishes ${action} after pending hold and output closes throw (undefined: %s)`,
      async (undefinedFailure) => {
        const context = fixture()
        const checked = source('pending resync '.repeat(1000))
        const accepted = await context.publish(checked)
        accepted.capture.release()
        const original = context.owner.capture()
        const before = context.owner.stats
        const request = context.receiver.begin(1, checked)
        const work = context.publisher.offerCurrentSteps(request, checked, serialization)
        const message = finishPackedSteps(work)
        if (!message) throw new Error('Expected complete resync offer')
        const failure = undefinedFailure ? undefined : new Error('pending hold cleanup failed')
        const later = new Error('pending output cleanup failed')
        let holds = 0,
          outputs = 0
        const realHold = PackedHold.prototype.release,
          realOutput = PackedValue.prototype.release
        const hold = vi.spyOn(PackedHold.prototype, 'release').mockImplementation(function (
          this: PackedHold,
        ) {
          realHold.call(this)
          if (++holds === 1) throw failure
        })
        const output = vi.spyOn(PackedValue.prototype, 'release').mockImplementation(function (
          this: PackedValue<object>,
        ) {
          realOutput.call(this)
          outputs++
          throw later
        })
        try {
          let threw = false
          try {
            context.publisher[action]()
          } catch (error) {
            threw = true
            expect(error).toBe(failure)
          }
          expect(threw).toBe(true)
          hold.mockRestore()
          output.mockRestore()
          expect(outputs).toBe(1)
          expect(message.payload.byteLength).toBe(0)
          expect(context.owner.stats.captures).toBe(before.captures)
          expect(context.owner.stats.readers).toBe(before.readers)
          expect(context.owner.stats.readerStagingBytes).toBe(before.readerStagingBytes)
          expect(context.owner.stats.holds).toBe(
            action === 'dispose' ? 0 : action === 'reset' ? 1 : before.holds,
          )
          if (action === 'cancel') expect(context.owner.stats).toEqual(before)
          expect(original.reader.scalar(['value'], scalarLimits)).toBe(checked.text)
          if (action === 'dispose')
            expect(() => context.publisher.base(request, checked)).toThrow('disposed')
          else expect(context.publisher.cancel()).toBe(false)
          work.return()
        } finally {
          hold.mockRestore()
          output.mockRestore()
          original.release()
          context.close()
        }
      },
    )

  it.each([false, true])(
    'finishes disposed-session cleanup after output close throws (undefined: %s)',
    async (undefinedFailure) => {
      const context = fixture()
      const checked = source('disposed resync '.repeat(1000))
      const accepted = await context.publish(checked)
      accepted.capture.release()
      const request = context.receiver.begin(1, checked)
      const work = context.publisher.offerCurrentSteps(request, checked, serialization)
      const message = finishPackedSteps(work)
      if (!message) throw new Error('Expected complete resync offer')
      context.owner.dispose()
      const failure = undefinedFailure ? undefined : new Error('disposed output cleanup failed')
      const realOutput = PackedValue.prototype.release
      let outputs = 0
      const output = vi.spyOn(PackedValue.prototype, 'release').mockImplementation(function (
        this: PackedValue<object>,
      ) {
        realOutput.call(this)
        outputs++
        throw failure
      })
      try {
        let threw = false
        try {
          context.publisher.dispose()
        } catch (error) {
          threw = true
          expect(error).toBe(failure)
        }
        expect(threw).toBe(true)
        expect(message.payload.byteLength).toBe(0)
        expect(context.owner.stats.retainedBytes).toBe(0)
        expect(() => context.publisher.base(request, checked)).toThrow('disposed')
        expect(() => context.publisher.dispose()).not.toThrow()
        expect(outputs).toBe(1)
      } finally {
        output.mockRestore()
        context.close()
      }
    },
  )
})

describe('bounded request and receipt metadata', () => {
  it('copies and freezes requests and exact acknowledgements without evaluating accessors', () => {
    const checked = source('value')
    const request = {
      protocol: packedWireVersion,
      kind: 'request' as const,
      sequence: 1,
      identity: { ...checked.identity },
      requestToken: newPackedToken(),
      base: { identity: { ...checked.identity }, token: newPackedToken() },
    }
    const normalized = readPackedRequest(request, checked.identity)
    request.base.identity.options = 'changed'
    expect(normalized.value.base?.identity.options).toBe('options')
    expect(Object.isFrozen(normalized.value.base)).toBe(true)
    const ack: PackedAcknowledgement = {
      protocol: packedWireVersion,
      kind: 'accepted',
      sequence: 1,
      result: checked.identity,
      requestToken: request.requestToken,
      resultToken: newPackedToken(),
    }
    expect(readPackedAcknowledgement(structuredClone(ack), ack).value).toEqual(ack)
    for (const key of Object.keys(ack)) {
      const candidate = { ...ack }
      Object.defineProperty(candidate, key, {
        enumerable: true,
        get() {
          throw new Error('Getter evaluated')
        },
      })
      expect(() => readPackedAcknowledgement(candidate, ack)).toThrow('data property')
    }
    expect(normalized.stagingBytes).toBeLessThanOrEqual(8 * MiB)
    expect(normalized.bytes).toBeLessThanOrEqual(64 * 1024)
    for (const candidate of [
      { ...request, requestToken: '' },
      { ...request, sequence: -1 },
      { ...request, identity: { ...checked.identity, revision: 9 } },
      { ...request, extra: true },
      { ...request, base: undefined },
      { ...request, base: { ...request.base, token: 'bad' } },
    ])
      expect(() => readPackedRequest(candidate, checked.identity)).toThrow()
  })
})
