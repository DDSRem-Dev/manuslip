import { parseMarkdown } from '@manuslip/core'
import { afterEach, expect, it, vi } from 'vitest'
import { ReadingWorker } from '../../../../../src/renderer/src/translation/browser'
import { sharedReadingPrepared } from '../../../../../src/renderer/src/translation/prepared-wire'
import {
  type ReadingOperation,
  readingLimits,
} from '../../../../../src/renderer/src/translation/protocol'

class FakeWorker {
  static instances: FakeWorker[] = []
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() {
    FakeWorker.instances.push(this)
  }
}
const render: ReadingOperation = {
  kind: 'render',
  outputs: [],
  options: { rawHtml: false, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' },
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  FakeWorker.instances = []
})
function worker() {
  vi.stubGlobal('Worker', FakeWorker)
  return new ReadingWorker()
}
it('allows one operation and validates the matching response before releasing capacity', async () => {
  const engine = worker()
  const pending = engine.request(render)
  await expect(engine.request(render)).rejects.toThrow('translation-view-worker')
  FakeWorker.instances[0]?.onmessage?.({
    data: {
      sequence: 1,
      value: { kind: 'rendered', projection: { html: '<p>ok</p>', slots: [] } },
    },
  })
  await expect(pending).resolves.toMatchObject({ kind: 'rendered' })
  engine.dispose()
})
it('terminates a hung worker at five seconds, rejects work and requires a fresh instance', async () => {
  vi.useFakeTimers()
  const engine = worker()
  const pending = expect(engine.request(render)).rejects.toThrow('translation-view-worker')
  await vi.advanceTimersByTimeAsync(5000)
  await pending
  expect(FakeWorker.instances[0]?.terminate).toHaveBeenCalledOnce()
  await expect(engine.request(render)).rejects.toThrow('translation-view-worker')
})
it.each(['error', 'messageerror', 'mismatched', 'oversized', 'dispose'])(
  'rejects %s and releases the worker',
  async (failure) => {
    const engine = worker()
    const pending = expect(engine.request(render)).rejects.toThrow('translation-view-worker')
    const native = FakeWorker.instances[0]
    if (failure === 'error') native?.onerror?.()
    if (failure === 'messageerror') native?.onmessageerror?.()
    if (failure === 'mismatched') native?.onmessage?.({ data: { sequence: 2 } })
    if (failure === 'oversized')
      native?.onmessage?.({ data: { sequence: 1, junk: 'x'.repeat(8 * 1024 * 1024) } })
    if (failure === 'dispose') engine.dispose()
    await pending
    expect(native?.terminate).toHaveBeenCalledOnce()
  },
)
it('rejects oversized messages before posting', async () => {
  const engine = worker()
  const source = 'x'.repeat(8 * 1024 * 1024)
  await expect(
    engine.request({
      kind: 'prepare',
      root: parseMarkdown('small').root,
      source,
      settings: {} as never,
    }),
  ).rejects.toThrow('translation-view-limit')
  expect(FakeWorker.instances[0]?.postMessage).not.toHaveBeenCalled()
  engine.dispose()
})
it('uses a transfer list for packed roots, detaches the sender and measures actual buffer bytes', async () => {
  const engine = worker()
  const payload = new ArrayBuffer(32)
  const op: ReadingOperation = {
    kind: 'prepare-packed',
    payload,
    identity: {} as never,
    source: 'root',
    settings: {} as never,
  }
  const native = FakeWorker.instances[0]
  let received: unknown
  native?.postMessage.mockImplementation((message, transfer) => {
    expect(transfer).toEqual([payload])
    received = structuredClone(message, { transfer })
  })
  const pending = engine.request(op)
  expect(payload.byteLength).toBe(0)
  expect(received).toMatchObject({
    sequence: 1,
    operation: { kind: 'prepare-packed', payload: new ArrayBuffer(32) },
  })
  native?.onmessage?.({
    data: { sequence: 1, value: { kind: 'prepared-shared', units: [], payloads: [], blocks: [] } },
  })
  await expect(pending).resolves.toMatchObject({ kind: 'prepared' })
  await expect(
    engine.request({ ...op, payload: new ArrayBuffer(readingLimits.message) }),
  ).rejects.toThrow('translation-view-limit')
  await expect(engine.request(op)).rejects.toThrow('translation-view-limit')
  expect(native?.postMessage).toHaveBeenCalledOnce()
  engine.dispose()
})
it('rejects an invalid payload table and terminates the worker while its request is still pending', async () => {
  const engine = worker(),
    pending = expect(engine.request(render)).rejects.toThrow('translation-view-worker')
  const value = sharedReadingPrepared({ kind: 'prepared', units: [], blocks: [] }).value
  value.payloads.push({} as never)
  FakeWorker.instances[0]?.onmessage?.({ data: { sequence: 1, value } })
  await pending
  expect(FakeWorker.instances[0]?.terminate).toHaveBeenCalledOnce()
  await expect(engine.request(render)).rejects.toThrow('translation-view-worker')
})
it('releases a pending packed request when transfer fails', async () => {
  const engine = worker()
  FakeWorker.instances[0]?.postMessage.mockImplementation(() => {
    throw new Error('clone failed')
  })
  await expect(
    engine.request({
      kind: 'prepare-packed',
      payload: new ArrayBuffer(32),
      identity: {} as never,
      source: '',
      settings: {} as never,
    }),
  ).rejects.toThrow('translation-view-worker')
  expect(FakeWorker.instances[0]?.terminate).toHaveBeenCalledOnce()
})
