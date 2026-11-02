import { describe, expect, it } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedSession } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'
import { finishPackedSteps } from '../../src/packing-work'

const MiB = 1024 * 1024
const limits = { bytes: MiB, retained: 4 * MiB, staging: MiB, captures: 8, readers: 16 }
const source = (revision = 0) =>
  new PackedSource(
    {
      generation: 1,
      documentId: 'staging',
      revision,
      sourceHash: sourceHash('source'),
      parserVersion: 'test',
      rendererVersion: 'test',
      options: 'test',
    },
    'source',
  )
const read = (capture: ReturnType<PackedSession['capture']>, path: string[]) =>
  capture.reader.scalar(path, { retained: MiB, staging: MiB })

describe('request-owned temporary packed snapshots', () => {
  it('stages multiple independently owned values without publishing or replacing the request', () => {
    const owner = new PackedSession(limits)
    const initial = source()
    owner.commit(
      owner.prepareFull(
        owner.beginPrepared(initial),
        initial.identity,
        packValue({ old: true }, MiB),
      ),
    )
    const old = owner.capture()
    const next = source(1)
    const ticket = owner.beginPrepared(next)
    const baseline = owner.stats
    const first = finishPackedSteps(owner.stageFullSteps(ticket, packValue({ first: 1 }, MiB)))
    const second = finishPackedSteps(owner.stageFullSteps(ticket, packValue({ second: 2 }, MiB)))
    if (!first || !second) throw new Error('Missing staged capture')
    expect(read(first, ['first'])).toBe(1)
    expect(read(second, ['second'])).toBe(2)
    expect(read(old, ['old'])).toBe(true)
    expect(first.sameOwner(second)).toBe(true)
    expect(first.sourceResource).toBe(next)
    expect(owner.stats.current).toEqual(initial.identity)
    expect(owner.stats.requested).toEqual(next.identity)
    expect(owner.stats.prepared).toBeNull()
    expect(owner.stats.preparingPhase).toBeNull()
    const prepared = finishPackedSteps(
      owner.prepareFullSteps(ticket, next.identity, packValue({ final: 3 }, MiB)),
    )
    if (!prepared) throw new Error('Missing final preparation')
    owner.commit(prepared)
    expect(read(first, ['first'])).toBe(1)
    expect(read(second, ['second'])).toBe(2)
    expect(read(old, ['old'])).toBe(true)
    first.release()
    second.release()
    old.release()
    expect(owner.stats.captures).toBe(0)
    expect(owner.stats.retainedBytes).toBeLessThan(baseline.retainedBytes + 1024)
    owner.dispose()
  })

  it('charges staged values and old consumers to the same aggregate cap', () => {
    const owner = new PackedSession({ ...limits, retained: 130000 })
    const current = source()
    const ticket = owner.beginPrepared(current)
    const first = finishPackedSteps(
      owner.stageFullSteps(ticket, packValue({ text: 'a'.repeat(70000) }, MiB)),
    )
    if (!first) throw new Error('Missing staged capture')
    const baseline = owner.stats
    expect(() =>
      finishPackedSteps(owner.stageFullSteps(ticket, packValue({ text: 'b'.repeat(70000) }, MiB))),
    ).toThrow('retained limit')
    expect(owner.stats).toEqual(baseline)
    expect(first.reader.textLength(['text'])).toBe(70000)
    first.release()
    const retry = finishPackedSteps(
      owner.stageFullSteps(ticket, packValue({ text: 'b'.repeat(70000) }, MiB)),
    )
    expect(retry).toBeDefined()
    retry?.release()
    owner.dispose()
  })

  it.each(['before', 'suspended', 'superseded', 'dispose', 'throw'] as const)(
    'closes pending indexing after %s without retaining a temporary capture',
    (phase) => {
      const owner = new PackedSession(limits)
      const current = source()
      const ticket = owner.beginPrepared(current)
      const baseline = owner.stats
      const payload = packValue(
        Array.from({ length: 10000 }, (_, i) => ({ i })),
        MiB,
      )
      const work = owner.stageFullSteps(ticket, payload)
      expect(payload.byteLength).toBe(0)
      if (phase !== 'before') expect(work.next().done).toBe(false)
      if (phase === 'superseded') owner.beginPrepared(source(1))
      else if (phase === 'dispose') owner.dispose()
      else if (phase === 'throw') {
        const failure = new Error('cancelled')
        expect(() => work.throw(failure)).toThrow(failure)
      } else work.return()
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(owner.stats.preparingPhase).toBeNull()
      expect(owner.stats.captures).toBe(0)
      if (phase === 'before' || phase === 'suspended' || phase === 'throw')
        expect(owner.stats).toEqual(baseline)
      owner.dispose()
    },
  )

  it('keeps explicitly held staged data valid across request supersession and revokes it on disposal', () => {
    const owner = new PackedSession(limits)
    const capture = finishPackedSteps(
      owner.stageFullSteps(owner.beginPrepared(source()), packValue({ value: 4 }, MiB)),
    )
    if (!capture) throw new Error('Missing staged capture')
    const reader = capture.reader
    owner.beginPrepared(source(1))
    expect(read(capture, ['value'])).toBe(4)
    owner.dispose()
    expect(() => reader.kind()).toThrow('released')
    expect(owner.stats.captures).toBe(0)
    expect(owner.stats.retainedBytes).toBe(0)
  })

  it('denies a stale ticket and an overlapping preparation before consuming their buffers', () => {
    const owner = new PackedSession(limits)
    const stale = owner.beginPrepared(source())
    const ticket = owner.beginPrepared(source(1))
    const bytes = packValue({ value: 4 }, MiB)
    const length = bytes.byteLength
    expect(() => owner.stageFullSteps(stale, bytes)).toThrow('Stale packed request')
    expect(bytes.byteLength).toBe(length)
    const work = owner.stageFullSteps(ticket, packValue({ value: 1 }, MiB))
    expect(() => owner.stageFullSteps(ticket, bytes)).toThrow('already pending')
    expect(bytes.byteLength).toBe(length)
    work.return()
    owner.dispose()
  })
})
