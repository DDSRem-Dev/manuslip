import type { SemanticBlock } from '../../core/src/contracts'
import type { PackedReadScope } from '../../core/src/packing-capture'
import {
  copyPackedNative,
  measurePackedNative,
  type PackedNativePlan,
} from '../../core/src/packing-native-copy'
import type { PackedRootValidationLimits } from '../../core/src/packing-validate-root'
import { packedSmall } from '../../core/src/packing-validation-read'

function range(scope: PackedReadScope): string {
  return `${packedSmall(scope, ['from'])}:${packedSmall(scope, ['to'])}`
}

/** Only called after complete snapshot validation, under the caller's selection reservation. */
export function* previewDescriptorRanges(widgets: PackedReadScope): Generator<void, Set<string>> {
  const ranges = new Set<string>()
  for (const widget of widgets.elementSteps()) {
    if (widget) ranges.add(range(widget))
    yield
  }
  return ranges
}

function* selected(blocks: PackedReadScope, ranges: ReadonlySet<string>) {
  if (!ranges.size) return
  // Keep source order and every coincident descriptor: the existing model's final
  // range lookup then has exactly the same last-match behavior as the complete input.
  for (const block of blocks.elementSteps())
    yield block && ranges.has(range(block)) ? block : undefined
}

export function* measurePreviewDescriptors(
  blocks: PackedReadScope,
  ranges: ReadonlySet<string>,
  limits: PackedRootValidationLimits,
  plan: PackedNativePlan,
  admit: () => void,
): Generator<void> {
  if (++plan.nodes > limits.nodes) throw new Error('Packed native node/depth limit')
  plan.retained += 64
  admit()
  yield
  for (const block of selected(blocks, ranges)) {
    if (block) {
      plan.retained += 8
      admit()
      yield* measurePackedNative(block, limits, plan, admit, 1)
    }
    yield
  }
}

export function* copyPreviewDescriptors(
  blocks: PackedReadScope,
  ranges: ReadonlySet<string>,
): Generator<void, readonly SemanticBlock[]> {
  const output: SemanticBlock[] = []
  yield
  for (const block of selected(blocks, ranges)) {
    if (block) output.push((yield* copyPackedNative(block)) as SemanticBlock)
    yield
  }
  return Object.freeze(output)
}
