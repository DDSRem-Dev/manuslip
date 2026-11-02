import { parserVersion, sourceHash } from '@manuslip/core'
import { rendererVersion } from '@manuslip/renderer'
import type { PackedCapture } from '../../../../../../packages/core/src/packing-capture'
import type { PackedHold } from '../../../../../../packages/core/src/packing-hold'
import type {
  PackedReceived,
  PackedReceiveTicket,
} from '../../../../../../packages/core/src/packing-receiver'
import {
  PackedSource,
  PackedSourceJsonLimitError,
  packedSourceSteps,
} from '../../../../../../packages/core/src/packing-source'
import { PackedWork } from '../../../../../../packages/core/src/packing-work'
import type { PackedSnapshotCertificate } from '../../../../../../packages/renderer/src/packed-snapshot-certificate'
import { type SemanticFailureReason, semanticMetric } from './metrics'
import { packedChannelKind, readPackedChannelError, sameCorrelation } from './packed-channel'
import type { PackedSemanticReceiver } from './packed-receiver'
import { capturePackedRequest } from './packed-request-source'
import { absoluteNow, type ParseRequest, parseRequest } from './protocol'
import { browserRuntime, SlicedWork, type SliceRuntime } from './sliced-work'

export interface PackedSnapshot {
  readonly kind: 'packed'
  /** Latest wire payload; delta bytes do not measure the complete revision. */
  readonly bytes: number
  readonly retainedBytes: number
  readonly cached: boolean
  readonly transportInMs: number
  readonly serializeMs: number
  readonly parseMs: number
  readonly describeMs: number
  readonly renderMs: number
}
interface ResultIdentity {
  readonly sequence: number
  readonly generation: number
  readonly documentId: string
  readonly revision: number
  readonly sentAt: number
}
export type PackedSemanticResult = ResultIdentity &
  (
    | {
        readonly kind: 'packed-result'
        readonly snapshot: PackedSnapshot
        readonly capture: PackedCapture
        readonly certificate: PackedSnapshotCertificate
      }
    | { readonly kind: 'error'; readonly code: 'semantic-limit' | 'semantic-parse' }
  )
export interface PackedWorkerPort {
  readonly kind: 'packed'
  /** The result capture is borrowed only through this synchronous notification. */
  onResult(listener: (result: PackedSemanticResult) => void): void
  onFailure(listener: (reason?: SemanticFailureReason) => void): void
  post(request: ParseRequest): void
  /** Application scheduling path; legacy post retains synchronous source validation. */
  postCooperative?(request: ParseRequest): void
  /** Fixed-shape application path; exact source JSON sizing shares the queued source scan. */
  postRequestCooperative?(request: ParseRequest): void
  warm(): void
  cancel(): void
  terminate(): void
}
export interface PackedChannelPort {
  onMessage(listener: (value: unknown) => void): void
  onFailure(listener: (reason?: SemanticFailureReason) => void): void
  post(value: unknown): void
  terminate(): void
}
interface Request {
  readonly input: ParseRequest
  readonly source: PackedSource
  readonly ticket: PackedReceiveTicket
  readonly retries: number
}
/** Renderer transport over a borrowed window receiver. Worker restarts evict cache/current
 * ownership, while old consumer captures remain charged in the same renderer session.
 * Complete cooperative validation precedes every ACK and borrowed result notification.
 */
export class PackedSemanticPort implements PackedWorkerPort {
  readonly kind = 'packed'
  readonly #hold: PackedHold
  #request: Request | undefined
  #work: { cancel(): void } | undefined
  #resume: (() => void) | undefined
  #scheduled = false
  #backgroundResume: (() => void) | undefined
  #backgroundScheduled = false
  #closed = false
  #result: ((result: PackedSemanticResult) => void) | undefined
  #failure: ((reason: SemanticFailureReason) => void) | undefined
  readonly #slices: SliceRuntime
  readonly #backgroundSlices: SliceRuntime
  constructor(
    private readonly channel: PackedChannelPort,
    private readonly receiver: PackedSemanticReceiver,
    private readonly runtime: SliceRuntime = browserRuntime,
  ) {
    try {
      this.#hold = receiver.retain({ resources: () => [{ key: this, bytes: 4096 }] })
    } catch (error) {
      channel.terminate()
      throw error
    }
    try {
      this.#slices = { now: runtime.now.bind(runtime), defer: (run) => this.#defer(run) }
      this.#backgroundSlices = {
        now: runtime.now.bind(runtime),
        defer: (run) => this.#defer(run, true),
      }
      channel.onMessage((value) => {
        if (!this.#closed) this.#received(value)
      })
      channel.onFailure((reason) => this.#failed(reason ?? 'worker-failure'))
      if (this.#closed) throw new Error('Packed semantic port closed during setup')
    } catch (error) {
      // A failed factory never returns a port for the Service to terminate. Revoke
      // registered callbacks and finish every owner cleanup before reporting setup failure.
      try {
        this.terminate()
      } catch {
        // terminate() attempts all cleanup in finally blocks; keep the original failure.
      }
      throw error
    }
  }
  get stats() {
    return this.receiver.stats
  }
  onResult(listener: (result: PackedSemanticResult) => void): void {
    this.#result = listener
  }
  onFailure(listener: (reason?: SemanticFailureReason) => void): void {
    this.#failure = listener
  }
  post(value: ParseRequest): void {
    if (this.#closed) throw new Error('Packed semantic port terminated')
    const checked = parseRequest(value)
    const options = Object.freeze({
      rawHtml: checked.options.rawHtml,
      footnotesLabel: checked.options.footnotesLabel,
      footnoteBackLabel: checked.options.footnoteBackLabel,
    })
    const input = Object.freeze({
      kind: 'parse' as const,
      sequence: checked.sequence,
      generation: checked.generation,
      documentId: checked.documentId,
      revision: checked.revision,
      source: checked.source,
      options,
      sentAt: checked.sentAt,
    })
    const source = new PackedSource(
      {
        generation: input.generation,
        documentId: input.documentId,
        revision: input.revision,
        sourceHash: sourceHash(input.source),
        parserVersion: `${parserVersion}/manuslip`,
        rendererVersion,
        options: JSON.stringify(options),
      },
      input.source,
    )
    this.cancel()
    this.#send(input, source, 0)
  }
  postCooperative(value: ParseRequest): void {
    if (this.#closed) throw new Error('Packed semantic port terminated')
    const checked = parseRequest(value)
    const options = Object.freeze({
      rawHtml: checked.options.rawHtml,
      footnotesLabel: checked.options.footnotesLabel,
      footnoteBackLabel: checked.options.footnoteBackLabel,
    })
    const input = Object.freeze({
      kind: 'parse' as const,
      sequence: checked.sequence,
      generation: checked.generation,
      documentId: checked.documentId,
      revision: checked.revision,
      source: checked.source,
      options,
      sentAt: checked.sentAt,
    })
    this.#queueSource(input)
  }
  postRequestCooperative(value: ParseRequest): void {
    if (this.#closed) throw new Error('Packed semantic port terminated')
    const { request, jsonByteLimit } = capturePackedRequest(value)
    this.#queueSource(request, jsonByteLimit)
  }
  #queueSource(input: Readonly<ParseRequest>, jsonByteLimit?: number): void {
    const options = input.options
    const source = packedSourceSteps(
      {
        generation: input.generation,
        documentId: input.documentId,
        revision: input.revision,
        parserVersion: `${parserVersion}/manuslip`,
        rendererVersion,
        options: JSON.stringify(options),
      },
      input.source,
      jsonByteLimit,
    )
    let hold: PackedHold
    try {
      hold = this.receiver.retain({
        resources: () => [{ key: source, bytes: source.retainedBytes + 4096 }],
      })
    } catch (error) {
      source.return()
      throw error
    }
    const prepared = new PackedWork(
      (function* () {
        return yield* source
      })(),
      () => {
        try {
          source.return()
        } finally {
          hold.release()
        }
      },
    )
    try {
      this.cancel()
      const work: SlicedWork<PackedSource> = new SlicedWork(
        prepared,
        {
          valid: (): boolean => !this.#closed && this.#work === work,
          complete: (result) => {
            this.#work = undefined
            this.#send(input, result, 0)
          },
          finished: () => {},
          failed: (error) => {
            if (this.#work !== work || this.#closed) return
            this.#work = undefined
            if (error instanceof PackedSourceJsonLimitError)
              this.#result?.({
                kind: 'error',
                code: 'semantic-limit',
                sequence: input.sequence,
                generation: input.generation,
                documentId: input.documentId,
                revision: input.revision,
                sentAt: absoluteNow(),
              })
            else this.#failed('worker-post')
          },
          measured: () => {},
        },
        this.#slices,
      )
      this.#work = work
      this.#defer(work.run)
    } catch (error) {
      prepared.return()
      throw error
    }
  }
  #send(input: ParseRequest, source: PackedSource, retries: number): void {
    const ticket = this.receiver.begin(input.sequence, source, input.options)
    this.#request = { input, source, ticket, retries }
    try {
      this.channel.post({ kind: 'prepare', input, exchange: ticket })
    } catch (error) {
      this.#failed('channel-post')
      throw error
    }
  }
  #defer(run: () => void, background = false): void {
    if (this.#closed) return
    // One revocable callback slot per priority. A delayed background callback must never
    // take a newer mandatory receipt, or retain the cache work it originally scheduled.
    if (background) {
      this.#backgroundResume = run
      if (this.#backgroundScheduled) return
      this.#backgroundScheduled = true
    } else {
      this.#resume = run
      if (this.#scheduled) return
      this.#scheduled = true
    }
    try {
      const defer = background
        ? (this.runtime.deferBackground ?? this.runtime.defer)
        : this.runtime.defer
      defer.call(this.runtime, () => {
        const next = background ? this.#backgroundResume : this.#resume
        if (background) {
          this.#backgroundScheduled = false
          this.#backgroundResume = undefined
        } else {
          this.#scheduled = false
          this.#resume = undefined
        }
        next?.()
      })
    } catch (error) {
      if (background) this.#backgroundScheduled = false
      else this.#scheduled = false
      this.#failed('slice-schedule')
      throw error
    }
  }
  #received(value: unknown): void {
    const request = this.#request
    if (!request) return
    try {
      // Only inspect clone-data correlation fields before the complete wire reader.
      const sequence =
        value && typeof value === 'object'
          ? Object.getOwnPropertyDescriptor(value, 'sequence')
          : undefined
      const token =
        value && typeof value === 'object'
          ? Object.getOwnPropertyDescriptor(value, 'requestToken')
          : undefined
      if (!sequence || !('value' in sequence) || !token || !('value' in token))
        throw new Error('Invalid packed semantic response correlation')
      if (sequence.value !== request.ticket.sequence || token.value !== request.ticket.requestToken)
        return
      if (this.#work) throw new Error('Duplicate packed semantic response')
      if (packedChannelKind(value) === 'semantic-error') {
        const error = readPackedChannelError(value)
        if (!sameCorrelation(request.ticket, error))
          throw new Error('Packed semantic error mismatch')
        this.receiver.cancel(request.ticket)
        this.#request = undefined
        this.#result?.({
          ...this.#identity(request.input),
          kind: 'error',
          code: error.code,
          sentAt: error.sentAt,
        })
        return
      }
      const receivedAt = performance.now()
      const iterator = this.receiver.receiveSteps(request.ticket, value)
      let accepted = false
      const work = new SlicedWork(
        iterator,
        {
          valid: () => !this.#closed && this.#request === request,
          complete: (result) => {
            this.#accepted(request, result)
            accepted = result.kind !== 'resync'
          },
          // This includes complete indexing/validation and synchronous acceptance.
          // Keep the original worker-to-service clock, which also includes this work.
          finished: (stats) =>
            semanticMetric('semantic-receive', receivedAt, {
              sequence: request.input.sequence,
              revision: request.input.revision,
              accepted,
              slices: stats.slices,
              maxSliceMs: stats.maxSliceMs,
              activeMs: stats.activeMs,
            }),
          failed: () => this.#failed('packed-receipt'),
          measured: (start) =>
            semanticMetric('semantic-receive-slice', start, {
              sequence: request.input.sequence,
              revision: request.input.revision,
            }),
        },
        this.#slices,
      )
      this.#work = work
      this.#defer(work.run)
    } catch {
      this.#failed('packed-response')
    }
  }
  #identity(input: ParseRequest) {
    return {
      sequence: input.sequence,
      generation: input.generation,
      documentId: input.documentId,
      revision: input.revision,
    }
  }
  #accepted(request: Request, received: PackedReceived): void {
    this.#work = undefined
    if (received.kind === 'resync') {
      this.channel.post({
        kind: 'cancel',
        sequence: request.ticket.sequence,
        requestToken: request.ticket.requestToken,
      })
      this.#request = undefined
      this.receiver.evict()
      if (request.retries === 0) this.#send(request.input, request.source, 1)
      else
        this.#result?.({
          ...this.#identity(request.input),
          kind: 'error',
          code: 'semantic-limit',
          sentAt: absoluteNow(),
        })
      return
    }
    let certificate: PackedSnapshotCertificate | undefined
    try {
      const read = (path: string[]) => {
        const number = received.capture.reader.scalar(path, { retained: 64, staging: 64 })
        if (typeof number !== 'number' || !Number.isFinite(number) || number < 0)
          throw new Error('Invalid packed semantic timings')
        return number
      }
      const snapshot: PackedSnapshot = Object.freeze({
        kind: 'packed',
        bytes: received.bytes,
        retainedBytes: received.capture.retainedBytes,
        cached: received.cached,
        transportInMs: received.transportInMs,
        serializeMs: received.serializeMs,
        parseMs: read(['document', 'timings', 'parse']),
        describeMs: read(['document', 'timings', 'describe']),
        renderMs: read(['projection', 'renderMs']),
      })
      certificate = this.receiver.certificate(received.capture)
      this.channel.post({ kind: 'ack', acknowledgement: received.acknowledgement })
      this.#request = undefined
      this.#result?.({
        ...this.#identity(request.input),
        kind: 'packed-result',
        snapshot,
        capture: received.capture,
        certificate,
        sentAt: received.sentAt,
      })
    } finally {
      try {
        certificate?.close()
      } finally {
        received.capture.release()
      }
    }
  }
  /** Optional warmup yields at background priority after native consumer preparation. */
  warm(): void {
    if (this.#closed || this.#request || this.#work || !this.receiver.stats.current) return
    if (
      this.receiver.stats.cachePhase === 'idle' ||
      this.receiver.stats.cachePhase === 'unavailable'
    ) {
      try {
        this.#cache()
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message.startsWith('Invalid ') ||
          !/limit|scope|capacity/.test(error.message)
        )
          this.#failed('packed-cache')
      }
    }
  }
  #cache(): void {
    const iterator = this.receiver.cacheSteps()
    const work = new SlicedWork(
      iterator,
      {
        valid: () => !this.#closed && !this.#request,
        complete: () => {
          if (this.#work === work) this.#work = undefined
        },
        finished: () => {},
        failed: () => this.#failed('packed-cache'),
        measured: () => {},
      },
      this.#backgroundSlices,
    )
    this.#work = work
    this.#defer(work.run, true)
  }
  cancel(): void {
    const request = this.#request
    this.#request = undefined
    this.#resume = undefined
    this.#backgroundResume = undefined
    const work = this.#work
    this.#work = undefined
    try {
      work?.cancel()
    } finally {
      if (request) {
        this.receiver.cancel(request.ticket)
        if (!this.#closed)
          this.channel.post({
            kind: 'cancel',
            sequence: request.ticket.sequence,
            requestToken: request.ticket.requestToken,
          })
      }
    }
  }
  #failed(reason: SemanticFailureReason): void {
    if (this.#closed) return
    const failed = this.#failure
    try {
      this.terminate()
    } finally {
      failed?.(reason)
    }
  }
  terminate(): void {
    if (this.#closed) return
    this.#closed = true
    this.#result = this.#failure = undefined
    try {
      this.cancel()
    } finally {
      try {
        this.channel.terminate()
      } finally {
        try {
          this.receiver.evict()
        } finally {
          this.#hold.release()
        }
      }
    }
  }
}
