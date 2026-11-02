import { afterEach, expect, it, vi } from 'vitest'
import type { DocumentsController } from '../../../../src/renderer/src/documents'
import { SearchController } from '../../../../src/renderer/src/search'
import type { Result } from '../../../../src/shared/contracts'
import type { SearchBridge, SearchEntry, SearchPage } from '../../../../src/shared/search-contracts'

function deferred<T>() {
  let resolve!: (result: T) => void
  return {
    promise: new Promise<T>((done) => {
      resolve = done
    }),
    resolve: (value: T) => resolve(value),
  }
}
const entry: SearchEntry = { id: crypto.randomUUID(), path: 'notes.md', line: 1, excerpt: 'needle' }
function page(id: string, state: SearchPage['state'] = 'done'): Result<SearchPage> {
  return {
    ok: true,
    value: {
      id,
      state,
      entries: [entry],
      cursor: 1,
      total: 1,
      error: null,
      skipped: 0,
      truncated: false,
    },
  }
}
function setup() {
  vi.useFakeTimers()
  const bridge: SearchBridge = {
    startSearch: vi.fn(async () => ({ ok: true as const, value: null })),
    pollSearch: vi.fn(async (id) => page(id)),
    cancelSearch: vi.fn(async () => ({ ok: true as const, value: null })),
    openSearchResult: vi.fn(async () => ({
      ok: false as const,
      code: 'search-session',
      error: 'Revoked',
    })),
  }
  const documents: Pick<DocumentsController, 'openFile' | 'active'> = {
    active: null,
    openFile: vi.fn(async (load) => {
      await load()
      return false
    }),
  }
  const controller = new SearchController(bridge, documents)
  controller.setRoot(crypto.randomUUID())
  return { bridge, controller }
}
afterEach(() => vi.useRealTimers())

it('debounces typing, rejects late poll results and cancels only the obsolete request', async () => {
  const { bridge, controller } = setup()
  const old = deferred<Result<SearchPage>>()
  vi.mocked(bridge.pollSearch).mockImplementationOnce(() => old.promise)
  controller.query('n')
  await vi.advanceTimersByTimeAsync(100)
  controller.query('needle')
  await vi.advanceTimersByTimeAsync(199)
  expect(bridge.startSearch).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  const first = vi.mocked(bridge.startSearch).mock.calls[0]?.[0]
  if (!first) throw new Error('No first request')
  controller.query('latest')
  await vi.advanceTimersByTimeAsync(200)
  const latest = vi.mocked(bridge.startSearch).mock.calls[1]?.[0]
  if (!latest) throw new Error('No latest request')
  old.resolve({ ...page(first.id) })
  await vi.advanceTimersByTimeAsync(0)
  expect(controller.store.getState()).toMatchObject({
    query: 'latest',
    state: 'done',
    entries: [entry],
  })
  expect(bridge.cancelSearch).toHaveBeenCalledWith(first.id)
  expect(bridge.cancelSearch).not.toHaveBeenCalledWith(latest.id)
  controller.setRoot(null)
  expect(controller.store.getState().entries).toEqual([])
  expect(bridge.cancelSearch).toHaveBeenCalledWith(latest.id)
})

it('keeps streamed results openable after Stop and drops late batches', async () => {
  const { bridge, controller } = setup()
  vi.mocked(bridge.pollSearch).mockImplementation(async (id) => page(id, 'running'))
  controller.query('needle')
  await vi.advanceTimersByTimeAsync(200)
  expect(controller.store.getState().entries).toEqual([entry])
  controller.cancel()
  expect(controller.store.getState().state).toBe('cancelled')
  await controller.open(entry)
  expect(bridge.openSearchResult).toHaveBeenCalledWith(expect.any(String), entry.id)
  await vi.advanceTimersByTimeAsync(1000)
  expect(bridge.pollSearch).toHaveBeenCalledOnce()
  controller.setRoot(null)
})

it('does not poll a start response superseded by a new query', async () => {
  const { bridge, controller } = setup()
  const first = deferred<Result<null>>()
  vi.mocked(bridge.startSearch).mockImplementationOnce(() => first.promise)
  controller.query('first')
  await vi.advanceTimersByTimeAsync(200)
  controller.query('second')
  await vi.advanceTimersByTimeAsync(200)
  first.resolve({ ok: true, value: null })
  await vi.advanceTimersByTimeAsync(0)
  expect(bridge.pollSearch).toHaveBeenCalledOnce()
  expect(controller.store.getState()).toMatchObject({ query: 'second', state: 'done' })
  controller.setRoot(null)
})
