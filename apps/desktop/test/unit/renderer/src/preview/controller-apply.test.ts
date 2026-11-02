import { parseMarkdown, semanticLimits } from '@manuslip/core'
import { createSourceState, liveModel, StateEffect, type TransactionSpec } from '@manuslip/editor'
import { renderMarkdown } from '@manuslip/renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PackedSession } from '../../../../../../../packages/core/src/packing-session'
import { renderProjectionLayout } from '../../../../../../../packages/renderer/src/projection-layout'
import {
  DocumentPreview,
  initialPreviewStatus,
} from '../../../../../src/renderer/src/preview/controller'
import { OwnedPackedPreview } from '../../../../../src/renderer/src/preview/packed-preparation'
import { PreviewStatusPublication } from '../../../../../src/renderer/src/preview/status-publication'
import type {
  ParseRequest,
  ParseResponse,
} from '../../../../../src/renderer/src/semantics/protocol'
import { SemanticService } from '../../../../../src/renderer/src/semantics/service'
import type { SliceRuntime } from '../../../../../src/renderer/src/semantics/sliced-work'

const dispose: (() => void)[] = []
afterEach(() => {
  for (const release of dispose.splice(0)) release()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function setup(packed: boolean, statusOwnership = false) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  let now = performance.now()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const queued: (() => void)[] = []
  const packedCommit = vi.spyOn(OwnedPackedPreview.prototype, 'commit')
  const runtime: SliceRuntime = {
    now: () => {
      now += 0.6
      return now
    },
    defer: (run) => queued.push(run),
  }
  let receive: (value: unknown) => void = () => {}
  const requests: ParseRequest[] = []
  const service = new SemanticService(() => ({
    onMessage: (listener) => {
      receive = listener
    },
    onFailure: () => {},
    post: (request) => requests.push(request),
    terminate: () => {},
  }))
  let state = createSourceState(
    `# Heading\n\n${'Same paragraph.\n\n'.repeat(160)}\n\n\`\`\`js\nlet x = 1\n\`\`\``,
  )
  let revision = 0
  let status = { ...initialPreviewStatus }
  const publications = new PreviewStatusPublication()
  const dispatch = (spec: TransactionSpec) => {
    const transaction = state.update(spec)
    state = transaction.state
    if (transaction.docChanged) revision++
    preview.changed([transaction])
  }
  const preview = new DocumentPreview(
    {
      id: 'apply',
      state: () => state,
      view: () => null,
      revision: () => revision,
      bytes: () => state.doc.length,
      dispatch,
      status: (patch) => {
        status = {
          ...status,
          ...patch,
          ...(statusOwnership && 'outline' in patch
            ? { previewPublication: publications.replace() }
            : {}),
        }
      },
      ...(statusOwnership
        ? {
            reserveStatus: (acquire: Parameters<PreviewStatusPublication['prepare']>[0]) => {
              const reservation = publications.prepare(acquire)
              return {
                publish: (patch: Partial<typeof status>) => {
                  status = { ...status, ...patch, previewPublication: reservation.publish() }
                },
                release: () => reservation.release(),
              }
            },
          }
        : {}),
      openLink: () => {},
    },
    () => service,
    runtime,
  )
  state = state.update({ effects: StateEffect.appendConfig.of(preview.extensions) }).state
  const deliver = (index: number) => {
    const request = requests[index]
    if (!request) throw new Error('Missing semantic request')
    const document = parseMarkdown(request.source)
    const layout = packed
      ? renderProjectionLayout(document.root, request.options, semanticLimits.rendererBytes).layout
      : undefined
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
        ...(layout ? { layout } : {}),
        bytes: 100,
        cached: false,
        transportInMs: 0,
        serializeMs: 0,
      },
    } satisfies ParseResponse)
  }
  const drain = () => {
    while (queued.length) queued.shift()?.()
  }
  dispose.push(() => {
    publications.close()
    preview.dispose()
    service.dispose()
  })
  return {
    preview,
    publications,
    packedCommit,
    requests,
    queued,
    deliver,
    drain,
    dispatch,
    get state() {
      return state
    },
    get status() {
      return status
    },
    get revision() {
      return revision
    },
    publish: () => vi.advanceTimersByTimeAsync(semanticLimits.debounce),
  }
}

describe.each(['native', 'packed'] as const)('%s sliced preparation', (mode) => {
  it('installs one complete model and resolves a capture only after preparation finishes', async () => {
    const app = setup(mode === 'packed')
    app.preview.attach()
    await app.publish()
    app.deliver(0)
    expect(app.queued).toHaveLength(1)
    expect(app.preview.currentSnapshot()).toBeNull()
    expect(app.state.field(liveModel)).toBeNull()
    expect(app.status.semantic).toBe('pending')
    expect(app.status.wordCount).toBeNull()
    expect(app.status.characterCount).toBeNull()
    expect(app.status.outline).toEqual([])
    const capture = app.preview.capture(app.revision, new AbortController().signal)
    expect(app.requests).toHaveLength(1)
    const source = app.state.doc
    app.drain()
    expect(await capture).toBe(app.preview.currentSnapshot())
    expect(app.state.doc).toBe(source)
    expect(app.status.semantic).toBe('ready')
    expect(app.state.field(liveModel)?.blocks).toHaveLength(1)
    expect(app.status.outline[0]?.text).toBe('Heading')
    const expected = parseMarkdown(source.toString())
    expect(app.status.wordCount).toBe(expected.counts.words)
    expect(app.status.characterCount).toBe(expected.counts.characters)
    expect(app.status.outline).toEqual(expected.outline)
    if (mode === 'packed') expect(app.packedCommit).toHaveReturnedWith(true)
    const model = app.state.field(liveModel)
    app.preview.setMode('source')
    app.preview.setMode('live')
    expect(app.state.field(liveModel)).toBe(model)
    expect(app.requests).toHaveLength(1)
  })

  it.each(['edit', 'suspend', 'reset', 'raw-html', 'locale', 'dispose'] as const)(
    'discards queued preparation after %s and accepts only a subsequent current snapshot',
    async (action) => {
      const app = setup(mode === 'packed')
      app.preview.attach()
      await app.publish()
      app.deliver(0)
      expect(app.queued).toHaveLength(1)
      switch (action) {
        case 'edit':
          app.dispatch({ changes: { from: 0, to: 9, insert: '# New heading' } })
          break
        case 'suspend':
          app.preview.suspend()
          break
        case 'reset':
          app.preview.reset()
          break
        case 'raw-html':
          app.preview.setRawHtml(true)
          break
        case 'locale':
          app.preview.localize()
          break
        case 'dispose':
          app.preview.dispose()
          break
      }
      app.drain()
      expect(app.preview.currentSnapshot()).toBeNull()
      expect(app.state.field(liveModel)).toBeNull()
      if (action === 'dispose') return
      if (action === 'suspend') app.preview.attach()
      if (action === 'reset') app.preview.retry()
      await app.publish()
      expect(app.requests).toHaveLength(2)
      app.deliver(1)
      expect(app.preview.currentSnapshot()).toBeNull()
      app.drain()
      expect(app.status.semantic).toBe('ready')
      if (mode === 'packed') expect(app.packedCommit).toHaveReturnedWith(true)
      expect(app.preview.currentSnapshot()).not.toBeNull()
      expect(app.status.semanticRevision).toBe(app.revision)
      expect(app.state.field(liveModel)?.blocks).toHaveLength(1)
      expect(app.state.field(liveModel)?.blocks[0]?.from).toBe(
        app.state.doc.toString().indexOf('```js'),
      )
      expect(app.status.outline[0]?.text).toBe(action === 'edit' ? 'New heading' : 'Heading')
    },
  )
})

it('keeps packed status admitted after suspension until all UI consumers finish their old outline', async () => {
  const app = setup(true, true),
    first = app.publications.subscribe(),
    second = app.publications.subscribe()
  try {
    app.preview.attach()
    await app.publish()
    app.deliver(0)
    app.drain()
    const outline = app.status.outline,
      published = app.status.previewPublication,
      owner = Reflect.get(app.preview, 'packedOwner') as PackedSession
    first.acknowledge(published)
    second.acknowledge(published)
    app.preview.suspend()
    expect(app.status.outline).toEqual([])
    expect(outline[0]?.text).toBe('Heading')
    expect(app.publications.stats.publications).toBe(1)
    expect(owner.stats.holds).toBeGreaterThan(0)
    first.acknowledge(app.status.previewPublication)
    expect(owner.stats.holds).toBeGreaterThan(0)
    second.release()
    expect(app.publications.stats.publications).toBe(0)
    expect(owner.stats).toMatchObject({ holds: 0, readers: 0, captures: 0, retainedBytes: 256 })
  } finally {
    first.release()
    second.release()
  }
})

it('rejects a full packed status queue before model commit and still publishes the complete native fallback', async () => {
  const app = setup(true, true),
    consumer = app.publications.subscribe(),
    released = vi.fn()
  try {
    app.preview.attach()
    await app.publish()
    app.deliver(0)
    app.drain()
    consumer.acknowledge(app.status.previewPublication)
    for (let index = 1; index < 8; index++)
      app.publications.prepare(() => ({ release: released })).publish()
    expect(app.packedCommit).toHaveBeenCalledTimes(1)
    app.dispatch({ changes: { from: 0, to: 9, insert: '# Replacement heading' } })
    await app.publish()
    app.deliver(1)
    app.drain()
    expect(app.packedCommit).toHaveBeenCalledTimes(1)
    expect(app.status.semantic).toBe('ready')
    expect(app.status.outline[0]?.text).toBe('Replacement heading')
    expect(app.preview.currentSnapshot()).toMatchObject({
      document: { root: parseMarkdown(app.state.doc.toString()).root },
    })
    expect(app.publications.stats.publications).toBe(8)
    consumer.acknowledge(app.status.previewPublication)
    expect(app.publications.stats.publications).toBe(0)
    expect(released).toHaveBeenCalledTimes(7)
  } finally {
    consumer.release()
  }
})
