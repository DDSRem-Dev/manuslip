import { parseMarkdown, semanticLimits } from '@manuslip/core'
import { createSourceState, liveModel, StateEffect, type TransactionSpec } from '@manuslip/editor'
import { renderMarkdown } from '@manuslip/renderer'
import { expect, it, type MockInstance, vi } from 'vitest'
import { renderProjectionLayout } from '../../../../../../../packages/renderer/src/projection-layout'
import {
  DocumentPreview,
  initialPreviewStatus,
  type PreviewStatus,
} from '../../../../../src/renderer/src/preview/controller'
import {
  OwnedPackedPreview,
  type PackedPreviewLease,
} from '../../../../../src/renderer/src/preview/packed-preparation'
import type {
  ParseRequest,
  ParseResponse,
} from '../../../../../src/renderer/src/semantics/protocol'
import { SemanticService, type WorkerPort } from '../../../../../src/renderer/src/semantics/service'

it('suspending a tab releases derived state and resumes parsing the current editable state', async () => {
  vi.useFakeTimers()
  let receive: (value: unknown) => void = () => {}
  const requests: ParseRequest[] = []
  const worker: WorkerPort = {
    onMessage: (listener) => {
      receive = listener
    },
    onFailure: () => {},
    post: (request) => {
      requests.push(request)
    },
    terminate: () => {},
  }
  const service = new SemanticService(() => worker)
  let state = createSourceState('| A | B |\n| - | - |\n| 1 | 2 |')
  let revision = 0
  let status: PreviewStatus = { ...initialPreviewStatus }
  const dispatch = (spec: TransactionSpec): void => {
    const transaction = state.update(spec)
    state = transaction.state
    if (transaction.docChanged) revision++
    preview.changed([transaction])
  }
  const preview = new DocumentPreview(
    {
      id: 'tab',
      state: () => state,
      view: () => null,
      revision: () => revision,
      bytes: () => state.doc.length,
      dispatch,
      status: (patch) => {
        status = { ...status, ...patch }
      },
      openLink: () => {},
    },
    () => service,
  )
  // Install the same fields as DocumentController without mounting a browser view.
  state = state.update({ effects: StateEffect.appendConfig.of(preview.extensions) }).state
  const finish = (index: number): void => {
    const request = requests[index]
    if (!request) throw new Error('No semantic request')
    const document = parseMarkdown(request.source)
    const { layout } = renderProjectionLayout(
      document.root,
      request.options,
      semanticLimits.rendererBytes,
    )
    receive({
      kind: 'result',
      sequence: request.sequence,
      generation: request.generation,
      documentId: request.documentId,
      revision: request.revision,
      sentAt: performance.timeOrigin + performance.now(),
      snapshot: {
        document,
        projection: renderMarkdown(document.root, request.options),
        layout,
        bytes: 100,
        cached: false,
        transportInMs: 0,
        serializeMs: 0,
      },
    } satisfies ParseResponse)
  }
  let packedPrepare: MockInstance | undefined
  let packedCommit: MockInstance | undefined
  let consumer: PackedPreviewLease | undefined
  try {
    packedPrepare = vi.spyOn(OwnedPackedPreview, 'prepare')
    const commit = OwnedPackedPreview.prototype.commit
    packedCommit = vi.spyOn(OwnedPackedPreview.prototype, 'commit').mockImplementation(function (
      this: OwnedPackedPreview,
    ) {
      const accepted = commit.call(this)
      if (accepted && !consumer) consumer = this.retain()
      return accepted
    })
    preview.attach()
    await vi.advanceTimersByTimeAsync(semanticLimits.debounce)
    finish(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(packedPrepare).toHaveBeenCalledOnce()
    expect(packedCommit).toHaveReturnedWith(true)
    expect(state.field(liveModel)?.blocks.length).toBeGreaterThan(0)
    expect(preview.currentSnapshot()).not.toBeNull()
    expect(await preview.capture(revision, new AbortController().signal)).toBe(
      preview.currentSnapshot(),
    )
    const reading = await preview.captureReading(revision, new AbortController().signal)
    expect(reading.kind).toBe('packed')
    const body = state.doc
    preview.suspend()
    if (reading.kind === 'packed') {
      expect(
        reading.capture.reader.at(reading.path).scalar(['type'], { retained: 1024, staging: 1024 }),
      ).toBe('root')
      reading.capture.release()
    }
    expect(state.doc).toBe(body)
    expect(state.field(liveModel)).toBeNull()
    expect(preview.currentSnapshot()).toBeNull()
    expect(status.wordCount).toBeNull()
    expect(status.outline).toEqual([])
    dispatch({
      changes: { from: state.doc.length, insert: '\n\nInactive change' },
      selection: { anchor: 3 },
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(requests).toHaveLength(1)
    preview.attach()
    await vi.advanceTimersByTimeAsync(semanticLimits.debounce)
    expect(requests[1]?.source).toContain('Inactive change')
    finish(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(state.selection.main.head).toBe(3)
    const snapshot = preview.currentSnapshot()
    if (!snapshot || !('document' in snapshot)) throw new Error('Expected native snapshot')
    expect(snapshot.document.counts.words).toBeGreaterThan(0)
    // Source mode still consumes whole-document semantics for outline and counts.
    preview.setNavigation(true)
    preview.setMode('source')
    expect(requests).toHaveLength(2)
    dispatch({ changes: { from: state.doc.length, insert: '\n\n## Source heading' } })
    await vi.advanceTimersByTimeAsync(semanticLimits.debounce)
    expect(requests).toHaveLength(3)
    finish(2)
    await vi.advanceTimersByTimeAsync(100)
    expect(status.outline.map((heading) => heading.text)).toContain('Source heading')
    expect(status.characterCount).toBeGreaterThan(0)
    expect(state.field(liveModel)).toBeNull()
    preview.suspend()
    dispatch({ changes: { from: state.doc.length, insert: '\n\n## Inactive heading' } })
    await vi.advanceTimersByTimeAsync(2000)
    expect(requests).toHaveLength(3)
    await expect(preview.capture(revision, new AbortController().signal)).rejects.toThrow(
      'translation-capture-changed',
    )
    preview.attach()
    const rejected = expect(
      preview.capture(revision, new AbortController().signal),
    ).rejects.toThrow('translation-capture-changed')
    dispatch({ changes: { from: state.doc.length, insert: '\n\nA newer capture wins.' } })
    await rejected
    const abort = new AbortController()
    const cancelled = expect(preview.capture(revision, abort.signal)).rejects.toThrow(
      'translation-cancelled',
    )
    abort.abort()
    await cancelled
    const retainedModel = consumer?.model
    expect(retainedModel?.blocks.length).toBeGreaterThan(0)
    preview.dispose()
    expect(consumer?.model).toBe(retainedModel)
    consumer?.release()
    expect(() => consumer?.model).toThrow(/released/)
  } finally {
    consumer?.release()
    preview.dispose()
    packedPrepare?.mockRestore()
    packedCommit?.mockRestore()
    service.dispose()
    vi.useRealTimers()
  }
})
