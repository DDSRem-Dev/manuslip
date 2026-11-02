import { expect, it, vi } from 'vitest'
import {
  PreviewStatusPublication,
  previewStatusLimits,
} from '../../../../../src/renderer/src/preview/status-publication'

const resource = () => ({ release: vi.fn() })
function publish(owner: PreviewStatusPublication) {
  const value = resource(),
    ticket = owner.prepare(() => value),
    version = ticket.publish()
  ticket.release()
  return { value, version }
}

it('holds superseded status until every committed consumer advances or unmounts', () => {
  const owner = new PreviewStatusPublication(),
    first = owner.subscribe(),
    second = owner.subscribe()
  const a = publish(owner)
  first.acknowledge(a.version)
  second.acknowledge(a.version)
  const b = publish(owner)
  first.acknowledge(b.version)
  expect(a.value.release).not.toHaveBeenCalled()
  first.acknowledge(a.version) // A stale effect must never move acknowledgement backward.
  second.release()
  expect(a.value.release).toHaveBeenCalledTimes(1)
  expect(b.value.release).not.toHaveBeenCalled()
  first.release()
  expect(b.value.release).not.toHaveBeenCalled() // The store still owns its current status.
  owner.close()
  expect(b.value.release).toHaveBeenCalledTimes(1)
})

it('cancels unpublished status and keeps previous publication after acquisition failure', () => {
  const owner = new PreviewStatusPublication(),
    a = publish(owner),
    pending = resource()
  const ticket = owner.prepare(() => pending)
  expect(owner.stats.pending).toBe(true)
  ticket.release()
  ticket.release()
  expect(pending.release).toHaveBeenCalledTimes(1)
  expect(() => ticket.publish()).toThrow('Superseded')
  expect(() =>
    owner.prepare(() => {
      throw new Error('capacity')
    }),
  ).toThrow('capacity')
  expect(owner.stats).toMatchObject({ version: a.version, publications: 1, pending: false })
  expect(a.value.release).not.toHaveBeenCalled()
  owner.close()
})

it('retains skipped publications until a committed latest snapshot acknowledges them', () => {
  const owner = new PreviewStatusPublication(),
    consumer = owner.subscribe()
  const all = Array.from({ length: 5 }, () => publish(owner))
  expect(all.every(({ value }) => value.release.mock.calls.length === 0)).toBe(true)
  consumer.acknowledge(owner.stats.version)
  expect(all.slice(0, -1).every(({ value }) => value.release.mock.calls.length === 1)).toBe(true)
  expect(all.at(-1)?.value.release).not.toHaveBeenCalled()
  const empty = owner.replace()
  expect(all.at(-1)?.value.release).not.toHaveBeenCalled()
  consumer.acknowledge(empty)
  expect(owner.stats.publications).toBe(0)
  consumer.release()
  owner.close()
})

it('bounds pending resources before acquisition and permits native fallback at capacity', () => {
  const owner = new PreviewStatusPublication(),
    consumer = owner.subscribe()
  const values = Array.from({ length: previewStatusLimits.publications }, () => publish(owner))
  const acquire = vi.fn(resource)
  expect(() => owner.prepare(acquire)).toThrow('semantic-limit')
  expect(acquire).not.toHaveBeenCalled()
  const version = owner.replace()
  consumer.acknowledge(version)
  expect(values.every(({ value }) => value.release.mock.calls.length === 1)).toBe(true)
  expect(owner.stats.publications).toBe(0)
  consumer.release()
  owner.close()
})

it('keeps status during close until current consumers acknowledge empty state or unmount', () => {
  const owner = new PreviewStatusPublication(),
    consumer = owner.subscribe(),
    a = publish(owner)
  consumer.acknowledge(a.version)
  const pending = resource(),
    ticket = owner.prepare(() => pending)
  const version = owner.close()
  expect(pending.release).toHaveBeenCalledTimes(1)
  expect(() => ticket.publish()).toThrow('Superseded')
  expect(a.value.release).not.toHaveBeenCalled()
  consumer.acknowledge(version)
  expect(a.value.release).toHaveBeenCalledTimes(1)
  consumer.release()
  consumer.release()
  owner.close()
  expect(owner.stats).toMatchObject({ publications: 0, consumers: 0, pending: false, closed: true })
})

it('bounds consumers and tolerates Strict Mode cleanup/re-subscription without releasing current status', () => {
  const owner = new PreviewStatusPublication(),
    a = publish(owner)
  const consumers = Array.from({ length: previewStatusLimits.consumers }, () => owner.subscribe())
  expect(() => owner.subscribe()).toThrow('semantic-limit')
  for (const consumer of consumers) consumer.release()
  const replay = owner.subscribe()
  replay.acknowledge(a.version)
  expect(a.value.release).not.toHaveBeenCalled()
  expect(() => replay.acknowledge(a.version + 1)).toThrow('Invalid')
  replay.release()
  owner.close()
  owner.subscribe().release()
})
