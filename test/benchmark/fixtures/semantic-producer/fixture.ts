import { PackedSemanticReceiver } from '../../../../apps/desktop/src/renderer/src/semantics/packed-receiver'
import { browserRuntime } from '../../../../apps/desktop/src/renderer/src/semantics/sliced-work'
import { parserVersion, semanticLimits, sourceHash } from '../../../../packages/core/src/contracts'
import { unpackValue } from '../../../../packages/core/src/packing'
import { PackedReceiver } from '../../../../packages/core/src/packing-receiver'
import { PackedSource } from '../../../../packages/core/src/packing-source'
import type { PackedWireMessage } from '../../../../packages/core/src/packing-wire'
import { finishPackedSteps } from '../../../../packages/core/src/packing-work'
import { rendererVersion } from '../../../../packages/renderer/src/index'
import { validatePackedSnapshot } from '../../../../packages/renderer/src/packing-validate-snapshot'

const options = { rawHtml: false, footnotesLabel: 'Footnotes', footnoteBackLabel: 'Back' }
const validation = {
  retained: 32 * 1024 * 1024,
  staging: semanticLimits.messageBytes,
  nodes: 800000,
  depth: 128,
}
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
async function hash(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
declare global {
  interface Window {
    runProducerProbe(
      text: string,
      edits?: readonly string[],
      receiverCache?: boolean,
      producerCache?: boolean,
    ): Promise<unknown>
    receiverProbePhase?: (phase: 'start' | 'end', revision: number) => Promise<void>
  }
}
window.runProducerProbe = async (
  text,
  edits = [],
  receiverCache = false,
  producerCache = false,
) => {
  const worker = new Worker(new URL('./producer.worker.ts', import.meta.url), { type: 'module' })
  const session = {
    bytes: semanticLimits.messageBytes,
    retained: semanticLimits.rendererBytes,
    staging: semanticLimits.messageBytes,
    captures: 8,
    readers: 160,
  }
  const receiver = receiverCache
    ? new PackedSemanticReceiver(session, validation)
    : new PackedReceiver(session, (capture, source) =>
        validatePackedSnapshot(capture, source, [], options, validation),
      )
  const initialSource = new PackedSource(
    {
      generation: 1,
      documentId: 'producer-probe',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: `${parserVersion}/manuslip`,
      rendererVersion,
      options: JSON.stringify(options),
    },
    text,
  )
  type Stats = {
    current: unknown
    retainedBytes: number
    outgoingReservedBytes: number
    prepared: unknown
    requested: unknown
    cacheEvictions: number
  }
  type Response =
    | { kind: 'error'; message: string; stats: Stats }
    | {
        kind: 'offer'
        message: Exclude<PackedWireMessage, { kind: 'resync' }>
        stats: Stats
        report: unknown
      }
    | { kind: 'acknowledged'; stats: Stats }
    | { kind: 'cached'; ready: boolean; stats: Stats; report: unknown }
  const rpc = (message: unknown) =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Producer diagnostic timed out')), 60000)
      worker.onmessage = (event) => {
        clearTimeout(timer)
        resolve(event.data)
      }
      worker.onerror = (event) => {
        clearTimeout(timer)
        reject(new Error(event.message))
      }
      worker.postMessage(message)
    })
  const rounds = []
  const caches = []
  const producerCaches = []
  const texts = [text, ...edits, edits.at(-1) ?? text]
  try {
    for (let round = 0; round < texts.length; round++) {
      const cached = round === texts.length - 1
      if (cached) receiver.evict()
      const currentText = texts[round]
      assert(currentText !== undefined, 'Missing source')
      const revision = cached ? edits.length : round
      const source = new PackedSource(
        { ...initialSource.identity, revision, sourceHash: sourceHash(currentText) },
        currentText,
      )
      const ticket =
        receiver instanceof PackedSemanticReceiver
          ? receiver.begin(round + 1, source, options)
          : receiver.begin(round + 1, source)
      const response = await rpc({
        kind: 'prepare',
        exchange: ticket,
        input: {
          kind: 'parse',
          sequence: round + 1,
          generation: 1,
          documentId: 'producer-probe',
          revision,
          source: currentText,
          options,
          sentAt: performance.timeOrigin + performance.now(),
        },
      })
      if (response.kind === 'error') {
        assert(
          response.stats.prepared === null && response.stats.requested === null,
          'Failed producer retained pending work',
        )
        return { kind: 'rejected', error: response.message, stats: response.stats, rounds }
      }
      assert(response.kind === 'offer', 'Missing worker offer')
      const message = response.message
      if (!round || cached) assert(message.kind === 'full', 'Expected full producer result')
      assert(
        round && !(cached && response.stats.cacheEvictions > 0)
          ? response.stats.current !== null
          : response.stats.current === null,
        'Premature worker commit',
      )
      assert(
        message.metadata.cached === cached ||
          (cached && !message.metadata.cached && response.stats.cacheEvictions > 0),
        'Unexpected cache state',
      )
      const payloadBytes = message.payload.byteLength
      function semanticHash(payload: ArrayBuffer) {
        const decoded = unpackValue(payload, {
          bytes: semanticLimits.messageBytes,
          retained: semanticLimits.rendererBytes,
          staging: semanticLimits.messageBytes,
        }).value as {
          document: Record<string, unknown>
          projection: Record<string, unknown>
          layout: unknown
        }
        return hash(
          JSON.stringify({
            document: { ...decoded.document, timings: null },
            projection: { ...decoded.projection, renderMs: null },
            layout: decoded.layout,
          }),
        )
      }
      let semanticSha256 = message.kind === 'full' ? await semanticHash(message.payload) : undefined
      const work = receiver.receiveSteps(ticket, message)
      if (round && !cached) await window.receiverProbePhase?.('start', revision)
      const started = performance.now()
      let batch = started
      let largestStepMs = 0
      try {
        while (true) {
          const stepStarted = performance.now()
          const next = work.next()
          largestStepMs = Math.max(largestStepMs, performance.now() - stepStarted)
          if (next.done) {
            assert(next.value?.kind === 'accepted', 'Receiver rejected producer result')
            const receiverMs = performance.now() - started
            if (round && !cached) await window.receiverProbePhase?.('end', revision)
            const acknowledged = await rpc({
              kind: 'ack',
              acknowledgement: next.value.acknowledgement,
            })
            assert(
              acknowledged.kind === 'acknowledged' && acknowledged.stats.current !== null,
              'Worker did not commit exact ACK',
            )
            assert(
              acknowledged.stats.outgoingReservedBytes === 0,
              'Worker retained outgoing reserve after ACK',
            )
            try {
              if (!semanticSha256) {
                // Diagnostic-only complete materialization AFTER independent validation;
                // this is not an admitted application consumer or part of receiver timing.
                const encoded = finishPackedSteps(
                  next.value.capture.serialize([], {
                    bytes: semanticLimits.messageBytes,
                    workspace: semanticLimits.messageBytes - 65536,
                    nodes: 800000,
                    depth: 128,
                  }),
                )
                assert(encoded, 'Missing complete delta encoding')
                try {
                  semanticSha256 = await semanticHash(encoded.value.payload)
                } finally {
                  encoded.release()
                }
              }
            } finally {
              next.value.capture.release()
            }
            rounds.push({
              kind: message.kind,
              revision,
              resync: cached,
              cached: message.metadata.cached,
              payloadBytes,
              semanticSha256,
              producer: response.report,
              receiverMs,
              receiverLargestStepMs: largestStepMs,
              receiver: receiver.stats,
              worker: acknowledged.stats,
            })
            break
          }
          if (performance.now() - batch >= 2) {
            await new Promise<void>((resolve) => browserRuntime.defer(resolve))
            batch = performance.now()
          }
        }
      } finally {
        work.return()
        if (round && !cached) await window.receiverProbePhase?.('end', revision)
      }
      const warmup = round === 0 && producerCache ? rpc({ kind: 'cache' }) : undefined
      if (round === 0 && receiver instanceof PackedSemanticReceiver) {
        const work = receiver.cacheSteps()
        const started = performance.now()
        let batch = started,
          largestStepMs = 0,
          steps = 0,
          peakRetainedBytes = receiver.stats.retainedBytes,
          peakStagingBytes = receiver.stats.readerStagingBytes
        try {
          while (true) {
            const stepStarted = performance.now()
            const step = work.next()
            largestStepMs = Math.max(largestStepMs, performance.now() - stepStarted)
            steps++
            peakRetainedBytes = Math.max(peakRetainedBytes, receiver.stats.retainedBytes)
            peakStagingBytes = Math.max(peakStagingBytes, receiver.stats.readerStagingBytes)
            if (step.done) {
              caches.push({
                result: step.value,
                ms: performance.now() - started,
                steps,
                largestStepMs,
                peakRetainedBytes,
                peakStagingBytes,
                receiver: receiver.stats,
              })
              break
            }
            if (performance.now() - batch >= 2) {
              await new Promise<void>((resolve) => browserRuntime.defer(resolve))
              batch = performance.now()
            }
          }
        } finally {
          work.return()
        }
      }
      if (warmup) {
        const result = await warmup
        assert(result.kind === 'cached' && result.ready, 'Producer dependency warmup unavailable')
        producerCaches.push({ report: result.report, worker: result.stats })
      }
    }
    return { kind: 'accepted', rounds, caches, producerCaches }
  } finally {
    receiver.dispose()
    worker.terminate()
    assert(receiver.stats.retainedBytes === 0, 'Receiver cleanup leaked ledger ownership')
  }
}
