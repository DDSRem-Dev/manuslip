import type { Nodes, Root } from '@manuslip/core'
import { utf8Bytes } from '@manuslip/core/text'
import {
  type ReconstructedDocument,
  TranslationError,
  type TranslationPlan,
  type TranslationUnit,
  translationLimits,
} from './contracts'
import { reconstructUnit } from './reconstruct'

type Parent = Extract<Nodes, { children: unknown }>
interface Patch {
  children?: Parent['children']
  branches: Map<number, Patch>
}
export interface SharedReconstruction extends ReconstructedDocument {
  /** Conservative new-output plus transient patch/workspace charge; source graph is shared. */
  retainedBytes: number
  stagingBytes: number
}

/** Immutable worker-local reconstruction. Share every untouched node/protected binding and
 * copy only changed paths. The caller must keep the captured plan immutable for the entire
 * output lifetime. Preserve property descriptors/prototypes so lazy positions stay lazy.
 * All new graph/patch/workspace allocations are admitted before construction. These weights
 * are conservative admission estimates, not portable heap calibration or renderer costs.
 */
export function reconstructSharedTranslation(
  plan: TranslationPlan,
  outputs:
    | Pick<ReadonlyMap<string, unknown>, 'get'>
    | ((unit: Readonly<TranslationUnit>) => unknown),
  limits: { retained: number; staging: number },
): SharedReconstruction {
  for (const value of [limits.retained, limits.staging])
    if (!Number.isSafeInteger(value) || value < 0) throw new TranslationError('translation-invalid')
  if (plan.units.length > translationLimits.units) throw new TranslationError('translation-limit')
  let retainedBytes = 0,
    stagingBytes = 0,
    scratch = 0,
    outputBytes = 0
  const charge = (bytes: number) => {
    if (retainedBytes + bytes + scratch > limits.retained)
      throw new TranslationError('translation-limit')
    retainedBytes += bytes
  }
  const stage = (bytes: number) => {
    const peak = Math.max(scratch, bytes)
    if (peak > limits.staging || retainedBytes + peak > limits.retained)
      throw new TranslationError('translation-limit')
    scratch = peak
    stagingBytes = Math.max(stagingBytes, bytes)
  }
  // Status objects/array, bounded patch traversal frames and fixed control metadata.
  charge(4096 + plan.units.length * 256)
  const patch = (): Patch => {
    charge(256)
    return { branches: new Map() }
  }
  const changes = patch()
  const branch = (node: Nodes, children: Nodes[]): Parent => {
    const keys = Reflect.ownKeys(node)
    if (keys.length > 128) throw new TranslationError('translation-invalid')
    charge(128 + keys.length * 64 + 64)
    const descriptors = Object.getOwnPropertyDescriptors(node)
    descriptors.children = { value: children, enumerable: true, writable: true, configurable: true }
    return Object.create(Object.getPrototypeOf(node), descriptors) as Parent
  }
  const texts = new Map<string, Nodes>()
  const text = (value: string): Nodes => {
    const prior = texts.get(value)
    if (prior) return prior
    // Exact new text nodes contain only type/value. Charge the immutable output and its
    // transient canonical key/index before retaining either; occurrence edges stay separate.
    charge(264 + value.length * 4)
    const node: Nodes = Object.freeze({ type: 'text', value })
    texts.set(value, node)
    return node
  }
  const statuses: ReconstructedDocument['statuses'] = []
  for (const unit of plan.units) {
    const value = typeof outputs === 'function' ? outputs(unit) : outputs.get(unit.occurrenceId)
    let status: ReconstructedDocument['statuses'][number]['status'] = unit.error
      ? 'limit'
      : 'missing'
    if (!unit.error && value !== undefined) {
      // Never allocate a provider-controlled pieces array or path map before admission.
      stage(
        65536 +
          (unit.path.length + 1) * 1024 +
          (unit.payload?.tokens.length ?? 0) * 1024 +
          (typeof value === 'string' ? value.length * 12 : 0),
      )
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
        // UTF-8 is bounded by at most three bytes per UTF-16 unit. A precise count is
        // performed by reconstructUnit's existing output validator before pieces escape.
        const children = reconstructUnit(unit, value, { charge, branch, text })
        const bytes = typeof value === 'string' ? utf8Bytes(value) : 0
        if (outputBytes + bytes > translationLimits.reconstructed)
          throw new TranslationError('translation-output-large')
        let target = changes
        for (const index of unit.path) {
          let next = target.branches.get(index)
          if (!next) {
            next = patch()
            charge(64)
            target.branches.set(index, next)
          }
          target = next
        }
        target.children = children
        outputBytes += bytes
        status = 'translated'
      } catch (error) {
        // Capacity is a whole-operation rejection. Invalid/oversized individual outputs
        // preserve their original source exactly, matching the detached reconstruction.
        if (error instanceof TranslationError && error.code === 'translation-limit') throw error
        status =
          error instanceof TranslationError && error.code === 'translation-output-large'
            ? 'limit'
            : 'invalid'
      }
    }
    statuses.push({ occurrenceId: unit.occurrenceId, status })
  }
  stage(8192 + translationLimits.depth * 1024)
  const rebuild = (node: Nodes, patch: Patch, depth: number): Nodes => {
    if (depth > translationLimits.depth || !('children' in node))
      throw new TranslationError('translation-invalid')
    if (patch.children) return Object.freeze(branch(node, patch.children as Nodes[]))
    if (!patch.branches.size) return node
    charge(64 + node.children.length * 8)
    const children: Nodes[] = [...node.children]
    for (const [index, replacement] of patch.branches) {
      const child = children[index]
      if (!child) throw new TranslationError('translation-invalid')
      children[index] = rebuild(child, replacement, depth + 1)
    }
    const result = branch(node, children)
    Object.freeze(children)
    return Object.freeze(result)
  }
  const root = rebuild(plan.root, changes, 0) as Root
  return { root, statuses, retainedBytes: retainedBytes + stagingBytes, stagingBytes }
}
