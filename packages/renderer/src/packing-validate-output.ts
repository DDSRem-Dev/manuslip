import { semanticLimits } from '../../core/src/contracts'
import type {
  PackedCapture,
  PackedItemSteps,
  PackedReadScope,
} from '../../core/src/packing-capture'
import { finishPackedCleanup } from '../../core/src/packing-cleanup'
import type { PackedDocumentBaseline } from '../../core/src/packing-document-baseline'
import type { PackedRecordKey } from '../../core/src/packing-record-key'
import type { PackedSource } from '../../core/src/packing-source'
import { packedTextStepCost } from '../../core/src/packing-text-stream'
import {
  invalidPackedSemantic,
  packedInteger,
  packedKeys,
  packedSmall,
  validationStreamLimits,
} from '../../core/src/packing-validation-read'
import type { PackedWork } from '../../core/src/packing-work'
import type { CollectedProjectionContext } from './collected-projection-context'
import type { ProjectionLimits } from './fragment-projection-context'
import type { RenderOptions } from './index'
import { PackedHtmlCursor } from './packed-html-cursor'
import type { PackedProjectionBaseline } from './packed-projection-baseline'
import { packedDocumentContextPrune } from './packed-projection-definitions'
import { packedProjectionOutputInspectionSteps } from './packed-projection-output'
import {
  type PackedProjectionPaths,
  packedProjectionSchemaSteps,
} from './packing-validate-projection'

interface WidgetIndex {
  index: number
  seen: boolean
  key: PackedRecordKey | undefined
}
function* nextItem(items: PackedItemSteps): Generator<void, PackedReadScope | undefined> {
  while (true) {
    const next = items.next()
    if (next.done) return undefined
    if (next.value !== undefined) return next.value
    yield
  }
}
function* equalNative(
  scope: PackedReadScope,
  field: 'html' | 'value',
  value: string,
): Generator<void> {
  if (scope.textLength([field]) !== value.length) invalidPackedSemantic()
  const cursor = new PackedHtmlCursor(scope.textSteps([field], validationStreamLimits))
  let failed = false
  try {
    yield* cursor.equal(value)
    yield* cursor.finish(value.length)
  } catch (error) {
    failed = true
    throw error
  } finally {
    finishPackedCleanup([() => cursor.close()], failed)
  }
}
/** Exact renderer equivalence, including widget completeness and every HTML/value unit.
 * Composes projection/layout schema and supplied widget/source correspondence with the
 * exact comparison's complete span/visibility/separator checks, avoiding a duplicate walk. Complete
 * document/root validation must precede this helper, as in validatePackedSnapshot. It does
 * not establish fresh-parser equivalence or authorize unsanitized DOM installation.
 */
export function validatePackedProjectionOutput(
  capture: PackedCapture,
  source: PackedSource,
  paths: PackedProjectionPaths,
  options: RenderOptions,
  limits: ProjectionLimits,
  baseline?: PackedProjectionBaseline,
  documentBaseline?: PackedDocumentBaseline,
): PackedWork<void> {
  return capture.work(
    packedProjectionOutputSteps(
      capture,
      source,
      paths,
      options,
      limits,
      baseline,
      documentBaseline,
    ),
  )
}

/** Internal validation steps; an enclosing capture-owned task must own and close them. */
export function packedProjectionOutputSteps(
  capture: PackedCapture,
  source: PackedSource,
  paths: PackedProjectionPaths,
  options: RenderOptions,
  limits: ProjectionLimits,
  baseline?: PackedProjectionBaseline,
  documentBaseline?: PackedDocumentBaseline,
  collected?: CollectedProjectionContext,
): Generator<void> {
  for (const path of [paths.root, paths.projection, paths.layout]) {
    capture.reader.at(path)
    if (path.length > 64) throw new Error('Invalid packed projection output path')
  }
  const copied = {
    root: [...paths.root],
    projection: [...paths.projection],
    layout: [...paths.layout],
  }
  const work = outputSteps(
    capture,
    source,
    copied,
    { ...options },
    { ...limits },
    baseline,
    documentBaseline,
    collected,
  )
  return (function* () {
    let failed = false
    try {
      while (true) {
        capture.identity
        const next = work.next()
        capture.identity
        if (next.done) return
        yield
      }
    } catch (error) {
      failed = true
      throw error
    } finally {
      finishPackedCleanup([() => work.return(undefined)], failed)
    }
  })()
}

function* outputSteps(
  capture: PackedCapture,
  source: PackedSource,
  paths: PackedProjectionPaths,
  options: RenderOptions,
  limits: ProjectionLimits,
  baseline?: PackedProjectionBaseline,
  documentBaseline?: PackedDocumentBaseline,
  collected?: CollectedProjectionContext,
): Generator<void> {
  yield* packedProjectionSchemaSteps(capture, source, paths, options, limits)
  const reusable = baseline?.compatible(capture, source, options) ? baseline : undefined
  const documentPrune = packedDocumentContextPrune(
    capture,
    source,
    paths.root,
    limits,
    documentBaseline,
  )
  const projection = capture.reader.at(paths.projection)
  const layout = capture.reader.at(paths.layout)
  const size = projection.length(['blocks'])
  const htmlLength = projection.textLength(['html'])
  const bodyEnd = packedInteger(layout, ['bodyEnd'], htmlLength)
  const sourceLength = source.text.length - Number(source.text.charCodeAt(0) === 0xfeff)
  const bytes =
    32768 +
    (paths.root.length + paths.layout.length + paths.projection.length + 8) * 512 +
    size * (reusable ? 512 : 256)
  // One persistent HTML decoder and at most one widget HTML/value decoder coexist with
  // owned rendering. A lookup owns the supplied array once, including out-of-order notes.
  const streams = (size ? 2 : 1) + Number(reusable !== undefined)
  const streamRetained =
    streams * (packedTextStepCost.retained + packedTextStepCost.workspace + 512)
  const streamStaging = streams * packedTextStepCost.workspace
  if (bytes + streamRetained + 16 * 512 > limits.retained || bytes + streamStaging > limits.staging)
    throw new Error('Packed output comparison exceeds workspace limit')
  const workspace = capture.workspace(bytes, bytes)
  const widgets = new Map<string, WidgetIndex>()
  let failed = false
  try {
    yield* capture.inspectArraySteps(
      [...paths.projection, 'blocks'],
      {
        retained: limits.retained - bytes,
        staging: limits.staging - bytes,
        items: semanticLimits.blocks,
      },
      function* (lookup, cost) {
        for (let index = 0; index < lookup.length; index++) {
          const scope = lookup.at(index)
          const from = packedInteger(scope, ['from'], sourceLength)
          const to = packedInteger(scope, ['to'], sourceLength)
          widgets.set(`${from}:${to}`, {
            index,
            seen: false,
            key: reusable ? scope.recordKey() : undefined,
          })
          yield
        }
        const remaining = {
          ...limits,
          retained: limits.retained - bytes - cost.retainedBytes - streamRetained - 16 * 512,
          staging: limits.staging - bytes - cost.stagingBytes - streamStaging,
        }
        let html: PackedHtmlCursor | undefined
        let spans: PackedItemSteps | undefined
        let oldHtml: PackedHtmlCursor | undefined
        let widgetHtml: PackedHtmlCursor | undefined
        let widgetLength = 0
        let activeWidget: WidgetIndex | undefined
        let contextVerified: boolean | undefined
        let at = 0
        let visible = false
        let children = 0
        let spanEnd: number | undefined
        let failed = false
        try {
          html = new PackedHtmlCursor(projection.textSteps(['html'], validationStreamLimits))
          spans = layout.elementSteps(['blocks'])
          const cursor = html
          const blocks = spans
          function* beginBodySpan(index: number, currentVisible: boolean): Generator<void> {
            const span = yield* nextItem(blocks)
            if (!span || index !== children++) invalidPackedSemantic()
            packedKeys(span, [], ['from', 'to', 'visible'])
            const from = at + Number(visible && currentVisible)
            spanEnd = packedInteger(span, ['to'], htmlLength)
            if (
              packedSmall(span, ['from']) !== from ||
              packedSmall(span, ['visible']) !== currentVisible
            )
              invalidPackedSemantic()
            if (visible && currentVisible) {
              yield* cursor.equal('\n')
              at++
            }
            visible ||= currentVisible
          }
          function* bodySpan(
            index: number,
            currentVisible: boolean,
            length: number,
          ): Generator<void> {
            yield* beginBodySpan(index, currentVisible)
            if (spanEnd !== at + length) invalidPackedSemantic()
          }
          yield* packedProjectionOutputInspectionSteps(
            capture,
            source,
            paths.root,
            options,
            remaining,
            {
              chunks: function* (event) {
                if (event.kind === 'begin') {
                  if (event.footer) {
                    if (at !== bodyEnd || event.index !== children || (yield* nextItem(blocks)))
                      invalidPackedSemantic()
                    spanEnd = htmlLength
                  } else yield* beginBodySpan(event.index, event.visible)
                } else if (event.kind === 'html') {
                  yield* cursor.equal(event.value)
                  at += event.value.length
                  if (at > htmlLength) invalidPackedSemantic()
                } else if (event.kind === 'widget') {
                  const block = event.block
                  const widget = widgets.get(`${block.from}:${block.to}`)
                  if (!widget || widget.seen || widgetHtml) invalidPackedSemantic()
                  const scope = lookup.at(widget.index)
                  if (packedSmall(scope, ['kind']) !== block.kind) invalidPackedSemantic()
                  yield* equalNative(scope, 'value', block.value)
                  widgetLength = scope.textLength(['html'])
                  widgetHtml = new PackedHtmlCursor(
                    scope.textSteps(['html'], validationStreamLimits),
                  )
                  activeWidget = widget
                } else if (event.kind === 'widget-html') {
                  if (!widgetHtml) invalidPackedSemantic()
                  yield* widgetHtml.equal(event.value)
                } else if (event.kind === 'widget-end') {
                  if (!widgetHtml || !activeWidget || widgetHtml.position !== widgetLength)
                    invalidPackedSemantic()
                  yield* widgetHtml.finish(widgetLength)
                  const completed = widgetHtml
                  widgetHtml = undefined
                  completed.close()
                  activeWidget.seen = true
                  activeWidget = undefined
                } else if (event.kind === 'end') {
                  if (at !== spanEnd || widgetHtml) invalidPackedSemantic()
                  spanEnd = undefined
                }
              },
            },
            reusable
              ? function* (node, index, context) {
                  contextVerified ??= yield* reusable.sameContext(context)
                  const match = reusable.find(node, contextVerified)
                  if (!match || match.block.htmlFrom < (oldHtml?.position ?? 0)) return false
                  const { block, offset } = match
                  for (const previous of block.widgets) {
                    const widget = widgets.get(`${previous.from + offset}:${previous.to + offset}`)
                    const key = widget?.key
                    if (
                      !widget ||
                      widget.seen ||
                      !key ||
                      key.token !== previous.key.token ||
                      key.record !== previous.key.record ||
                      key.offset !== previous.key.offset ||
                      key.range - previous.key.range !== offset
                    )
                      return false
                    yield
                  }
                  const length = block.htmlTo - block.htmlFrom
                  yield* bodySpan(index, block.visible, length)
                  oldHtml ??= reusable.openHtml()
                  for (const step of oldHtml.skip(block.htmlFrom)) {
                    reusable.assertOpen()
                    yield step
                  }
                  for (const step of cursor.equalCursor(oldHtml, length)) {
                    reusable.assertOpen()
                    yield step
                  }
                  at += length
                  if (at > htmlLength) invalidPackedSemantic()
                  for (const previous of block.widgets) {
                    const widget = widgets.get(`${previous.from + offset}:${previous.to + offset}`)
                    if (!widget || widget.seen) invalidPackedSemantic()
                    widget.seen = true
                    yield
                  }
                  return true
                }
              : undefined,
            reusable
              ? (node) => reusable.contextFree(node) ?? documentPrune?.(node)
              : documentPrune,
            collected,
          )
          if (at !== htmlLength) invalidPackedSemantic()
          yield* cursor.finish(htmlLength)
          for (const widget of widgets.values()) {
            if (!widget.seen) invalidPackedSemantic()
            yield
          }
        } catch (error) {
          failed = true
          throw error
        } finally {
          finishPackedCleanup(
            [
              () => html?.close(),
              () => oldHtml?.close(),
              () => widgetHtml?.close(),
              () => spans?.return(),
            ],
            failed,
          )
        }
      },
    )
  } catch (error) {
    failed = true
    throw error
  } finally {
    widgets.clear()
    finishPackedCleanup([() => workspace.release()], failed)
  }
}
