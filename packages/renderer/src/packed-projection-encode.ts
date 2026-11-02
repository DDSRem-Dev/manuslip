import { packStreamedValueSteps } from '../../core/src/packing'
import type { PackedCapture } from '../../core/src/packing-capture'
import { finishPackedCleanup } from '../../core/src/packing-cleanup'
import type { PackedEncodingLimits } from '../../core/src/packing-encode-budget'
import { PackedArrayInput, packedArrayPause } from '../../core/src/packing-input-array'
import type { PackedSource } from '../../core/src/packing-source'
import type { PackedValue } from '../../core/src/packing-value'
import type { PackedPath } from '../../core/src/packing-view'
import type { PackedWork } from '../../core/src/packing-work'
import type { CollectedProjectionContext } from './collected-projection-context'
import type { ProjectionLimits } from './fragment-projection-context'
import { type RenderOptions, rendererVersion } from './index'
import { packedProjectionOutputInspectionSteps } from './packed-projection-output'
import { bufferProjectionChunks } from './projection-chunk-buffer'
import type { ProjectionChunkEvent } from './projection-owned-chunks'

interface Span {
  from: number
  to: number
  visible: boolean
}
export interface PackedProjectionEncoding {
  readonly payload: ArrayBuffer
  readonly bodyEnd: number
  readonly htmlLength: number
  readonly blocks: number
}
type Event =
  | { html: string }
  | { widget: Extract<ProjectionChunkEvent, { kind: 'widget' }>['block'] }
  | { widgetHtml: string }
  | { widgetEnd: true }

/** Internal render spool. Compose complete SemanticDocument validation first. All HTML
 * and widget HTML stays in bounded chunks; layout metadata, render state, encoding and
 * independently owned output share the capture's session. No native root or joined HTML
 * is created. The private event packet must be assembled into the public projection shape.
 */
export function encodePackedProjectionSteps(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  options: RenderOptions,
  limits: ProjectionLimits,
  encoding: PackedEncodingLimits,
  byteLimit: number,
): PackedWork<PackedValue<PackedProjectionEncoding>> {
  const work = createPackedProjectionEncoding(
    capture,
    source,
    root,
    options,
    limits,
    encoding,
    byteLimit,
  )
  try {
    return capture.work(work.steps, work.close)
  } catch (error) {
    finishPackedCleanup([work.close], true)
    throw error
  }
}

/** Internal encoding borrow. The enclosing capture-owned task must delegate its steps
 * immediately and call close even if they never start. Collected context remains owned
 * by its validation transaction through the entire borrow.
 */
export function createPackedProjectionEncoding(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  options: RenderOptions,
  limits: ProjectionLimits,
  encoding: PackedEncodingLimits,
  byteLimit: number,
  collected?: CollectedProjectionContext,
): {
  steps: Generator<void, PackedValue<PackedProjectionEncoding>, undefined>
  close(): void
} {
  capture.reader.at(root)
  const path = [...root]
  const render = { ...options }
  const budget = { ...limits }
  const encodedBudget = { ...encoding }
  const layout = { blocks: undefined as PackedArrayInput | undefined, bodyEnd: 0, htmlLength: 0 }
  const timings = { renderMs: 0 }
  let spans: Span[] = []
  let pending: ProjectionChunkEvent | undefined
  let outgoing: Event | undefined
  let child: Generator<void, void, undefined> | undefined
  let spanCount = 0
  let at = 0
  let start = 0
  let visible = false
  let footer = false
  let blockVisible = false
  let complete = false
  // The outer buffer may retain text across body blocks and widget events. Its lease
  // is separate from the renderer's own per-body buffer/borrow admission.
  const buffer = capture.reserveWorkspace(128 * 1024, 128 * 1024)
  let metadata: ReturnType<PackedCapture['reserveWorkspace']>
  let allocation: ReturnType<PackedCapture['reserveWorkspace']>
  try {
    metadata = capture.reserveWorkspace(0, 0)
    try {
      allocation = capture.reserveWorkspace(0, 0)
    } catch (error) {
      metadata.release()
      throw error
    }
  } catch (error) {
    buffer.release()
    throw error
  }
  let events: PackedWork<unknown, Event | typeof packedArrayPause> | undefined
  let spanWork: PackedWork<unknown, Span> | undefined
  let eventInput: PackedArrayInput | undefined
  let spanInput: PackedArrayInput | undefined
  let encoded: PackedWork<ArrayBuffer> | undefined
  const cleanup = () =>
    finishPackedCleanup([
      () => encoded?.return(),
      () => eventInput?.return(),
      () => spanInput?.return(),
      () => events?.return(),
      () => spanWork?.return(),
      () => buffer.release(),
      () => metadata.release(),
      () => allocation.release(),
    ])
  const html = function* (): Generator<string | undefined> {
    // The enclosing event iterator owns this private borrow. Its finally closes
    // the render generator after an active advance has unwound, including cancellation.
    child = packedProjectionOutputInspectionSteps(
      capture,
      source,
      path,
      render,
      budget,
      {
        *chunks(event) {
          pending = event
          try {
            yield
          } finally {
            pending = undefined
          }
        },
      },
      undefined,
      undefined,
      collected,
    )
    try {
      while (true) {
        const before = performance.now()
        const next = child.next()
        timings.renderMs += performance.now() - before
        if (next.done) {
          if (!footer) throw new Error('Incomplete packed projection footer')
          layout.htmlLength = at
          complete = true
          return
        }
        const event = pending
        if (!event) {
          yield
          continue
        }
        switch (event.kind) {
          case 'begin':
            footer = event.footer
            blockVisible = event.visible
            if (event.index !== spanCount) throw new Error('Invalid packed projection block order')
            if (footer) layout.bodyEnd = at
            else {
              if (blockVisible && visible) {
                at++
                yield '\n'
              }
              start = at
            }
            break
          case 'html':
            if (footer || blockVisible) {
              at += event.value.length
              yield event.value
            }
            break
          case 'widget':
            outgoing = { widget: event.block }
            yield
            outgoing = undefined
            break
          case 'widget-html':
            outgoing = { widgetHtml: event.value }
            yield
            outgoing = undefined
            break
          case 'widget-end':
            outgoing = { widgetEnd: true }
            yield
            outgoing = undefined
            break
          case 'end':
            if (!footer) {
              metadata.resize(1024 + (spanCount + 1) * 256, 0)
              spans.push({ from: start, to: at, visible: blockVisible })
              spanCount++
              if (blockVisible) visible = true
            }
            break
        }
        yield
      }
    } finally {
      const renderWork = child
      child = undefined
      renderWork?.return(undefined)
    }
  }
  try {
    events = capture.work(
      (function* (): Generator<Event | typeof packedArrayPause> {
        for (const value of bufferProjectionChunks(html())) {
          if (value !== undefined) yield { html: value }
          else if (outgoing) yield outgoing
          else yield packedArrayPause
        }
        if (!complete) throw new Error('Incomplete packed projection output')
      })(),
      () => {
        pending = undefined
        outgoing = undefined
        buffer.release()
      },
    )
    spanWork = capture.work(
      (function* () {
        if (!complete) throw new Error('Incomplete packed projection layout')
        yield* spans
      })(),
      () => {
        spans = []
        metadata.release()
      },
    )
    spanInput = new PackedArrayInput(spanWork)
    layout.blocks = spanInput
    eventInput = new PackedArrayInput(events)
    encoded = packStreamedValueSteps(
      { events: eventInput, layout, timings, rendererVersion },
      byteLimit,
      encodedBudget,
      [eventInput, spanInput],
      (bytes) => allocation.resize(bytes + 256, 0),
    )
    const work = encoded
    return {
      steps: (function* () {
        const payload = yield* work
        if (!payload || !complete) throw new Error('Incomplete packed projection encoding')
        const value = Object.freeze({
          payload,
          bodyEnd: layout.bodyEnd,
          htmlLength: layout.htmlLength,
          blocks: spanCount,
        })
        // Exchange the admitted result for independent native output synchronously.
        allocation.resize(0, 0)
        return capture.own(value, payload.byteLength + 256)
      })(),
      close: cleanup,
    }
  } catch (error) {
    finishPackedCleanup([cleanup], true)
    throw error
  }
}
