import { type Nodes, utf8Bytes } from '@manuslip/core'
import { TranslationError, type TranslationStatus, translationLimits } from './contracts'
import { UnitExtraction } from './extract-unit'
import type { PackedTranslationOccurrence } from './packed-plan'
import { reconstructUnit, validateTranslation } from './reconstruct'

interface ProjectionData {
  source: string
  units: readonly PackedTranslationOccurrence[]
  indexes: Map<string, number>
  values: (string | undefined)[]
  outputs: Map<string, string>
  statuses: TranslationStatus[]
  retained: number
  staging: number
  stage(bytes: number): void
}
const key = (kind: string, from: number | undefined, to: number | undefined) =>
  `${kind}:${from}:${to}`

/** Internal borrowed projection over an immutable validated packed plan. Only metadata,
 * output references and statuses persist. Native blocks must be exact independently
 * admitted copies of that plan's revision; each children() call re-creates its own private
 * bindings. Returned children must be consumed in the admitted native rendering phase.
 * A plan-owned inspector closes this object before ending its raw metadata/source borrow.
 */
export class PackedTranslationProjection {
  #data: ProjectionData | undefined
  constructor(
    source: string,
    units: readonly PackedTranslationOccurrence[],
    resolve: (unit: PackedTranslationOccurrence) => unknown,
    reserve: (retained: number, staging: number) => void,
  ) {
    const retained = 4096 + units.length * 768
    reserve(retained, 0)
    const data: ProjectionData = {
      source,
      units,
      retained,
      indexes: new Map(),
      values: [],
      outputs: new Map(),
      statuses: [],
      staging: 0,
      stage: (bytes) => {
        reserve(data.retained, bytes)
        data.staging = bytes
      },
    }
    this.#data = data
    let outputBytes = 0
    try {
      for (const unit of units) {
        const index = data.statuses.length
        const identity = key(unit.kind, unit.from, unit.to)
        if (data.indexes.has(identity)) throw new TranslationError('translation-invalid')
        data.indexes.set(identity, index)
        data.statuses.push(unit.error ? 'limit' : 'missing')
        data.values.push(undefined)
        const value = resolve(unit)
        if (unit.error || !unit.payload || value === undefined) continue
        data.stage(
          65536 +
            (typeof value === 'string' ? value.length * 12 : 0) +
            unit.payload.tokens.length * 1024,
        )
        try {
          validateTranslation(unit.payload, value)
          const bytes = utf8Bytes(value as string)
          if (outputBytes + bytes > translationLimits.reconstructed)
            throw new TranslationError('translation-output-large')
          let canonical = data.outputs.get(value as string)
          if (canonical === undefined) {
            const next = data.retained + 128 + (value as string).length * 2
            reserve(next, data.staging)
            data.retained = next
            canonical = value as string
            data.outputs.set(canonical, canonical)
          }
          outputBytes += bytes
          data.values[index] = canonical
          data.statuses[index] = 'translated'
        } catch (error) {
          if (!(error instanceof TranslationError)) throw error
          data.statuses[index] = error.code === 'translation-output-large' ? 'limit' : 'invalid'
        } finally {
          data.stage(0)
        }
      }
    } catch (error) {
      this.close()
      throw error
    }
  }
  #current(): ProjectionData {
    if (!this.#data) throw new Error('Packed translation projection closed')
    return this.#data
  }
  get retainedBytes(): number {
    return this.#current().retained
  }
  status(index: number): TranslationStatus {
    return this.#current().statuses[index] ?? 'missing'
  }
  /** nativeBytes bounds the caller-owned complete native block/context containing node.
   * The projection scratch remains admitted until reset(), after native consumption ends.
   * HAST/output allocation has its own enclosing owner and is not included here.
   */
  children(node: Nodes, nativeBytes: number): Nodes[] | undefined {
    const data = this.#current()
    if (!Number.isSafeInteger(nativeBytes) || nativeBytes < 0)
      throw new Error('Invalid packed projection native allowance')
    const index = data.indexes.get(
      key(node.type, node.position?.start.offset, node.position?.end.offset),
    )
    if (index === undefined || data.statuses[index] !== 'translated') return
    const occurrence = data.units[index],
      value = data.values[index]
    if (!occurrence || value === undefined) throw new TranslationError('translation-invalid')
    let scratch =
      2 * 1024 * 1024 +
      nativeBytes * 2 +
      65536 +
      value.length * 12 +
      (occurrence.payload?.tokens.length ?? 0) * 1024
    data.stage(scratch)
    const unit = new UnitExtraction().unit(
      node,
      data.source,
      [...occurrence.path],
      occurrence.path.length,
      () => occurrence.occurrenceId,
    )
    if (
      !unit ||
      unit.error !== occurrence.error ||
      unit.from !== occurrence.from ||
      unit.to !== occurrence.to ||
      JSON.stringify(unit.payload) !== JSON.stringify(occurrence.payload)
    )
      throw new TranslationError('translation-invalid')
    const charge = (bytes: number) => {
      scratch += bytes
      data.stage(scratch)
    }
    return reconstructUnit(unit, value, {
      charge,
      branch(node, children) {
        const keys = Reflect.ownKeys(node)
        if (keys.length > 128) throw new TranslationError('translation-invalid')
        charge(192 + keys.length * 64)
        const descriptors = Object.getOwnPropertyDescriptors(node)
        descriptors.children = {
          value: children,
          enumerable: true,
          writable: true,
          configurable: true,
        }
        return Object.create(Object.getPrototypeOf(node), descriptors)
      },
    })
  }
  reset(): void {
    this.#current().stage(0)
  }
  close(): void {
    this.#data = undefined
  }
}
