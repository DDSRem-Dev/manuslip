import type { PackedCapture } from '../../core/src/packing-capture'
import { finishPackedCleanup } from '../../core/src/packing-cleanup'
import { PackedArrayInput } from '../../core/src/packing-input-array'
import { PackedCaptureInput } from '../../core/src/packing-input-capture'
import type { PackedSource } from '../../core/src/packing-source'
import type { PackedPath } from '../../core/src/packing-view'
import type { CollectedProjectionContext } from './collected-projection-context'
import type { ProjectionLimits } from './fragment-projection-context'
import { type RenderOptions, rendererVersion } from './index'
import type { PackedProjectionInput } from './packed-projection-input'
import { PackedProjectionJournal } from './packed-projection-journal'
import { packedProjectionOutputInspectionSteps } from './packed-projection-output'
import { bufferProjectionChunks } from './projection-chunk-buffer'
import type { ProjectionChunkEvent } from './projection-owned-chunks'

export interface PackedProjectionPlan extends PackedProjectionInput {
  readonly renderMs: number
}

/** Internal render borrow. The enclosing validator delegates immediately and closes
 * this factory even before its first advance. A delivered plan owns its independent
 * capture, journal and single-use inputs until encoding completes or it is closed.
 */
export function createPackedProjectionPlan(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  options: RenderOptions,
  limits: ProjectionLimits,
  collected?: CollectedProjectionContext,
): { steps: Generator<void, PackedProjectionPlan, undefined>; close(): void } {
  const owned = capture.retain()
  let journal: PackedProjectionJournal | undefined
  let buffer: ReturnType<PackedCapture['reserveWorkspace']> | undefined
  let child: Generator<void> | undefined
  let pending: ProjectionChunkEvent | undefined
  let input: PackedCaptureInput | undefined
  let blocks: PackedArrayInput | undefined
  let spans: PackedArrayInput | undefined
  let delivered = false
  const cleanup = () =>
    finishPackedCleanup([
      () => child?.return(undefined),
      () => blocks?.return(),
      () => spans?.return(),
      () => input?.return(),
      () => journal?.close(),
      () => buffer?.release(),
      () => owned.release(),
    ])
  try {
    // Keep both clock reads around each child advance; resolve the native receiver once.
    const now = performance.now.bind(performance)
    journal = new PackedProjectionJournal(owned, limits.retained)
    buffer = owned.reserveWorkspace(128 * 1024, 128 * 1024)
    const storage = journal
    let at = 0,
      start = 0,
      bodyEnd = 0,
      count = 0,
      visible = false,
      footer = false,
      blockVisible = false,
      renderMs = 0
    let current: number | undefined
    const html = (): IterableIterator<string | undefined> => {
      // Buffering reads this private iterator synchronously. Source-free progress
      // records can be reused without allocating a generator result for every step.
      const progress = Object.freeze({ done: false as const, value: undefined })
      const done = Object.freeze({ done: true as const, value: undefined })
      let closed = false
      let afterOutput: 'newline' | 'html' | undefined
      let widget: Generator<void, number, undefined> | undefined
      const close = (failed = false) => {
        if (closed) return
        closed = true
        const work = child,
          writing = widget
        child = undefined
        widget = undefined
        pending = undefined
        current = undefined
        finishPackedCleanup(
          [() => writing?.return(undefined as never), () => work?.return(undefined)],
          failed,
        )
      }
      const iterator: IterableIterator<string | undefined> = {
        [Symbol.iterator]: () => iterator,
        next() {
          if (closed) return done
          try {
            // Match the suspension after a yielded HTML piece or block separator.
            if (afterOutput) {
              if (afterOutput === 'newline') start = at
              afterOutput = undefined
              return progress
            }
            if (widget) {
              const next = widget.next()
              if (next.done) {
                current = next.value
                widget = undefined
              }
              return progress
            }
            child ??= packedProjectionOutputInspectionSteps(
              capture,
              source,
              root,
              options,
              limits,
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
            const before = now()
            const next = child.next()
            renderMs += now() - before
            if (next.done) {
              if (!footer || current !== undefined)
                throw new Error('Incomplete packed projection output')
              close()
              return done
            }
            const event = pending
            if (!event) return progress
            switch (event.kind) {
              case 'begin':
                footer = event.footer
                blockVisible = event.visible
                if (event.index !== count) throw new Error('Invalid packed projection block order')
                if (footer) bodyEnd = at
                else {
                  if (blockVisible && visible) {
                    at++
                    afterOutput = 'newline'
                    return { done: false, value: '\n' }
                  }
                  start = at
                }
                break
              case 'html':
                if (footer || blockVisible) {
                  at += event.value.length
                  afterOutput = 'html'
                  return { done: false, value: event.value }
                }
                break
              case 'widget':
                if (current !== undefined) throw new Error('Invalid packed projection widget order')
                widget = storage.widget(event.block)
                {
                  const next = widget.next()
                  if (next.done) {
                    current = next.value
                    widget = undefined
                  }
                }
                break
              case 'widget-html':
                if (current === undefined) throw new Error('Invalid packed projection widget HTML')
                storage.widgetHtml(event.value)
                break
              case 'widget-end':
                if (current === undefined) throw new Error('Invalid packed projection widget end')
                storage.endWidget(current)
                current = undefined
                break
              case 'end':
                if (!footer) {
                  storage.span(start, at, blockVisible)
                  count++
                  if (blockVisible) visible = true
                }
                break
            }
            return progress
          } catch (error) {
            close(true)
            throw error
          }
        },
        return() {
          close()
          return done
        },
        throw(error) {
          close(true)
          throw error
        },
      }
      return iterator
    }
    return {
      steps: (function* () {
        for (const value of bufferProjectionChunks(html())) {
          if (value !== undefined) storage.html(value)
          yield
        }
        buffer?.release()
        input = new PackedCaptureInput(owned, true)
        const captured = input
        blocks = new PackedArrayInput(storage.blocks(captured, source.text.length), () =>
          storage.releaseText(),
        )
        spans = new PackedArrayInput(storage.spans(), () => storage.releaseSpans())
        const plan = Object.freeze({
          projection: {
            html: captured.text(() => storage.text()),
            blocks,
            renderMs,
            rendererVersion,
          },
          layout: { blocks: spans, bodyEnd, htmlLength: at },
          arrays: [blocks, spans],
          captures: [captured],
          renderMs,
          close: cleanup,
        })
        delivered = true
        return plan
      })(),
      close() {
        if (!delivered) cleanup()
      },
    }
  } catch (error) {
    finishPackedCleanup([cleanup], true)
    throw error
  }
}
