import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { PackedItemSteps, type PackedReadScope } from '../../src/packing-capture'
import { PackedSession } from '../../src/packing-session'
import type { PackedView } from '../../src/packing-view'

const MiB = 1024 * 1024
function fixture() {
  const owner = new PackedSession({
    bytes: MiB,
    retained: 4 * MiB,
    staging: MiB,
    captures: 4,
    readers: 8,
  })
  const text = 'source'
  const identity = {
    generation: 1,
    revision: 0,
    documentId: 'iteration',
    sourceHash: sourceHash(text),
    parserVersion: 'test',
    rendererVersion: 'test',
    options: 'test',
  }
  owner.commit(
    owner.prepareFull(
      owner.begin(identity, text),
      identity,
      packValue(
        Array.from({ length: 600 }, (_, index) => index),
        MiB,
      ),
    ),
  )
  return { owner, capture: owner.capture() }
}
const unused = () => {
  throw new Error('Unexpected child traversal')
}

describe('capture-owned array iteration', () => {
  for (const phase of ['queued', 'item', 'checkpoint'] as const)
    it.each(['return', 'release', 'dispose'] as const)(
      `revokes ${phase} arrays and their borrowed values on %s`,
      (action) => {
        const { owner, capture } = fixture()
        const items = capture.reader.elementSteps()
        try {
          let borrowed: PackedReadScope | undefined
          if (phase !== 'queued') {
            let step = items.next()
            expect(step.done).toBe(false)
            borrowed = step.value
            expect(borrowed?.scalar([], { retained: 16, staging: 0 })).toBe(0)
            if (phase === 'checkpoint') {
              for (let index = 0; step.value !== undefined; index++) {
                expect(index).toBeLessThan(256)
                step = items.next()
              }
              expect(step.done).toBe(false)
              expect(() => borrowed?.kind()).toThrow('expired')
            }
          }
          if (action === 'return') items.return()
          else if (action === 'release') capture.release()
          else owner.dispose()
          expect(owner.stats.readers).toBe(0)
          expect(items.next()).toEqual({ done: true, value: undefined })
          expect(items.return()).toEqual({ done: true, value: undefined })
          if (borrowed) expect(() => borrowed.kind()).toThrow('expired')
        } finally {
          owner.dispose()
        }
      },
    )

  for (const mode of ['synchronous', 'cooperative'] as const)
    it.each(['return', 'release', 'dispose', 'next'] as const)(
      `revokes a ${mode} running advance on %s and discards the yielded item`,
      (action) => {
        const { owner, capture } = fixture()
        const items =
          mode === 'synchronous' ? capture.reader.elements() : capture.reader.elementSteps()
        const original = PackedArena.prototype.elements
        let finalized = 0
        const spy = vi.spyOn(PackedArena.prototype, 'elements').mockImplementation(function* (
          this: PackedArena,
          reference,
        ) {
          try {
            for (const value of original.call(this, reference)) {
              if (action === 'next') expect(() => items.next()).toThrow('Reentrant packed work')
              else if (action === 'return') items.return()
              else if (action === 'release') capture.release()
              else owner.dispose()
              expect(owner.stats.readers).toBe(0)
              yield value
            }
          } finally {
            finalized++
          }
        })
        try {
          expect(items.next()).toEqual({ done: true, value: undefined })
          expect(finalized).toBe(1)
          expect(owner.stats.readers).toBe(0)
          items.return()
          expect(items.next()).toEqual({ done: true, value: undefined })
          expect(finalized).toBe(1)
        } finally {
          spy.mockRestore()
          owner.dispose()
        }
      },
    )

  for (const started of [false, true])
    for (const generatorThrows of [false, true])
      it.each([false, true])(
        `finishes all cleanup (started=${started}, generator throws=${generatorThrows}, owner throws=%s)`,
        (ownerThrows) => {
          const events: string[] = [],
            generatorFailure = new Error('generator cleanup'),
            ownerFailure = new Error('owner cleanup')
          const inner = (function* (): Generator<PackedView | undefined, void, undefined> {
            try {
              yield
            } finally {
              events.push('generator')
              if (generatorThrows) {
                // biome-ignore lint/correctness/noUnsafeFinally: Verify failure precedence.
                throw generatorFailure
              }
            }
          })()
          const items = new PackedItemSteps(
            inner,
            unused,
            unused,
            unused,
            () => {
              events.push('closed')
              if (ownerThrows) throw ownerFailure
            },
            () => events.push('revoked'),
          )
          if (started) items.next()
          if (ownerThrows) expect(() => items.return()).toThrow(ownerFailure)
          else if (started && generatorThrows)
            expect(() => items.return()).toThrow(generatorFailure)
          else items.return()
          expect(events).toEqual(
            started ? ['revoked', 'generator', 'closed'] : ['revoked', 'closed'],
          )
          items.return()
          expect(items.next()).toEqual({ done: true, value: undefined })
          expect(events.filter((event) => event === 'closed')).toHaveLength(1)
        },
      )

  it.each([false, true])(
    'releases a failed advance when owner cleanup throws=%s',
    (ownerThrows) => {
      const bodyFailure = new Error('body failed'),
        ownerFailure = new Error('owner failed'),
        events: string[] = []
      const items = new PackedItemSteps(
        (function* (): Generator<PackedView | undefined, void, undefined> {
          try {
            yield
            throw bodyFailure
          } finally {
            events.push('generator')
          }
        })(),
        unused,
        unused,
        unused,
        () => {
          events.push('closed')
          if (ownerThrows) throw ownerFailure
        },
        () => events.push('revoked'),
      )
      items.next()
      expect(() => items.next()).toThrow(ownerThrows ? ownerFailure : bodyFailure)
      expect(events).toEqual(['generator', 'revoked', 'closed'])
      expect(items.next()).toEqual({ done: true, value: undefined })
    },
  )
})
