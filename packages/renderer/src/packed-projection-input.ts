import type { PackedCapture } from '../../core/src/packing-capture'
import { finishPackedCleanup } from '../../core/src/packing-cleanup'
import type { PackedEncodingLimits } from '../../core/src/packing-encode-budget'
import { PackedArrayInput, packedArrayPause } from '../../core/src/packing-input-array'
import { PackedCaptureInput } from '../../core/src/packing-input-capture'
import {
  packedInteger,
  packedKeys,
  validationStreamLimits,
} from '../../core/src/packing-validation-read'
import { PackedWork } from '../../core/src/packing-work'
import type { ProjectionLimits } from './fragment-projection-context'
import { type PackedWidgetRange, PackedWidgetRanges } from './packed-widget-ranges'

export interface PackedProjectionInput {
  readonly projection: unknown
  readonly layout: unknown
  readonly arrays: readonly PackedArrayInput[]
  readonly captures: readonly PackedCaptureInput[]
  close(): void
}

/** Private section plan over the complete, validated event spool. The parked inspector
 * owns its compact lookup until encoding closes the plan. No joined HTML or native
 * widget array is constructed. The caller transfers both input lists to one encoder.
 */
export function preparePackedProjectionInputSteps(
  spool: PackedCapture,
  encoding: PackedEncodingLimits,
  limits: ProjectionLimits,
): PackedWork<PackedProjectionInput> {
  const budget = { ...limits }
  const nodes = encoding.nodes
  const metadata = spool.reserveWorkspace(65536, 65536)
  let inspection: PackedWork<void> | undefined
  let input: PackedCaptureInput | undefined
  let blocks: PackedArrayInput | undefined
  let ranges: PackedWidgetRanges | undefined
  let plan: PackedProjectionInput | undefined
  let delivered = false
  const cleanup = () =>
    finishPackedCleanup([
      () => blocks?.return(),
      () => inspection?.return(),
      () => ranges?.clear(false),
      () => input?.return(),
      () => metadata.release(),
    ])
  return new PackedWork(
    (function* () {
      packedKeys(spool.reader, [], ['events', 'layout', 'timings', 'rendererVersion'])
      inspection = spool.inspectArray(
        ['events'],
        {
          retained: budget.retained,
          staging: budget.staging,
          items: nodes,
          compact: true,
        },
        function* (lookup) {
          const widgets = new PackedWidgetRanges(spool.sourceResource.text.length, (bytes) =>
            metadata.resize(bytes, 65536),
          )
          ranges = widgets
          let current: PackedWidgetRange | undefined
          for (let i = 0; i < lookup.length; i++) {
            const event = lookup.at(i)
            if (event.hasField('widget')) {
              if (current) throw new Error('Invalid packed widget order')
              packedKeys(event, [], ['widget'])
              packedKeys(event, ['widget'], ['kind', 'value', 'from', 'to'], ['syntax'])
              current = {
                from: packedInteger(event, ['widget', 'from'], spool.sourceResource.text.length),
                to: packedInteger(event, ['widget', 'to'], spool.sourceResource.text.length),
                first: i,
                last: -1,
              }
              if (current.to < current.from) throw new Error('Invalid packed widget range')
            } else if (event.hasField('widgetEnd')) {
              packedKeys(event, [], ['widgetEnd'])
              if (!current || event.scalar(['widgetEnd'], { retained: 16, staging: 0 }) !== true)
                throw new Error('Invalid packed widget end')
              current.last = i
              yield* widgets.setSteps(current)
              current = undefined
            } else if (event.hasField('widgetHtml')) {
              packedKeys(event, [], ['widgetHtml'])
              if (!current) throw new Error('Invalid packed widget HTML')
            } else packedKeys(event, [], ['html'])
            yield
          }
          if (current) throw new Error('Incomplete packed widget')
          const readSpool = new PackedCaptureInput(spool, true)
          input = readSpool
          const text = function* (key: 'html' | 'widgetHtml', first: number, last: number) {
            for (let i = first; i < last; i++) {
              const event = lookup.at(i)
              if (event.hasField(key)) yield* event.textSteps([key], validationStreamLimits)
              else yield undefined
            }
          }
          blocks = new PackedArrayInput(
            (function* () {
              for (const widget of widgets.values()) {
                if (!widget) {
                  yield packedArrayPause
                  continue
                }
                const value: Record<string, unknown> = {}
                const reader = lookup.at(widget.first).at(['widget'])
                for (const key of reader.keys([], { retained: 4096, staging: 0 }))
                  value[key] = readSpool.read(reader.at([key]))
                value.html = readSpool.text(() => text('widgetHtml', widget.first + 1, widget.last))
                yield value
              }
            })(),
            () => widgets.clear(),
          )
          plan = Object.freeze({
            projection: {
              html: readSpool.text(() => text('html', 0, lookup.length)),
              blocks,
              renderMs: readSpool.at(['timings', 'renderMs']),
              rendererVersion: readSpool.at(['rendererVersion']),
            },
            layout: readSpool.at(['layout']),
            arrays: [blocks],
            captures: [readSpool],
            close: cleanup,
          })
          // The section encoder consumes borrowed lookup scopes while this inspector is
          // parked. Its close path revokes the entire delegation chain, including queued work.
          while (true) yield
        },
      )
      while (!plan) {
        if (inspection.next().done) throw new Error('Incomplete packed projection input')
        yield
      }
      delivered = true
      return plan
    })(),
    () => {
      if (!delivered) cleanup()
    },
  )
}
