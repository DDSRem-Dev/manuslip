import { parserVersion, semanticLimits } from './contracts'
import type { PackedCapture, PackedItemSteps, PackedReadScope } from './packing-capture'
import { finishPackedCleanup } from './packing-cleanup'
import type { PackedHold } from './packing-hold'
import { readSimpleMdastRecord, validateMdastFields } from './packing-mdast-schema'
import { type PackedSource, sameIdentity } from './packing-source'
import { PackedSourcePoints } from './packing-source-points'
import type { ScalarLimits } from './packing-text'
import { invalidPackedSemantic, packedSmall } from './packing-validation-read'
import type { PackedPath } from './packing-view'
import type { PackedWork } from './packing-work'

export interface PackedRootValidationLimits {
  retained: number
  staging: number
  nodes: number
  depth: number
}
export type PackedRootObserver = (
  node: PackedReadScope,
  type: string,
  position: ReturnType<PackedReadScope['position']> | undefined,
  budget: ScalarLimits,
  depth: number,
) => Generator<void> | void
export interface PackedRootSubtree {
  readonly nodes: number
  readonly depth: number
}
/** Trusted internal reuse: prove the complete immutable subtree's fields/source/geometry
 * and consume any observer metadata before returning its full logical costs.
 */
export type PackedRootPrune = (
  node: PackedReadScope,
  position: ReturnType<PackedReadScope['position']>,
  budget: ScalarLimits,
) => Generator<void, PackedRootSubtree | undefined>
interface Frame {
  readonly iterator: PackedItemSteps
  readonly allowed: ReadonlySet<string>
  readonly from: number
  readonly to: number
  previous: number
}

function closeRootFrames(
  frames: readonly Frame[],
  workspace: PackedHold,
  preserveFailure: boolean,
): void {
  try {
    finishPackedCleanup(
      (function* () {
        for (const frame of frames)
          yield () => {
            frame.iterator.return()
          }
        yield () => workspace.release()
      })(),
    )
  } catch (error) {
    // The original validation failure takes precedence over cleanup failures.
    if (!preserveFailure) throw error
  }
}

/** Source-bound schema validation for the pinned parser's complete mdast root. This layer
 * does not certify parser equivalence, document metadata, word counts or projection HTML.
 * A receiver must compose those checks before publication. No native root or text copy.
 * A trusted top-level prune hook must prove the complete immutable subtree's fields and
 * source-relative geometry and consume its observer metadata; logical limits still apply.
 */
export function validatePackedRoot(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  limits: PackedRootValidationLimits,
  observe?: PackedRootObserver,
  prune?: PackedRootPrune,
): PackedWork<void> {
  return capture.work(packedRootSteps(capture, source, root, limits, observe, prune))
}

/** Internal composition under a capture-owned parent. Retains every root guard and
 * checkpoint; the parent must close the complete delegation chain on cancellation.
 */
export function packedRootSteps(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  limits: PackedRootValidationLimits,
  observe?: PackedRootObserver,
  prune?: PackedRootPrune,
): Generator<void> {
  capture.reader.at(root)
  return guardRootSteps(capture, source, [...root], { ...limits }, observe, prune)
}

function* guardRootSteps(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  limits: PackedRootValidationLimits,
  observe?: PackedRootObserver,
  prune?: PackedRootPrune,
): Generator<void, void, undefined> {
  const work = validateRootSteps(capture, source, root, limits, observe, prune)
  try {
    while (true) {
      // Guard every resumed step, including source indexing and nested text streams.
      capture.identity
      if (work.next().done) return
      yield
    }
  } finally {
    work.return(undefined)
  }
}

export function packedRootWorkspace(
  source: PackedSource,
  root: PackedPath,
  limits: PackedRootValidationLimits,
): number {
  for (const key of ['retained', 'staging', 'nodes', 'depth'] as const)
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0)
      throw new Error('Invalid packed root validation limits')
  if (
    limits.nodes > semanticLimits.blocks * 16 ||
    limits.depth > 128 ||
    limits.depth < 1 ||
    root.length > 64
  )
    throw new Error('Invalid packed root validation limits')
  const bytes = PackedSourcePoints.bytes(source) + 8192 + limits.depth * 1024
  if (bytes > limits.retained || bytes > limits.staging)
    throw new Error('Packed root validation exceeds workspace limit')
  return bytes
}

function* validateRootSteps(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  limits: PackedRootValidationLimits,
  observe?: PackedRootObserver,
  prune?: PackedRootPrune,
): Generator<void> {
  if (capture.sourceResource !== source || !sameIdentity(capture.identity, source.identity))
    invalidPackedSemantic()
  if (
    ![`${parserVersion}/commonmark`, `${parserVersion}/manuslip`].includes(
      source.identity.parserVersion,
    )
  )
    invalidPackedSemantic()
  const bytes = packedRootWorkspace(source, root, limits)
  const workspace = capture.workspace(bytes, bytes)
  const frames: Frame[] = []
  let nodes = 0
  let failed = false
  try {
    const selected = capture.reader.at(root)
    const points = yield* PackedSourcePoints.build(source)
    const budget = { retained: limits.retained - bytes, staging: limits.staging - bytes }
    let scope: PackedReadScope | undefined = selected
    while (scope) {
      if (++nodes > limits.nodes) throw new Error('Packed root validation node limit')
      if (frames.length + 1 > limits.depth) throw new Error('Packed root validation depth limit')
      // Bound unknown shapes before copying keys or attempting any field lookup.
      const simple = prune ? undefined : readSimpleMdastRecord(scope, source.text.length)
      if (!simple && (scope.kind() !== 'object' || scope.keyCount() > 10)) invalidPackedSemantic()
      const type = simple?.type ?? packedSmall(scope, ['type'])
      if (typeof type !== 'string') invalidPackedSemantic()
      const parent = frames.at(-1)
      if (parent ? !parent.allowed.has(type) : type !== 'root') invalidPackedSemantic()
      let from = parent?.from ?? 0
      let to = parent?.to ?? points.length
      let position: ReturnType<PackedReadScope['position']> | undefined
      // GFM's literal-autolink transform synthesizes unpositioned text and links.
      // Their children still inherit the nearest positioned ancestor's bounds.
      if (simple || scope.hasField('position')) {
        if (!simple && scope.kind(['position']) !== 'position') invalidPackedSemantic()
        position = simple?.position ?? scope.position(['position'], { retained: 512, staging: 0 })
        for (const point of [position.start, position.end]) {
          const expected = points.point(point.offset)
          if (point.line !== expected.line || point.column !== expected.column)
            invalidPackedSemantic()
        }
        from = position.start.offset
        to = position.end.offset
        if (
          from > to ||
          (parent && (from < parent.from || to > parent.to || from < parent.previous))
        )
          invalidPackedSemantic()
        // A setext heading can include a preceding definition in its source range.
        if (parent) parent.previous = from
      }
      if (!parent && (from !== 0 || to !== points.length)) invalidPackedSemantic()
      let reused: PackedRootSubtree | undefined
      if (prune && parent && frames.length === 1 && position) {
        reused = yield* prune(scope, position, budget)
        if (reused) {
          if (
            !Number.isSafeInteger(reused.nodes) ||
            reused.nodes < 1 ||
            !Number.isSafeInteger(reused.depth) ||
            reused.depth < 1 ||
            frames.length + reused.depth > limits.depth
          )
            throw new Error('Packed root validation depth limit')
          nodes += reused.nodes - 1
          if (nodes > limits.nodes) throw new Error('Packed root validation node limit')
        }
      }
      if (!reused) {
        const allowed = simple
          ? simple.children
          : yield* validateMdastFields(scope, type, source.text.length, budget)
        if (observe) {
          const work = observe(scope, type, position, budget, frames.length + 1)
          if (work !== undefined) yield* work
        }
        if (allowed)
          frames.push({
            iterator: scope.elementSteps(['children']),
            allowed,
            from,
            to,
            previous: from,
          })
      }
      yield
      scope = undefined
      while (frames.length) {
        const frame = frames.at(-1)
        if (!frame) throw new Error('Missing packed validation frame')
        const step = frame.iterator.next()
        if (step.done) {
          frames.pop()
          yield
        } else if (step.value === undefined) yield
        else {
          scope = step.value
          break
        }
      }
    }
  } catch (error) {
    failed = true
    throw error
  } finally {
    closeRootFrames(frames, workspace, failed)
  }
}
