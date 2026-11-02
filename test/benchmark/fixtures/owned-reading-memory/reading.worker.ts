import { sourceHash } from '../../../../packages/core/src/contracts'
import type { PackedCapture } from '../../../../packages/core/src/packing-capture'
import type { PackedIdentity } from '../../../../packages/core/src/packing-revision'
import { PackedSession } from '../../../../packages/core/src/packing-session'
import { PackedSource } from '../../../../packages/core/src/packing-source'
import { finishPackedSteps } from '../../../../packages/core/src/packing-work'
import type { RenderOptions } from '../../../../packages/renderer/src/index'
import { rendererVersion } from '../../../../packages/renderer/src/index'
import { inspectPackedReading } from '../../../../packages/renderer/src/packed-reading'
import type { ReadingBlock, ReadingLayout } from '../../../../packages/renderer/src/reading'
import { readingJsonBytes } from '../../../../packages/renderer/src/reading-bytes'
import {
  buildPackedTranslationPlan,
  type PackedTranslationPlan,
} from '../../../../packages/translate/src/packed-plan'

// Diagnostic actor only: actual owned consumers and a transferred complete packed root.
// Provider/hash jobs and the application's production queue/wire are not exercised here.
const MiB = 1024 * 1024
const limits = { retained: 24 * MiB, metadata: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 64 }
const options: RenderOptions = { rawHtml: true, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
let owner: PackedSession | undefined
let capture: PackedCapture | undefined
let source: PackedSource | undefined
let plan: PackedTranslationPlan | undefined
let blocks: ReadingBlock[] = []

function clear() {
  try {
    owner?.dispose()
  } finally {
    owner = undefined
    capture = undefined
    source = undefined
    plan = undefined
    blocks = []
  }
}
function checkpoint(phase: string, bytes: number) {
  const hook = Reflect.get(globalThis, '__ownedReadingCheckpoint')
  if (hook) hook(phase, bytes, owner?.stats)
}
function prepare(operation: {
  payload: ArrayBuffer
  source: string
  blocks: ReadingBlock[]
  identity: PackedIdentity
}) {
  clear()
  if (
    operation.identity.rendererVersion !== rendererVersion ||
    operation.identity.options !== JSON.stringify(options) ||
    operation.identity.sourceHash !== sourceHash(operation.source)
  )
    throw new Error('Invalid diagnostic identity')
  owner = new PackedSession({
    retained: 32 * MiB,
    staging: 8 * MiB,
    bytes: 8 * MiB,
    captures: 8,
    readers: 160,
  })
  source = new PackedSource(operation.identity, operation.source)
  // The input buffer transfers into the arena. Separately admit the supplied block records
  // and other envelope metadata; the source and arena are charged by their actual owners.
  const metadataBytes =
    65536 + readingJsonBytes({ identity: operation.identity, blocks: operation.blocks }) * 2
  const key = {}
  owner.retain({ resources: () => [{ key, bytes: metadataBytes }] })
  owner.commit(owner.prepareFull(owner.beginPrepared(source), source.identity, operation.payload))
  capture = owner.capture()
  owner.evict()
  plan = finishPackedSteps(buildPackedTranslationPlan(capture, source, ['root'], limits))
  if (!plan) throw new Error('Missing diagnostic plan')
  blocks = operation.blocks
  checkpoint('plan', owner.stats.retainedBytes)
  return { units: plan.units.length, cost: plan.cost, stats: owner.stats }
}
function render(layout: ReadingLayout, publish: (value: unknown) => void) {
  if (!plan || !capture || !source || !owner) throw new Error('Diagnostic not prepared')
  const active = { plan, capture, source, owner }
  finishPackedSteps(
    active.plan.inspectProjection(
      (unit) => (unit.payload ? `Changed ${unit.payload.text}` : undefined),
      limits,
      function* (projected) {
        yield* inspectPackedReading(
          active.capture,
          active.source,
          ['root'],
          options,
          {
            layout,
            blocks,
            units: active.plan.units,
            translated: new Set(
              active.plan.units
                .filter((_, index) => projected.status(index) === 'translated')
                .map((unit) => `${unit.from}:${unit.to}`),
            ),
            sourceLanguage: 'en',
            targetLanguage: 'ar',
            labels: { original: 'Original', translation: 'Translation' },
            indexAboveBytes: 0,
          },
          limits,
          projected,
          function* (projection, cost) {
            checkpoint('output', active.owner.stats.retainedBytes)
            // Copy to the independent driver while this borrow is still admitted.
            publish({ projection, cost })
            yield
          },
        )
      },
    ),
  )
}
addEventListener('message', ({ data }) => {
  try {
    const operation = data.operation
    if (operation.kind === 'render') {
      render(operation.layout, (value) => postMessage({ sequence: data.sequence, value }))
      return
    }
    let value: unknown
    if (operation.kind === 'prepare') value = prepare(operation)
    else {
      clear()
      value = { cleared: true }
    }
    postMessage({ sequence: data.sequence, value })
  } catch (error) {
    const details = JSON.stringify({
      message: error instanceof Error ? error.stack : String(error),
      stats: owner?.stats,
      checkpoint: Reflect.get(globalThis, '__ownedReadingSample'),
    })
    clear()
    postMessage({
      sequence: data.sequence,
      error: details,
    })
  }
})
