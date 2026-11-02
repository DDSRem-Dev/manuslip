import type { PackedItemSteps, PackedReadScope } from './packing-capture'
import type { PackedRootValidationLimits } from './packing-validate-root'
import {
  invalidPackedSemantic,
  packedString,
  validationStreamLimits,
} from './packing-validation-read'

/** The pinned plainText spelling, streamed without retaining the heading's complete text.
 * The caller reserves frames plus one fixed text stream before starting this traversal.
 * Independent node/depth guards apply even before the outer AST walk reaches these children.
 */
export function* packedPlainText(
  selected: PackedReadScope,
  sourceLength: number,
  limits: Pick<PackedRootValidationLimits, 'nodes' | 'depth'>,
): Generator<string | undefined, void, undefined> {
  const frames: PackedItemSteps[] = []
  let nodes = 0
  const visit = function* (node: PackedReadScope): Generator<string | undefined, void, undefined> {
    if (++nodes > limits.nodes || frames.length + 1 > limits.depth)
      throw new Error('Packed heading traversal limit')
    if (node.kind() !== 'object' || node.keyCount() > 10) invalidPackedSemantic()
    const keys = node.keys([], { retained: 4096, staging: 8192 })
    if (keys.includes('children')) frames.push(node.elementSteps(['children']))
    else {
      const field = keys.includes('value') ? 'value' : keys.includes('alt') ? 'alt' : undefined
      if (field) {
        packedString(node, [field], sourceLength)
        yield* node.textSteps([field], validationStreamLimits)
      }
    }
    yield undefined
  }
  try {
    yield* visit(selected)
    while (frames.length) {
      const frame = frames.at(-1)
      if (!frame) throw new Error('Missing packed heading frame')
      const step = frame.next()
      if (step.done) {
        frames.pop()
        yield undefined
      } else if (step.value === undefined) yield undefined
      else yield* visit(step.value)
    }
  } finally {
    for (const frame of frames) frame.return()
  }
}
