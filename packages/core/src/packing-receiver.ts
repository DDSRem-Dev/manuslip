import type { PackedCapture } from './packing-capture'
import type { PackedAcknowledgement, PackedRequest } from './packing-exchange'
import type { PackedHold } from './packing-hold'
import type { PackedResource } from './packing-resources'
import { PackedSession, type PackedSessionLimits, type PackedTicket } from './packing-session'
import { type PackedIdentity, PackedSource, sameIdentity } from './packing-source'
import { newPackedToken } from './packing-token'
import {
  type CheckedPackedWire,
  type PackedResyncReason,
  packedWireVersion,
  readPackedWire,
} from './packing-wire'
import { PackedWork } from './packing-work'

export type PackedReceiveTicket = PackedRequest
interface Request {
  readonly ticket: PackedReceiveTicket
  readonly sessionTicket: PackedTicket
  readonly source: PackedSource
  readonly base: PackedSource | undefined
  work?: PackedWork<PackedReceived>
}
export type PackedValidator = (capture: PackedCapture, source: PackedSource) => unknown
export type PackedReceived =
  | {
      readonly kind: 'accepted'
      readonly capture: PackedCapture
      readonly acknowledgement: PackedAcknowledgement
      readonly bytes: number
      readonly envelopeBytes: number
      readonly wireStagingBytes: number
      readonly wireMetadataBytes: number
      readonly preparationStagingBytes: number
      readonly cached: boolean
      readonly transportInMs: number
      readonly serializeMs: number
      readonly sentAt: number
    }
  | { readonly kind: 'resync'; readonly reason: PackedResyncReason }

/** Experimental transactional wire receiver. The mandatory validator must finish complete
 * prepared application schema/range/ownership validation before publication. It may return
 * a synchronous generator for receiveSteps; ordinary promises/async iterators are rejected.
 * It does not claim that an arbitrary validator supplies complete mdast validation.
 */
export class PackedReceiver {
  readonly #session: PackedSession
  readonly #hold: PackedHold
  #validate: PackedValidator | undefined
  #request: Request | undefined
  #currentSource: PackedSource | undefined
  #currentToken: string | undefined
  #disposed = false
  #evicting = false
  constructor(limits: PackedSessionLimits, validate: PackedValidator) {
    if (typeof validate !== 'function') throw new Error('Packed receiver requires a validator')
    this.#session = new PackedSession(limits)
    // Fixed receiver/request/base slots and UUID strings; identities share source resources.
    this.#hold = this.#session.retain({ resources: () => [{ key: this, bytes: 2048 }] })
    this.#validate = validate
  }
  get stats() {
    return this.#session.stats
  }
  /** Trusted application metadata shares this receiver's resource union. The handle
   * is revoked by session disposal; this exposes no preparation or revision internals.
   */
  retain(derived: { resources(): Iterable<PackedResource> }): PackedHold {
    return this.#session.retain(derived)
  }
  begin(sequence: number, source: PackedSource): PackedReceiveTicket {
    if (this.#disposed || this.#evicting) throw new Error('Packed receiver disposed or evicting')
    if (!Number.isSafeInteger(sequence) || sequence < 0 || !(source instanceof PackedSource))
      throw new Error('Invalid packed receiver request')
    if (this.#request) this.cancel(this.#request.ticket)
    const sessionTicket = this.#session.beginPrepared(source)
    const current = this.#currentSource
    const base =
      current &&
      Object.keys(current.identity).every(
        (key) =>
          key === 'revision' ||
          key === 'sourceHash' ||
          current.identity[key as keyof PackedIdentity] ===
            source.identity[key as keyof PackedIdentity],
      )
        ? current
        : undefined
    const ticket: PackedReceiveTicket = Object.freeze({
      protocol: packedWireVersion,
      kind: 'request',
      sequence,
      identity: source.identity,
      requestToken: newPackedToken(),
      base:
        base && this.#currentToken
          ? Object.freeze({ identity: base.identity, token: this.#currentToken })
          : null,
    })
    this.#request = { ticket, sessionTicket, source, base }
    return ticket
  }
  receive(ticket: PackedReceiveTicket, value: unknown): PackedReceived {
    const work = this.#start(ticket, value, false)
    const result = work.next()
    if (!result.done || !result.value) {
      work.return()
      throw new Error('Incomplete synchronous packed receipt')
    }
    return result.value
  }
  /** Consume with a bounded scheduler. No acceptance/acknowledgement escapes before done.
   * Cancel, replacement, eviction and disposal revoke a suspended handle immediately.
   * Binary indexing and offset/range validation yield. Wire normalization, metadata copies,
   * native allocation and one validator step still run synchronously;
   * callers must measure these separately rather than treating every step as bounded time.
   */
  receiveSteps(ticket: PackedReceiveTicket, value: unknown): PackedWork<PackedReceived> {
    return this.#start(ticket, value, true)
  }
  #start(
    ticket: PackedReceiveTicket,
    value: unknown,
    cooperative: boolean,
  ): PackedWork<PackedReceived> {
    const request = this.#request
    const validate = this.#validate
    if (this.#disposed || this.#evicting) throw new Error('Packed receiver disposed or evicting')
    if (!request || request.ticket !== ticket || !validate)
      throw new Error('Stale packed receiver request')
    if (request.work) throw new Error('Packed receipt already pending')
    try {
      const checked = readPackedWire(value, {
        sequence: ticket.sequence,
        result: request.source.identity,
        requestToken: ticket.requestToken,
      })
      const message = checked.message
      if (message.kind === 'resync') return this.#resyncWork(request, message.reason)
      if (message.resultToken === this.#currentToken)
        throw new Error('Packed result token must advance')
      const base = request.base
      if (message.kind === 'delta' && !base) return this.#resyncWork(request, 'base-unavailable')
      if (
        message.kind === 'delta' &&
        base &&
        (!sameIdentity(message.base, base.identity) || message.baseToken !== ticket.base?.token)
      )
        return this.#resyncWork(request, 'base-mismatch')
      // Incoming payload and normalized metadata stay charged through prepare/validation.
      // Consuming the buffer temporarily overcharges its old wrapper rather than dropping
      // accounting before the resulting arena has acquired ownership.
      const incomingBytes = message.payload.byteLength
      const hold = this.#session.retain({
        resources: () => [
          { key: checked, bytes: checked.retainedBytes + (cooperative ? 4608 : 0) },
          { key: message.payload, bytes: incomingBytes },
        ],
      })
      let admitted = checked
      if (cooperative) {
        try {
          // Seal payload ownership before returning a queued handle. The original wrapper's
          // charge covers this moved buffer until prepare acquires its arena ownership.
          const payload = structuredClone(message.payload, { transfer: [message.payload] })
          admitted = Object.freeze({ ...checked, message: Object.freeze({ ...message, payload }) })
        } catch (error) {
          hold.release()
          throw error
        }
      }
      const work = new PackedWork(
        this.#receive(request, admitted, hold, validate, cooperative),
        () => {
          try {
            if (this.#request === request) {
              this.#request = undefined
              this.#session.invalidate()
            }
          } finally {
            hold.release()
          }
        },
      )
      request.work = work
      return work
    } catch (error) {
      if (this.#request === request) {
        this.#request = undefined
        this.#session.invalidate()
      }
      throw error
    }
  }
  #resyncWork(request: Request, reason: PackedResyncReason): PackedWork<PackedReceived> {
    const result = this.#resync(request, reason)
    return new PackedWork(
      // biome-ignore lint/correctness/useYield: A resync completes immediately through the same scheduler contract.
      (function* () {
        return result
      })(),
      () => {},
    )
  }
  *#receive(
    request: Request,
    checked: CheckedPackedWire,
    hold: PackedHold,
    validate: PackedValidator,
    cooperative: boolean,
  ): Generator<void, PackedReceived | undefined, undefined> {
    const ticket = request.ticket
    const message = checked.message
    const base = request.base
    let inspection: PackedCapture | undefined
    let validation: Generator<void, void, undefined> | undefined
    let preparation: PackedWork<PackedTicket> | undefined
    try {
      if (message.kind === 'resync') throw new Error('Expected prepared packed result')
      if (cooperative) yield
      if (this.#request !== request) throw new Error('Stale packed receiver preparation')
      let prepared: PackedTicket | undefined
      if (message.kind === 'full') {
        if (cooperative)
          preparation = this.#session.prepareFullSteps(
            request.sessionTicket,
            message.result,
            message.payload,
          )
        else
          prepared = this.#session.prepareFull(
            request.sessionTicket,
            message.result,
            message.payload,
          )
      } else {
        if (!base) throw new Error('Packed receiver base unavailable')
        const delta = {
          base: message.base,
          baseSource: base.text,
          result: message.result,
          payload: message.payload,
          operations: message.operations,
        }
        if (cooperative) preparation = this.#session.prepareDeltaSteps(request.sessionTicket, delta)
        else prepared = this.#session.prepareDelta(request.sessionTicket, delta)
      }
      if (preparation) {
        while (true) {
          if (this.#request !== request) throw new Error('Stale packed receiver preparation')
          const step = preparation.next()
          if (step.done) {
            prepared = step.value
            break
          }
          yield
        }
        preparation = undefined
      }
      if (!prepared) throw new Error('Incomplete packed receiver preparation')
      inspection = this.#session.capturePrepared(prepared)
      if (cooperative) yield
      if (this.#request !== request) throw new Error('Stale packed receiver validation')
      const returned: unknown = validate(inspection, request.source)
      if (returned !== undefined) {
        const iterate =
          returned && typeof returned === 'object' && Symbol.iterator in returned
            ? returned[Symbol.iterator]
            : undefined
        if (
          !returned ||
          typeof returned !== 'object' ||
          !('next' in returned) ||
          typeof returned.next !== 'function' ||
          !('return' in returned) ||
          typeof returned.return !== 'function' ||
          typeof iterate !== 'function' ||
          iterate.call(returned) !== returned
        )
          throw new Error('Packed receiver validator must finish synchronously or yield steps')
        validation = returned as Generator<void, void, undefined>
        if (!cooperative) throw new Error('Packed validator requires cooperative receipt')
        while (true) {
          if (this.#request !== request) throw new Error('Stale packed receiver validation')
          const step = validation.next()
          if (this.#request !== request) throw new Error('Stale packed receiver validation')
          if (
            !step ||
            typeof step !== 'object' ||
            step.value !== undefined ||
            (step.done !== undefined && typeof step.done !== 'boolean')
          )
            throw new Error('Invalid packed validation step')
          if (step.done) break
          yield
        }
        const completed = validation
        validation = undefined
        const closed = completed.return()
        if (!closed.done || closed.value !== undefined)
          throw new Error('Incomplete packed validator cleanup')
      }
      if (this.#request !== request) throw new Error('Stale packed receiver validation')
      const preparationStagingBytes = this.#session.stats.preparedStagingBytes
      inspection.release()
      inspection = undefined
      this.#session.commit(prepared)
      this.#request = undefined
      this.#currentSource = request.source
      this.#currentToken = message.resultToken
      hold.release()
      return Object.freeze({
        kind: 'accepted',
        capture: this.#session.capture(),
        acknowledgement: Object.freeze({
          protocol: packedWireVersion,
          kind: 'accepted',
          sequence: ticket.sequence,
          result: request.source.identity,
          requestToken: ticket.requestToken,
          resultToken: message.resultToken,
        }),
        bytes: checked.bytes,
        envelopeBytes: checked.envelopeBytes,
        wireStagingBytes: checked.stagingBytes,
        wireMetadataBytes: checked.retainedBytes,
        preparationStagingBytes,
        ...message.metadata,
        sentAt: message.sentAt,
      })
    } finally {
      try {
        validation?.return()
      } finally {
        inspection?.release()
        try {
          preparation?.return()
        } finally {
          hold.release()
        }
      }
    }
  }
  #resync(request: Request, reason: PackedResyncReason): PackedReceived {
    if (this.#request !== request) throw new Error('Stale packed receiver resync')
    this.#request = undefined
    this.#session.invalidate()
    return Object.freeze({ kind: 'resync', reason })
  }
  cancel(ticket: PackedReceiveTicket): boolean {
    if (this.#request?.ticket !== ticket) return false
    const request = this.#request
    this.#request = undefined
    this.#session.invalidate()
    request.work?.return()
    return true
  }
  capture(): PackedCapture {
    return this.#session.capture()
  }
  evict(): void {
    if (this.#disposed || this.#evicting) throw new Error('Packed receiver disposed or evicting')
    this.#evicting = true
    try {
      if (this.#request) this.cancel(this.#request.ticket)
    } finally {
      this.#currentSource = undefined
      this.#currentToken = undefined
      this.#session.evict()
      this.#evicting = false
    }
  }
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    try {
      if (this.#request) this.cancel(this.#request.ticket)
    } finally {
      this.#currentSource = undefined
      this.#currentToken = undefined
      this.#validate = undefined
      this.#hold.release()
      this.#session.dispose()
    }
  }
}
