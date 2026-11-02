import { search, setSearchQuery } from '@codemirror/search'
import { createSourceState, SearchQuery, type TransactionSpec } from '@manuslip/editor'
import { prepareReplacements, type ReplaceInput, replaceLimits } from '@manuslip/editor/replace'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentReplace } from '../../../../src/renderer/src/replace'

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  input: ReplaceInput | null = null
  terminate = vi.fn()
  postMessage(value: unknown) {
    this.input = value as ReplaceInput
  }
  reply() {
    if (!this.input) throw new Error('Missing input')
    this.send({
      sequence: this.input.sequence,
      payload: new TextEncoder().encode(JSON.stringify(prepareReplacements(this.input))).buffer,
    })
  }
  send(value: unknown) {
    this.onmessage?.({ data: value } as MessageEvent<unknown>)
  }
}
function setup(source = 'word '.repeat(1025)) {
  let state = createSourceState(source, { extensions: [search()] })
  state = state.update({
    effects: setSearchQuery.of(new SearchQuery({ search: 'word', replace: '😀' })),
  }).state
  const tasks: (() => void)[] = []
  const workers: FakeWorker[] = []
  const status = vi.fn()
  const dispatches: TransactionSpec[] = []
  let available = true
  let clock = 0
  const controller = new DocumentReplace(
    {
      state: () => state,
      canApply: () => available,
      dispatch: (spec) => dispatch(spec),
      status,
    },
    () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
    {
      now: () => (clock += 2),
      defer: (run) => tasks.push(run),
    },
  )
  function dispatch(spec: TransactionSpec) {
    const transaction = state.update(spec)
    state = transaction.state
    dispatches.push(spec)
    controller.changed([transaction])
  }
  const drain = () => {
    while (tasks.length) tasks.shift()?.()
  }
  const start = () => {
    controller.start()
    drain()
    return workers.at(-1) as FakeWorker
  }
  return {
    controller,
    start,
    drain,
    tasks,
    workers,
    status,
    dispatch,
    dispatches,
    state: () => state,
    unavailable: () => {
      available = false
    },
  }
}
afterEach(() => vi.useRealTimers())

describe('atomic cancellable replacement', () => {
  it('combines many staged ranges exactly, mapping the latest selection and changing the document once', () => {
    const context = setup()
    const worker = context.start()
    context.dispatch({ selection: { anchor: 10, head: 14 } })
    worker.reply()
    context.tasks.shift()?.()
    expect(context.state().doc.toString()).toBe('word '.repeat(1025))
    context.drain()
    expect(context.state().doc.toString()).toBe('😀 '.repeat(1025))
    expect(context.dispatches.filter((spec) => spec.changes)).toHaveLength(1)
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(context.controller.cancel()).toBe(false)
  })
  it('serializes an empty document and trailing empty lines losslessly', () => {
    for (const source of ['', 'word\n\n']) {
      const context = setup(source)
      const worker = context.start()
      expect(worker.input?.lines.join('\n')).toBe(source)
      worker.reply()
      context.drain()
      expect(context.state().doc.toString()).toBe(source.replaceAll('word', '😀'))
    }
  })
  it('cancels before worker creation and releases queued source preparation', () => {
    const context = setup()
    context.controller.start()
    expect(context.controller.cancel()).toBe(true)
    context.drain()
    expect(context.workers).toHaveLength(0)
    expect(context.dispatches).toHaveLength(0)
  })
  it('cancels partial result preparation without exposing any replacement', () => {
    const context = setup()
    context.start().reply()
    context.tasks.shift()?.()
    context.controller.cancel()
    context.drain()
    expect(context.state().doc.toString()).toBe('word '.repeat(1025))
    expect(context.dispatches).toHaveLength(0)
  })
  it('terminates obsolete work on edit or query changes and ignores late results', () => {
    for (const change of [
      { changes: { from: 0, insert: 'kept ' } },
      { effects: setSearchQuery.of(new SearchQuery({ search: 'different' })) },
    ]) {
      const context = setup()
      const worker = context.start()
      context.dispatch(change)
      const current = context.state().doc
      worker.reply()
      context.drain()
      expect(context.state().doc).toBe(current)
      expect(worker.terminate).toHaveBeenCalledOnce()
    }
  })
  it('discards a completed worker result when the document is unavailable', () => {
    const context = setup()
    const worker = context.start()
    context.unavailable()
    worker.reply()
    context.drain()
    expect(context.dispatches).toHaveLength(0)
    expect(context.status).toHaveBeenLastCalledWith(false)
  })
  it('applies the external deadline to worker execution and allows explicit retry', () => {
    vi.useFakeTimers()
    const context = setup()
    const worker = context.start()
    vi.advanceTimersByTime(replaceLimits.watchdog)
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(context.status).toHaveBeenLastCalledWith(false, 'replace-timeout')
    context.start().reply()
    context.drain()
    expect(context.state().doc.toString()).toBe('😀 '.repeat(1025))
  })
  it('keeps the deadline active during renderer preparation', () => {
    vi.useFakeTimers()
    const context = setup()
    context.start().reply()
    vi.advanceTimersByTime(replaceLimits.watchdog)
    context.drain()
    expect(context.dispatches).toHaveLength(0)
    expect(context.status).toHaveBeenLastCalledWith(false, 'replace-timeout')
  })
  it.each([
    { sequence: 999, payload: new ArrayBuffer(0) },
    { sequence: 1, payload: new ArrayBuffer(replaceLimits.message + 1) },
    { sequence: 1, payload: new Uint8Array([255]).buffer },
    { sequence: 1, error: 'untrusted-message' },
  ])('rejects stale/malformed/over-cap worker replies atomically', (value) => {
    const context = setup()
    context.start().send(value)
    context.drain()
    expect(context.dispatches).toHaveLength(0)
    expect(context.status).toHaveBeenLastCalledWith(false, 'replace-failed')
  })
  it('rejects an invalid final range after earlier ranges were privately prepared', () => {
    const context = setup()
    const changes = Array.from({ length: 129 }, (_, index) => [index * 5, index * 5 + 4, 'new'])
    changes.push([-1, 0, 'bad'])
    context.start().send({
      sequence: 1,
      payload: new TextEncoder().encode(JSON.stringify({ changes, matches: changes.length }))
        .buffer,
    })
    context.drain()
    expect(context.dispatches).toHaveLength(0)
    expect(context.status).toHaveBeenLastCalledWith(false, 'replace-failed')
  })
})
