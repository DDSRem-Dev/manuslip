import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  worker: null as
    | (EventEmitter & {
        postMessage: ReturnType<typeof vi.fn>
        terminate: ReturnType<typeof vi.fn>
      })
    | null,
}))
vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    postMessage = vi.fn()
    terminate = vi.fn(async () => 0)
    constructor() {
      super()
      state.worker = this
    }
  },
}))

import { ExportWorker } from '../../../../src/main/exports/worker'

afterEach(() => vi.useRealTimers())
it('terminates a hung worker at its deadline and refuses future work', async () => {
  vi.useFakeTimers()
  const worker = new ExportWorker()
  const pending = worker.request({ kind: 'parse' }, 5000)
  const rejected = expect(pending).rejects.toMatchObject({ code: 'export-timeout' })
  await expect(worker.request({}, 5)).rejects.toMatchObject({ code: 'export-busy' })
  await vi.advanceTimersByTimeAsync(5000)
  await rejected
  expect(state.worker?.terminate).toHaveBeenCalledTimes(1)
  expect(state.worker?.listenerCount('message')).toBe(0)
  await expect(worker.request({}, 5)).rejects.toMatchObject({ code: 'export-render' })
})
it('handles startup and idle crashes without an unhandled worker error', async () => {
  const worker = new ExportWorker()
  state.worker?.emit('error', new Error('startup failure'))
  await expect(worker.request({}, 5)).rejects.toMatchObject({ code: 'export-render' })
  worker.dispose()
  expect(state.worker?.terminate).toHaveBeenCalledTimes(1)
})
it('keeps page/size failures distinct and disposes active work once', async () => {
  const worker = new ExportWorker()
  for (const code of ['export-pages', 'export-limit']) {
    const pending = worker.request({}, 100)
    state.worker?.emit('message', { ok: false, code })
    await expect(pending).rejects.toMatchObject({ code })
  }
  const pending = worker.request({}, 100)
  worker.dispose()
  worker.dispose()
  await expect(pending).rejects.toMatchObject({ code: 'export-cancelled' })
  expect(state.worker?.terminate).toHaveBeenCalledTimes(1)
})
