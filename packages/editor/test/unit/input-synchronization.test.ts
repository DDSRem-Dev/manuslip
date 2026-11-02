import type { EditorView } from '@codemirror/view'
import { expect, it, vi } from 'vitest'
import { SourceInputSynchronization } from '../../src/input-synchronization'

type MeasureRequest = NonNullable<Parameters<EditorView['requestMeasure']>[0]>

function fixture() {
  const requests: MeasureRequest[] = []
  const view = {
    contentDOM: new EventTarget(),
    compositionStarted: false,
    requestMeasure: vi.fn((request: MeasureRequest) => requests.push(request)),
  }
  const input = new SourceInputSynchronization(view as unknown as EditorView)
  const measure = () => {
    const request = requests.shift()
    if (!request) throw new Error('Missing measurement')
    const value = request.read(view as unknown as EditorView)
    request.write?.(value, view as unknown as EditorView)
  }
  const start = () => {
    view.compositionStarted = true
  }
  const end = () => {
    view.compositionStarted = false
    view.contentDOM.dispatchEvent(new Event('compositionend'))
  }
  return { input, view, measure, start, end }
}

it('coalesces simultaneous snapshot waits and completes only at the editor measurement boundary', async () => {
  const { input, view, measure } = fixture()
  const first = input.flush()
  expect(input.flush()).toBe(first)
  const captured = vi.fn()
  void first.then(captured)
  await Promise.resolve()
  expect(captured).not.toHaveBeenCalled()
  expect(view.requestMeasure).toHaveBeenCalledOnce()
  measure()
  await first
  expect(captured).toHaveBeenCalledOnce()
  const later = input.flush()
  expect(later).not.toBe(first)
  measure()
  await later
  input.close()
})

it('keeps a snapshot pending through composition and consumes final input at a later measurement', async () => {
  const { input, view, measure, start, end } = fixture()
  start()
  const first = input.flush()
  const captured = vi.fn()
  void first.then(captured)
  expect(input.flush()).toBe(first)
  expect(view.requestMeasure).not.toHaveBeenCalled()
  await Promise.resolve()
  expect(captured).not.toHaveBeenCalled()
  end()
  expect(view.requestMeasure).toHaveBeenCalledOnce()
  await Promise.resolve()
  expect(captured).not.toHaveBeenCalled()
  measure()
  await first
  expect(captured).toHaveBeenCalledOnce()
  input.close()
})

it('defers a requested snapshot if composition starts before its measurement completes', async () => {
  const { input, view, measure, start, end } = fixture()
  const pending = input.flush()
  const captured = vi.fn()
  void pending.then(captured)
  start()
  measure()
  await Promise.resolve()
  expect(captured).not.toHaveBeenCalled()
  expect(input.flush()).toBe(pending)
  end()
  expect(view.requestMeasure).toHaveBeenCalledTimes(2)
  measure()
  await pending
  expect(captured).toHaveBeenCalledOnce()
  input.close()
})

it('waits for a second composition that begins before the first final-input measurement', async () => {
  const { input, measure, start, end } = fixture()
  start()
  const pending = input.flush()
  const captured = vi.fn()
  void pending.then(captured)
  end()
  start()
  measure()
  await Promise.resolve()
  expect(captured).not.toHaveBeenCalled()
  end()
  measure()
  await pending
  expect(captured).toHaveBeenCalledOnce()
  input.close()
})

it('settles a composition wait on disposal and removes the listener before late native events', async () => {
  const { input, view, start, end } = fixture()
  start()
  const pending = input.flush()
  input.close()
  await pending
  end()
  expect(view.requestMeasure).not.toHaveBeenCalled()
  await input.flush()
  input.close()
})

it('also waits for composition delivered by a native EditContext', async () => {
  const requests: MeasureRequest[] = []
  const contentDOM = Object.assign(new EventTarget(), { editContext: new EventTarget() })
  const view = {
    contentDOM,
    compositionStarted: true,
    requestMeasure: vi.fn((request: MeasureRequest) => requests.push(request)),
  }
  const input = new SourceInputSynchronization(view as unknown as EditorView)
  const pending = input.flush()
  expect(view.requestMeasure).not.toHaveBeenCalled()
  view.compositionStarted = false
  contentDOM.editContext.dispatchEvent(new Event('compositionend'))
  expect(requests).toHaveLength(1)
  requests[0]?.write?.(undefined, view as unknown as EditorView)
  await pending
  input.close()
  contentDOM.editContext.dispatchEvent(new Event('compositionend'))
  expect(view.requestMeasure).toHaveBeenCalledOnce()
})

it('settles pending saves when a view unmounts and ignores its late scheduled callbacks', async () => {
  const { input, view, measure } = fixture()
  const pending = input.flush()
  input.close()
  await pending
  measure()
  await input.flush()
  expect(view.requestMeasure).toHaveBeenCalledOnce()
  input.close()
})
