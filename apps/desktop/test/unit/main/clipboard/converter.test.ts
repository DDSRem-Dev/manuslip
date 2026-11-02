import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const workers = vi.hoisted(() => ({ instances: [] as EventEmitter[] }))
vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    constructor() {
      super()
      workers.instances.push(this)
    }
    postMessage = vi.fn()
    terminate = vi.fn(async () => {
      this.emit('exit', 0)
      return 0
    })
  },
}))

import { ClipboardConverter } from '../../../../src/main/clipboard/converter'

afterEach(() => {
  workers.instances.length = 0
  vi.useRealTimers()
})
describe('clipboard conversion worker lifecycle', () => {
  it('allows one active conversion and starts a fresh worker after success', async () => {
    const converter = new ClipboardConverter()
    const result = converter.convert(1, 'doc', '<b>one</b>')
    await expect(converter.convert(1, 'other', '<b>two</b>')).rejects.toMatchObject({
      code: 'paste-busy',
    })
    workers.instances[0]?.emit('message', { ok: true, value: '**one**' })
    await expect(result).resolves.toBe('**one**')
    const retry = converter.convert(1, 'doc', 'next')
    workers.instances[1]?.emit('message', { ok: true, value: 'next' })
    await expect(retry).resolves.toBe('next')
  })
  it('terminates a hung worker at the deadline and permits retry', async () => {
    vi.useFakeTimers()
    const converter = new ClipboardConverter()
    const result = expect(converter.convert(1, 'doc', 'slow')).rejects.toMatchObject({
      code: 'paste-failed',
    })
    await vi.advanceTimersByTimeAsync(5000)
    await result
    const retry = converter.convert(1, 'doc', 'retry')
    workers.instances[1]?.emit('message', { ok: true, value: 'retry' })
    await expect(retry).resolves.toBe('retry')
  })
  it('revokes only the owning document or window and rejects late malformed output', async () => {
    const converter = new ClipboardConverter()
    const result = expect(converter.convert(1, 'doc', 'pending')).rejects.toMatchObject({
      code: 'paste-failed',
    })
    converter.closeDocument(1, 'another')
    converter.closeOwner(2)
    expect(workers.instances[0]?.listenerCount('message')).toBe(1)
    converter.closeDocument(1, 'doc')
    await result
    const malformed = converter.convert(1, 'doc', 'retry')
    workers.instances[1]?.emit('message', { ok: true, value: 42 })
    await expect(malformed).rejects.toMatchObject({ code: 'paste-failed' })
  })
  it('rejects UTF-8 input before creating a worker', async () => {
    await expect(
      new ClipboardConverter().convert(1, 'doc', '界'.repeat(400_000)),
    ).rejects.toMatchObject({ code: 'paste-large' })
    expect(workers.instances).toHaveLength(0)
  })
})
