import { parserVersion, semanticLimits } from '@manuslip/core'
import { type RenderOptions, rendererVersion } from '@manuslip/renderer'
import type { PackedCapture } from '../../../../../../packages/core/src/packing-capture'
import { finishPackedCleanup } from '../../../../../../packages/core/src/packing-cleanup'
import { PackedDocumentBaseline } from '../../../../../../packages/core/src/packing-document-baseline'
import type { PackedHold } from '../../../../../../packages/core/src/packing-hold'
import {
  type PackedReceived,
  PackedReceiver,
  type PackedReceiveTicket,
} from '../../../../../../packages/core/src/packing-receiver'
import type { PackedResource } from '../../../../../../packages/core/src/packing-resources'
import type { PackedSessionLimits } from '../../../../../../packages/core/src/packing-session'
import { PackedSource } from '../../../../../../packages/core/src/packing-source'
import type { PackedRootValidationLimits } from '../../../../../../packages/core/src/packing-validate-root'
import { PackedWordBaseline } from '../../../../../../packages/core/src/packing-word-baseline'
import { PackedWork } from '../../../../../../packages/core/src/packing-work'
import { PackedProjectionBaseline } from '../../../../../../packages/renderer/src/packed-projection-baseline'
import { PackedSnapshotCertificate } from '../../../../../../packages/renderer/src/packed-snapshot-certificate'

interface Cache {
  readonly capture: PackedCapture
  document?: PackedDocumentBaseline
  projection?: PackedProjectionBaseline
  words?: PackedWordBaseline
}
export interface SemanticCacheResult {
  readonly document: boolean
  readonly projection: boolean
  readonly words: boolean
}
type CachePhase = 'idle' | 'document' | 'projection' | 'words' | 'ready' | 'unavailable'
const capacity = (error: unknown) =>
  error instanceof Error &&
  !error.message.startsWith('Invalid ') &&
  /limit|scope|capacity/.test(error.message)
const cacheResult = (cache?: Cache): SemanticCacheResult =>
  Object.freeze({
    document: !!cache?.document,
    projection: !!cache?.projection,
    words: !!cache?.words,
  })
function closeCache(cache?: Cache): void {
  if (!cache) return
  finishPackedCleanup([
    () => cache.words?.close(),
    () => cache.projection?.close(),
    () => cache.document?.close(),
    () => cache.capture.release(),
  ])
}
function completedWork<T>(result: T): PackedWork<T> {
  return new PackedWork(
    // biome-ignore lint/correctness/useYield: Immediate results use the same revocable scheduler contract.
    (function* () {
      return result
    })(),
    () => {},
  )
}
function policy(options: RenderOptions): Readonly<RenderOptions> {
  if (
    !options ||
    typeof options.rawHtml !== 'boolean' ||
    typeof options.footnotesLabel !== 'string' ||
    options.footnotesLabel.length > 200 ||
    typeof options.footnoteBackLabel !== 'string' ||
    options.footnoteBackLabel.length > 200
  )
    throw new Error('Invalid packed receiver policy')
  return Object.freeze({
    rawHtml: options.rawHtml,
    footnotesLabel: options.footnotesLabel,
    footnoteBackLabel: options.footnoteBackLabel,
  })
}

/** Experimental application receiver. All accepted snapshots pass complete document,
 * HTML/layout/widget checks. Optional caches certify only immutable shared records;
 * initial cache construction requires complete validation, reusing the exact current
 * snapshot certificate for projection metadata when available. Consumers own their
 * returned capture independently of cache eviction. Ordinary transport is unchanged.
 */
export class PackedSemanticReceiver {
  readonly #receiver: PackedReceiver
  readonly #hold: PackedHold
  readonly #limits: Readonly<PackedRootValidationLimits>
  #request:
    | {
        ticket: PackedReceiveTicket
        options: Readonly<RenderOptions>
        certificate?: PackedSnapshotCertificate
      }
    | undefined
  #certificate: PackedSnapshotCertificate | undefined
  #work: PackedWork<PackedReceived> | undefined
  #cacheWork: PackedWork<SemanticCacheResult> | undefined
  #cache: Cache | undefined
  #cachePhase: CachePhase = 'idle'
  #disposed = false
  constructor(limits: PackedSessionLimits, validation: PackedRootValidationLimits) {
    for (const key of ['retained', 'staging', 'nodes', 'depth'] as const)
      if (!Number.isSafeInteger(validation[key]) || validation[key] < 0)
        throw new Error('Invalid packed semantic validation limits')
    if (
      validation.retained > semanticLimits.rendererBytes ||
      validation.staging > semanticLimits.messageBytes ||
      validation.nodes > semanticLimits.blocks * 16 ||
      validation.depth < 1 ||
      validation.depth > 128
    )
      throw new Error('Invalid packed semantic validation limits')
    this.#limits = Object.freeze({ ...validation })
    this.#receiver = new PackedReceiver(limits, (capture, source) => {
      const request = this.#request
      if (!request || request.ticket.identity !== source.identity)
        throw new Error('Stale packed semantic validation')
      const cache = this.#cache
      const limits = this.#limits
      return capture.work(
        (function* () {
          for (let attempt = 0; ; attempt++) {
            let validation:
              | Generator<void, PackedSnapshotCertificate | undefined, undefined>
              | undefined
            try {
              validation = PackedSnapshotCertificate.createSteps(
                capture,
                source,
                [],
                request.options,
                limits,
                { projection: cache?.projection, document: cache?.document, words: cache?.words },
              )
              const certificate = yield* validation
              if (!certificate) throw new Error('Incomplete packed snapshot certificate')
              request.certificate = certificate
              return
            } catch (error) {
              if (attempt !== 0 || !capacity(error) || !cache?.words) throw error
            } finally {
              validation?.return(undefined)
            }
            // Optional cached prose must not crowd out mandatory whole-string validation.
            // End the failed inspection before revoking its borrowed chunks, then validate
            // the same prepared graph again. No ACK, new payload or semantic shortcut.
            const words = cache.words
            cache.words = undefined
            words.close()
            yield
          }
        })(),
      )
    })
    try {
      this.#hold = this.#receiver.retain({ resources: () => [{ key: this, bytes: 4096 }] })
    } catch (error) {
      this.#receiver.dispose()
      throw error
    }
  }
  get stats() {
    return Object.freeze({
      ...this.#receiver.stats,
      cachePhase: this.#cachePhase,
      cache: cacheResult(this.#cache),
    })
  }
  /** Trusted application transport metadata shares this receiver's session allowance. */
  retain(resource: { resources(): Iterable<PackedResource> }) {
    this.#alive()
    return this.#receiver.retain(resource)
  }
  #alive(): void {
    if (this.#disposed) throw new Error('Packed semantic receiver disposed')
  }
  begin(sequence: number, source: PackedSource, options: RenderOptions): PackedReceiveTicket {
    this.#alive()
    const render = policy(options)
    if (
      !(source instanceof PackedSource) ||
      !Number.isSafeInteger(sequence) ||
      sequence < 0 ||
      source.identity.parserVersion !== `${parserVersion}/manuslip` ||
      source.identity.rendererVersion !== rendererVersion ||
      source.identity.options !== JSON.stringify(render)
    )
      throw new Error('Packed semantic receiver identity mismatch')
    this.#work?.return()
    this.#cacheWork?.return()
    const before = this.#cache?.capture.identity,
      after = source.identity
    if (
      before &&
      (before.generation !== after.generation ||
        before.documentId !== after.documentId ||
        before.parserVersion !== after.parserVersion ||
        before.rendererVersion !== after.rendererVersion ||
        before.options !== after.options)
    )
      this.#dropCache()
    this.#request = undefined
    let ticket: PackedReceiveTicket
    try {
      ticket = this.#receiver.begin(sequence, source)
    } catch (error) {
      if (!capacity(error) || !this.#cache) throw error
      this.#dropCache()
      ticket = this.#receiver.begin(sequence, source)
    }
    this.#request = { ticket, options: render }
    return ticket
  }
  receiveSteps(ticket: PackedReceiveTicket, value: unknown): PackedWork<PackedReceived> {
    this.#alive()
    if (this.#request?.ticket !== ticket || this.#work)
      throw new Error('Stale packed semantic receipt')
    const request = this.#request
    let child: PackedWork<PackedReceived>
    try {
      child = this.#receiver.receiveSteps(ticket, value)
    } catch (error) {
      this.#receiver.cancel(ticket)
      this.#request = undefined
      if (!capacity(error)) throw error
      this.#dropCache()
      return completedWork(Object.freeze({ kind: 'resync', reason: 'capacity' }))
    }
    const receiver = this
    let work: PackedWork<PackedReceived>
    work = new PackedWork(
      (function* () {
        try {
          const result = yield* child
          if (!result) throw new Error('Incomplete packed semantic receipt')
          if (result.kind === 'accepted') {
            try {
              const certificate = request.certificate
              if (!certificate?.matches(result.capture))
                throw new Error('Packed snapshot certificate mismatch')
              receiver.#certificate?.close()
              receiver.#certificate = certificate
              request.certificate = undefined
            } catch (error) {
              result.capture.release()
              throw error
            }
          }
          return result
        } catch (error) {
          if (!capacity(error)) throw error
          receiver.#receiver.cancel(ticket)
          receiver.#dropCache()
          return Object.freeze({ kind: 'resync' as const, reason: 'capacity' as const })
        }
      })(),
      () => {
        finishPackedCleanup([
          () => child.return(),
          () => request.certificate?.close(),
          () => {
            receiver.#receiver.cancel(ticket)
          },
          () => {
            if (receiver.#request?.ticket === ticket) receiver.#request = undefined
            if (receiver.#work === work) receiver.#work = undefined
          },
        ])
      },
    )
    this.#work = work
    return work
  }
  /** Build on an independently retained committed capture, never a prepared inspection
   * that commit revokes. Call during idle time; begin/clearCache/evict/dispose revoke partial
   * construction. Completed original certificates remain useful across repeated deltas.
   */
  cacheSteps(): PackedWork<SemanticCacheResult> {
    this.#alive()
    if (this.#request || this.#work) throw new Error('Packed semantic cache requires idle receiver')
    this.#cacheWork?.return()
    const capture = this.#receiver.capture()
    if (this.#cache?.capture.sameRevision(capture)) {
      capture.release()
      const result = cacheResult(this.#cache)
      return completedWork(result)
    }
    this.#dropCache()
    const candidate: Cache = { capture }
    const receiver = this,
      source = capture.sourceResource
    let render: Readonly<RenderOptions>
    try {
      render = policy(JSON.parse(source.identity.options) as RenderOptions)
    } catch (error) {
      capture.release()
      throw error
    }
    let completed = false
    let work: PackedWork<SemanticCacheResult>
    work = new PackedWork(
      (function* () {
        for (const phase of ['document', 'projection', 'words'] as const) {
          receiver.#cachePhase = phase
          try {
            if (phase === 'document')
              candidate.document = yield* PackedDocumentBaseline.create(
                capture,
                source,
                ['document'],
                receiver.#limits,
              )
            else if (phase === 'projection')
              candidate.projection = yield* PackedProjectionBaseline.create(
                capture,
                source,
                [],
                render,
                receiver.#limits,
                candidate.document,
                receiver.#certificate,
              )
            else
              candidate.words = yield* PackedWordBaseline.create(
                capture,
                source,
                ['document'],
                receiver.#limits,
                candidate.document,
              )
          } catch (error) {
            if (!capacity(error)) throw error
          }
          yield
        }
        const result = cacheResult(candidate)
        if (result.document || result.projection || result.words) receiver.#cache = candidate
        else closeCache(candidate)
        completed = true
        receiver.#cachePhase = receiver.#cache ? 'ready' : 'unavailable'
        return result
      })(),
      () => {
        try {
          if (!completed) closeCache(candidate)
        } finally {
          if (!completed) receiver.#cachePhase = 'idle'
          if (receiver.#cacheWork === work) receiver.#cacheWork = undefined
        }
      },
    )
    this.#cacheWork = work
    return work
  }
  #dropCache(): void {
    const cache = this.#cache
    this.#cache = undefined
    this.#cachePhase = 'idle'
    closeCache(cache)
  }
  clearCache(): void {
    this.#alive()
    finishPackedCleanup([
      () => this.#work?.return(),
      () => this.#cacheWork?.return(),
      () => this.#dropCache(),
    ])
  }
  cancel(ticket: PackedReceiveTicket): boolean {
    this.#alive()
    if (this.#request?.ticket !== ticket) return false
    this.#work?.return()
    this.#receiver.cancel(ticket)
    this.#request = undefined
    return true
  }
  capture(): PackedCapture {
    this.#alive()
    return this.#receiver.capture()
  }
  /** Independent metadata ownership; it never pins the graph on behalf of a consumer. */
  certificate(capture: PackedCapture): PackedSnapshotCertificate {
    this.#alive()
    if (!this.#certificate?.matches(capture))
      throw new Error('Packed snapshot certificate unavailable')
    return this.#certificate.retain()
  }
  #closeCertificate(): void {
    const certificate = this.#certificate
    this.#certificate = undefined
    certificate?.close()
  }
  evict(): void {
    this.#alive()
    finishPackedCleanup([
      () => this.clearCache(),
      () => this.#closeCertificate(),
      () => this.#receiver.evict(),
      () => {
        this.#request = undefined
      },
    ])
  }
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    finishPackedCleanup([
      () => this.#work?.return(),
      () => this.#cacheWork?.return(),
      () => this.#dropCache(),
      () => this.#closeCertificate(),
      () => this.#hold.release(),
      () => this.#receiver.dispose(),
      () => {
        this.#request = undefined
      },
    ])
  }
}
