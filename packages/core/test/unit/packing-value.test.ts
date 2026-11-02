import { describe, expect, it } from 'vitest'
import { PackedSession } from '../../src/packing-session'

const limits = { retained: 65536, bytes: 8192, staging: 8192, captures: 4, readers: 16 }
describe('session-owned native values', () => {
  it('retains independently after base eviction and after the original handle closes', () => {
    const owner = new PackedSession(limits)
    const value = { blocks: [{ text: 'still borrowed' }] }
    const first = owner.own(value, 8192)
    const before = owner.stats
    const second = first.retain()
    expect(second.sameOwner(first)).toBe(true)
    expect(owner.stats.holds).toBe(2)
    expect(owner.stats.retainedBytes - before.retainedBytes).toBe(320)
    first.release()
    owner.evict()
    expect(() => first.retain()).toThrow(/released/)
    expect(second.value).toBe(value)
    const third = second.retain()
    second.release()
    expect(third.value).toBe(value)
    owner.dispose()
    expect(() => third.value).toThrow(/released/)
    expect(() => third.retain()).toThrow(/released/)
    third.release()
    expect(owner.stats.retainedBytes).toBe(0)
  })
  it('rejects a retained handle atomically when metadata does not fit', () => {
    const owner = new PackedSession({ ...limits, retained: 1024 })
    const first = owner.own({}, 100)
    const before = owner.stats
    expect(() => first.retain()).toThrow(/retained limit/)
    expect(owner.stats).toEqual(before)
    expect(first.value).toEqual({})
    first.release()
    expect(owner.stats.retainedBytes).toBe(256)
  })
  it('charges independent output until release and revokes all access on disposal', () => {
    const owner = new PackedSession(limits),
      before = owner.stats
    const value = { blocks: [{ text: 'value' }] }
    const first = owner.own(value, 8192),
      second = owner.own(value, 8192)
    expect(first.value).toBe(value)
    expect(owner.stats.retainedBytes).toBeLessThan(before.retainedBytes + 2 * 8192)
    first.release()
    first.release()
    expect(() => first.value).toThrow(/released/)
    expect(second.value).toBe(value)
    expect(owner.stats.retainedBytes).toBeGreaterThan(before.retainedBytes + 8192)
    owner.dispose()
    expect(() => second.value).toThrow(/released/)
    expect(owner.stats.retainedBytes).toBe(0)
    second.release()
    expect(owner.stats.retainedBytes).toBe(0)
  })
  it('rejects inconsistent weights, invalid inputs and capacity without admitting partial output', () => {
    const owner = new PackedSession(limits)
    const value = {},
      first = owner.own(value, 8192),
      before = owner.stats
    expect(() => owner.own(value, 4096)).toThrow(/Inconsistent/)
    for (const bytes of [-1, NaN, Infinity, 0.5, limits.retained])
      expect(() => owner.own({}, bytes)).toThrow()
    expect(() => owner.own(null as unknown as object, 1)).toThrow(/Invalid/)
    expect(owner.stats).toEqual(before)
    first.release()
    expect(owner.stats.holds).toBe(0)
    owner.dispose()
    expect(() => owner.own({}, 1)).toThrow(/disposed/)
  })
})
