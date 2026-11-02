import { messageSize, sourceHash } from '@manuslip/core'
import {
  type ReadingBlock,
  readingBlocks,
  readingProjectionBytes,
  renderReading,
} from '@manuslip/renderer/reading'
import {
  capabilitiesFor,
  extractTranslation,
  prepareTranslation,
  projectTranslation,
  reconstructSharedTranslation,
  type TranslationPayload,
  type TranslationPlan,
  type TranslationSettings,
  validateTranslation,
} from '@manuslip/translate'
import { readingJsonBytes } from '../../../../../../packages/renderer/src/reading-bytes'
import { PackedReadingProcessor } from './packed-engine'
import type { ReadingWireValue } from './prepared-wire'
import { sharedReadingPrepared } from './prepared-wire'
import {
  type ReadingOperation,
  type ReadingUnit,
  type ReadingValue,
  readingLimits,
  readingOperationBytes,
} from './protocol'

/** Owns one immutable semantic capture. Never reparses Markdown or exports bindings. */
export class ReadingProcessor {
  private packed: PackedReadingProcessor | undefined
  private busy = false
  private cleared = false
  private plan: TranslationPlan | null = null
  private keys = new Map<TranslationPayload, string>()
  private readonly outputs = new Map<string, string>()
  private readonly payloads = new Map<string, TranslationPayload>()
  private bytes = 0
  private planPeakBytes = 0
  private blocks: ReadingBlock[] = []
  private settings: Pick<TranslationSettings, 'sourceLanguage' | 'targetLanguage'> | null = null
  /** Weighted ownership diagnostics; decoding has its own independent admission phase. */
  get stats(): Readonly<{
    retainedBytes: number
    planPeakBytes: number
    payloadKeys: number
    blockStoreBytes: number
  }> {
    if (this.packed) return Object.freeze(this.packed.stats)
    return Object.freeze({
      retainedBytes: this.bytes,
      planPeakBytes: this.planPeakBytes,
      payloadKeys: this.keys.size,
      blockStoreBytes: 0,
    })
  }
  /** Trusted local borrow, owned through the next operation or clear. Worker callers use
   * respond so publication and structured-clone admission finish before releasing it. */
  async execute(operation: ReadingOperation): Promise<ReadingValue> {
    return this.invoke(operation, (value) => value)
  }
  async respond(
    operation: ReadingOperation,
    sequence: number,
    send: (response: { sequence: number; value: ReadingWireValue }) => void,
  ): Promise<void> {
    return this.invoke(operation, (value) => {
      if (this.packed) this.packed.publish(value, sequence, send)
      else {
        const response = {
          sequence,
          value: value.kind === 'prepared' ? sharedReadingPrepared(value).value : value,
        }
        if (readingJsonBytes(response) > readingLimits.message)
          throw new Error('translation-view-limit')
        send(response)
      }
    })
  }
  private async invoke<T>(
    operation: ReadingOperation,
    consume: (value: ReadingValue) => T,
  ): Promise<T> {
    if (this.busy) throw new Error('translation-view-worker')
    if (operation.kind !== 'render') this.clear()
    this.busy = true
    this.cleared = false
    try {
      this.packed?.releaseResponse()
      if (readingOperationBytes(operation) > readingLimits.message)
        throw new Error('translation-view-limit')
      let value: ReadingValue
      if (operation.kind === 'prepare-packed') {
        this.packed = new PackedReadingProcessor()
        value = await this.packed.prepare(operation)
      } else if (operation.kind === 'prepare') value = await this.prepare(operation)
      else value = this.packed ? this.packed.render(operation) : this.render(operation)
      if (this.cleared) {
        this.clear()
        throw new Error('translation-view-worker')
      }
      return consume(value)
    } catch (error) {
      if (operation.kind !== 'render') this.clear()
      if (error instanceof Error && /limit|exceeds/.test(error.message)) {
        throw new Error('translation-view-limit', { cause: error })
      }
      if (
        operation.kind === 'prepare-packed' &&
        !(error instanceof Error && /^translation-/.test(error.message))
      )
        throw new Error('translation-view-worker', { cause: error })
      throw error
    } finally {
      this.busy = false
      if (this.cleared) this.packed = undefined
    }
  }
  private async prepare(
    operation: Extract<ReadingOperation, { kind: 'prepare' }>,
  ): Promise<ReadingValue> {
    const plan = extractTranslation(operation.root, operation.source)
    const blocks = readingBlocks(operation.root, operation.source)
    this.blocks = blocks
    const baseBytes = messageSize(plan) * 2 + messageSize(blocks) * 2
    if (baseBytes > readingLimits.worker) throw new Error('translation-view-limit')
    this.settings = {
      sourceLanguage: operation.settings.sourceLanguage,
      targetLanguage: operation.settings.targetLanguage,
    }
    const prepared = await prepareTranslation(
      plan,
      operation.settings,
      capabilitiesFor(operation.settings.provider.adapter),
    )
    const units: ReadingUnit[] = plan.units.map((unit) => ({
      occurrenceId: unit.occurrenceId,
      kind: unit.kind,
      from: unit.from,
      to: unit.to,
      hash: sourceHash(operation.source.slice(unit.from, unit.to)),
      key: prepared.occurrences.get(unit.occurrenceId) ?? null,
      payload: unit.payload,
    }))
    for (const job of prepared.jobs) this.payloads.set(job.key, job.payload)
    for (const unit of units) if (unit.payload && unit.key) this.keys.set(unit.payload, unit.key)
    const bytes = baseBytes + messageSize(units) * 2
    if (bytes > readingLimits.worker) throw new Error('translation-view-limit')
    const result = { kind: 'prepared' as const, units, blocks }
    sharedReadingPrepared(result)
    this.planPeakBytes = this.bytes = bytes
    this.plan = plan
    return result
  }
  private render(operation: Extract<ReadingOperation, { kind: 'render' }>): ReadingValue {
    const plan = this.plan
    if (!plan || !this.settings) throw new Error('translation-view-worker')
    for (const entry of operation.outputs) {
      const payload = this.payloads.get(entry.key)
      if (!payload) throw new Error('translation-view-worker')
      validateTranslation(payload, entry.output)
      const previous = this.outputs.get(entry.key)
      const bytes = entry.output.length * 2 - (previous?.length ?? 0) * 2
      if (this.bytes + bytes > readingLimits.worker) throw new Error('translation-view-limit')
      this.outputs.set(entry.key, entry.output)
      this.bytes += bytes
    }
    const remaining = readingLimits.worker - this.bytes - readingLimits.message
    if (remaining < 0) throw new Error('translation-view-limit')
    const resolve = (unit: Readonly<(typeof plan.units)[number]>) =>
      this.outputs.get(unit.payload ? (this.keys.get(unit.payload) ?? '') : '')
    const limits = {
      retained: remaining,
      staging: Math.min(remaining, readingLimits.message),
    }
    const projected = projectTranslation(plan, resolve, limits)
    const rebuilt = projected ? null : reconstructSharedTranslation(plan, resolve, limits)
    const translated = new Set<string>()
    // Reconstruction emits exactly one status per plan unit, in the same order.
    for (let index = 0; index < plan.units.length; index++) {
      const status = projected?.status(index) ?? rebuilt?.statuses[index]?.status,
        unit = plan.units[index]
      if (status === 'translated' && unit) translated.add(`${unit.from}:${unit.to}`)
    }
    const projection = renderReading(plan.root, rebuilt?.root ?? plan.root, operation.options, {
      layout: operation.layout ?? 'replace',
      blocks: operation.blocks ?? this.blocks,
      sourceLanguage: this.settings.sourceLanguage,
      targetLanguage: this.settings.targetLanguage,
      labels: operation.labels ?? { original: 'Original', translation: 'Translation' },
      translated,
      units: plan.units,
      children: projected?.children,
      indexAboveBytes: readingLimits.projection,
    })
    if (readingProjectionBytes(projection) > readingLimits.projection)
      throw new Error('translation-view-limit', { cause: 'projection' })
    return { kind: 'rendered', projection }
  }
  clear(): void {
    this.cleared = true
    this.packed?.clear()
    if (!this.busy) this.packed = undefined
    this.plan = null
    this.keys.clear()
    this.outputs.clear()
    this.payloads.clear()
    this.bytes = 0
    this.planPeakBytes = 0
    this.blocks = []
    this.settings = null
  }
}
