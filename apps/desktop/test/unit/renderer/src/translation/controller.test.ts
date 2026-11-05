import { parseDocumentMarkdown, parseMarkdown, semanticLimits } from '@manuslip/core'
import { defaultMarkdownPlugins, type MarkdownPlugins } from '@manuslip/core/conventions'
import { createSourceState } from '@manuslip/editor'
import type { TranslationSettings } from '@manuslip/translate'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentReading } from '../../../../../src/renderer/src/translation/controller'
import { ReadingProcessor } from '../../../../../src/renderer/src/translation/engine'
import type { ReadingCapture } from '../../../../../src/renderer/src/translation/prepare'
import {
  type ReadingEngine,
  type ReadingOperation,
  readingLimits,
} from '../../../../../src/renderer/src/translation/protocol'
import type { Result } from '../../../../../src/shared/contracts'
import type {
  TranslationBridge,
  TranslationOutcome,
  TranslationRequest,
  TranslationState,
} from '../../../../../src/shared/translation-contracts'

const settings: TranslationSettings = {
  provider: {
    adapter: 'ollama',
    version: '1',
    baseUrl: 'http://localhost:11434/api/chat',
    model: 'fake',
    profile: null,
    options: {},
  },
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  glossary: [],
  formality: 'default',
  promptVersion: 'prose-translation/v1',
}
const options = { rawHtml: false, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
const controllers: DocumentReading[] = []
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
  vi.useRealTimers()
})
function setup(
  source = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.',
  initialPlugins?: MarkdownPlugins,
) {
  vi.useFakeTimers()
  let plugins = initialPlugins
  let state = createSourceState(source)
  let revision = 0
  let composing = false
  let metadata: TranslationState = {
    settings,
    settingsRevision: 1,
    cacheGeneration: 0,
    cache: 'ready',
    configuration: 'ready',
    credential: 'none',
  }
  const calls: { request: TranslationRequest; resolve(value: Result<TranslationOutcome>): void }[] =
    []
  const cancelled: string[] = []
  let changed = () => {}
  const bridge: TranslationBridge = {
    translationState: vi.fn(
      async (): Promise<Result<TranslationState>> => ({ ok: true, value: metadata }),
    ),
    configureTranslation: async (settings) => {
      metadata = { ...metadata, settings, settingsRevision: metadata.settingsRevision + 1 }
      return { ok: true, value: metadata }
    },
    setTranslationCredential: async () => ({ ok: true, value: metadata }),
    clearTranslationCache: async () => ({ ok: true, value: metadata }),
    onTranslationChanged: (listener) => {
      changed = listener
      return () => {
        changed = () => {}
      }
    },
    translateUnit: (request) => new Promise((resolve) => calls.push({ request, resolve })),
    cancelTranslation: async (id) => {
      cancelled.push(id)
      return { ok: true, value: null }
    },
  }
  const engines: ReadingEngine[] = []
  const reading = new DocumentReading(
    {
      id: crypto.randomUUID(),
      state: () => state,
      revision: () => revision,
      composing: () => composing,
      capture: async () => {
        const document = plugins
          ? parseDocumentMarkdown(state.doc.toString(), plugins)
          : parseMarkdown(state.doc.toString())
        return {
          kind: 'native',
          root: document.root,
          retainedBytes: 200,
          ...(plugins ? { plugins: { ...plugins } } : {}),
        } satisfies ReadingCapture
      },
      options: () => ({ ...options, ...(plugins ? { plugins } : {}) }),
    },
    bridge,
    () => {
      const processor = new ReadingProcessor()
      const engine: ReadingEngine = {
        request: (operation) => processor.execute(operation),
        dispose: vi.fn(() => processor.clear()),
      }
      engines.push(engine)
      return engine
    },
  )
  controllers.push(reading)
  reading.attach()
  return {
    reading,
    calls,
    cancelled,
    bridge,
    engines,
    state: () => state,
    setPlugins(value: MarkdownPlugins) {
      plugins = value
    },
    edit(from: number, to: number, insert: string) {
      const transaction = state.update({ changes: { from, to, insert } })
      state = transaction.state
      revision++
      reading.changed([transaction])
    },
    compose(value: boolean) {
      composing = value
    },
    update(patch: Partial<TranslationState>) {
      metadata = { ...metadata, ...patch }
      changed()
    },
    finish(index: number, output?: string | null, cached = false) {
      const call = calls[index]
      if (!call) throw new Error('Missing request')
      const { payload: _payload, network: _network, ...context } = call.request
      call.resolve({
        ok: true,
        value: {
          ...context,
          output:
            output === undefined
              ? call.request.payload.text.replaceAll('paragraph', '段落')
              : output,
          cached,
          cache: 'ready',
        },
      })
    },
    fail(index: number, code = 'translation-network') {
      calls[index]?.resolve({ ok: false, code, error: 'Failure' })
    },
  }
}
it('defaults the preview to Simplified Chinese before a provider is configured and respects saved targets', async () => {
  const f = setup()
  expect(f.reading.store.getState().target).toBe('zh-CN')
  f.update({ settings: null })
  await vi.advanceTimersByTimeAsync(1)
  expect(f.reading.store.getState().target).toBe('zh-CN')
  f.update({ settings: { ...settings, targetLanguage: 'ja' } })
  await vi.advanceTimersByTimeAsync(1)
  expect(f.reading.store.getState().target).toBe('ja')
  expect(f.calls).toHaveLength(0)
})
it('buffers out-of-order responses while continuing concurrent requests and renders a settled prefix', async () => {
  const f = setup('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n\nFourth paragraph.')
  await f.reading.start(true)
  expect(f.calls).toHaveLength(2)
  f.finish(1, '第二段。')
  await vi.advanceTimersByTimeAsync(600)
  expect(f.calls).toHaveLength(3)
  expect(f.reading.store.getState().projection?.html).not.toContain('第二段。')
  expect(f.reading.captureExport().reading.units).toEqual([])
  f.finish(2, '第三段。')
  await vi.advanceTimersByTimeAsync(600)
  expect(f.calls).toHaveLength(4)
  expect(f.reading.store.getState().projection?.html).not.toContain('第三段。')
  f.finish(0, '第一段。')
  await vi.advanceTimersByTimeAsync(600)
  const html = f.reading.store.getState().projection?.html ?? ''
  expect(html).toContain('第一段。')
  expect(html.indexOf('第一段。')).toBeLessThan(html.indexOf('第二段。'))
  expect(html.indexOf('第二段。')).toBeLessThan(html.indexOf('第三段。'))
  expect(html).toContain('Fourth paragraph.')
  expect(f.reading.captureExport().reading.units).toEqual([
    { index: 0, output: '第一段。' },
    { index: 1, output: '第二段。' },
    { index: 2, output: '第三段。' },
  ])
  f.finish(3, '第四段。')
  await vi.advanceTimersByTimeAsync(600)
  expect(f.reading.store.getState()).toMatchObject({ phase: 'ready', completed: 4, failed: 0 })
  expect(f.reading.store.getState().projection?.html).toContain('第四段。')
})
it('avoids allocating worker projections for blocked results but still rerenders layout and explicit refreshes', async () => {
  const f = setup('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n\nFourth paragraph.')
  await f.reading.start(true)
  const engine = f.engines[0]
  if (!engine) throw new Error('No worker')
  const render = vi.spyOn(engine, 'request')
  const original = f.reading.store.getState().projection
  f.finish(1)
  await vi.advanceTimersByTimeAsync(600)
  f.finish(2)
  await vi.advanceTimersByTimeAsync(600)
  expect(f.calls).toHaveLength(4)
  expect(render).not.toHaveBeenCalled()
  expect(f.reading.store.getState().projection).toBe(original)
  f.finish(0)
  await vi.advanceTimersByTimeAsync(600)
  expect(render).toHaveBeenCalledOnce()
  expect(f.reading.captureExport().reading.units).toHaveLength(3)
  f.reading.setLayout('interlinear')
  await vi.advanceTimersByTimeAsync(600)
  expect(render).toHaveBeenCalledTimes(2)
  expect(f.reading.store.getState().projection?.layout).toBe('interlinear')
  f.reading.refreshRendering()
  await vi.advanceTimersByTimeAsync(600)
  expect(render).toHaveBeenCalledTimes(3)
  expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'render', outputs: [] }))
  f.finish(3)
  await vi.advanceTimersByTimeAsync(600)
  expect(f.reading.store.getState()).toMatchObject({ phase: 'ready', completed: 4 })
  await f.reading.start(true)
  await vi.advanceTimersByTimeAsync(600)
  expect(f.calls).toHaveLength(4)
  expect(render).toHaveBeenCalledTimes(4)
  expect(f.reading.captureExport().reading.units).toHaveLength(4)
})
it.each(['failure', 'invalid', 'miss'] as const)(
  'a preceding %s releases buffered translations and keeps source fallback',
  async (outcome) => {
    const f = setup()
    await f.reading.start(true)
    f.finish(1, '第二段。')
    await vi.advanceTimersByTimeAsync(600)
    expect(f.reading.store.getState().projection?.html).not.toContain('第二段。')
    if (outcome === 'failure') f.fail(0)
    else f.finish(0, outcome === 'invalid' ? '' : null)
    await vi.advanceTimersByTimeAsync(600)
    expect(f.reading.store.getState().projection?.html).toContain('First paragraph.')
    expect(f.reading.store.getState().projection?.html).toContain('第二段。')
    f.finish(2, '第三段。')
    await vi.advanceTimersByTimeAsync(600)
    expect(f.reading.store.getState()).toMatchObject({
      phase: 'ready',
      completed: 2,
      failed: outcome === 'miss' ? 0 : 1,
    })
    if (outcome !== 'miss') {
      await f.reading.start(true, true)
      expect(f.calls).toHaveLength(4)
      expect(f.calls[3]?.request.payload.text).toBe('First paragraph.')
      f.finish(3, '第一段。')
      await vi.advanceTimersByTimeAsync(600)
      expect(f.reading.store.getState()).toMatchObject({ phase: 'ready', completed: 3, failed: 0 })
    }
  },
)
it('cancellation publishes completed buffered responses and ignores late replies', async () => {
  const f = setup()
  await f.reading.start(true)
  f.finish(1, '第二段。')
  await vi.advanceTimersByTimeAsync(600)
  expect(f.reading.store.getState().projection?.html).not.toContain('第二段。')
  f.reading.cancel()
  f.finish(0, 'LATE')
  f.finish(2, 'LATE')
  await vi.advanceTimersByTimeAsync(600)
  expect(f.reading.store.getState()).toMatchObject({ phase: 'cancelled', completed: 1 })
  expect(f.reading.store.getState().projection?.html).toContain('First paragraph.')
  expect(f.reading.store.getState().projection?.html).toContain('第二段。')
  expect(f.reading.store.getState().projection?.html).not.toContain('LATE')
  expect(f.reading.captureExport().reading.units).toEqual([{ index: 1, output: '第二段。' }])
})
it('a refreshed source retains buffered results behind the new preceding request', async () => {
  const f = setup('First paragraph.\n\nSecond paragraph.')
  await f.reading.start(true)
  f.finish(1, '第二段。')
  await vi.advanceTimersByTimeAsync(600)
  f.edit(0, 5, 'Changed')
  await f.reading.start(true)
  expect(f.calls).toHaveLength(3)
  expect(f.cancelled).toEqual([f.calls[0]?.request.requestId])
  expect(f.reading.store.getState().projection?.html).not.toContain('第二段。')
  f.finish(0, 'OBSOLETE')
  f.finish(2, '已更新的第一段。')
  await vi.advanceTimersByTimeAsync(600)
  expect(f.reading.store.getState()).toMatchObject({ phase: 'ready', completed: 2 })
  expect(f.reading.store.getState().projection?.html).toContain('已更新的第一段。')
  expect(f.reading.store.getState().projection?.html).toContain('第二段。')
  expect(f.reading.store.getState().projection?.html).not.toContain('OBSOLETE')
})
it('releases a rejected mounted copy and permits an explicit retry with the original source', async () => {
  const fixture = setup()
  await fixture.reading.start(true)
  await vi.advanceTimersByTimeAsync(1)
  expect(fixture.calls).toHaveLength(2)
  const source = fixture.state().doc.toString()
  fixture.reading.mountFailed()
  expect(fixture.reading.store.getState()).toMatchObject({
    phase: 'error',
    error: 'translation-view-limit',
    projection: null,
    total: 0,
  })
  expect(fixture.cancelled).toHaveLength(2)
  expect(fixture.engines[0]?.dispose).toHaveBeenCalledOnce()
  expect(fixture.state().doc.toString()).toBe(source)
  await fixture.reading.start(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(fixture.engines).toHaveLength(2)
})
it('keeps captured conventions for layout and export, then explicitly refreshes with new settings', async () => {
  const source = '==First paragraph.==\n\n```mermaid\nflowchart LR\nA-->B\n```'
  const initial = { ...defaultMarkdownPlugins }
  const f = setup(source, initial)
  await f.reading.start(true)
  f.finish(0)
  await vi.advanceTimersByTimeAsync(600)
  const capture = f.reading.captureExport()
  expect(capture.plugins).toEqual(initial)
  expect(f.reading.store.getState().projection?.html).toContain('<mark')
  const next = { ...initial, opt: false, mermaid: false }
  f.setPlugins(next)
  f.reading.conventionsChanged()
  expect(f.reading.store.getState().stale).toBe(true)
  f.reading.setLayout('interlinear')
  await vi.advanceTimersByTimeAsync(600)
  expect(f.reading.store.getState().projection?.html).toContain('<mark')
  expect(f.reading.captureExport().plugins).toEqual(initial)
  await f.reading.start(true)
  await vi.advanceTimersByTimeAsync(600)
  expect(f.engines).toHaveLength(2)
  expect(f.reading.store.getState().projection?.html).not.toContain('<mark')
  expect(f.reading.captureExport().plugins).toEqual(next)
  expect(capture.plugins).toEqual(initial)
  expect(f.state().doc.toString()).toBe(source)
})
it('translates inline note bodies in source order and preserves their export indices', async () => {
  const source = 'First paragraph^[Note paragraph with `private`].\n\nLast paragraph.'
  const f = setup(source, { ...defaultMarkdownPlugins })
  await f.reading.start(true)
  expect(f.reading.store.getState().phase).toBe('translating')
  expect(f.calls).toHaveLength(2)
  expect(f.calls[0]?.request.payload.text).toContain('First paragraph')
  expect(f.calls[1]?.request.payload.text).toContain('Note paragraph')
  f.finish(0)
  f.finish(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(f.calls).toHaveLength(3)
  f.finish(2)
  await vi.advanceTimersByTimeAsync(600)
  expect(f.reading.store.getState().phase).toBe('ready')
  expect(f.reading.store.getState().projection?.html).toContain('Note 段落')
  expect(
    f.reading
      .captureExport()
      .reading.units.map((unit) => ({ index: unit.index, output: unit.output })),
  ).toEqual([
    { index: 0, output: f.calls[0]?.request.payload.text.replaceAll('paragraph', '段落') },
    { index: 1, output: f.calls[1]?.request.payload.text.replaceAll('paragraph', '段落') },
    { index: 2, output: 'Last 段落.' },
  ])
  expect(f.state().doc.toString()).toBe(source)
})
it('changes layout without provider calls and captures immutable partial outputs, language and revision', async () => {
  const f = setup()
  expect(() => f.reading.captureExport()).toThrow('export-reading-empty')
  await f.reading.start(true)
  f.finish(0)
  await vi.advanceTimersByTimeAsync(600)
  f.reading.setLayout('side-by-side')
  await vi.advanceTimersByTimeAsync(600)
  const capture = f.reading.captureExport()
  expect(capture).toMatchObject({
    source: f.state().doc.toString(),
    revision: 0,
    missing: 2,
    reading: {
      targetLanguage: 'zh-CN',
      layout: 'side-by-side',
      units: [{ index: 0, output: 'First 段落.' }],
    },
  })
  const ids = f.reading.store.getState().projection?.blocks?.map((block) => block.id)
  f.reading.setLayout('interlinear')
  await vi.advanceTimersByTimeAsync(600)
  expect(f.reading.store.getState().projection?.layout).toBe('interlinear')
  expect(f.reading.store.getState().projection?.blocks?.map((block) => block.id)).toEqual(ids)
  expect(f.calls).toHaveLength(3)
  f.finish(1)
  f.finish(2)
  await vi.advanceTimersByTimeAsync(600)
  f.edit(0, 0, '# New heading\n\n')
  expect(capture.missing).toBe(2)
  expect(capture.reading.units).toHaveLength(1)
  expect(capture.reading.layout).toBe('side-by-side')
  expect(capture.reading.stale).toBe(false)
  expect(f.reading.captureExport()).toMatchObject({
    revision: 0,
    reading: { stale: true, layout: 'interlinear' },
  })
  await f.reading.start(true)
  await vi.advanceTimersByTimeAsync(600)
  expect(
    f.reading.store
      .getState()
      .projection?.blocks?.slice(1)
      .map((block) => block.id),
  ).toEqual(ids)
  expect(f.calls).toHaveLength(4)
})
it('opening and editing never requests a provider; explicit requests are bounded and leave editable text and selection unchanged', async () => {
  const f = setup()
  const source = f.state().doc
  const selection = f.state().selection
  f.reading.show(true)
  await vi.waitFor(() => expect(f.calls).toHaveLength(2))
  expect(f.calls).toHaveLength(2)
  expect(f.calls.every((call) => !call.request.network)).toBe(true)
  f.finish(0, null)
  await vi.advanceTimersByTimeAsync(1)
  expect(f.reading.store.getState()).toMatchObject({ phase: 'idle', projection: null })
  await f.reading.start(true)
  expect(f.calls).toHaveLength(4)
  expect(f.calls.slice(2).every((call) => call.request.network)).toBe(true)
  f.finish(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(f.calls).toHaveLength(5)
  f.finish(3)
  f.finish(4)
  await vi.advanceTimersByTimeAsync(600)
  expect(f.reading.store.getState()).toMatchObject({ phase: 'ready', completed: 3, failed: 0 })
  expect(f.reading.store.getState().projection?.html).toContain('段落')
  expect(f.state().doc).toBe(source)
  expect(f.state().selection).toBe(selection)
  f.edit(0, 5, 'Changed')
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.reading.store.getState().stale).toBe(true)
  expect(f.calls).toHaveLength(5)
  expect(f.reading.store.getState().projection?.html).toContain('First')
})
it('opening restores a complete cached copy atomically in document order and reuses its projection on reopening', async () => {
  const f = setup()
  const source = f.state().doc
  const selection = f.state().selection
  f.reading.show(true)
  await vi.waitFor(() => expect(f.calls).toHaveLength(2))
  const engine = f.engines[0]
  if (!engine) throw new Error('No worker')
  const render = vi.spyOn(engine, 'request')
  f.finish(1, '第二段。', true)
  await vi.advanceTimersByTimeAsync(600)
  expect(f.calls).toHaveLength(3)
  f.finish(2, '第三段。', true)
  await vi.advanceTimersByTimeAsync(600)
  expect(f.reading.store.getState().projection).toBeNull()
  expect(render).not.toHaveBeenCalled()
  expect(() => f.reading.captureExport()).toThrow('export-reading-empty')
  f.finish(0, '第一段。', true)
  await vi.advanceTimersByTimeAsync(600)
  expect(render).toHaveBeenCalledOnce()
  expect(f.calls.every((call) => !call.request.network)).toBe(true)
  expect(f.reading.store.getState()).toMatchObject({
    phase: 'ready',
    total: 3,
    completed: 3,
    cached: 3,
    failed: 0,
  })
  const projection = f.reading.store.getState().projection
  expect(projection?.html).toMatch(/第一段。.*第二段。.*第三段。/s)
  expect(f.reading.captureExport().reading.units).toHaveLength(3)
  expect(f.state().doc).toBe(source)
  expect(f.state().selection).toBe(selection)
  f.reading.show(false)
  f.reading.show(true)
  await vi.advanceTimersByTimeAsync(600)
  expect(f.reading.store.getState().projection).toBe(projection)
  expect(f.calls).toHaveLength(3)
  expect(render).toHaveBeenCalledOnce()
})
it.each(['miss', 'failure'] as const)(
  'a cache %s releases an incomplete automatic restore and leaves new work behind Translate',
  async (result) => {
    const f = setup()
    f.reading.show(true)
    await vi.waitFor(() => expect(f.calls).toHaveLength(2))
    f.finish(1, '第二段。', true)
    await vi.advanceTimersByTimeAsync(600)
    if (result === 'miss') f.finish(0, null)
    else f.fail(0)
    await vi.advanceTimersByTimeAsync(600)
    f.finish(2, 'LATE', true)
    await vi.advanceTimersByTimeAsync(600)
    expect(f.reading.store.getState()).toMatchObject({
      phase: 'idle',
      projection: null,
      total: 0,
      completed: 0,
      error: null,
      unitError: null,
    })
    expect(f.engines[0]?.dispose).toHaveBeenCalledOnce()
    expect(f.cancelled).toEqual([f.calls[2]?.request.requestId])
    expect(f.calls.every((call) => !call.request.network)).toBe(true)
    await f.reading.start(true)
    expect(f.calls).toHaveLength(5)
    expect(f.calls.slice(3).every((call) => call.request.network)).toBe(true)
    expect(f.reading.store.getState().projection?.html).not.toContain('LATE')
  },
)
it.each(['hide', 'edit', 'cancel', 'suspend'] as const)(
  '%s discards an automatic restore and ignores its late cached results',
  async (action) => {
    const f = setup()
    f.reading.show(true)
    await vi.waitFor(() => expect(f.calls).toHaveLength(2))
    if (action === 'hide') f.reading.show(false)
    else if (action === 'edit') f.edit(0, 5, 'Changed')
    else f.reading[action]()
    f.finish(0, 'LATE', true)
    f.finish(1, 'LATE', true)
    await vi.advanceTimersByTimeAsync(600)
    expect(f.reading.store.getState()).toMatchObject({ phase: 'idle', projection: null, total: 0 })
    expect(f.calls).toHaveLength(2)
    expect(f.cancelled).toHaveLength(2)
    expect(f.engines[0]?.dispose).toHaveBeenCalledOnce()
  },
)
it('deduplicates prose while restoring each occurrence’s own code, formula and link destination', async () => {
  const f = setup(
    'Hello `ONE` $X$ [label](https://one.invalid).\n\nHello `TWO` $Y$ [label](https://two.invalid).',
  )
  await f.reading.start(true)
  expect(f.calls).toHaveLength(1)
  expect(JSON.stringify(f.calls[0]?.request.payload)).not.toMatch(
    /ONE|TWO|https:|one.invalid|two.invalid/,
  )
  f.finish(0, f.calls[0]?.request.payload.text.replace('Hello', '<script>你好</script>'))
  await vi.advanceTimersByTimeAsync(600)
  const projection = f.reading.store.getState().projection
  expect(projection?.html).toContain('&#x3C;script>你好&#x3C;/script>')
  expect(projection?.html).toContain('<code>ONE</code>')
  expect(projection?.html).toContain('<code>TWO</code>')
  expect(projection?.html).toContain('https://one.invalid')
  expect(projection?.html).toContain('https://two.invalid')
  expect(projection?.slots.map((slot) => slot.source)).toEqual(['X', 'Y'])
  expect(f.reading.store.getState().completed).toBe(2)
})
it('keeps unchanged in-flight occurrences across an unrelated edit and refresh, cancelling changed occurrences only', async () => {
  const f = setup('First paragraph.\n\nSecond paragraph.')
  await f.reading.start(true)
  const second = f.calls[1]?.request
  f.edit(0, 5, 'Changed')
  await f.reading.start(true)
  expect(f.cancelled).toEqual([f.calls[0]?.request.requestId])
  expect(f.calls).toHaveLength(3)
  expect(f.calls[1]?.request).toBe(second)
  f.finish(0, 'OBSOLETE')
  f.finish(1)
  f.finish(2)
  await vi.advanceTimersByTimeAsync(600)
  expect(f.reading.store.getState()).toMatchObject({ completed: 2, stale: false, failed: 0 })
  expect(f.reading.store.getState().projection?.html).toContain('Changed 段落')
  expect(f.reading.store.getState().projection?.html).not.toContain('OBSOLETE')
})
it('does not carry a removed duplicate occurrence into an identical newly inserted paragraph', async () => {
  const f = setup('First paragraph.\n\nSecond paragraph.')
  await f.reading.start(true)
  f.edit(0, 'First paragraph.'.length, '')
  f.edit(f.state().doc.length, f.state().doc.length, '\n\nFirst paragraph.')
  await f.reading.start(true)
  expect(f.cancelled).toContain(f.calls[0]?.request.requestId)
  expect(f.calls[2]?.request.occurrenceId).not.toBe(f.calls[0]?.request.occurrenceId)
})
it('offline misses and individual malformed output retain source; Retry Failed targets failures only', async () => {
  const f = setup('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.')
  await f.reading.start(false)
  expect(f.calls.every((call) => !call.request.network)).toBe(true)
  f.finish(0, null)
  f.finish(1, '')
  await vi.advanceTimersByTimeAsync(1)
  f.finish(2, undefined, true)
  await vi.advanceTimersByTimeAsync(600)
  expect(f.reading.store.getState()).toMatchObject({ completed: 1, failed: 1, cached: 1, total: 3 })
  expect(f.reading.store.getState().projection?.html).toContain('First paragraph.')
  expect(f.reading.store.getState().projection?.html).toContain('Second paragraph.')
  await f.reading.start(true, true)
  expect(f.calls).toHaveLength(4)
  expect(f.calls[3]?.request.payload.text).toBe('Second paragraph.')
  expect(f.calls[3]?.request.network).toBe(true)
  f.finish(3)
  await vi.advanceTimersByTimeAsync(600)
  expect(f.reading.store.getState()).toMatchObject({ completed: 2, failed: 0 })
})
it('cancel stops scheduling and rejects late results; completed output can resume without retransmitting it', async () => {
  const f = setup()
  await f.reading.start(true)
  f.finish(0)
  await vi.advanceTimersByTimeAsync(1)
  f.reading.cancel()
  expect(f.cancelled).toHaveLength(2)
  f.finish(1, 'LATE')
  f.finish(2, 'LATE')
  await vi.advanceTimersByTimeAsync(600)
  expect(f.reading.store.getState()).toMatchObject({ phase: 'cancelled', completed: 1 })
  expect(f.reading.store.getState().projection?.html).not.toContain('LATE')
  await f.reading.start(true)
  expect(f.calls).toHaveLength(5)
  expect(
    f.calls.slice(3).some((call) => call.request.unitKey === f.calls[0]?.request.unitKey),
  ).toBe(false)
})
it.each(['settingsRevision', 'cacheGeneration'] as const)(
  '%s invalidates the view, all pending work and old output',
  async (field) => {
    const f = setup()
    await f.reading.start(true)
    f.update({ [field]: 2 })
    await vi.advanceTimersByTimeAsync(1)
    f.finish(0, 'STALE')
    f.finish(1, 'STALE')
    await vi.advanceTimersByTimeAsync(600)
    expect(f.cancelled).toHaveLength(2)
    expect(f.reading.store.getState()).toMatchObject({ phase: 'idle', projection: null, total: 0 })
    expect(f.engines[0]?.dispose).toHaveBeenCalledOnce()
  },
)
it('suspending during metadata loading cannot revive a tab or start requests', async () => {
  const f = setup()
  let resolve!: (value: Result<TranslationState>) => void
  vi.mocked(f.bridge.translationState).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const pending = f.reading.start(true)
  f.reading.suspend()
  resolve({
    ok: true,
    value: {
      settings,
      settingsRevision: 1,
      cacheGeneration: 0,
      cache: 'ready',
      configuration: 'ready',
      credential: 'none',
    },
  })
  await pending
  expect(f.calls).toHaveLength(0)
  expect(f.engines).toHaveLength(0)
  expect(f.reading.store.getState().configurationLoading).toBe(false)
})
it.each(['reply', 'reject'] as const)(
  'settings %s failures remain distinct from missing configuration and retry without sending prose',
  async (failure) => {
    const f = setup()
    if (failure === 'reply')
      vi.mocked(f.bridge.translationState).mockResolvedValueOnce({
        ok: false,
        code: 'translation-storage',
        error: 'Unavailable',
      })
    else vi.mocked(f.bridge.translationState).mockRejectedValueOnce(new Error('Unavailable'))
    await f.reading.start(true)
    expect(f.reading.store.getState()).toMatchObject({
      configurationLoading: false,
      configurationError: failure === 'reply' ? 'translation-storage' : 'translation-settings',
      configuration: null,
      error: null,
      phase: 'idle',
    })
    await f.reading.metadata()
    expect(f.reading.store.getState()).toMatchObject({
      configurationLoading: false,
      configurationError: null,
      configuration: { settings },
      error: null,
    })
    expect(f.calls).toHaveLength(0)
    expect(f.engines).toHaveLength(0)
  },
)
it('an older rejected settings request cannot replace a newer successful configuration', async () => {
  const f = setup()
  let reject!: (reason: Error) => void
  vi.mocked(f.bridge.translationState).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      }),
  )
  const older = f.reading.metadata()
  expect(f.reading.store.getState().configurationLoading).toBe(true)
  const current = await f.reading.metadata()
  reject(new Error('Late failure'))
  await older
  expect(f.reading.store.getState()).toMatchObject({
    configuration: current,
    configurationError: null,
    configurationLoading: false,
    error: null,
  })
})
it('an older settings response cannot clear the loading state of the current request', async () => {
  const f = setup()
  const value = await f.reading.metadata()
  if (!value) throw new Error('Missing metadata')
  const finish: ((value: Result<TranslationState>) => void)[] = []
  vi.mocked(f.bridge.translationState).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish.push(resolve)
      }),
  )
  const older = f.reading.metadata()
  const current = f.reading.metadata()
  finish[0]?.({ ok: true, value })
  await older
  expect(f.reading.store.getState().configurationLoading).toBe(true)
  finish[1]?.({ ok: false, code: 'translation-storage', error: 'Unavailable' })
  await current
  expect(f.reading.store.getState()).toMatchObject({
    configuration: value,
    configurationLoading: false,
    configurationError: 'translation-storage',
  })
})
it.each(['suspend', 'dispose'] as const)('%s ignores late settings rejection', async (method) => {
  const f = setup()
  let reject!: (reason: Error) => void
  vi.mocked(f.bridge.translationState).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      }),
  )
  const pending = f.reading.start(true)
  f.reading[method]()
  const stopped = f.reading.store.getState()
  reject(new Error('Late failure'))
  await pending
  expect(f.reading.store.getState()).toEqual(stopped)
  expect(stopped.configurationLoading).toBe(false)
  expect(f.calls).toHaveLength(0)
  expect(f.engines).toHaveLength(0)
})
it('read-only settings prevent a language change from discarding the reading copy', async () => {
  const f = setup()
  await f.reading.start(false)
  f.finish(0, 'Cached first', true)
  f.finish(1, 'Cached second', true)
  await vi.advanceTimersByTimeAsync(1)
  f.finish(2, 'Cached third', true)
  await vi.advanceTimersByTimeAsync(600)
  f.update({ configuration: 'read-only' })
  await vi.advanceTimersByTimeAsync(1)
  const projection = f.reading.store.getState().projection
  expect(projection).not.toBeNull()
  const configure = vi.spyOn(f.bridge, 'configureTranslation')
  await f.reading.target('ja')
  expect(f.reading.store.getState().projection).toBe(projection)
  expect(f.reading.store.getState().target).toBe('zh-CN')
  expect(configure).not.toHaveBeenCalled()
})
it('suspending drops derived memory and late output; returning automatically restores cached translations', async () => {
  const f = setup()
  await f.reading.start(true)
  f.reading.suspend()
  f.finish(0, 'LATE')
  f.finish(1, 'LATE')
  f.reading.attach()
  await vi.waitFor(() => expect(f.calls).toHaveLength(4))
  expect(f.reading.store.getState()).toMatchObject({ phase: 'translating', projection: null })
  expect(f.calls).toHaveLength(4)
  expect(f.calls.slice(2).every((call) => !call.request.network)).toBe(true)
  f.finish(2, undefined, true)
  f.finish(3, undefined, true)
  await vi.advanceTimersByTimeAsync(1)
  f.finish(4, undefined, true)
  await vi.advanceTimersByTimeAsync(600)
  expect(f.reading.store.getState()).toMatchObject({ phase: 'ready', completed: 3, cached: 3 })
  expect(f.reading.store.getState().projection?.html).toContain('段落')
  expect(f.reading.store.getState().projection?.html).not.toContain('LATE')
  expect(f.engines[0]?.dispose).toHaveBeenCalledOnce()
})
it('composition and stale Retry Failed are blocked without sending prose', async () => {
  const f = setup()
  f.compose(true)
  await f.reading.start(true)
  expect(f.calls).toHaveLength(0)
  expect(f.reading.store.getState().error).toBe('translation-composing')
  f.compose(false)
  await f.reading.start(true)
  f.fail(0)
  f.fail(1)
  await vi.advanceTimersByTimeAsync(1)
  f.fail(2)
  await vi.advanceTimersByTimeAsync(600)
  f.edit(0, 5, 'Changed')
  await f.reading.start(true, true)
  expect(f.calls).toHaveLength(3)
  expect(f.reading.store.getState().error).toBe('translation-refresh-first')
})

// The complete output-budget boundary took 17.2 s on the instrumented Intel CI runner.
it('buffers 16 MiB of output and publishes it in bounded messages, excluding excess units', async () => {
  const f = setup(Array.from({ length: 40 }, (_, index) => `Paragraph ${index}.`).join('\n\n'))
  await f.reading.start(true)
  const engine = f.engines[0]
  if (!engine) throw new Error('No engine')
  const original = engine.request.bind(engine)
  const renders: Extract<ReadingOperation, { kind: 'render' }>[] = []
  engine.request = (operation) => {
    if (operation.kind === 'render') renders.push(operation)
    return original(operation)
  }
  const output = `T${'\n'.repeat(249_999)}`
  for (let index = 0; index < 40; index++) {
    f.finish(index, output)
    await vi.advanceTimersByTimeAsync(1)
  }
  await vi.advanceTimersByTimeAsync(1600)
  expect(f.reading.store.getState()).toMatchObject({
    phase: 'ready',
    total: 40,
    completed: 33,
    failed: 7,
    unitError: 'translation-view-limit',
  })
  // Native JSON sizing is independent of the incremental production byte counter.
  expect(
    renders.every(
      (operation) => Buffer.byteLength(JSON.stringify(operation)) <= readingLimits.message,
    ),
  ).toBe(true)
  expect(renders.flatMap((operation) => operation.outputs)).toHaveLength(33)
  expect(f.reading.store.getState().projection?.html).toContain('T\n')
  expect(f.reading.captureExport().reading.units).toHaveLength(33)
}, 30_000)

it('an oversized unit keeps source without issuing a provider request', async () => {
  const f = setup('x'.repeat(70_000))
  await f.reading.start(true)
  await vi.advanceTimersByTimeAsync(600)
  expect(f.calls).toHaveLength(0)
  expect(f.reading.store.getState()).toMatchObject({
    phase: 'ready',
    total: 1,
    limited: 1,
    completed: 0,
  })
  expect(f.reading.store.getState().projection?.html).toContain('x'.repeat(70_000))
})

it('new source semantics can reclaim the shared derived budget from an older reading copy', async () => {
  const f = setup()
  await f.reading.start(true)
  f.reading.semanticChanged(semanticLimits.snapshotBytes)
  f.finish(0, 'LATE')
  f.finish(1, 'LATE')
  await vi.advanceTimersByTimeAsync(600)
  expect(f.cancelled).toHaveLength(2)
  expect(f.reading.store.getState()).toMatchObject({
    phase: 'error',
    projection: null,
    total: 0,
    error: 'translation-view-limit',
  })
  expect(f.engines[0]?.dispose).toHaveBeenCalledOnce()
})

it('an unhealthy derived worker can be explicitly recreated while validated completed output is retained', async () => {
  const f = setup('First paragraph.\n\nSecond paragraph.')
  await f.reading.start(true)
  const engine = f.engines[0]
  if (!engine) throw new Error('No worker')
  const original = engine.request.bind(engine)
  engine.request = vi
    .fn()
    .mockRejectedValueOnce(new Error('translation-view-worker'))
    .mockImplementation(original)
  f.finish(0)
  f.finish(1)
  await vi.advanceTimersByTimeAsync(600)
  expect(f.reading.store.getState()).toMatchObject({
    phase: 'error',
    error: 'translation-view-worker',
  })
  expect(engine.dispose).toHaveBeenCalledOnce()
  await f.reading.start(true)
  await vi.advanceTimersByTimeAsync(600)
  expect(f.engines).toHaveLength(2)
  expect(f.calls).toHaveLength(2)
  expect(f.reading.store.getState()).toMatchObject({ phase: 'ready', completed: 2, error: null })
  expect(f.reading.store.getState().projection?.html).toContain('段落')
})

it('uses the saved layout for a new copy and retains a layout chosen for the current document', () => {
  const { reading } = setup()
  reading.setDefaultLayout('side-by-side')
  expect(reading.store.getState().layout).toBe('side-by-side')
  reading.setDefaultLayout('interlinear')
  expect(reading.store.getState().layout).toBe('interlinear')
  reading.setLayout('replace')
  reading.setDefaultLayout('side-by-side')
  expect(reading.store.getState().layout).toBe('replace')
})

it('keeps a captured reading layout when application defaults change', async () => {
  const { reading } = setup()
  reading.setDefaultLayout('interlinear')
  await reading.start(false)
  reading.setDefaultLayout('replace')
  expect(reading.store.getState().layout).toBe('interlinear')
})
