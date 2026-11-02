import type { PackedReadScope } from './packing-capture'
import { finishPackedCleanup } from './packing-cleanup'
import type { ScalarLimits } from './packing-text'
import type { PackedPath } from './packing-view'

const small = { retained: 4096, staging: 8192 }
export function invalidPackedSemantic(): never {
  throw new Error('Invalid packed semantic document')
}
export function packedKeys(
  scope: PackedReadScope,
  path: PackedPath,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  if (!scope.matchesKeys(path, required, optional, small)) invalidPackedSemantic()
}
export function packedString(scope: PackedReadScope, path: PackedPath, length: number) {
  if (scope.scalarType(path) !== 'string' || scope.textLength(path) > length)
    invalidPackedSemantic()
}
export function packedSmall(scope: PackedReadScope, path: PackedPath) {
  return scope.scalar(path, small)
}
export function packedInteger(scope: PackedReadScope, path: PackedPath, maximum: number) {
  const value = packedSmall(scope, path)
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum)
    invalidPackedSemantic()
  return value
}

/** Compare arbitrarily large immutable packed strings without materialization. Each decode
 * and comparison batch yields, preserving independent piece/chunk boundaries and progress.
 */
export function* equalPackedText(
  scope: PackedReadScope,
  left: PackedPath,
  right: PackedPath,
  budget: ScalarLimits,
  other: PackedReadScope = scope,
): Generator<void> {
  if (scope.textLength(left) !== other.textLength(right)) invalidPackedSemantic()
  admitValidationStreams([scope.textStepCost(left), other.textStepCost(right)], budget)
  let first: ReturnType<PackedReadScope['textSteps']> | undefined = scope.textSteps(
    left,
    validationStreamLimits,
  )
  let failed = false
  try {
    const second = other.textSteps(right, validationStreamLimits)
    const delegated = first
    // Transfer both decoders together; only setup failure remains owned here.
    first = undefined
    yield* equalPackedChunks(delegated, second)
  } catch (error) {
    failed = true
    throw error
  } finally {
    finishPackedCleanup([() => first?.return()], failed)
  }
}

export const validationStreamLimits = { retained: 16384, staging: 512 * 1024 }
export function admitValidationStreams(
  costs: readonly { retained: number; workspace: number }[],
  budget: ScalarLimits,
) {
  if (
    costs.reduce((sum, cost) => sum + cost.retained + cost.workspace + 512, 0) > budget.retained ||
    costs.reduce((sum, cost) => sum + cost.workspace, 0) > budget.staging
  )
    throw new Error('Packed validation streams exceed workspace limit')
}

/** Own both inputs through success, failure or cancellation. Undefined is progress. */
export function* equalPackedChunks(
  first: IterableIterator<string | undefined>,
  second: IterableIterator<string | undefined>,
): Generator<void> {
  let failed = false
  try {
    let a = ''
    let b = ''
    let fromA = 0
    let fromB = 0
    let doneA = false
    let doneB = false
    while (true) {
      if (fromA === a.length && !doneA) {
        const next = first.next()
        doneA = !!next.done
        a = next.value ?? ''
        fromA = 0
        yield
        continue
      }
      if (fromB === b.length && !doneB) {
        const next = second.next()
        doneB = !!next.done
        b = next.value ?? ''
        fromB = 0
        yield
        continue
      }
      if (doneA || doneB) {
        if (!doneA || !doneB || fromA !== a.length || fromB !== b.length) invalidPackedSemantic()
        return
      }
      const size = Math.min(a.length - fromA, b.length - fromB)
      if (a.slice(fromA, fromA + size) !== b.slice(fromB, fromB + size)) invalidPackedSemantic()
      fromA += size
      fromB += size
      yield
    }
  } catch (error) {
    failed = true
    throw error
  } finally {
    finishPackedCleanup([() => first.return?.(), () => second.return?.()], failed)
  }
}
