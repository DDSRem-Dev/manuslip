import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { TranslationQueue } from '../../../../../src/renderer/src/translation/queue'

it('preserves all 10,000 entries in order through repeated compaction and reuse', () => {
  const queue = new TranslationQueue<{ index: number }>()
  queue.reset(Array.from({ length: 10_000 }, (_, index) => ({ index })))
  for (let index = 0; index < 10_000; index++) expect(queue.take()?.index).toBe(index)
  expect(queue.first).toBeUndefined()
  expect(queue.take()).toBeUndefined()
  queue.reset([{ index: 10_000 }])
  expect(queue.take()?.index).toBe(10_000)
  expect(queue.first).toBeUndefined()
})

it.each(['clear', 'reset'] as const)(
  '%s allows consumed and abandoned payloads to be collected while the queue stays live',
  async (operation) => {
    // Use a separate process so GC is available without changing the runner's VM flags.
    const module = new URL('../../../../../src/renderer/src/translation/queue.ts', import.meta.url)
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        '--expose-gc',
        '--input-type=module',
        '-e',
        `
          import { setImmediate } from 'node:timers/promises'
          import { TranslationQueue } from ${JSON.stringify(module.href)}
          const queue = new TranslationQueue()
          const refs = []
          queue.reset(Array.from({ length: 4096 }, (_, index) => {
            const item = { index, payload: new Uint8Array(4096) }
            refs.push(new WeakRef(item))
            return item
          }))
          // Consuming less than half leaves the original backing array in place.
          for (let index = 0; index < 1024; index++) queue.take()
          await setImmediate()
          globalThis.gc()
          const retainedAfterDrain = refs.filter(ref => ref.deref()).length
          ${operation === 'clear' ? 'queue.clear()' : 'queue.reset([{ index: 4096 }])'}
          await setImmediate()
          globalThis.gc()
          process.stdout.write(JSON.stringify({
            retainedAfterDrain,
            retainedAfterReset: refs.filter(ref => ref.deref()).length,
            next: queue.first?.index ?? null,
          }))
        `,
      ],
      { timeout: 5000 },
    )
    expect(JSON.parse(stdout)).toEqual({
      retainedAfterDrain: 3072,
      retainedAfterReset: 0,
      next: operation === 'clear' ? null : 4096,
    })
  },
)
