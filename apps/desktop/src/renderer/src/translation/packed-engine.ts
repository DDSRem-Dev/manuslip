import { sourceHash } from '@manuslip/core'
import { readingBudgets } from '@manuslip/core/reading-limits'
import { rendererVersion } from '@manuslip/renderer'
import { type ReadingBlock, readingProjectionBytes } from '@manuslip/renderer/reading'
import {
  capabilitiesFor,
  prepareCanonicalTranslation,
  type TranslationPayload,
  validateTranslation,
} from '@manuslip/translate'
import type { PackedCapture } from '../../../../../../packages/core/src/packing-capture'
import type { PackedHold } from '../../../../../../packages/core/src/packing-hold'
import { PackedSession } from '../../../../../../packages/core/src/packing-session'
import { PackedSource } from '../../../../../../packages/core/src/packing-source'
import { finishPackedSteps } from '../../../../../../packages/core/src/packing-work'
import type { PackedWorkspace } from '../../../../../../packages/core/src/packing-workspace'
import { assertPackedProjectionOptions } from '../../../../../../packages/renderer/src/packed-projection-state'
import { inspectPackedReading } from '../../../../../../packages/renderer/src/packed-reading'
import type { PackedReadingOutput } from '../../../../../../packages/renderer/src/packed-reading-output'
import { readingJsonBytes } from '../../../../../../packages/renderer/src/reading-bytes'
import {
  buildPackedTranslationPlan,
  type PackedTranslationPlan,
} from '../../../../../../packages/translate/src/packed-plan'
import { CompactReadingBlocks } from './compact-blocks'
import { type ReadingWireValue, sharedReadingPrepared } from './prepared-wire'
import {
  type ReadingOperation,
  type ReadingUnit,
  type ReadingValue,
  readingLimits,
} from './protocol'

const MiB = 1024 * 1024
const limits = {
  retained: 48 * MiB,
  metadata: 8 * MiB,
  staging: readingBudgets.workspace,
  nodes: 800000,
  depth: 64,
}
const hashScratch = 2 * MiB
type Prepare = Extract<ReadingOperation, { kind: 'prepare-packed' }>
type Render = Extract<ReadingOperation, { kind: 'render' }>

/** Dedicated-worker ownership. The incoming buffer becomes the arena; native roots and
 * private bindings never persist. Response borrows end at publication or the next request.
 * During an asynchronous hash, cancellation keeps its admitted owner until that job settles.
 */
export class PackedReadingProcessor {
  private readonly owner = new PackedSession({
    retained: readingLimits.worker,
    staging: limits.staging,
    bytes: readingLimits.message,
    captures: 8,
    readers: 160,
  })
  private source: PackedSource | undefined
  private capture: PackedCapture | undefined
  private plan: PackedTranslationPlan | undefined
  private blocks: CompactReadingBlocks | undefined
  private keys = new Map<TranslationPayload, string>()
  private readonly payloads = new Map<string, TranslationPayload>()
  private readonly outputs = new Map<string, string>()
  private outputBytes = 4096
  private outputTextBytes = 0
  private retained: PackedWorkspace | undefined
  private records: PackedWorkspace | undefined
  private input: PackedWorkspace | undefined
  private incoming: PackedHold | undefined
  private output: PackedReadingOutput | undefined
  private preparedWire: ReturnType<typeof sharedReadingPrepared> | undefined
  private settings: { sourceLanguage: string; targetLanguage: string } | undefined
  private preparing = true
  private stopped = false
  private peakBytes = 0

  get stats() {
    return {
      retainedBytes: this.owner.stats.retainedBytes,
      planPeakBytes: this.peakBytes,
      payloadKeys: this.keys.size,
      blockStoreBytes: this.blocks?.bytes ?? 0,
    }
  }
  private active() {
    if (this.stopped) throw new Error('translation-view-worker')
  }
  private observe() {
    this.peakBytes = Math.max(this.peakBytes, this.owner.stats.retainedBytes)
  }
  async prepare(operation: Prepare): Promise<ReadingValue> {
    try {
      if (operation.identity.rendererVersion !== rendererVersion)
        throw new Error('translation-view-worker')
      const envelope =
        65536 + readingJsonBytes({ identity: operation.identity, settings: operation.settings }) * 2
      const key = {}
      this.incoming = this.owner.retain({ resources: () => [{ key, bytes: envelope }] })
      this.source = new PackedSource(operation.identity, operation.source)
      const options = JSON.parse(this.source.identity.options)
      assertPackedProjectionOptions(options)
      if (JSON.stringify(options) !== this.source.identity.options)
        throw new Error('translation-view-worker')
      this.owner.commit(
        this.owner.prepareFull(
          this.owner.beginPrepared(this.source),
          this.source.identity,
          operation.payload,
        ),
      )
      const capture = this.owner.capture()
      this.capture = capture
      this.owner.evict()
      const base = this.owner.stats.retainedBytes
      const plan = finishPackedSteps(buildPackedTranslationPlan(capture, this.source, [], limits))
      if (!plan) throw new Error('translation-view-worker')
      this.plan = plan
      this.peakBytes = Math.max(this.peakBytes, base + plan.cost.peakBytes)
      const count = capture.reader.length(['children']) + 1
      const store = CompactReadingBlocks.reservation(count)
      this.retained = capture.reserveWorkspace(store + 4096 + plan.cost.uniquePayloads * 1024, 0)
      // Native public records and the later shared-wire occurrence records coexist.
      const records = count * 768 + plan.units.length * 1024 + 65536
      this.records = capture.reserveWorkspace(
        records + hashScratch + plan.cost.payloadBytes * 2,
        hashScratch,
      )
      this.observe()
      const blocks = this.readBlocks()
      this.blocks = new CompactReadingBlocks(blocks, store)
      const keys = operation.settings
        ? await prepareCanonicalTranslation(
            plan,
            operation.settings,
            capabilitiesFor(operation.settings.provider.adapter),
            () => this.active(),
          ).then((prepared) => prepared.keys)
        : new Map<TranslationPayload, string>()
      this.active()
      this.keys = keys
      for (const [payload, key] of keys) this.payloads.set(key, payload)
      const units: ReadingUnit[] = plan.units.map((unit) => ({
        occurrenceId: unit.occurrenceId,
        kind: unit.kind,
        from: unit.from,
        to: unit.to,
        hash: sourceHash(operation.source.slice(unit.from, unit.to)),
        key: unit.payload ? (keys.get(unit.payload) ?? null) : null,
        payload: operation.settings ? unit.payload : null,
      }))
      this.settings = {
        sourceLanguage: operation.settings?.sourceLanguage ?? 'auto',
        targetLanguage: operation.settings?.targetLanguage ?? '',
      }
      const value = { kind: 'prepared' as const, units, blocks }
      // Validate the actual complete descriptor representation under its existing cap.
      this.preparedWire = sharedReadingPrepared(value)
      this.records.resize(records, 0)
      this.observe()
      return value
    } catch (error) {
      this.stopped = true
      throw error
    } finally {
      this.preparing = false
      if (this.stopped) this.dispose()
    }
  }
  private readBlocks(): ReadingBlock[] {
    const capture = this.capture,
      source = this.source
    if (!capture || !source) throw new Error('translation-view-worker')
    const result: ReadingBlock[] = []
    const items = capture.reader.elementSteps(['children'])
    let notes = false
    try {
      for (const item of items) {
        if (!item) continue
        const kind = item.scalar(['type'], { retained: 4096, staging: 8192 })
        if (typeof kind !== 'string') throw new Error('translation-view-worker')
        notes ||= kind === 'footnoteDefinition'
        if (!item.hasField('position')) continue
        const position = item.position(['position'], { retained: 272, staging: 0 })
        const from = position.start.offset,
          to = position.end.offset
        if (from !== undefined && to !== undefined)
          result.push({
            id: crypto.randomUUID(),
            kind,
            from,
            to,
            hash: sourceHash(source.text.slice(from, to)),
          })
      }
    } finally {
      items.return()
    }
    if (notes)
      result.push({
        id: crypto.randomUUID(),
        kind: 'footnotes',
        from: source.text.length,
        to: source.text.length,
        hash: 'footnotes',
      })
    return result
  }
  render(operation: Render): ReadingValue {
    this.active()
    const capture = this.capture,
      source = this.source,
      plan = this.plan,
      blocks = this.blocks,
      settings = this.settings
    if (!capture || !source || !plan || !blocks || !settings || !this.retained)
      throw new Error('translation-view-worker')
    this.releaseResponse()
    const store =
      CompactReadingBlocks.reservation(blocks.count) + 4096 + plan.cost.uniquePayloads * 1024
    this.input = capture.reserveWorkspace(
      65536 +
        readingJsonBytes({ ...operation, blocks: undefined }) * 2 +
        (operation.blocks?.length ?? blocks.count) * 768,
      0,
    )
    try {
      for (const entry of operation.outputs) {
        const payload = this.payloads.get(entry.key)
        if (!payload) throw new Error('translation-view-worker')
        const scratch = 65536 + entry.output.length * 12 + payload.tokens.length * 1024
        this.retained.resize(store + this.outputBytes + scratch, scratch)
        this.observe()
        try {
          validateTranslation(payload, entry.output)
          const textBytes =
            this.outputTextBytes +
            entry.output.length * 2 -
            (this.outputs.get(entry.key)?.length ?? 0) * 2
          if (textBytes > readingLimits.outputs) throw new Error('translation-view-limit')
          const next =
            this.outputBytes +
            (this.outputs.has(entry.key) ? 0 : 512) +
            entry.output.length * 2 -
            (this.outputs.get(entry.key)?.length ?? 0) * 2
          this.retained.resize(store + next, 0)
          this.outputs.set(entry.key, entry.output)
          this.outputBytes = next
          this.outputTextBytes = textBytes
        } finally {
          this.retained.resize(store + this.outputBytes, 0)
        }
      }
      // Validated strings now belong to outputs; the request borrows those same
      // strings rather than retaining a second backing store during projection.
      this.input.resize(
        65536 +
          readingJsonBytes({ ...operation, outputs: [], blocks: undefined }) * 2 +
          (operation.blocks?.length ?? blocks.count) * 768,
        0,
      )
      let value: ReadingValue | undefined
      const processor = this
      finishPackedSteps(
        plan.inspectProjection(
          (unit) => this.outputs.get(unit.payload ? (this.keys.get(unit.payload) ?? '') : ''),
          { ...limits, borrowOutputs: true },
          function* (projected) {
            const translated = new Set(
              plan.units
                .filter((_, index) => projected.status(index) === 'translated')
                .map((unit) => `${unit.from}:${unit.to}`),
            )
            yield* inspectPackedReading(
              capture,
              source,
              [],
              operation.options,
              {
                layout: operation.layout ?? 'replace',
                blocks: operation.blocks ?? blocks.snapshot(),
                units: plan.units,
                translated,
                sourceLanguage: settings.sourceLanguage,
                targetLanguage: settings.targetLanguage,
                labels: operation.labels ?? { original: 'Original', translation: 'Translation' },
                indexAboveBytes: readingLimits.message,
              },
              limits,
              projected,
              function* (_projection, cost, retain) {
                processor.observe()
                processor.output = retain()
                value = { kind: 'rendered', projection: processor.output.value }
                if (cost.retainedPeakBytes > limits.retained)
                  throw new Error('translation-view-limit')
                yield
              },
            )
          },
        ),
      )
      if (!value) throw new Error('translation-view-worker')
      this.observe()
      return value
    } catch (error) {
      this.releaseResponse()
      throw error
    }
  }
  /** The wrapper calls this while native response records/output are still owned. */
  publish(
    value: ReadingValue,
    sequence: number,
    send: (response: { sequence: number; value: ReadingWireValue }) => void,
  ): void {
    const capture = this.capture
    if (!capture) throw new Error('translation-view-worker')
    let copies: PackedWorkspace | undefined
    try {
      const shared = value.kind === 'prepared' ? this.preparedWire : undefined
      if (value.kind === 'prepared' && !shared) throw new Error('translation-view-worker')
      const response = { sequence, value: shared?.value ?? (value as ReadingWireValue) }
      if (
        readingJsonBytes(response) >
        (value.kind === 'rendered' ? readingLimits.response : readingLimits.message)
      )
        throw new Error('translation-view-limit')
      const bytes =
        4096 +
        (shared?.bytes ??
          (value.kind === 'rendered' ? readingProjectionBytes(value.projection) : 0))
      copies = capture.reserveWorkspace(bytes, bytes)
      this.observe()
      send(response)
    } finally {
      copies?.release()
      this.releaseResponse()
    }
  }
  releaseResponse(): void {
    this.preparedWire = undefined
    this.output?.release()
    this.output = undefined
    this.records?.release()
    this.records = undefined
    this.input?.release()
    this.input = undefined
    this.incoming?.release()
    this.incoming = undefined
  }
  clear(): void {
    this.stopped = true
    if (!this.preparing) this.dispose()
  }
  private dispose(): void {
    try {
      this.owner.dispose()
    } finally {
      this.source = undefined
      this.capture = undefined
      this.plan = undefined
      this.blocks = undefined
      this.retained = undefined
      this.releaseResponse()
      this.keys.clear()
      this.payloads.clear()
      this.outputs.clear()
      this.settings = undefined
    }
  }
}
