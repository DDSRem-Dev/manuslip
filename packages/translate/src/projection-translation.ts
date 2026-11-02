import { type Nodes, utf8Bytes } from '@manuslip/core'
import {
  TranslationError,
  type TranslationPlan,
  type TranslationStatus,
  type TranslationUnit,
  translationLimits,
} from './contracts'
import { reconstructUnit } from './reconstruct'

const statuses: TranslationStatus[] = ['missing', 'translated', 'invalid', 'limit']
/** Synchronous projection of an immutable plan. Retain occurrence indexes/statuses and
 * admitted output references; reconstruct one inline unit at a time, never ancestor paths.
 * The caller must consume returned children synchronously without retaining an mdast graph.
 * Aliased unit nodes require path-aware reconstruction instead and return null.
 */
export function projectTranslation(
  plan: TranslationPlan,
  resolve: (unit: Readonly<TranslationUnit>) => unknown,
  limits: { retained: number; staging: number },
) {
  for (const value of [limits.retained, limits.staging])
    if (!Number.isSafeInteger(value) || value < 0) throw new TranslationError('translation-invalid')
  if (plan.units.length > translationLimits.units) throw new TranslationError('translation-limit')
  const base = 4096 + plan.units.length * 145
  let peakBytes = base,
    stagingBytes = 0,
    outputBytes = 0
  const admit = (scratch: number) => {
    if (base + scratch > limits.retained || scratch > limits.staging)
      throw new TranslationError('translation-limit')
    peakBytes = Math.max(peakBytes, base + scratch)
    stagingBytes = Math.max(stagingBytes, scratch)
  }
  admit(0)
  const indexes = new WeakMap<Nodes, number>()
  const values: (string | undefined)[] = new Array(plan.units.length)
  const codes = new Uint8Array(plan.units.length)
  const reconstruct = (unit: TranslationUnit, value: unknown): Nodes[] => {
    let bytes =
      65536 +
      (unit.path.length + 1) * 1024 +
      (unit.payload?.tokens.length ?? 0) * 1024 +
      (typeof value === 'string' ? value.length * 12 : 0)
    admit(bytes)
    const charge = (cost: number) => {
      bytes += cost
      admit(bytes)
    }
    return reconstructUnit(unit, value, {
      charge,
      branch(node, children) {
        const keys = Reflect.ownKeys(node)
        if (keys.length > 128) throw new TranslationError('translation-invalid')
        charge(128 + keys.length * 64 + 64)
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
  for (let index = 0; index < plan.units.length; index++) {
    const unit = plan.units[index]
    if (!unit) throw new TranslationError('translation-invalid')
    const value = resolve(unit)
    codes[index] = unit.error ? 3 : 0
    try {
      if (
        unit.path.length > translationLimits.depth ||
        unit.path.some((index) => !Number.isSafeInteger(index) || index < 0)
      )
        throw new TranslationError('translation-invalid')
      let node: Nodes = plan.root
      for (const index of unit.path) {
        if (!('children' in node) || !node.children[index])
          throw new TranslationError('translation-invalid')
        node = node.children[index]
      }
      if (node.type !== unit.kind || !('children' in node))
        throw new TranslationError('translation-invalid')
      if (indexes.has(node)) return null
      indexes.set(node, index)
      if (unit.error || value === undefined) continue
      reconstruct(unit, value)
      const bytes = utf8Bytes(value as string)
      if (outputBytes + bytes > translationLimits.reconstructed)
        throw new TranslationError('translation-output-large')
      outputBytes += bytes
      values[index] = value as string
      codes[index] = 1
    } catch (error) {
      if (error instanceof TranslationError && error.code === 'translation-limit') throw error
      codes[index] =
        error instanceof TranslationError && error.code === 'translation-output-large' ? 3 : 2
    }
  }
  return Object.freeze({
    get peakBytes() {
      return peakBytes
    },
    get stagingBytes() {
      return stagingBytes
    },
    status(index: number): TranslationStatus {
      return statuses[codes[index] ?? 0] ?? 'missing'
    },
    children(node: Nodes): Nodes[] | undefined {
      const index = indexes.get(node)
      if (index === undefined) return
      const unit = plan.units[index],
        value = values[index]
      if (!unit || value === undefined) return
      return reconstruct(unit, value)
    },
  })
}
