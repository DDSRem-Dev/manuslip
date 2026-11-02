import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue, unpackValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import type { PackedAcknowledgement } from '../../src/packing-exchange'
import { PackedPublisher } from '../../src/packing-publisher'
import { PackedReceiver } from '../../src/packing-receiver'
import type { PackedSerializedValue } from '../../src/packing-serialize'
import { PackedSession } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'
import { newPackedToken } from '../../src/packing-token'
import type { PackedValue } from '../../src/packing-value'
import { type PackedWireMessage, packedWireVersion } from '../../src/packing-wire'
import { finishPackedSteps } from '../../src/packing-work'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 8, readers: 16 }
const budget = { bytes: 8 * MiB - 65536, workspace: 3 * MiB, nodes: 1000000, depth: 128 }
const source = (text = 'original', revision = 0) =>
  new PackedSource(
    {
      generation: 1,
      documentId: 'resync',
      revision,
      sourceHash: sourceHash(text),
      parserVersion: 'test',
      rendererVersion: 'test',
      options: 'test',
    },
    text,
  )
const transfer = <T>(value: T): Promise<T> =>
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
    try {
      port1.postMessage(
        value,
        value &&
          typeof value === 'object' &&
          'payload' in value &&
          value.payload instanceof ArrayBuffer
          ? [value.payload]
          : [],
      )
    } catch (error) {
      close()
      reject(error)
    }
  })
function fixture(value?: unknown, sessionLimits = limits) {
  const owner = new PackedSession(sessionLimits),
    publisher = new PackedPublisher(owner)
  const checked = source()
  const original = value ?? { value: checked.text, list: [1, 2, 3], child: { text: '界😀' } }
  const payload = packValue(original, limits.bytes)
  const bytes = payload.slice(0)
  owner.commit(owner.prepareFull(owner.beginPrepared(checked), checked.identity, payload))
  const receiver = new PackedReceiver(limits, (capture, current) => {
    if (capture.reader.scalar(['value'], { retained: MiB, staging: MiB }) !== current.text)
      throw new Error('Schema/source mismatch')
  })
  const offer = (sequence = 1, current = checked) => {
    const request = receiver.begin(sequence, current)
    const wire = finishPackedSteps(publisher.offerCurrentSteps(request, current, budget))
    if (wire?.kind !== 'full') throw new Error('Missing full resync')
    return { request, wire }
  }
  return {
    owner,
    publisher,
    receiver,
    checked,
    original,
    bytes,
    offer,
    close() {
      publisher.dispose()
      receiver.dispose()
      owner.dispose()
      expect(owner.stats.retainedBytes).toBe(0)
      expect(receiver.stats.retainedBytes).toBe(0)
    },
  }
}
const receipt = (wire: Exclude<PackedWireMessage, { kind: 'resync' }>): PackedAcknowledgement => ({
  protocol: packedWireVersion,
  kind: 'accepted',
  sequence: wire.sequence,
  requestToken: wire.requestToken,
  resultToken: wire.resultToken,
  result: wire.result,
})

describe('bounded committed-result resync', () => {
  it('copies a validated complete encoding in bounded chunks without scalar reads and retains independent output ownership', () => {
    const context = fixture({ value: 'x'.repeat(300000), repeated: Array(1000).fill('same') })
    const capture = context.owner.capture()
    const baseline = context.owner.stats
    const work = capture.copyEncoding(limits.bytes)
    const scalar = vi.spyOn(PackedArena.prototype, 'scalar')
    if (!work) throw new Error('Expected existing encoding')
    let output: PackedValue<PackedSerializedValue> | undefined
    try {
      let advances = 0
      while (true) {
        const step = work.next()
        if (step.done) {
          output = step.value
          break
        }
        advances++
      }
      expect(scalar).not.toHaveBeenCalled()
      expect(advances).toBe(1 + Math.ceil(context.bytes.byteLength / 65536))
      if (!output) throw new Error('Missing copy')
      expect(new Uint8Array(output.value.payload)).toEqual(new Uint8Array(context.bytes))
      expect(output.value.workspaceBytes).toBe(4096)
      capture.release()
      context.owner.evict()
      expect(unpackValue(output.value.payload, limits).value).toEqual(context.original)
      output.release()
      expect(context.owner.stats.holds).toBe(baseline.holds)
    } finally {
      scalar.mockRestore()
      work.return()
      output?.release()
      capture.release()
      context.close()
    }
  })

  it.each([0, 1, 3])(
    'cancels direct copy at advance %i with exact ownership restoration',
    (advances) => {
      const context = fixture({ value: 'x'.repeat(300000) })
      const capture = context.owner.capture(),
        baseline = context.owner.stats
      const work = capture.copyEncoding(limits.bytes)
      if (!work) throw new Error('Expected existing encoding')
      try {
        for (let i = 0; i < advances; i++) expect(work.next().done).toBe(false)
        work.return()
        expect(work.next()).toEqual({ done: true, value: undefined })
        expect(context.owner.stats).toEqual(baseline)
      } finally {
        work.return()
        capture.release()
        context.close()
      }
    },
  )

  it('revalidates a transferred full result after receiver eviction, advances only the exact ACK token and supports the next delta', async () => {
    const context = fixture()
    const originalCapture = context.owner.capture()
    try {
      const first = context.offer()
      expect(() => context.publisher.acknowledge(receipt(first.wire))).toThrow('transfer')
      const initial = context.receiver.receive(first.request, await transfer(first.wire))
      if (initial.kind !== 'accepted') throw new Error('No receipt')
      context.publisher.acknowledge(await transfer(initial.acknowledgement))
      initial.capture.release()
      context.receiver.evict()
      const retry = context.offer()
      expect(context.publisher.base(retry.request, context.checked)).toBeUndefined()
      expect(() => context.publisher.acknowledge(initial.acknowledgement)).toThrow('mismatch')
      const result = finishPackedSteps(
        context.receiver.receiveSteps(retry.request, await transfer(retry.wire)),
      )
      if (result?.kind !== 'accepted') throw new Error('No full resync acceptance')
      context.publisher.acknowledge(await transfer(result.acknowledgement))
      result.capture.release()
      const next = source('next', 1),
        request = context.receiver.begin(1, next)
      expect(context.publisher.base(await transfer(request), next)).toBe(context.checked)
      const payload = packValue(next.text, limits.bytes)
      const wire = {
        protocol: packedWireVersion,
        kind: 'delta' as const,
        sequence: request.sequence,
        result: next.identity,
        requestToken: request.requestToken,
        resultToken: newPackedToken(),
        base: context.checked.identity,
        baseToken: request.base?.token,
        payload: payload.slice(0),
        operations: [{ kind: 'replace' as const, path: ['value'], record: 0 }],
        sentAt: 0,
        metadata: { cached: false, serializeMs: 0, transportInMs: 0 },
      }
      const prepared = context.owner.prepareDelta(
        context.owner.beginPrepared(next),
        {
          base: context.checked.identity,
          baseSource: context.checked.text,
          result: next.identity,
          payload,
          operations: wire.operations,
        },
        MiB,
      )
      const offered = context.publisher.offer(request, next, prepared, wire)
      const accepted = context.receiver.receive(request, await transfer(offered))
      if (accepted.kind !== 'accepted') throw new Error('Missing delta acceptance')
      context.publisher.acknowledge(await transfer(accepted.acknowledgement))
      expect(context.owner.stats.current).toEqual(next.identity)
      expect(originalCapture.reader.scalar(['value'], { retained: MiB, staging: MiB })).toBe(
        'original',
      )
      accepted.capture.release()
    } finally {
      originalCapture.release()
      context.close()
    }
  })

  it('recovers a lost full-result acknowledgement without preparing a duplicate graph', async () => {
    const context = fixture()
    try {
      const first = context.offer()
      const accepted = context.receiver.receive(first.request, await transfer(first.wire))
      if (accepted.kind !== 'accepted') throw new Error('No receipt')
      accepted.capture.release()
      context.publisher.cancel()
      const next = context.offer()
      expect(context.publisher.base(next.request, context.checked)).toBeUndefined()
      expect(context.owner.stats.prepared).toBeNull()
      const received = context.receiver.receive(next.request, await transfer(next.wire))
      if (received.kind !== 'accepted') throw new Error('No retry receipt')
      expect(() => context.publisher.acknowledge(accepted.acknowledgement)).toThrow('mismatch')
      context.publisher.acknowledge(await transfer(received.acknowledgement))
      received.capture.release()
      expect(context.owner.stats.current).toEqual(context.checked.identity)
    } finally {
      context.close()
    }
  })

  it.each(['unstarted', 'copying', 'pending', 'transferred'] as const)(
    'cancels %s resync and preserves its committed result',
    async (phase) => {
      const context = fixture({ value: 'original', text: 'x'.repeat(300000) })
      const baseline = context.owner.stats
      const request = context.receiver.begin(1, context.checked)
      const work = context.publisher.offerCurrentSteps(request, context.checked, budget)
      let wire: Exclude<PackedWireMessage, { kind: 'resync' }> | undefined
      try {
        if (phase === 'copying') expect(work.next().done).toBe(false)
        if (phase === 'pending' || phase === 'transferred') wire = finishPackedSteps(work)
        if (phase === 'transferred' && wire) await transfer(wire)
        expect(context.publisher.cancel()).toBe(true)
        expect(work.next()).toEqual({ done: true, value: undefined })
        if (wire) {
          expect(wire.payload.byteLength).toBe(0)
          const acknowledgement = receipt(wire)
          expect(() => context.publisher.acknowledge(acknowledgement)).toThrow('pending')
        }
        expect(context.owner.stats).toEqual(baseline)
      } finally {
        work.return()
        context.close()
      }
    },
  )

  it.each(['new-source', 'same-source-new-graph', 'eviction', 'pending-preparation'] as const)(
    'rejects a suspended result after %s and releases candidate ownership',
    (change) => {
      const context = fixture({ value: 'original', text: 'x'.repeat(300000) })
      const request = context.receiver.begin(1, context.checked)
      const work = context.publisher.offerCurrentSteps(request, context.checked, budget)
      try {
        expect(work.next().done).toBe(false)
        if (change === 'eviction') context.owner.evict()
        else {
          const checked = change === 'new-source' ? source('changed', 1) : context.checked
          const ticket = context.owner.beginPrepared(checked)
          if (change !== 'pending-preparation')
            context.owner.commit(
              context.owner.prepareFull(
                ticket,
                checked.identity,
                packValue({ value: checked.text }, MiB),
              ),
            )
        }
        expect(() => work.next()).toThrow(/changed|unavailable|idle/)
        expect(context.publisher.cancel()).toBe(false)
        expect(context.owner.stats.captures).toBe(0)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
      } finally {
        work.return()
        context.close()
      }
    },
  )

  it('checks exact graph identity again at ACK, including replacement with the same source object', async () => {
    const context = fixture()
    try {
      const { wire, request } = context.offer()
      const accepted = context.receiver.receive(request, await transfer(wire))
      if (accepted.kind !== 'accepted') throw new Error('No receipt')
      context.owner.commit(
        context.owner.prepareFull(
          context.owner.beginPrepared(context.checked),
          context.checked.identity,
          packValue({ value: 'original', changed: true }, MiB),
        ),
      )
      expect(() => context.publisher.acknowledge(accepted.acknowledgement)).toThrow('changed')
      expect(context.publisher.cancel()).toBe(true)
      accepted.capture.release()
      expect(context.owner.stats.captures).toBe(0)
    } finally {
      context.close()
    }
  })

  it('serializes a persistent overlay for complete resync and retains the previous graph unchanged', async () => {
    const context = fixture()
    const before = context.owner.capture()
    try {
      const next = source('next', 1),
        payload = packValue(next.text, MiB)
      context.owner.commit(
        context.owner.prepareDelta(context.owner.beginPrepared(next), {
          base: context.checked.identity,
          baseSource: context.checked.text,
          result: next.identity,
          payload,
          operations: [{ kind: 'replace', path: ['value'], record: 0 }],
        }),
      )
      const current = context.owner.capture()
      try {
        expect(current.copyEncoding(budget.bytes)).toBeUndefined()
      } finally {
        current.release()
      }
      const { wire, request } = context.offer(1, next)
      expect(unpackValue(wire.payload, limits).value).toEqual({
        ...context.original,
        value: next.text,
      })
      const received = context.receiver.receive(request, await transfer(wire))
      if (received.kind !== 'accepted') throw new Error('No receipt')
      context.publisher.acknowledge(received.acknowledgement)
      received.capture.release()
      expect(before.reader.scalar(['value'], { retained: MiB, staging: MiB })).toBe('original')
    } finally {
      before.release()
      context.close()
    }
  })

  it('rejects normalized envelope overflow and returns all output reservations', () => {
    const context = fixture(
      { value: 'x'.repeat(limits.bytes - 1024) },
      { ...limits, retained: 32 * MiB },
    )
    const baseline = context.owner.stats
    const request = context.receiver.begin(1, context.checked)
    try {
      expect(() =>
        finishPackedSteps(
          context.publisher.offerCurrentSteps(request, context.checked, {
            ...budget,
            bytes: limits.bytes,
          }),
        ),
      ).toThrow('message/envelope limit')
      expect(context.owner.stats).toEqual(baseline)
    } finally {
      context.close()
    }
  })

  it('keeps the committed worker result usable after receiver validation rejects a transferred full result', async () => {
    const context = fixture({ value: 'forged' })
    const baseline = context.owner.stats
    try {
      const { wire, request } = context.offer()
      expect(() =>
        context.receiver.receive(request, structuredClone(wire, { transfer: [wire.payload] })),
      ).toThrow('Schema/source mismatch')
      expect(context.receiver.stats.current).toBeNull()
      expect(context.publisher.cancel()).toBe(true)
      expect(context.owner.stats).toEqual(baseline)
      const next = context.offer()
      expect(next.wire.kind).toBe('full')
      context.publisher.cancel()
    } finally {
      context.close()
    }
  })

  it('binds the normalized request before queued resync starts and rejects concurrent publication', async () => {
    const context = fixture()
    const original = context.receiver.begin(1, context.checked)
    const request = { ...structuredClone(original) },
      localBudget = { ...budget }
    const work = context.publisher.offerCurrentSteps(request, context.checked, localBudget)
    try {
      request.sequence = 999
      localBudget.bytes = 4
      expect(() => context.publisher.offerCurrentSteps(original, context.checked, budget)).toThrow(
        'pending',
      )
      const wire = finishPackedSteps(work)
      if (!wire) throw new Error('No resync')
      expect(wire.sequence).toBe(1)
      const received = context.receiver.receive(original, await transfer(wire))
      if (received.kind !== 'accepted') throw new Error('No receipt')
      context.publisher.acknowledge(received.acknowledgement)
      received.capture.release()
    } finally {
      work.return()
      context.close()
    }
  })

  it('rejects copy limits and closed capture copies without allocating outgoing storage', () => {
    const context = fixture()
    const capture = context.owner.capture(),
      baseline = context.owner.stats
    const allocate = vi.spyOn(globalThis, 'ArrayBuffer')
    try {
      for (const bytes of [4, NaN, -1, 9 * MiB]) {
        const work = capture.copyEncoding(bytes)
        if (!work) throw new Error('Missing copy')
        expect(() => finishPackedSteps(work)).toThrow(/copy/)
        expect(context.owner.stats).toEqual(baseline)
      }
      expect(allocate).not.toHaveBeenCalled()
      capture.release()
      expect(() => capture.copyEncoding(MiB)).toThrow('released')
    } finally {
      allocate.mockRestore()
      capture.release()
      context.close()
    }
  })

  it('rejects a full copy before allocation when total session capacity is unavailable, then permits retry', () => {
    const context = fixture({ value: 'original', text: 'x'.repeat(300000) })
    const busy = context.owner.retain({
      resources: () => [
        { key: {}, bytes: limits.retained - context.owner.stats.retainedBytes - 200000 },
      ],
    })
    const baseline = context.owner.stats
    const request = context.receiver.begin(1, context.checked)
    const allocate = vi.spyOn(globalThis, 'ArrayBuffer')
    try {
      expect(() =>
        finishPackedSteps(context.publisher.offerCurrentSteps(request, context.checked, budget)),
      ).toThrow('Packed reader scope limit')
      expect(allocate).not.toHaveBeenCalled()
      expect(context.owner.stats).toEqual(baseline)
      allocate.mockRestore()
      busy.release()
      const { wire } = context.offer()
      expect(wire.kind).toBe('full')
      context.publisher.cancel()
    } finally {
      allocate.mockRestore()
      busy.release()
      context.close()
    }
  })

  it.each(['measurement', 'output'] as const)(
    'cancels overlay resync during %s with exact owner restoration',
    (phase) => {
      const context = fixture({
        value: 'original',
        items: Array.from({ length: 2000 }, (_, index) => ({ index })),
      })
      const next = source('next', 1)
      context.owner.commit(
        context.owner.prepareDelta(context.owner.beginPrepared(next), {
          base: context.checked.identity,
          baseSource: context.checked.text,
          result: next.identity,
          payload: packValue(next.text, MiB),
          operations: [{ kind: 'replace', path: ['value'], record: 0 }],
        }),
      )
      const baseline = context.owner.stats
      const request = context.receiver.begin(1, next)
      const work = context.publisher.offerCurrentSteps(request, next, budget)
      try {
        let suspended = false
        for (let i = 0; i < 100000; i++) {
          const step = work.next()
          if (step.done) throw new Error('Finished before cancellation')
          if (phase === 'measurement' ? i > 10 : context.owner.stats.holds > baseline.holds) {
            suspended = true
            break
          }
        }
        expect(suspended).toBe(true)
        context.publisher.cancel()
        expect(work.next()).toEqual({ done: true, value: undefined })
        expect(context.owner.stats).toEqual(baseline)
      } finally {
        work.return()
        context.close()
      }
    },
  )

  it.each(['queued', 'running', 'offered', 'owner-first'] as const)(
    'disposes %s resync without leaving live output or scheduler ownership',
    (phase) => {
      const context = fixture()
      const request = context.receiver.begin(1, context.checked)
      const work = context.publisher.offerCurrentSteps(request, context.checked, budget)
      let wire: Exclude<PackedWireMessage, { kind: 'resync' }> | undefined
      try {
        if (phase === 'running') work.next()
        if (phase === 'offered' || phase === 'owner-first') wire = finishPackedSteps(work)
        if (phase === 'owner-first') context.owner.dispose()
        context.publisher.dispose()
        expect(work.next()).toEqual({ done: true, value: undefined })
        if (wire) expect(wire.payload.byteLength).toBe(0)
        if (phase !== 'owner-first') {
          expect(context.owner.stats.captures).toBe(0)
          expect(context.owner.stats.holds).toBe(0)
          expect(context.owner.stats.readerStagingBytes).toBe(0)
        }
      } finally {
        work.return()
        context.close()
      }
    },
  )
})
