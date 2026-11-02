import { semanticLimits } from '@manuslip/core'
import type { RenderOptions } from '@manuslip/renderer'
import { createPackedSequenceEncoding } from '../../../../../../packages/core/src/packing'
import type { PackedCapture } from '../../../../../../packages/core/src/packing-capture'
import { finishPackedCleanup } from '../../../../../../packages/core/src/packing-cleanup'
import type { PackedEncodingLimits } from '../../../../../../packages/core/src/packing-encode-budget'
import type { PackedHold } from '../../../../../../packages/core/src/packing-hold'
import { preparedMarkdownDocumentInput } from '../../../../../../packages/core/src/packing-markdown'
import type { PackedSequence } from '../../../../../../packages/core/src/packing-sequence'
import type {
  PackedSession,
  PackedTicket,
} from '../../../../../../packages/core/src/packing-session'
import type { PackedSource } from '../../../../../../packages/core/src/packing-source'
import { PackedWork } from '../../../../../../packages/core/src/packing-work'
import type { PackedProjectionPlan } from '../../../../../../packages/renderer/src/packed-projection-plan'
import { prepareValidatedPackedProjectionPlan } from '../../../../../../packages/renderer/src/packed-projection-plan-validated'

/** Complete experimental result with one existing owner. Native tokenizer/compiler work
 * remains partly atomic/unadmitted; no full native MDAST root or joined render is retained
 * by this coordinator. Independent old captures continue to count against the same cap.
 */
export function encodeProducerFull(
  owner: PackedSession,
  ticket: PackedTicket,
  source: PackedSource,
  options: RenderOptions,
  encoding: PackedEncodingLimits,
  staging: number,
  phase: (phase: 'parse' | 'render' | 'encode') => void,
  activeTime?: () => number,
): PackedWork<{ payload: ArrayBuffer; serializeMs: number }> {
  const byteLimit = semanticLimits.messageBytes - 1024
  const budget = {
    retained: semanticLimits.snapshotBytes,
    staging: Math.min(staging, semanticLimits.messageBytes),
    nodes: encoding.nodes,
    depth: 128,
  }
  let child: PackedWork<unknown> | undefined
  let allocation: PackedHold | undefined
  let document: PackedCapture | undefined
  let sequence: PackedSequence | undefined
  let plan: PackedProjectionPlan | undefined
  let input: ReturnType<typeof preparedMarkdownDocumentInput> | undefined
  let activeMs = 0
  function* run<T>(work: PackedWork<T>): Generator<void, T, undefined> {
    child = work
    if (activeTime) {
      const value = yield* work
      if (value === undefined) throw new Error('Incomplete packed producer stage')
      return value
    }
    while (true) {
      const before = performance.now()
      const next = work.next()
      activeMs += performance.now() - before
      if (next.done) {
        if (next.value === undefined) throw new Error('Incomplete packed producer stage')
        return next.value
      }
      yield
    }
  }
  function* advance(boundary?: number): Generator<void, ArrayBuffer | undefined, undefined> {
    if (!sequence) throw new Error('Missing packed producer sequence')
    child = sequence.work
    while (true) {
      const before = activeTime ? 0 : performance.now()
      const next = sequence.work.next()
      if (!activeTime) activeMs += performance.now() - before
      if (next.done) {
        if (!next.value) throw new Error('Incomplete packed producer sequence')
        return next.value
      }
      yield
      if (boundary !== undefined && sequence.boundary === boundary) return undefined
    }
  }
  const admit = (bytes: number) => {
    const key = Object.freeze({})
    allocation = owner.retain({ resources: () => [{ key, bytes: bytes + 256 }] })
  }
  const cleanup = () =>
    finishPackedCleanup([
      () => child?.return(),
      () => sequence?.close(),
      () => plan?.close(),
      () => finishPackedCleanup((input?.arrays ?? []).map((array) => () => array.return())),
      () => document?.release(),
      () => allocation?.release(),
    ])
  return new PackedWork(
    (function* () {
      const started = activeTime?.()
      phase('parse')
      sequence = createPackedSequenceEncoding(
        ['document', 'projection', 'layout'],
        byteLimit,
        encoding,
        admit,
      )
      input = preparedMarkdownDocumentInput(source)
      sequence.supply(input.value, input.arrays)
      input = undefined
      yield* advance(0)
      let payload: ArrayBuffer | undefined = yield* run(sequence.copy(admit))
      allocation?.release()
      allocation = undefined
      document = yield* run(owner.stageFullSteps(ticket, payload))
      payload = undefined
      const small = { retained: 16, staging: 0 }
      const parse = document.reader.scalar(['timings', 'parse'], small)
      const describe = document.reader.scalar(['timings', 'describe'], small)
      if (typeof parse !== 'number' || typeof describe !== 'number')
        throw new Error('Invalid packed producer parser timings')
      phase('render')
      plan = yield* run(
        prepareValidatedPackedProjectionPlan(document, source, ['root'], options, budget),
      )
      document.release()
      document = undefined
      const render = plan.renderMs
      phase('encode')
      sequence.supply(plan.projection, plan.arrays, plan.captures)
      yield* advance(1)
      sequence.supply(plan.layout)
      const result = yield* advance()
      if (!result) throw new Error('Incomplete packed producer snapshot')
      // The caller immediately exchanges this admitted output for its wire/copy reserve.
      // Cleanup closes the independent plan before control returns to that caller.
      const elapsed = activeTime && started !== undefined ? activeTime() - started : activeMs
      return { payload: result, serializeMs: Math.max(0, elapsed - parse - describe - render) }
    })(),
    cleanup,
  )
}
