import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import type { PackedCapture } from '../../src/packing-capture'
import { readPackedNative } from '../../src/packing-native'
import { PackedReceiver, type PackedReceiveTicket } from '../../src/packing-receiver'
import { PackedSource } from '../../src/packing-source'
import { newPackedToken } from '../../src/packing-token'
import { packedWireVersion } from '../../src/packing-wire'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 8, readers: 64 }
const outputLimits = { ...limits, nodes: 800000, depth: 64 }
const source = (text: string, revision = 0, changed = {}) =>
  new PackedSource(
    {
      generation: 1,
      documentId: 'receiver-tests',
      revision,
      sourceHash: sourceHash(text),
      parserVersion: 'parser',
      rendererVersion: 'renderer',
      options: 'options',
      ...changed,
    },
    text,
  )
const full = (checked: PackedSource, sequence = 1, body: unknown = { value: checked.text }) => ({
  protocol: packedWireVersion,
  kind: 'full',
  sequence,
  result: checked.identity,
  sentAt: 1,
  payload: packValue(body, 8 * MiB),
  metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
})
const delta = (base: PackedSource, result: PackedSource, sequence = 2) => ({
  protocol: packedWireVersion,
  kind: 'delta',
  sequence,
  base: base.identity,
  result: result.identity,
  sentAt: 2,
  payload: packValue(result.text, 8 * MiB),
  operations: [{ kind: 'replace', path: ['value'], record: 0 }],
  metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
})
const transfer = <T extends { payload: ArrayBuffer }>(value: T): T =>
  structuredClone(value, { transfer: [value.payload] })
const value = (capture: PackedCapture) => readPackedNative(capture.reader, [], outputLimits).value
const validate = (capture: PackedCapture, checked: PackedSource) => {
  if (
    capture.reader.keys([], { retained: 8192, staging: 0 }).join(',') !== 'value' ||
    capture.reader.scalar(['value'], outputLimits) !== checked.text
  )
    throw new Error('Invalid test schema/source binding')
}
function receive(receiver: PackedReceiver, ticket: PackedReceiveTicket, raw: object) {
  const packet = {
    ...raw,
    requestToken: ticket.requestToken,
    ...('payload' in raw ? { resultToken: newPackedToken() } : {}),
    ...('kind' in raw && raw.kind === 'delta'
      ? { baseToken: ticket.base?.token ?? newPackedToken() }
      : {}),
  }
  return receiver.receive(ticket, packet)
}
function publish(receiver: PackedReceiver, checked: PackedSource, sequence = 1) {
  const result = receive(
    receiver,
    receiver.begin(sequence, checked),
    transfer(full(checked, sequence)),
  )
  if (result.kind !== 'accepted') throw new Error('Expected acceptance')
  return result.capture
}

describe('transactional packed wire receiver', () => {
  it('admits trusted application metadata in the receiver union and revokes it on disposal', () => {
    const receiver = new PackedReceiver(limits, validate)
    const before = receiver.stats
    const key = {}
    const first = receiver.retain({ resources: () => [{ key, bytes: 4096 }] })
    const retained = receiver.stats.retainedBytes
    expect(retained - before.retainedBytes).toBeGreaterThanOrEqual(4096)
    const second = receiver.retain({ resources: () => [{ key, bytes: 4096 }] })
    expect(receiver.stats.retainedBytes - retained).toBeLessThan(4096)
    first.release()
    expect(receiver.stats.retainedBytes).toBe(retained)
    second.release()
    expect(receiver.stats).toEqual(before)
    const live = receiver.retain({ resources: () => [{ key, bytes: 4096 }] })
    receiver.dispose()
    live.release()
    expect(receiver.stats.retainedBytes).toBe(0)
    expect(() => receiver.retain({ resources: () => [] })).toThrow(/disposed/)
  })
  it('rejects a replay with repeated sequence and source before consuming its payload', () => {
    const receiver = new PackedReceiver(limits, validate)
    const checked = source('same')
    try {
      const cancelled = receiver.begin(1, checked)
      const packet = {
        ...full(checked),
        requestToken: cancelled.requestToken,
        resultToken: newPackedToken(),
      }
      receiver.cancel(cancelled)
      const fresh = receiver.begin(1, checked)
      expect(fresh.requestToken).not.toBe(cancelled.requestToken)
      expect(() => receiver.receive(fresh, packet)).toThrow('mismatch')
      expect(packet.payload.byteLength).toBeGreaterThan(0)
      expect(receiver.stats.current).toBeNull()
    } finally {
      receiver.dispose()
    }
  })
  it('advertises the accepted token and resyncs a delta with an unrelated base token', () => {
    const receiver = new PackedReceiver(limits, validate)
    const initial = source('old')
    try {
      const ticket = receiver.begin(1, initial)
      const resultToken = newPackedToken()
      const result = receiver.receive(ticket, {
        ...full(initial),
        requestToken: ticket.requestToken,
        resultToken,
      })
      if (result.kind !== 'accepted') throw new Error('Expected acceptance')
      expect(result.acknowledgement).toMatchObject({
        requestToken: ticket.requestToken,
        resultToken,
      })
      const next = source('next', 1)
      const nextTicket = receiver.begin(2, next)
      expect(nextTicket.base).toEqual({ identity: initial.identity, token: resultToken })
      const packet = {
        ...delta(initial, next),
        requestToken: nextTicket.requestToken,
        baseToken: newPackedToken(),
        resultToken: newPackedToken(),
      }
      expect(receiver.receive(nextTicket, packet)).toEqual({
        kind: 'resync',
        reason: 'base-mismatch',
      })
      expect(packet.payload.byteLength).toBeGreaterThan(0)
      expect(value(result.capture)).toEqual({ value: 'old' })
      const retry = receiver.begin(2, next)
      const reused = { ...full(next, 2), requestToken: retry.requestToken, resultToken }
      expect(() => receiver.receive(retry, reused)).toThrow('advance')
      expect(reused.payload.byteLength).toBeGreaterThan(0)
      result.capture.release()
    } finally {
      receiver.dispose()
    }
  })
  it('validates before atomic full/delta publication through real transfers, retaining exact old captures', () => {
    let calls = 0
    const receiver = new PackedReceiver(limits, (capture, checked) => {
      validate(capture, checked)
      calls++
      expect(receiver.stats.current?.revision ?? -1).toBe(checked.identity.revision - 1)
      expect(receiver.stats.holds).toBe(2)
      expect(receiver.stats.retainedBytes).toBeLessThanOrEqual(limits.retained)
    })
    try {
      const initial = source('first')
      const old = publish(receiver, initial)
      let current = initial
      for (let step = 1; step <= 20; step++) {
        const next = source(`value 中文😀 ${step}`, step)
        const message = delta(current, next, step + 1)
        const incoming = transfer(message)
        expect(message.payload.byteLength).toBe(0)
        const result = receive(receiver, receiver.begin(step + 1, next), incoming)
        expect(incoming.payload.byteLength).toBe(0)
        if (result.kind !== 'accepted') throw new Error('Expected acceptance')
        expect(value(result.capture)).toEqual({ value: next.text })
        expect(value(old)).toEqual({ value: 'first' })
        expect(receiver.stats).toMatchObject({
          holds: 1,
          readers: 0,
          requested: null,
          prepared: null,
        })
        result.capture.release()
        current = next
      }
      expect(calls).toBe(21)
      old.release()
    } finally {
      receiver.dispose()
    }
    expect(receiver.stats).toMatchObject({
      retainedBytes: 0,
      captures: 0,
      holds: 0,
      resources: 0,
      disposed: true,
    })
  })
  it('requires a validator and rejects asynchronous validators before publication', () => {
    expect(() => new PackedReceiver(limits, undefined as unknown as typeof validate)).toThrow(
      'validator',
    )
    const receiver = new PackedReceiver(limits, () => Promise.resolve())
    try {
      const checked = source('value')
      expect(() => receive(receiver, receiver.begin(1, checked), full(checked))).toThrow(
        'synchronously',
      )
      expect(receiver.stats).toMatchObject({
        current: null,
        requested: null,
        prepared: null,
        holds: 1,
        captures: 0,
      })
    } finally {
      receiver.dispose()
    }
  })
  it('rejects cloned and obsolete tickets, including repeated sequence/identity values after cancellation', () => {
    const receiver = new PackedReceiver(limits, validate)
    try {
      const checked = source('same')
      const stale = receiver.begin(1, checked)
      const ticket = receiver.begin(1, checked)
      const before = receiver.stats
      for (const wrong of [stale, { ...ticket }]) {
        const packet = full(checked)
        expect(() => receive(receiver, wrong, packet)).toThrow('Stale')
        expect(packet.payload.byteLength).toBeGreaterThan(0)
        expect(receiver.stats).toEqual(before)
        expect(receiver.cancel(wrong)).toBe(false)
      }
      expect(receiver.cancel(ticket)).toBe(true)
      const next = receiver.begin(1, checked)
      expect(() => receive(receiver, ticket, full(checked))).toThrow('Stale')
      const accepted = receive(receiver, next, full(checked))
      if (accepted.kind !== 'accepted') throw new Error('Expected acceptance')
      accepted.capture.release()
    } finally {
      receiver.dispose()
    }
  })
  it('rejects mismatched envelopes before decode and clears only their own pending request', () => {
    const receiver = new PackedReceiver(limits, validate)
    const checked = source('value')
    const decode = vi.spyOn(PackedArena, 'open')
    try {
      const packet = full(checked, 2)
      expect(() => receive(receiver, receiver.begin(1, checked), packet)).toThrow('mismatch')
      expect(decode).not.toHaveBeenCalled()
      expect(packet.payload.byteLength).toBeGreaterThan(0)
      expect(receiver.stats).toMatchObject({
        current: null,
        requested: null,
        prepared: null,
        holds: 1,
      })
    } finally {
      decode.mockRestore()
      receiver.dispose()
    }
  })
  it('returns explicit resync for absent/evicted/mismatched bases without consuming payloads', () => {
    const receiver = new PackedReceiver(limits, validate)
    const initial = source('old')
    const next = source('next', 1)
    try {
      let packet = delta(initial, next)
      expect(receive(receiver, receiver.begin(2, next), packet)).toEqual({
        kind: 'resync',
        reason: 'base-unavailable',
      })
      expect(packet.payload.byteLength).toBeGreaterThan(0)
      const old = publish(receiver, initial)
      packet = delta(source('wrong'), next)
      expect(receive(receiver, receiver.begin(2, next), packet)).toEqual({
        kind: 'resync',
        reason: 'base-mismatch',
      })
      expect(packet.payload.byteLength).toBeGreaterThan(0)
      expect(value(old)).toEqual({ value: 'old' })
      receiver.evict()
      expect(value(old)).toEqual({ value: 'old' })
      packet = delta(initial, next)
      expect(receive(receiver, receiver.begin(2, next), packet)).toEqual({
        kind: 'resync',
        reason: 'base-unavailable',
      })
      old.release()
      const fresh = publish(receiver, next, 3)
      expect(value(fresh)).toEqual({ value: 'next' })
      fresh.release()
    } finally {
      receiver.dispose()
    }
  })
  it.each(['generation', 'documentId', 'parserVersion', 'rendererVersion', 'options'] as const)(
    'requires a full result when %s changes',
    (key) => {
      const receiver = new PackedReceiver(limits, validate)
      try {
        const initial = source('old')
        const old = publish(receiver, initial)
        const next = source('next', 1, { [key]: key === 'generation' ? 2 : 'changed' })
        const base = source('old', 0, { [key]: next.identity[key] })
        const packet = delta(base, next)
        expect(receive(receiver, receiver.begin(2, next), packet)).toEqual({
          kind: 'resync',
          reason: 'base-unavailable',
        })
        const fresh = publish(receiver, next, 3)
        expect(value(fresh)).toEqual({ value: 'next' })
        expect(value(old)).toEqual({ value: 'old' })
        fresh.release()
        old.release()
      } finally {
        receiver.dispose()
      }
    },
  )
  it('preserves current data and closes partial inspections/readers on decode, operation or schema failure', () => {
    const receiver = new PackedReceiver(limits, (capture, checked) => {
      const iterator = capture.reader.elements(['items'])
      iterator.next()
      if (checked.identity.revision > 0) throw new Error('Rejected schema')
      iterator.return()
    })
    const initial = source('old')
    try {
      const original = receive(
        receiver,
        receiver.begin(1, initial),
        full(initial, 1, { items: [1, 2] }),
      )
      if (original.kind !== 'accepted') throw new Error('Expected acceptance')
      const next = source('next', 1)
      const malformed = full(next, 2)
      malformed.payload = new Uint8Array([77, 83, 80, 50, 255]).buffer
      expect(() => receive(receiver, receiver.begin(2, next), malformed)).toThrow()
      const badOperation = delta(initial, next)
      badOperation.operations[0] = { kind: 'replace', path: ['missing'], record: 0 }
      expect(() => receive(receiver, receiver.begin(2, next), badOperation)).toThrow()
      expect(() =>
        receive(receiver, receiver.begin(2, next), full(next, 2, { items: [3, 4] })),
      ).toThrow('Rejected schema')
      expect(receiver.stats).toMatchObject({
        current: initial.identity,
        requested: null,
        prepared: null,
        readers: 0,
        holds: 1,
        captures: 1,
      })
      expect(value(original.capture)).toEqual({ items: [1, 2] })
      original.capture.release()
    } finally {
      receiver.dispose()
    }
  })
  it('preserves a newer request when validation reenters the receiver', () => {
    const next = source('newer', 1)
    let replacement: ReturnType<PackedReceiver['begin']> | undefined
    const receiver = new PackedReceiver(limits, () => {
      replacement = receiver.begin(2, next)
    })
    try {
      const initial = source('old')
      expect(() => receive(receiver, receiver.begin(1, initial), full(initial))).toThrow('Stale')
      expect(receiver.stats).toMatchObject({
        current: null,
        requested: next.identity,
        prepared: null,
        holds: 1,
        captures: 0,
      })
      if (!replacement) throw new Error('Missing newer request')
      expect(receiver.cancel(replacement)).toBe(true)
    } finally {
      receiver.dispose()
    }
  })
  it('retains current/captured data when incoming ownership cannot fit and revokes all readers on disposal', () => {
    const receiver = new PackedReceiver({ ...limits, retained: 64 * 1024 }, validate)
    try {
      const initial = source('old')
      const old = publish(receiver, initial)
      const next = source('next', 1)
      expect(() =>
        receive(receiver, receiver.begin(2, next), full(next, 2, { value: 'x'.repeat(65536) })),
      ).toThrow('retained limit')
      expect(value(old)).toEqual({ value: 'old' })
      expect(receiver.stats).toMatchObject({
        current: initial.identity,
        requested: null,
        prepared: null,
        readers: 0,
        holds: 1,
      })
      receiver.dispose()
      expect(() => old.reader.kind()).toThrow('released')
      expect(() => receiver.begin(3, next)).toThrow('disposed')
    } finally {
      receiver.dispose()
    }
    expect(receiver.stats.retainedBytes).toBe(0)
  })
  it.each(['base-unavailable', 'base-mismatch', 'ownership', 'capacity', 'unsupported'] as const)(
    'handles explicit %s resync messages without changing accepted data',
    (reason) => {
      const receiver = new PackedReceiver(limits, validate)
      try {
        const initial = source('old')
        const old = publish(receiver, initial)
        const next = source('new', 1)
        expect(
          receive(receiver, receiver.begin(2, next), {
            protocol: packedWireVersion,
            kind: 'resync',
            sequence: 2,
            result: next.identity,
            sentAt: 2,
            reason,
          }),
        ).toEqual({ kind: 'resync', reason })
        expect(value(old)).toEqual({ value: 'old' })
        expect(receiver.stats).toMatchObject({
          current: initial.identity,
          requested: null,
          prepared: null,
        })
        old.release()
      } finally {
        receiver.dispose()
      }
    },
  )
})
