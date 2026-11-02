import { type Nodes, semanticLimits } from '@manuslip/core'
import type { PackedCapture, PackedReadScope } from '../../core/src/packing-capture'
import { inspectPackedNativeStream } from '../../core/src/packing-native-stream'
import type { PackedSource } from '../../core/src/packing-source'
import { packedTextStepCost } from '../../core/src/packing-text-stream'
import {
  packedRootWorkspace,
  validatePackedRoot,
  type PackedRootValidationLimits,
} from '../../core/src/packing-validate-root'
import { packedSmall } from '../../core/src/packing-validation-read'
import type { PackedPath } from '../../core/src/packing-view'
import type { PackedWork } from '../../core/src/packing-work'
import {
  TranslationError,
  type TranslationUnit,
  translationLimits,
  type UnitKind,
} from './contracts'
import { translationUnitKinds, UnitExtraction } from './extract-unit'

export interface PackedExtractionCost {
  readonly retainedBytes: number
  readonly stagingBytes: number
  readonly nativeBytes: number
  readonly projectionBytes: number
  readonly identityBytes: number
}
export interface PackedExtractionResult {
  readonly units: number
  readonly payloadBytes: number
  readonly retainedPeakBytes: number
  readonly stagingPeakBytes: number
  readonly largestNativeBytes: number
}

/** Experimental full-root extraction without expanding a complete native root. Validate
 * the entire source-bound root before any callback; copy only one eligible prose unit.
 * Unit paths/depth, token privacy, per-unit errors, ID uniqueness and logical aggregate
 * payload limits share native extraction's implementation. The trusted inspector may
 * suspend, but must not retain native units/bindings after it returns without independently
 * admitting that lifetime. No unit, source or complete root is retained by the result.
 * All output retained by an inspector is additional to this local/session workspace.
 */
export function inspectPackedTranslationUnits(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  limits: PackedRootValidationLimits,
  inspect: (
    unit: Readonly<TranslationUnit>,
    cost: Readonly<PackedExtractionCost>,
  ) => Generator<void>,
  occurrence: (range: { from: number; to: number; kind: UnitKind }) => string = () =>
    crypto.randomUUID(),
): PackedWork<PackedExtractionResult> {
  if (typeof inspect !== 'function' || typeof occurrence !== 'function')
    throw new Error('Invalid packed translation inspector')
  capture.reader.at(root)
  return capture.work(extract(capture, source, [...root], { ...limits }, inspect, occurrence))
}

function* extract(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  limits: PackedRootValidationLimits,
  inspect: (
    unit: Readonly<TranslationUnit>,
    cost: Readonly<PackedExtractionCost>,
  ) => Generator<void>,
  occurrence: (range: { from: number; to: number; kind: UnitKind }) => string,
): Generator<void, PackedExtractionResult> {
  // The full validator enforces identity, source bounds, schema, position geometry and
  // limits even on branches whose contents are ineligible for provider translation.
  const validationBytes = packedRootWorkspace(source, root, limits)
  yield* validatePackedRoot(capture, source, root, limits)
  const fixed = 32768 + (limits.depth + 1) * 1024
  const nativeDepth = Math.min(512, limits.depth * 4 + 16)
  const budget = capture.reserveWorkspace(fixed, fixed)
  let projectionBytes = 0,
    identityBytes = 0,
    nativeBytes = 0,
    retainedPeakBytes = Math.max(fixed, validationBytes),
    stagingPeakBytes = Math.max(fixed, validationBytes),
    largestNativeBytes = 0,
    nodes = 0
  const admit = (nextIdentity = identityBytes) => {
    const retained = fixed + nextIdentity + projectionBytes + nativeBytes
    const staging = fixed + projectionBytes + nativeBytes
    if (retained > limits.retained || staging > limits.staging)
      throw new Error('Packed translation extraction exceeds workspace limit')
    budget.resize(fixed + nextIdentity + projectionBytes, fixed + projectionBytes)
    retainedPeakBytes = Math.max(retainedPeakBytes, retained)
    stagingPeakBytes = Math.max(stagingPeakBytes, staging)
  }
  const extraction = new UnitExtraction(undefined, (bytes) => {
    admit(identityBytes + bytes)
    identityBytes += bytes
  })
  function* visit(node: PackedReadScope, path: number[], depth: number): Generator<void> {
    if (++nodes > semanticLimits.blocks * 16 || depth > translationLimits.depth)
      throw new TranslationError('translation-limit')
    const kind = packedSmall(node, ['type'])
    yield
    if (typeof kind !== 'string') throw new TranslationError('translation-invalid')
    if (translationUnitKinds.has(kind)) {
      yield* inspectPackedNativeStream(
        capture,
        node,
        {
          retained: limits.retained - fixed - identityBytes,
          staging: limits.staging - fixed,
          nodes: limits.nodes,
          depth: nativeDepth,
        },
        function* (value, cost) {
          nativeBytes = cost.stagingBytes
          largestNativeBytes = Math.max(largestNativeBytes, nativeBytes)
          // Include the copy phase's separate decoder/reader headroom conservatively,
          // even for units that do not use its largest string-collection path.
          retainedPeakBytes = Math.max(
            retainedPeakBytes,
            fixed +
              identityBytes +
              cost.copyStagingBytes +
              packedTextStepCost.retained +
              packedTextStepCost.workspace +
              (nativeDepth + 8) * 512,
          )
          stagingPeakBytes = Math.max(
            stagingPeakBytes,
            fixed + cost.copyStagingBytes + packedTextStepCost.workspace,
          )
          // Native projection can create literal bindings, HTML-group arrays, JSON spelling
          // and UTF-8 scratch. Charge a fixed token/payload allowance plus twice the full
          // native unit before invoking the shared synchronous projector.
          projectionBytes = 2 * 1024 * 1024 + cost.retainedBytes * 2
          try {
            admit()
            const unit = extraction.unit(value as Nodes, source.text, path, depth, occurrence)
            if (unit)
              yield* inspect(
                unit,
                Object.freeze({
                  retainedBytes: fixed + identityBytes + projectionBytes + nativeBytes,
                  stagingBytes: fixed + projectionBytes + nativeBytes,
                  nativeBytes,
                  projectionBytes,
                  identityBytes,
                }),
              )
          } finally {
            projectionBytes = 0
            nativeBytes = 0
          }
          admit()
        },
      )
      return
    }
    if (node.hasField('children')) {
      const children = node.elementSteps(['children'])
      let index = 0
      try {
        for (const child of children) {
          if (child === undefined) yield
          else {
            yield* visit(child, [...path, index], depth + 1)
            index++
          }
        }
      } finally {
        children.return()
      }
    }
  }
  try {
    admit()
    yield* visit(capture.reader.at(root), [], 0)
    return Object.freeze({
      units: extraction.count,
      payloadBytes: extraction.payloadBytes,
      retainedPeakBytes,
      stagingPeakBytes,
      largestNativeBytes,
    })
  } finally {
    budget.release()
  }
}
