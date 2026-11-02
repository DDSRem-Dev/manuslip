import {
  DocumentPreview,
  initialPreviewStatus,
} from '../../../../apps/desktop/src/renderer/src/preview/controller'
import { PreviewStatusPublication } from '../../../../apps/desktop/src/renderer/src/preview/status-publication'
import { PackedSemanticPort } from '../../../../apps/desktop/src/renderer/src/semantics/packed-port'
import { PackedSemanticReceiver } from '../../../../apps/desktop/src/renderer/src/semantics/packed-receiver'
import { SemanticService } from '../../../../apps/desktop/src/renderer/src/semantics/service'
import {
  browserRuntime,
  SlicedWork,
} from '../../../../apps/desktop/src/renderer/src/semantics/sliced-work'
import { semanticLimits } from '../../../../packages/core/src/contracts'
import { unpackValue } from '../../../../packages/core/src/packing'
import type { PackedCapture } from '../../../../packages/core/src/packing-capture'
import type { PackedSerializedValue } from '../../../../packages/core/src/packing-serialize'
import type { PackedValue } from '../../../../packages/core/src/packing-value'
import {
  createSourceState,
  documentBytes,
  EditorView,
  StateEffect,
  type TransactionSpec,
} from '../../../../packages/editor/src/index'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 64 * MiB, staging: 8 * MiB, captures: 8, readers: 160 }
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
async function until(ready: () => boolean) {
  const end = performance.now() + 45000
  while (!ready()) {
    if (performance.now() > end) throw new Error('Application diagnostic did not settle')
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
}
async function completeHash(capture: PackedCapture) {
  const encoded = await new Promise<PackedValue<PackedSerializedValue>>((resolve, reject) => {
    const work = new SlicedWork(
      capture.serialize([], {
        bytes: semanticLimits.messageBytes,
        workspace: semanticLimits.messageBytes - 65536,
        nodes: 800000,
        depth: 128,
      }),
      {
        valid: () => true,
        complete: resolve,
        finished: () => {},
        failed: reject,
        measured: () => {},
      },
      browserRuntime,
    )
    work.run()
  })
  try {
    const snapshot = unpackValue(encoded.value.payload, limits).value as {
      document: Record<string, unknown>
      projection: Record<string, unknown>
      layout: unknown
    }
    const normalized = JSON.stringify({
      document: { ...snapshot.document, timings: null },
      projection: { ...snapshot.projection, renderMs: null },
      layout: snapshot.layout,
    })
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  } finally {
    encoded.release()
  }
}

declare global {
  interface Window {
    runSemanticServiceProbe(texts: readonly string[]): Promise<unknown>
    semanticServiceProbePhase?(phase: 'start' | 'stop', revision: number): Promise<void>
    semanticServiceMemoryCheckpoint?(
      phase: string,
      revision: number,
      receiver: PackedSemanticReceiver['stats'],
    ): Promise<void>
  }
}
window.runSemanticServiceProbe = async (texts) => {
  const receiver = new PackedSemanticReceiver(limits, {
    retained: 32 * MiB,
    staging: 8 * MiB,
    nodes: 800000,
    depth: 128,
  })
  const messages: { kind: unknown; bytes: number; receivedAfterMs: number }[] = []
  const admissions: unknown[] = []
  const workerFailures: {
    kind: 'error' | 'messageerror'
    worker: number
    revision: number
    elapsedMs: number
    message?: string
    filename?: string
    line?: number
    column?: number
  }[] = []
  const admissionHook = Symbol.for('manuslip-semantic-admission')
  Reflect.set(globalThis, admissionHook, (report: unknown) => {
    if (admissions.length < 16) admissions.push(report)
  })
  let workers = 0,
    roundStarted = 0,
    revision = 0,
    view: EditorView | undefined
  let state = createSourceState(texts[0] ?? '', {
    onUpdate(update) {
      state = update.state
      if (update.docChanged) revision++
      preview.changed(update.transactions)
    },
  })
  let status = { ...initialPreviewStatus }
  const publications = new PreviewStatusPublication(),
    ui = publications.subscribe()
  const service = new SemanticService(() => {
    workers++
    const workerId = workers
    const worker = new Worker(
      new URL(
        '../../../../apps/desktop/src/renderer/src/semantics/packed-semantic.worker.ts',
        import.meta.url,
      ),
      { type: 'module' },
    )
    return new PackedSemanticPort(
      {
        onMessage: (listener) => {
          worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
            messages.push({
              kind: event.data.kind,
              bytes: event.data.payload instanceof ArrayBuffer ? event.data.payload.byteLength : 0,
              receivedAfterMs: performance.now() - roundStarted,
            })
            listener(event.data)
          }
        },
        onFailure: (listener) => {
          worker.onerror = (event) => {
            workerFailures.push({
              kind: 'error',
              worker: workerId,
              revision,
              elapsedMs: performance.now() - roundStarted,
              message: event.message,
              filename: event.filename,
              line: event.lineno,
              column: event.colno,
            })
            event.preventDefault()
            listener('worker-error')
          }
          worker.onmessageerror = () => {
            workerFailures.push({
              kind: 'messageerror',
              worker: workerId,
              revision,
              elapsedMs: performance.now() - roundStarted,
            })
            listener('message-error')
          }
        },
        post: (value) => worker.postMessage(value),
        terminate: () => worker.terminate(),
      },
      receiver,
    )
  })
  const preview = new DocumentPreview(
    {
      id: 'service-probe',
      state: () => view?.state ?? state,
      view: () => view ?? null,
      revision: () => revision,
      bytes: () => state.field(documentBytes),
      dispatch: (spec: TransactionSpec) => {
        if (view) view.dispatch(spec)
        else state = state.update(spec).state
      },
      status: (patch) => {
        status = { ...status, ...patch }
      },
      reserveStatus: (acquire) => {
        const reservation = publications.prepare(acquire)
        return {
          publish: (patch) => {
            status = { ...status, ...patch, previewPublication: reservation.publish() }
            ui.acknowledge(status.previewPublication)
          },
          release: () => reservation.release(),
        }
      },
      openLink: () => {},
    },
    () => service,
  )
  const rounds = []
  let old: PackedCapture | undefined
  let profilingRevision: number | undefined
  try {
    const parent = document.getElementById('editor')
    assert(parent, 'Missing editor host')
    state = state.update({ effects: StateEffect.appendConfig.of(preview.extensions) }).state
    view = new EditorView({ state, parent })
    for (let round = 0; round < texts.length; round++) {
      await window.semanticServiceMemoryCheckpoint?.('request', round, receiver.stats)
      await window.semanticServiceProbePhase?.('start', round)
      profilingRevision = round
      performance.clearMeasures()
      const started = performance.now()
      roundStarted = started
      if (!round) preview.attach()
      else {
        const next = texts[round]
        assert(next, 'Missing complete revision')
        view.dispatch({
          changes: { from: 0, to: view.state.doc.line(1).to, insert: next.split('\n', 1)[0] ?? '' },
        })
        assert(
          view.state.doc.toString() === next,
          'Source mutation differs from authoritative edit',
        )
      }
      await until(
        () =>
          (status.semantic === 'ready' && status.semanticRevision === revision) ||
          status.semantic === 'limit' ||
          status.semantic === 'error',
      )
      assert(
        status.semantic === 'ready' && status.mode === 'live',
        `Preview failed: ${status.semanticError}`,
      )
      const readyMs = performance.now() - started
      const metrics = performance
        .getEntriesByType('measure')
        .filter((entry) => entry.name.startsWith('manuslip:'))
        .map((entry) => ({
          name: entry.name,
          startMs: entry.startTime - started,
          durationMs: entry.duration,
          detail: (entry as PerformanceMeasure).detail,
        }))
      await window.semanticServiceProbePhase?.('stop', round)
      profilingRevision = undefined
      await window.semanticServiceMemoryCheckpoint?.('ready', round, receiver.stats)
      await until(
        () => receiver.stats.cachePhase === 'ready' || receiver.stats.cachePhase === 'unavailable',
      )
      assert(
        receiver.stats.cache.document && receiver.stats.cache.projection,
        'Application receiver structural caches incomplete',
      )
      // Warm the complete original cache. Later mandatory validation may reclaim only
      // optional prose; complete semantic hashes and direct-delta acceptance still apply.
      if (round === 0) assert(receiver.stats.cache.words, 'Initial word cache incomplete')
      await window.semanticServiceMemoryCheckpoint?.('cached', round, receiver.stats)
      const reading = await preview.captureReading(revision, new AbortController().signal)
      assert(reading.kind === 'packed', 'Controller expanded native root')
      assert(reading.path.join('/') === 'document/root', 'Incorrect complete reading root')
      try {
        const semanticSha256 = await completeHash(reading.capture)
        rounds.push({
          revision,
          readyMs,
          metrics,
          semanticSha256,
          words: status.wordCount,
          characters: status.characterCount,
          outline: status.outline,
          messages: messages.splice(0),
          ...(admissions.length ? { admissions: admissions.splice(0) } : {}),
          receiver: receiver.stats,
        })
        if (round === texts.length - 1) old = reading.capture.retain()
        await window.semanticServiceMemoryCheckpoint?.('hashed', round, receiver.stats)
      } finally {
        reading.capture.release()
      }
    }
    const renderOptions = preview.renderOptions()
    preview.suspend()
    service.dispose()
    await window.semanticServiceMemoryCheckpoint?.('worker-disposed', revision, receiver.stats)
    assert(
      old?.identity.revision === texts.length - 1,
      'Worker disposal revoked independent reading consumer',
    )
    old.release()
    old = undefined
    return { kind: 'accepted', workers, workerFailures, options: renderOptions, rounds }
  } catch (error) {
    return {
      kind: 'rejected',
      error: String(error),
      workers,
      workerFailures,
      rounds,
      receiver: receiver.stats,
    }
  } finally {
    Reflect.deleteProperty(globalThis, admissionHook)
    old?.release()
    ui.release()
    publications.close()
    view?.destroy()
    preview.dispose()
    service.dispose()
    receiver.dispose()
    assert(receiver.stats.retainedBytes === 0, 'Application diagnostic leaked receiver ownership')
    await window.semanticServiceMemoryCheckpoint?.('disposed', revision, receiver.stats)
    if (profilingRevision !== undefined)
      await window.semanticServiceProbePhase?.('stop', profilingRevision)
  }
}
