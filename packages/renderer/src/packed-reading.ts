import type { Nodes, RootContent } from 'mdast'
import { semanticLimits } from '../../core/src/contracts'
import type { PackedCapture } from '../../core/src/packing-capture'
import { inspectPackedNativeStream } from '../../core/src/packing-native-stream'
import type { PackedSource } from '../../core/src/packing-source'
import { packedRootWorkspace, validatePackedRoot } from '../../core/src/packing-validate-root'
import type { PackedPath } from '../../core/src/packing-view'
import type { PackedWork } from '../../core/src/packing-work'
import type { ProjectionLimits } from './fragment-projection-context'
import type { RenderOptions } from './index'
import {
  assertPackedProjectionOptions,
  inspectPackedProjectionStateContext,
} from './packed-projection-state'
import { PackedReadingOutput } from './packed-reading-output'
import type { ReadingOptions, ReadingProjection } from './reading'
import { readingProjectionBytes } from './reading'
import { ReadingSequence } from './reading-sequence'
import { ReadingWorkspace } from './reading-workspace'

export interface PackedReadingChildren {
  children(node: Nodes, nativeBytes: number): Nodes[] | undefined
  reset(): void
}
export interface PackedReadingCost {
  readonly retainedPeakBytes: number
  readonly stagingPeakBytes: number
  readonly outputBytes: number
  readonly blocks: number
}

// Keep escaped inspector callbacks in a separate closure from source, arena and frame
// ownership. Revocation clears the only reference back to the active render scope.
function readingOutputBorrow(create: () => PackedReadingOutput) {
  let current: (() => PackedReadingOutput) | undefined = create
  return {
    retain: () => {
      if (!current) throw new Error('Packed reading output borrow closed')
      return current()
    },
    close: () => {
      current = undefined
    },
  }
}

/** Internal reading consumer: full source-bound validation, admitted global language
 * states, one admitted native block and paired HAST/serialization frame at a time, and
 * separately admitted persistent row/slot output. Translation metadata/reconstruction
 * belongs to the supplied projection inspector and shares this capture's session ledger.
 * The trusted output inspector must not retain the borrowed result without its own owner.
 * Native conversion/planning/serialization remain synchronous between stream yields.
 */
export function inspectPackedReading(
  capture: PackedCapture,
  source: PackedSource,
  root: PackedPath,
  options: RenderOptions,
  reading: Omit<ReadingOptions, 'children'>,
  limits: ProjectionLimits,
  children: PackedReadingChildren | undefined,
  inspect: (
    projection: ReadingProjection,
    cost: Readonly<PackedReadingCost>,
    retain: () => PackedReadingOutput,
  ) => Generator<void>,
): PackedWork<void> {
  capture.reader.at(root)
  if (
    root.length > 64 ||
    typeof inspect !== 'function' ||
    !['replace', 'side-by-side', 'interlinear'].includes(reading.layout) ||
    reading.blocks.length > semanticLimits.blocks + 1 ||
    reading.units.length > semanticLimits.blocks ||
    [
      reading.sourceLanguage,
      reading.targetLanguage,
      reading.labels.original,
      reading.labels.translation,
    ].some((text) => typeof text !== 'string' || text.length > 200)
  )
    throw new Error('Invalid packed reading request')
  const path = [...root],
    render = { ...options },
    budget = { ...limits }
  assertPackedProjectionOptions(render)
  // Reading reprojects a completely validated mdast root, with no captured HAST/policy
  // reuse. Preserve the source's original render stamp for context validation while
  // allowing the requested raw-HTML policy/localized footer labels to change.
  const contextOptions: RenderOptions = JSON.parse(source.identity.options)
  const settings = { ...reading, labels: { ...reading.labels } }
  return capture.work(
    (function* () {
      const validation = packedRootWorkspace(source, path, budget)
      yield* validatePackedRoot(capture, source, path, budget)
      let retainedPeakBytes = validation,
        stagingPeakBytes = validation,
        blocks = 0
      yield* inspectPackedProjectionStateContext(
        capture,
        source,
        path,
        contextOptions,
        budget,
        function* (context, state) {
          const output = capture.reserveWorkspace(0, 0)
          let outputBytes = 0,
            outputScratch = 0,
            nativeBytes = 0
          let frame: ReadingWorkspace | undefined
          let sequence: ReadingSequence | undefined
          let owned: PackedReadingOutput | undefined
          let completed = false
          let borrow: ReturnType<typeof readingOutputBorrow> | undefined
          const admit = (
            frameBytes = frame?.bytes ?? 0,
            bytes = outputBytes,
            scratch = outputScratch,
          ) => {
            const retained = state.retainedBytes + nativeBytes + frameBytes + bytes
            const staging = state.stagingBytes + nativeBytes + frameBytes + scratch
            if (retained > budget.retained || staging > budget.staging)
              throw new Error('Packed reading exceeds workspace limit')
            retainedPeakBytes = Math.max(retainedPeakBytes, retained)
            stagingPeakBytes = Math.max(stagingPeakBytes, staging)
          }
          const finishFrame = () => {
            try {
              children?.reset()
            } finally {
              frame?.close()
              frame = undefined
            }
            nativeBytes = 0
          }
          const startFrame = () => {
            frame = new ReadingWorkspace(
              capture,
              render,
              {
                ...budget,
                depth: Math.min(512, budget.depth * 4 + 16),
              },
              state,
              (bytes) => admit(bytes),
            )
          }
          try {
            sequence = new ReadingSequence(
              context,
              render,
              {
                ...settings,
                children: children
                  ? (node) =>
                      children.children(node, Math.max(state.context.nativeBytes, nativeBytes))
                  : undefined,
              },
              (bytes, scratch = 0) => {
                admit(undefined, bytes, scratch)
                output.resize(bytes, scratch)
                outputBytes = bytes
                outputScratch = scratch
              },
            )
            sequence.admit({
              converted(value) {
                if (!frame) throw new Error('Reading frame closed')
                frame.converted(value)
                children?.reset()
              },
              node(current, node, parent) {
                if (!frame) throw new Error('Reading frame closed')
                frame.node(current, node, parent)
              },
              footer(current) {
                if (!frame) throw new Error('Reading frame closed')
                frame.footer(current)
              },
              project(value) {
                if (!frame) throw new Error('Reading frame closed')
                frame.project(value)
              },
              decorate(tree) {
                if (!frame) throw new Error('Reading frame closed')
                frame.decorate(tree)
              },
              serialize(tree) {
                if (!frame) throw new Error('Reading frame closed')
                frame.serialize(tree)
              },
              finalize: finishFrame,
            })
            const items = capture.reader.elementSteps([...path, 'children'])
            try {
              for (const item of items) {
                if (!item) {
                  yield
                  continue
                }
                if (++blocks > semanticLimits.blocks) throw new Error('Packed reading block limit')
                yield* inspectPackedNativeStream(
                  capture,
                  item,
                  {
                    ...budget,
                    depth: Math.min(512, budget.depth * 4 + 16),
                    retained: budget.retained - state.retainedBytes - outputBytes,
                    staging: budget.staging - state.stagingBytes,
                  },
                  function* (value, copied) {
                    nativeBytes = copied.stagingBytes
                    startFrame()
                    try {
                      sequence?.append(value as RootContent)
                      finishFrame()
                      yield
                    } finally {
                      frame?.close()
                      frame = undefined
                      nativeBytes = 0
                    }
                  },
                )
              }
            } finally {
              items.return()
            }
            startFrame()
            const projection = sequence.finish()
            admit()
            borrow = readingOutputBorrow(() => {
              if (owned) throw new Error('Packed reading output already retained')
              const bytes = 4096 + readingProjectionBytes(projection)
              admit(undefined, bytes, 0)
              output.resize(bytes, 0)
              outputBytes = bytes
              outputScratch = 0
              owned = new PackedReadingOutput(capture, projection, output)
              return owned
            })
            yield* inspect(
              projection,
              Object.freeze({ retainedPeakBytes, stagingPeakBytes, outputBytes, blocks }),
              borrow.retain,
            )
            completed = true
          } finally {
            borrow?.close()
            try {
              sequence?.close()
            } finally {
              try {
                frame?.close()
              } finally {
                if (!completed || !owned) {
                  owned?.release()
                  output.release()
                }
              }
            }
          }
        },
        undefined,
        settings.layout === 'replace' ? 1 : 2,
      )
    })(),
  )
}
