import { type Nodes, type Root, semanticLimits, utf8Bytes } from '@manuslip/core'
import {
  TranslationError,
  type TranslationPlan,
  type TranslationUnit,
  translationLimits,
  type UnitKind,
} from './contracts'
import { translationUnitKinds, UnitExtraction } from './extract-unit'
import { type ExtractionCost, ExtractionMemory } from './extraction-memory'

/** A captured semantic root is input; this function never rewrites source or that root. */
export function extractTranslation(
  root: Root,
  source: string,
  occurrence: (range: { from: number; to: number; kind: UnitKind }) => string = () =>
    crypto.randomUUID(),
): TranslationPlan {
  return extract(root, source, occurrence)
}

export interface SharedTranslationPlan extends TranslationPlan {
  cost: ExtractionCost
}
/** Share canonical provider data while keeping occurrence-specific bindings private.
 * The caller owns the complete immutable root separately for the plan's whole lifetime.
 */
export function extractSharedTranslation(
  root: Root,
  source: string,
  limits: { retained: number; staging: number },
  occurrence: (range: { from: number; to: number; kind: UnitKind }) => string = () =>
    crypto.randomUUID(),
): SharedTranslationPlan {
  const memory = new ExtractionMemory({ ...limits })
  const plan = extract(root, source, occurrence, memory)
  return { ...plan, cost: memory.cost }
}

/** Immutable worker plan with canonical payloads and compact private node bindings.
 * Reading bindings produces a complete immutable snapshot; use only while the separately
 * owned source root remains immutable. Ordinary extraction stays the detached oracle.
 */
export function extractCompactTranslation(
  root: Root,
  source: string,
  limits: { retained: number; staging: number },
  occurrence: (range: { from: number; to: number; kind: UnitKind }) => string = () =>
    crypto.randomUUID(),
): SharedTranslationPlan {
  const memory = new ExtractionMemory({ ...limits }, true)
  const plan = extract(root, source, occurrence, memory)
  Object.freeze(plan.units)
  return Object.freeze({ ...plan, cost: memory.cost })
}

function extract(
  root: Root,
  source: string,
  occurrence: (range: { from: number; to: number; kind: UnitKind }) => string,
  memory?: ExtractionMemory,
): TranslationPlan {
  if (utf8Bytes(source) > semanticLimits.previewBytes)
    throw new TranslationError('translation-limit')
  const result: TranslationUnit[] = []
  const extraction = new UnitExtraction(memory)
  let nodes = 0
  const pending: { node: Nodes; path: number[]; depth: number }[] = [
    { node: root, path: [], depth: 0 },
  ]
  memory?.pending(0, 1)
  while (pending.length) {
    const current = pending.pop()
    if (!current) break
    const { node, path, depth } = current
    memory?.pending(depth, -1)
    if (++nodes > semanticLimits.blocks * 16 || depth > translationLimits.depth)
      throw new TranslationError('translation-limit')
    if (translationUnitKinds.has(node.type)) {
      const unit = extraction.unit(node, source, path, depth, occurrence)
      if (unit) result.push(unit)
      continue
    }
    // Only structural containers lead to eligible prose. All other leaves stay untouched.
    if ('children' in node)
      for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index]
        if (child) {
          memory?.pending(depth + 1, 1)
          pending.push({ node: child, path: [...path, index], depth: depth + 1 })
        }
      }
  }
  // Generated inline-note definitions live in the AST footer but retain their
  // original source positions. Keep provider/export indices in source order.
  result.sort((a, b) => a.from - b.from || b.to - a.to)
  return { root, units: result, payloadBytes: extraction.payloadBytes }
}
