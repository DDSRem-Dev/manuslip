import type { TokenBinding, TranslationUnit } from './contracts'

type BindingNode = TokenBinding['node']
// Weak ownership: keeping the module loaded must not pin a discarded captured plan.
const nodes = new WeakMap<TranslationUnit, readonly BindingNode[]>()

/** Reserve the private node array, weak index entry and accessor metadata. Small lists
 * retain ordinary binding objects when that is cheaper. Root nodes are owned separately.
 * These explicit weights require runtime calibration, as does the rest of extraction.
 */
export function compactBindingBytes(count: number): number {
  return count >= 3 ? 192 + count * 8 : count * 104
}

function snapshot(this: TranslationUnit): TokenBinding[] {
  const result = Array.from(translationBindings(this), (binding) => Object.freeze(binding))
  Object.freeze(result)
  return result
}

/** The public property exposes complete immutable values on demand. Production
 * reconstruction uses the iterator and never retains a binding-object array per unit.
 * The caller must admit compactBindingBytes before calling; the input unit is exclusive.
 */
export function compactTranslationUnit(unit: TranslationUnit): TranslationUnit {
  // HTML groups are projection-owned arrays, rather than children arrays of the source.
  for (const binding of unit.bindings) if (Array.isArray(binding.node)) Object.freeze(binding.node)
  if (unit.bindings.length >= 3) {
    const values = unit.bindings.map((binding) => binding.node)
    // Add a shared accessor to a fresh shape. Replacing an existing data property with
    // an accessor can normalize each unit into a larger runtime property dictionary.
    const compact = {
      occurrenceId: unit.occurrenceId,
      kind: unit.kind,
      from: unit.from,
      to: unit.to,
      path: unit.path,
      payload: unit.payload,
    } as TranslationUnit
    Object.defineProperty(compact, 'bindings', {
      get: snapshot,
      enumerable: true,
      configurable: false,
    })
    compact.error = unit.error
    nodes.set(compact, Object.freeze(values))
    Object.freeze(compact.path)
    return Object.freeze(compact)
  } else {
    for (const binding of unit.bindings) Object.freeze(binding)
    Object.freeze(unit.bindings)
  }
  Object.freeze(unit.path)
  return Object.freeze(unit)
}

/** Yield each exact token/private-node pair without expanding a compact unit's snapshot. */
export function* translationBindings(unit: TranslationUnit): Generator<TokenBinding> {
  const values = nodes.get(unit)
  if (!values) {
    yield* unit.bindings
    return
  }
  const tokens = unit.payload?.tokens
  if (!tokens || tokens.length !== values.length) throw new Error('translation-invalid')
  for (let index = 0; index < values.length; index++) {
    const token = tokens[index]
    if (!token) throw new Error('translation-invalid')
    yield { token, node: values[index] ?? null }
  }
}
