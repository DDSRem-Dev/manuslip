import { semanticLimits, sourceHash } from '@manuslip/core'
import type { Text } from '@manuslip/editor'
import { type RenderOptions, rendererVersion } from '@manuslip/renderer'
import { packValueSteps } from '../../../../../../packages/core/src/packing'
import type { PackedCapture } from '../../../../../../packages/core/src/packing-capture'
import type {
  PackedSession,
  PackedTicket,
} from '../../../../../../packages/core/src/packing-session'
import { PackedSource } from '../../../../../../packages/core/src/packing-source'
import { PackedWork } from '../../../../../../packages/core/src/packing-work'
import type { Snapshot } from '../semantics/protocol'
import { OwnedPackedPreview } from './packed-preparation'

function* advance<T>(work: PackedWork<T>): Generator<void, T | undefined, undefined> {
  while (true) {
    const step = work.next()
    if (step.done) return step.value
    yield
  }
}

/** One cancellable task owns encoding, indexing, validation and native model preparation. */
export function prepareOwnedPreview(
  owner: PackedSession,
  snapshot: Snapshot,
  source: Text,
  documentId: string,
  revision: number,
  options: RenderOptions,
  previous?: OwnedPackedPreview,
): PackedWork<OwnedPackedPreview> {
  return new PackedWork(
    (function* () {
      let encoding: PackedWork<ArrayBuffer> | undefined
      let indexing: PackedWork<PackedTicket> | undefined
      let preparation: PackedWork<OwnedPackedPreview> | undefined
      let capture: PackedCapture | undefined
      try {
        // Always expose a cancellation point before any complete-source admission.
        yield
        if (!snapshot.layout) throw new Error('Missing packed preview layout')
        const sourceText = source.toString()
        const identity = {
          generation: 1,
          revision,
          documentId,
          sourceHash: sourceHash(sourceText),
          parserVersion: snapshot.document.parserVersion,
          rendererVersion,
          options: JSON.stringify(options),
        }
        const packedSource = new PackedSource(identity, sourceText)
        yield
        encoding = packValueSteps(
          {
            snapshot: {
              document: snapshot.document,
              projection: snapshot.projection,
              layout: snapshot.layout,
            },
          },
          semanticLimits.messageBytes,
          { working: 32 * 1024 * 1024, nodes: 800000, depth: 512 },
        )
        const payload = yield* advance(encoding)
        if (!payload) throw new Error('Incomplete packed preview encoding')
        const ticket = owner.beginPrepared(packedSource)
        indexing = owner.prepareFullSteps(ticket, identity, payload)
        const prepared = yield* advance(indexing)
        if (!prepared) throw new Error('Incomplete packed preview indexing')
        owner.commit(prepared)
        capture = owner.capture()
        preparation = OwnedPackedPreview.prepare(
          capture,
          packedSource,
          source,
          ['snapshot'],
          options,
          { retained: 32 * 1024 * 1024, staging: 8 * 1024 * 1024, nodes: 800000, depth: 128 },
          previous,
          {},
          true,
        )
        const owned = yield* advance(preparation)
        if (!owned) throw new Error('Incomplete packed preview preparation')
        return owned
      } finally {
        preparation?.return()
        capture?.release()
        indexing?.return()
        encoding?.return()
        owner.evict()
      }
    })(),
    () => {},
  )
}
