import type { Nodes } from 'mdast'
import type { PackedCapture } from '../../core/src/packing-capture'
import type { PackedSource } from '../../core/src/packing-source'
import { invalidPackedSemantic } from '../../core/src/packing-validation-read'
import type { PackedPath } from '../../core/src/packing-view'
import type { PackedWork } from '../../core/src/packing-work'
import type { CollectedProjectionContext } from './collected-projection-context'
import type { ProjectionLimits } from './fragment-projection-context'
import { type RenderOptions, rendererVersion } from './index'
import {
  type PackedProjectionContextCost,
  packedProjectionContextSteps,
} from './packed-projection-context'
import type { PackedProjectionPrune } from './packed-projection-definitions'
import { type ProjectionDefinition, ProjectionSequence } from './projection-sequence'

export interface PackedProjectionStateCost {
  /** Complete simultaneous reservation, including the immutable definition context. */
  readonly retainedBytes: number
  readonly stagingBytes: number
  readonly stateBytes: number
  readonly context: PackedProjectionContextCost
  readonly definitions: number
  readonly references: number
  readonly identifierUnits: number
}

/** One public renderer state, closed before its context/state reservation ends. */
export function inspectPackedProjectionState(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  options: RenderOptions,
  limits: ProjectionLimits,
  inspect: (sequence: ProjectionSequence, cost: PackedProjectionStateCost) => Generator<void>,
  prune?: PackedProjectionPrune,
): PackedWork<void> {
  return capture.work(
    packedProjectionStateSteps(capture, source, root, options, limits, inspect, prune),
  )
}

/** Internal state borrow; its enclosing capture-owned task must close every frame. */
export function packedProjectionStateSteps(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  options: RenderOptions,
  limits: ProjectionLimits,
  inspect: (sequence: ProjectionSequence, cost: PackedProjectionStateCost) => Generator<void>,
  prune?: PackedProjectionPrune,
  collected?: CollectedProjectionContext,
): Generator<void> {
  if (typeof inspect !== 'function') throw new Error('Invalid packed projection state request')
  const render = { ...options }
  return packedProjectionStateContextSteps(
    capture,
    source,
    root,
    render,
    limits,
    function* (context, cost) {
      const sequence = new ProjectionSequence(context, render)
      try {
        yield
        yield* inspect(sequence, cost)
      } finally {
        sequence.close()
      }
    },
    prune,
    1,
    collected,
  )
}

/** Internal trusted inspection of caller-admitted rendering of this capture's body once,
 * then its footer once. Compose full document/schema validation first. Context, definition
 * maps and footnote order/counters stay charged through every suspension and native call.
 * The inspector must separately admit native blocks, HAST and output before rendering;
 * those allocations are not covered here. Do not retain results without their own owner.
 * The trusted inspector must close every created state before returning from its borrow.
 */
export function inspectPackedProjectionStateContext(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  options: RenderOptions,
  limits: ProjectionLimits,
  inspect: (
    context: readonly ProjectionDefinition[],
    cost: PackedProjectionStateCost,
  ) => Generator<void>,
  prune?: PackedProjectionPrune,
  copies: 1 | 2 = 1,
): PackedWork<void> {
  return capture.work(
    packedProjectionStateContextSteps(
      capture,
      source,
      root,
      options,
      limits,
      inspect,
      prune,
      copies,
    ),
  )
}

/** Internal guarded context/state borrow under one enclosing capture-owned task. */
export function packedProjectionStateContextSteps(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  options: RenderOptions,
  limits: ProjectionLimits,
  inspect: (
    context: readonly ProjectionDefinition[],
    cost: PackedProjectionStateCost,
  ) => Generator<void>,
  prune?: PackedProjectionPrune,
  copies: 1 | 2 = 1,
  collected?: CollectedProjectionContext,
): Generator<void> {
  if (copies !== 1 && copies !== 2) throw new Error('Invalid packed projection state count')
  capture.reader.at(root)
  if (root.length > 64 || typeof inspect !== 'function')
    throw new Error('Invalid packed projection state request')
  assertPackedProjectionOptions(options)
  const work = stateSteps(
    capture,
    source,
    [...root],
    { ...options },
    { ...limits },
    inspect,
    prune,
    copies,
    collected,
  )
  return (function* () {
    try {
      while (true) {
        capture.identity
        const next = work.next()
        capture.identity
        if (next.done) return
        yield
      }
    } finally {
      work.return(undefined)
    }
  })()
}

export function assertPackedProjectionOptions(options: RenderOptions): void {
  if (
    !options ||
    Object.keys(options).length !== 3 ||
    Object.keys(options).some(
      (key) => !['rawHtml', 'footnotesLabel', 'footnoteBackLabel'].includes(key),
    ) ||
    typeof options.rawHtml !== 'boolean' ||
    typeof options.footnotesLabel !== 'string' ||
    options.footnotesLabel.length > 200 ||
    typeof options.footnoteBackLabel !== 'string' ||
    options.footnoteBackLabel.length > 200
  )
    throw new Error('Invalid packed projection state options')
}

function* stateSteps(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  options: RenderOptions,
  limits: ProjectionLimits,
  inspect: (
    context: readonly ProjectionDefinition[],
    cost: PackedProjectionStateCost,
  ) => Generator<void>,
  prune: PackedProjectionPrune | undefined,
  copies: 1 | 2,
  collected?: CollectedProjectionContext,
): Generator<void> {
  if (
    source.identity.rendererVersion !== rendererVersion ||
    source.identity.options !== JSON.stringify(options)
  )
    invalidPackedSemantic()
  yield* packedProjectionContextSteps(
    capture,
    source,
    root,
    limits,
    function* (context, cost) {
      // Include a second state during finish(): the public footer API first constructs its
      // own maps, then transfers the accumulated counters/order. Duplicate IDs deliberately
      // overcount entries. 32 bytes per input UTF-16 unit covers uppercase key expansion and
      // simultaneous key copies. General text/URLs never inflate the persistent-state budget.
      const fixed = 32768 + (limits.depth + 8) * 1024
      let definitions = 0
      let references = cost.bodyReferences
      let identifierUnits = cost.bodyReferenceUnits
      let visited = 0
      const bytes = () =>
        (fixed + (definitions + references) * 1024 + identifierUnits * 32) * copies
      const admit = () => {
        const total = cost.retainedBytes + bytes()
        if (
          total + (limits.depth + 16) * 512 > limits.retained ||
          cost.stagingBytes + bytes() > limits.staging
        )
          throw new Error('Packed projection state exceeds workspace limit')
      }
      admit()
      let workspace = capture.workspace(fixed * copies, fixed * copies)
      function* visit(node: Nodes, depth: number): Generator<void> {
        if (++visited > limits.nodes || depth > limits.depth)
          throw new Error('Packed projection state traversal limit')
        if (
          node.type === 'definition' ||
          node.type === 'footnoteDefinition' ||
          node.type === 'footnoteReference'
        ) {
          if (typeof node.identifier !== 'string') invalidPackedSemantic()
          if (node.type === 'footnoteReference') references++
          else definitions++
          identifierUnits += node.identifier.length
          admit()
        }
        yield
        if ('children' in node) for (const child of node.children) yield* visit(child, depth + 1)
      }
      try {
        for (const node of context) yield* visit(node, 1)
        admit()
        const stateBytes = bytes()
        workspace.release()
        workspace = capture.workspace(stateBytes, stateBytes)
        // No native map/counter allocation before the full reservation is admitted.
        yield
        yield* inspect(
          context,
          Object.freeze({
            retainedBytes: cost.retainedBytes + stateBytes,
            stagingBytes: cost.stagingBytes + stateBytes,
            stateBytes,
            context: cost,
            definitions,
            references,
            identifierUnits,
          }),
        )
      } finally {
        workspace.release()
      }
    },
    prune,
    collected,
  )
}
