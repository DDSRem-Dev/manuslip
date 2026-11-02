import type { RootContent } from 'mdast'
import { semanticLimits } from '../../core/src/contracts'
import type { PackedCapture, PackedReadScope } from '../../core/src/packing-capture'
import { packedNativeStreamSteps } from '../../core/src/packing-native-stream'
import type { PackedRecordKey } from '../../core/src/packing-record-key'
import type { PackedSource } from '../../core/src/packing-source'
import type { PackedPath } from '../../core/src/packing-view'
import type { PackedWork } from '../../core/src/packing-work'
import type { CollectedProjectionContext } from './collected-projection-context'
import type { ProjectionLimits } from './fragment-projection-context'
import type { RenderOptions, RenderProjection } from './index'
import type { PackedProjectionPrune } from './packed-projection-definitions'
import {
  type PackedProjectionStateCost,
  packedProjectionStateSteps,
} from './packed-projection-state'
import { type ProjectionChunkEvent, projectOwnedChunks } from './projection-owned-chunks'
import { projectOwnedOutput, type ProjectionDescriptionAbsence } from './projection-owned-output'
import type { ProjectionSerializationPlan } from './projection-serialization-plan'
import { ProjectionWorkspace } from './projection-workspace'

export interface PackedProjectionOutput {
  readonly index: number
  readonly footer: boolean
  readonly visible: boolean
  readonly projection: RenderProjection
}
export interface PackedProjectionOutputCost {
  readonly retainedBytes: number
  readonly stagingBytes: number
  readonly nativeBytes: number
  readonly outputBytes: number
  readonly state: PackedProjectionStateCost
  readonly serialization: Readonly<ProjectionSerializationPlan>
}
export interface PackedProjectionChunkInspector {
  chunks(event: ProjectionChunkEvent, cost: Readonly<PackedProjectionOutputCost>): Generator<void>
}
type PackedProjectionOutputInspector =
  | ((
      output: PackedProjectionOutput,
      cost: Readonly<PackedProjectionOutputCost>,
    ) => Generator<void>)
  | PackedProjectionChunkInspector

/** Internal capture-owned output stream. Compose complete document/schema validation
 * first. Each body block is copied, rendered and consumed once before advancing its packed
 * cursor; the final footer shares the admitted global state. Context, native block, HAST,
 * policy scratch and selected output mode have simultaneous admission. Function inspectors
 * borrow complete native output; chunk inspectors compare HTML without joined body/widget
 * strings. Native handlers and shallow serializer shells remain synchronous. Inspectors may suspend but
 * must not retain native results beyond its lifetime without separately admitted ownership.
 * The optional trusted reuse hook must prove exact output from a sealed validated baseline
 * and preserve global renderer state; blocks with footnote calls must render normally.
 * The optional context prune hook requires sealed absence proofs and complete logical costs.
 */
export function inspectPackedProjectionOutput(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  options: RenderOptions,
  limits: ProjectionLimits,
  inspect: PackedProjectionOutputInspector,
  reuse?: (
    node: PackedReadScope,
    index: number,
    context: readonly (PackedRecordKey | undefined)[],
  ) => Generator<void, boolean>,
  prune?: PackedProjectionPrune,
): PackedWork<void> {
  return capture.work(
    packedProjectionOutputInspectionSteps(
      capture,
      source,
      root,
      options,
      limits,
      inspect,
      reuse,
      prune,
    ),
  )
}

/** Internal complete output borrow. Its enclosing capture-owned task owns revocation
 * of the context, sequence, native blocks and output through this delegation chain.
 */
export function packedProjectionOutputInspectionSteps(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  options: RenderOptions,
  limits: ProjectionLimits,
  inspect: PackedProjectionOutputInspector,
  reuse?: (
    node: PackedReadScope,
    index: number,
    context: readonly (PackedRecordKey | undefined)[],
  ) => Generator<void, boolean>,
  prune?: PackedProjectionPrune,
  collected?: CollectedProjectionContext,
): Generator<void> {
  const nativeInspect = typeof inspect === 'function' ? inspect : undefined
  const chunkInspect = typeof inspect === 'object' && inspect !== null ? inspect.chunks : undefined
  if (!nativeInspect && typeof chunkInspect !== 'function')
    throw new Error('Invalid packed projection output inspector')
  capture.reader.at(root)
  if (root.length > 64) throw new Error('Invalid packed projection output path')
  const path = [...root]
  const render = { ...options }
  const budget = { ...limits }
  return packedProjectionStateSteps(
    capture,
    source,
    path,
    render,
    budget,
    function* (sequence, state) {
      const nativeDepth = Math.min(512, budget.depth * 4 + 16)
      const remaining = {
        ...budget,
        depth: nativeDepth,
        retained: budget.retained - state.retainedBytes,
        staging: budget.staging - state.stagingBytes,
      }
      let active: ProjectionWorkspace | undefined
      sequence.admit({
        node(current, node, parent) {
          if (!active) throw new Error('Projection output scope closed')
          active.node(current, node, parent)
        },
        nodeSteps(current, node, parent) {
          if (!active) throw new Error('Projection output scope closed')
          return active.nodeSteps(current, node, parent)
        },
        footer(current) {
          if (!active) throw new Error('Projection output scope closed')
          active.footer(current, state, render)
        },
        conversion(bytes) {
          if (!active) throw new Error('Projection output scope closed')
          active.add(bytes)
        },
      })
      function* output(
        node: RootContent | undefined,
        index: number,
        nativeBytes: number,
        absence?: ProjectionDescriptionAbsence,
      ): Generator<void> {
        const workspace = new ProjectionWorkspace(capture, {
          ...remaining,
          retained: remaining.retained - nativeBytes,
          staging: remaining.staging - nativeBytes,
        })
        active = workspace
        try {
          const converted = node
            ? yield* sequence.convertSteps(node, remaining)
            : sequence.finishConversion()
          yield
          if (chunkInspect) {
            yield* projectOwnedChunks(
              converted,
              render,
              remaining,
              workspace,
              index,
              !node,
              function* (event, serialization) {
                yield* chunkInspect(
                  event,
                  Object.freeze({
                    retainedBytes: state.retainedBytes + nativeBytes + workspace.bytes,
                    stagingBytes: state.stagingBytes + nativeBytes + workspace.bytes,
                    nativeBytes,
                    outputBytes: workspace.bytes,
                    state,
                    serialization,
                  }),
                )
              },
              absence,
            )
            return
          }
          let serialization: Readonly<ProjectionSerializationPlan> | undefined
          const projection = yield* projectOwnedOutput(
            converted,
            render,
            remaining,
            workspace,
            (cost) => {
              serialization = cost
            },
            absence,
          )
          if (!serialization) throw new Error('Missing projection output admission')
          if (!nativeInspect) throw new Error('Missing native projection inspector')
          yield* nativeInspect(
            Object.freeze({ index, footer: !node, visible: converted.visible, projection }),
            Object.freeze({
              retainedBytes: state.retainedBytes + nativeBytes + workspace.bytes,
              stagingBytes: state.stagingBytes + nativeBytes + workspace.bytes,
              nativeBytes,
              outputBytes: workspace.bytes,
              state,
              serialization,
            }),
          )
        } finally {
          active = undefined
          workspace.close()
        }
      }
      const items = capture.reader.elementSteps([...path, 'children'])
      let index = 0
      try {
        for (const child of items) {
          if (child === undefined) yield
          else {
            if (index >= semanticLimits.blocks) throw new Error('Packed projection block limit')
            if (!reuse || !(yield* reuse(child, index, state.context.recordKeys)))
              yield* packedNativeStreamSteps(
                capture,
                child,
                remaining,
                function* (value, native) {
                  yield* output(
                    value as RootContent,
                    index,
                    native.stagingBytes,
                    collected?.descriptionAbsence(capture, source, path, index, child),
                  )
                },
                true,
              )
            index++
          }
        }
      } finally {
        items.return()
      }
      yield* output(
        undefined,
        index,
        0,
        collected?.descriptionAbsence(capture, source, path, index),
      )
    },
    prune,
    collected,
  )
}
