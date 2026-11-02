import { afterEach, describe, expect, it, vi } from 'vitest'
import { TranslationCacheWorker } from '../../../../src/main/translation/cache'

const state = vi.hoisted(() => ({ workers: [] as any[] }))
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    Worker: class extends EventEmitter {
      postMessage = vi.fn()
      terminate = vi.fn(async () => 0)
      constructor() {
        super()
        state.workers.push(this)
      }
    },
  }
})
afterEach(() => {
  vi.useRealTimers()
  state.workers.length = 0
})
describe('bounded SQLite worker transport', () => {
  it('starts lazily, bounds pending reads and accounts completion before accepting more work', async () => {
    const changed = vi.fn(),
      cache = new TranslationCacheWorker('private-cache.sqlite', changed)
    expect(state.workers).toHaveLength(0)
    const reads = Array.from({ length: 32 }, () =>
      cache.request({ kind: 'get', key: 'a'.repeat(64), payload: '{}' }),
    )
    const worker = state.workers[0]
    expect(worker.postMessage).toHaveBeenCalledTimes(32)
    expect(
      (await cache.request({ kind: 'get', key: 'b'.repeat(64), payload: '{}' })).output,
    ).toBeNull()
    expect(worker.postMessage).toHaveBeenCalledTimes(32)
    for (let id = 1; id <= 32; id++)
      worker.emit('message', { id, reply: { status: 'ready', output: null } })
    await Promise.all(reads)
    expect(cache.status).toBe('ready')
    expect(changed).toHaveBeenCalledTimes(1)
    const next = cache.request({ kind: 'clear' })
    worker.emit('message', { id: 33, reply: { status: 'ready', output: null } })
    await next
    cache.dispose()
  })
  it('terminates a stalled worker, resolves every waiter and never restarts in the same session', async () => {
    vi.useFakeTimers()
    const cache = new TranslationCacheWorker('cache.sqlite', vi.fn())
    const reads = Array.from({ length: 3 }, () => cache.request({ kind: 'clear' }))
    await vi.advanceTimersByTimeAsync(5001)
    expect((await Promise.all(reads)).every((reply) => reply.status === 'unavailable')).toBe(true)
    expect(state.workers[0].terminate).toHaveBeenCalledTimes(1)
    expect((await cache.request({ kind: 'clear' })).status).toBe('unavailable')
    expect(state.workers).toHaveLength(1)
  })
  it('fails closed when a clear cannot be enqueued instead of retaining old readable cache data', async () => {
    const cache = new TranslationCacheWorker('cache.sqlite', vi.fn())
    const reads = Array.from({ length: 32 }, () =>
      cache.request({ kind: 'get', key: 'a'.repeat(64), payload: '{}' }),
    )
    expect((await cache.request({ kind: 'clear' })).status).toBe('unavailable')
    expect((await Promise.all(reads)).every((reply) => reply.status === 'unavailable')).toBe(true)
    expect(state.workers[0].terminate).toHaveBeenCalledTimes(1)
  })
  it('bounds queued bytes and handles worker crash/invalid replies without blocking source editing', async () => {
    const cache = new TranslationCacheWorker('cache.sqlite', vi.fn())
    const large = cache.request({
      kind: 'put',
      key: 'a'.repeat(64),
      payload: 'x'.repeat(8 * 1024 * 1024 + 1),
      output: 'text',
    })
    expect((await large).output).toBeNull()
    expect(state.workers[0].postMessage).not.toHaveBeenCalled()
    const pending = cache.request({ kind: 'clear' })
    state.workers[0].emit('message', { id: 1, reply: { status: 'invalid' } })
    expect((await pending).status).toBe('unavailable')
  })
})
