import type { PackedCapture } from '../../core/src/packing-capture'
import type { PackedSource } from '../../core/src/packing-source'
import type { PackedRootValidationLimits } from '../../core/src/packing-validate-root'
import type { PackedPath } from '../../core/src/packing-view'
import type { PackedWork } from '../../core/src/packing-work'
import type { PackedWorkspace } from '../../core/src/packing-workspace'
import { TranslationError, type TranslationUnit, type UnitKind } from './contracts'
import { type ExtractionCost, ExtractionMemory } from './extraction-memory'
import {
  inspectPackedTranslationUnits,
  type PackedExtractionCost,
  type PackedExtractionResult,
} from './packed-extract'
import { PackedTranslationProjection } from './packed-projection'

export interface PackedTranslationPlanLimits extends PackedRootValidationLimits {
  /** Persistent metadata/payload allowance, reserved out of retained before extraction. */
  metadata: number
}
export type PackedTranslationOccurrence = Readonly<
  Omit<TranslationUnit, 'bindings' | 'path'> & { readonly path: readonly number[] }
>
export interface PackedTranslationPlanCost extends ExtractionCost {
  readonly extraction: Readonly<PackedExtractionResult>
}
interface PlanData {
  capture: PackedCapture
  source: PackedSource
  root: PackedPath
  limits: PackedRootValidationLimits
  units: readonly PackedTranslationOccurrence[]
  cost: Readonly<PackedTranslationPlanCost>
  budget: PackedWorkspace
}
type Inspector = (
  unit: Readonly<TranslationUnit>,
  occurrence: PackedTranslationOccurrence,
  cost: Readonly<PackedExtractionCost>,
) => Generator<void>

/** Experimental persistent plan: one independently pinned immutable revision plus frozen
 * provider-safe payloads/occurrence metadata. No native root, subtree or binding is retained.
 * units is a trusted borrow: consumers must end raw borrows before release/session disposal
 * or independently admit their lifetime. Closing the plan revokes active inspection work.
 */
export class PackedTranslationPlan {
  #data: PlanData | undefined
  #lifetime: PackedWork<void> | undefined
  /** Internal construction; use buildPackedTranslationPlan for admission and validation. */
  constructor(data: PlanData) {
    this.#data = data
    const plan = this
    this.#lifetime = data.capture.work(
      (function* () {
        try {
          yield
        } finally {
          plan.release()
        }
      })(),
    )
    this.#lifetime.next()
    Object.freeze(this)
  }
  #current(): PlanData {
    const data = this.#data
    if (!data) throw new Error('Packed translation plan released')
    data.capture.identity
    return data
  }
  get units(): readonly PackedTranslationOccurrence[] {
    return this.#current().units
  }
  get cost(): Readonly<PackedTranslationPlanCost> {
    return this.#current().cost
  }
  /** Re-read each private unit from the same pinned revision in one ordered scan, avoiding
   * random child-path lookups and their quadratic cost on wide roots. Full validation and
   * logical limits remain mandatory. The callback cannot retain bindings without admitting
   * them independently. Plan metadata and the complete transient workspace coexist.
   */
  inspectUnits(inspect: Inspector): PackedWork<PackedExtractionResult> {
    if (typeof inspect !== 'function') throw new Error('Invalid packed plan inspector')
    const data = this.#current()
    return data.capture.work(inspectPlan(data, inspect))
  }
  /** Project separately admitted exact native blocks without retaining native bindings.
   * Metadata/source borrowing, reconstruction scratch and cancellation share this pin.
   * The inspector owns native conversion/output admission in addition to these limits.
   */
  inspectProjection(
    resolve: (unit: PackedTranslationOccurrence) => unknown,
    limits: { retained: number; staging: number },
    inspect: (projection: PackedTranslationProjection) => Generator<void>,
  ): PackedWork<void> {
    const data = this.#current()
    const budget = { ...limits }
    if (
      typeof resolve !== 'function' ||
      typeof inspect !== 'function' ||
      [budget.retained, budget.staging].some((bytes) => !Number.isSafeInteger(bytes) || bytes < 0)
    )
      throw new Error('Invalid packed translation projection')
    return data.capture.work(
      (function* () {
        const workspace = data.capture.reserveWorkspace(0, 0)
        let projection: PackedTranslationProjection | undefined
        try {
          projection = new PackedTranslationProjection(
            data.source.text,
            data.units,
            resolve,
            (retained, staging) => {
              if (retained + staging > budget.retained || staging > budget.staging)
                throw new Error('Packed translation projection exceeds workspace limit')
              workspace.resize(retained + staging, staging)
            },
          )
          yield* inspect(projection)
        } finally {
          projection?.close()
          workspace.release()
        }
      })(),
    )
  }
  release(): void {
    const data = this.#data
    this.#data = undefined
    const lifetime = this.#lifetime
    this.#lifetime = undefined
    try {
      lifetime?.return()
    } finally {
      try {
        data?.capture.release()
      } finally {
        data?.budget.release()
      }
    }
  }
}

/** Validate the complete root and build a separately revocable payload-only plan. Metadata
 * admission happens before retention. Its maximum allowance is removed from the extractor's
 * retained limit, so all phases (including native copying) fit the combined local ceiling.
 * The shared session ledger additionally admits the source/arena and other live captures.
 * Cancellation or failure drops the unfinished plan and independently pinned revision.
 */
export function buildPackedTranslationPlan(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  limits: PackedTranslationPlanLimits,
  occurrence: (range: { from: number; to: number; kind: UnitKind }) => string = () =>
    crypto.randomUUID(),
): PackedWork<PackedTranslationPlan> {
  capture.reader.at(root)
  if (typeof occurrence !== 'function') throw new Error('Invalid packed plan occurrence')
  const checked = { ...limits }
  for (const value of Object.values(checked))
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid packed plan limits')
  if (checked.metadata < 4096 || checked.metadata > checked.retained)
    throw new Error('Invalid packed plan metadata limit')
  return capture.work(build(capture, source, [...root], checked, occurrence))
}

function* build(
  parent: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  limits: PackedTranslationPlanLimits,
  occurrence: (range: { from: number; to: number; kind: UnitKind }) => string,
): Generator<void, PackedTranslationPlan> {
  const capture = parent.retain()
  let budget: PackedWorkspace | undefined
  let published = false
  try {
    budget = capture.reserveWorkspace(4096, 0)
    const reservation = budget
    const scratch = 2 * 1024 * 1024
    const memory = new ExtractionMemory(
      { retained: limits.metadata + scratch, staging: scratch },
      false,
      (bytes) => {
        if (bytes > limits.metadata) throw new Error('Packed plan exceeds metadata limit')
        reservation.resize(bytes, 0)
      },
    )
    const units: PackedTranslationOccurrence[] = []
    const extractionLimits = {
      retained: limits.retained - limits.metadata,
      staging: limits.staging,
      nodes: limits.nodes,
      depth: limits.depth,
    }
    const extraction: PackedExtractionResult | undefined = yield* inspectPackedTranslationUnits(
      capture,
      source,
      root,
      extractionLimits,
      function* (unit) {
        memory.charge(384 + unit.occurrenceId.length * 2 + unit.path.length * 8)
        const payload = unit.payload
          ? memory.intern(unit.payload, JSON.stringify(unit.payload), unit.bindings)
          : null
        units.push(
          Object.freeze({
            occurrenceId: unit.occurrenceId,
            kind: unit.kind,
            from: unit.from,
            to: unit.to,
            path: Object.freeze([...unit.path]),
            payload,
            error: unit.error,
          }),
        )
        yield
      },
      occurrence,
    )
    if (!extraction || extraction.units !== units.length) throw new Error('Packed plan cancelled')
    const cost = memory.cost
    const plan = new PackedTranslationPlan({
      capture,
      source,
      root: Object.freeze(root),
      limits: Object.freeze(extractionLimits),
      units: Object.freeze(units),
      cost: Object.freeze({
        ...cost,
        stagingBytes: extraction.stagingPeakBytes,
        peakBytes: cost.retainedBytes + extraction.retainedPeakBytes,
        extraction,
      }),
      budget,
    })
    published = true
    return plan
  } finally {
    if (!published) {
      capture.release()
      budget?.release()
    }
  }
}

function* inspectPlan(data: PlanData, inspect: Inspector): Generator<void, PackedExtractionResult> {
  let nextId = 0,
    index = 0
  const extraction: PackedExtractionResult | undefined = yield* inspectPackedTranslationUnits(
    data.capture,
    data.source,
    data.root,
    data.limits,
    function* (unit, cost) {
      const occurrence = data.units[index++]
      if (
        !occurrence ||
        unit.path.length !== occurrence.path.length ||
        unit.path.some((part, at) => part !== occurrence.path[at]) ||
        unit.error !== occurrence.error ||
        JSON.stringify(unit.payload) !== JSON.stringify(occurrence.payload)
      )
        throw new TranslationError('translation-invalid')
      yield* inspect(unit, occurrence, cost)
    },
    ({ from, to, kind }) => {
      const occurrence = data.units[nextId++]
      if (
        !occurrence ||
        from !== occurrence.from ||
        to !== occurrence.to ||
        kind !== occurrence.kind
      )
        throw new TranslationError('translation-invalid')
      return occurrence.occurrenceId
    },
  )
  if (!extraction || index !== data.units.length || nextId !== index)
    throw new TranslationError('translation-invalid')
  return extraction
}
