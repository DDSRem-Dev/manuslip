import { packStreamedValueSteps } from '../../core/src/packing'
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
import type { PackedValue } from '../../core/src/packing-value'
import type { PackedWork } from '../../core/src/packing-work'
import type { ProjectionLimits } from './fragment-projection-context'
import { type PackedWidgetRange, PackedWidgetRanges } from './packed-widget-ranges'
export interface PackedSnapshotEncoding {
  readonly payload: ArrayBuffer
}

/** Assemble the private chunk spool and complete document into the public snapshot.
 * Readers stream through the ordinary canonical record encoder. Native values are
 * bounded frames/chunks plus the admitted widget range map, never a full tree/HTML.
 * Both captures, inspection, metadata and output use the same existing session owner.
 */
export function encodePackedSnapshotSteps(
  document: PackedCapture,
  spool: PackedCapture,
  byteLimit: number,
  encoding: PackedEncodingLimits,
  limits: ProjectionLimits,
): PackedWork<PackedValue<PackedSnapshotEncoding>> {
  if (!document.sameOwner(spool) || document.sourceResource !== spool.sourceResource)
    throw new Error('Packed snapshot inputs require the same owner and source')
  const budget = { ...limits }
  const encodedBudget = { ...encoding }
  const metadata = document.reserveWorkspace(65536, 65536)
  let allocation: ReturnType<PackedCapture['reserveWorkspace']>
  try {
    allocation = document.reserveWorkspace(0, 0)
  } catch (error) {
    metadata.release()
    throw error
  }
  let inspection: PackedWork<void> | undefined
  let encoded: PackedWork<ArrayBuffer> | undefined
  let documentInput: PackedCaptureInput | undefined
  let spoolInput: PackedCaptureInput | undefined
  let blocks: PackedArrayInput | undefined
  let owned: PackedValue<PackedSnapshotEncoding> | undefined
  let delivered = false
  let ranges: PackedWidgetRanges | undefined
  const cleanup = () =>
    finishPackedCleanup([
      () => encoded?.return(),
      () => blocks?.return(),
      () => inspection?.return(),
      () => ranges?.clear(false),
      () => documentInput?.return(),
      () => spoolInput?.return(),
      () => metadata.release(),
      () => allocation.release(),
      () => {
        if (!delivered) owned?.release()
      },
    ])
  try {
    return document.work(
      (function* () {
        packedKeys(spool.reader, [], ['events', 'layout', 'timings', 'rendererVersion'])
        inspection = spool.inspectArray(
          ['events'],
          {
            retained: budget.retained,
            staging: budget.staging,
            items: encodedBudget.nodes,
            compact: true,
          },
          function* (lookup) {
            const widgets = new PackedWidgetRanges(document.sourceResource.text.length, (bytes) =>
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
                  from: packedInteger(
                    event,
                    ['widget', 'from'],
                    document.sourceResource.text.length,
                  ),
                  to: packedInteger(event, ['widget', 'to'], document.sourceResource.text.length),
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
            documentInput = new PackedCaptureInput(document, true)
            spoolInput = new PackedCaptureInput(spool, true)
            const readDocument = documentInput
            const readSpool = spoolInput
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
                  value.html = readSpool.text(() =>
                    text('widgetHtml', widget.first + 1, widget.last),
                  )
                  yield value
                }
              })(),
              () => widgets.clear(),
            )
            encoded = packStreamedValueSteps(
              {
                document: readDocument.at(),
                projection: {
                  html: readSpool.text(() => text('html', 0, lookup.length)),
                  blocks,
                  renderMs: readSpool.at(['timings', 'renderMs']),
                  rendererVersion: readSpool.at(['rendererVersion']),
                },
                layout: readSpool.at(['layout']),
              },
              byteLimit,
              encodedBudget,
              [blocks],
              (bytes) => allocation.resize(bytes + 256, 0),
              [readDocument, readSpool],
            )
            const payload = yield* encoded
            if (!payload) throw new Error('Incomplete packed snapshot encoding')
            allocation.resize(0, 0)
            owned = document.own(Object.freeze({ payload }), payload.byteLength + 256)
          },
        )
        yield* inspection
        if (!owned) throw new Error('Missing packed snapshot encoding')
        delivered = true
        return owned
      })(),
      cleanup,
    )
  } catch (error) {
    finishPackedCleanup([cleanup], true)
    throw error
  }
}
