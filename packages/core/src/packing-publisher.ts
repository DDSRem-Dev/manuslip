import {
  type PackedAcknowledgement,
  readPackedAcknowledgement,
  readPackedRequest,
} from './packing-exchange'
import type { PackedHold } from './packing-hold'
import type { PackedCapture } from './packing-capture'
import { finishPackedCleanup } from './packing-cleanup'
import type { PackedSerializationLimits, PackedSerializedValue } from './packing-serialize'
import type { PackedSession, PackedTicket } from './packing-session'
import { type PackedSource, sameIdentity } from './packing-source'
import { newPackedToken } from './packing-token'
import type { PackedValue } from './packing-value'
import { type PackedWireMessage, packedWireVersion, readPackedWire } from './packing-wire'
import { PackedWork } from './packing-work'

interface Accepted {
  readonly source: PackedSource
  readonly token: string
  readonly hold: PackedHold
}
interface PendingFields {
  readonly source: PackedSource
  readonly message: Exclude<PackedWireMessage, { kind: 'resync' }>
  readonly acknowledgement: PackedAcknowledgement
  readonly hold: PackedHold
}
type Pending = PendingFields &
  (
    | { readonly prepared: PackedTicket; readonly current?: never; readonly output?: never }
    | {
        readonly prepared?: never
        readonly current: PackedCapture
        readonly output: PackedValue<PackedSerializedValue>
      }
  )
type ResultMessage = Exclude<PackedWireMessage, { kind: 'resync' }>

/** Experimental sender for a borrowed session. While an offer is pending, the controller
 * must transfer/acknowledge or cancel it before changing the session. Preparation and the
 * outgoing buffer are admitted by that session; only an exact receipt commits its base.
 */
export class PackedPublisher {
  #owner: PackedSession | undefined
  #hold: PackedHold | undefined
  #accepted: Accepted | undefined
  #pending: Pending | undefined
  #working: PackedWork<ResultMessage> | undefined
  constructor(owner: PackedSession) {
    this.#hold = owner.retain({ resources: () => [{ key: this, bytes: 512 }] })
    this.#owner = owner
  }
  #alive(): PackedSession {
    const owner = this.#owner
    if (!owner || owner.stats.disposed) throw new Error('Packed publisher disposed')
    return owner
  }
  /** Only the exact acknowledged source object can serve as the next delta base. */
  base(request: unknown, source: PackedSource): PackedSource | undefined {
    const owner = this.#alive()
    const checked = readPackedRequest(request, source.identity).value
    const accepted = this.#accepted
    if (
      !accepted ||
      !checked.base ||
      checked.base.token !== accepted.token ||
      !sameIdentity(checked.base.identity, accepted.source.identity)
    )
      return undefined
    if (!owner.stats.current) return undefined
    const capture = owner.capture()
    try {
      return capture.sourceResource === accepted.source ? accepted.source : undefined
    } finally {
      capture.release()
    }
  }
  offer(
    request: unknown,
    source: PackedSource,
    prepared: PackedTicket,
    value: unknown,
  ): PackedWireMessage {
    const owner = this.#alive()
    if (this.#pending || this.#working) throw new Error('Packed offer already pending')
    const checkedRequest = readPackedRequest(request, source.identity)
    const ticket = checkedRequest.value
    const checked = readPackedWire(value, {
      sequence: ticket.sequence,
      result: source.identity,
      requestToken: ticket.requestToken,
    })
    const message = checked.message
    if (message.kind === 'resync') throw new Error('Packed offer requires a prepared result')
    const inspection = owner.capturePrepared(prepared)
    try {
      if (
        inspection.sourceResource !== source ||
        !sameIdentity(inspection.identity, message.result)
      )
        throw new Error('Packed offer preparation mismatch')
    } finally {
      inspection.release()
    }
    if (message.resultToken === this.#accepted?.token)
      throw new Error('Packed offer result token must advance')
    if (message.kind === 'delta') {
      const base = this.base(ticket, source)
      if (
        !base ||
        !sameIdentity(message.base, base.identity) ||
        message.baseToken !== ticket.base?.token
      )
        throw new Error('Packed offer base unavailable; full resync required')
    }
    // The controller retains its construction metadata until receipt too. This reserve
    // covers the actual outgoing buffer/envelope; the new normalized copies are pinned below.
    if (owner.stats.outgoingReservedBytes < checked.bytes + checked.retainedBytes)
      throw new Error('Packed offer outgoing reserve insufficient')
    const acknowledgement: PackedAcknowledgement = Object.freeze({
      protocol: packedWireVersion,
      kind: 'accepted',
      sequence: ticket.sequence,
      result: message.result,
      requestToken: ticket.requestToken,
      resultToken: message.resultToken,
    })
    const hold = owner.retain({
      resources: () => [
        { key: checked, bytes: checked.retainedBytes + checkedRequest.retainedBytes + 1024 },
        { key: source, bytes: source.retainedBytes },
      ],
    })
    this.#pending = { prepared, source, message, acknowledgement, hold }
    return message
  }
  /** Republish an exact committed result after receiver eviction or a lost receipt. This
   * does not prepare/commit another worker graph. Output, metadata and original capture
   * remain charged until transfer plus an exact ACK, or cancellation. A full response
   * never relies on the request's possibly unavailable base. The byte limit applies to
   * both paths; workspace/node/depth limits govern measured overlay serialization.
   */
  offerCurrentSteps(
    request: unknown,
    source: PackedSource,
    limits: PackedSerializationLimits,
  ): PackedWork<ResultMessage> {
    const owner = this.#alive()
    if (this.#pending || this.#working) throw new Error('Packed offer already pending')
    const checked = readPackedRequest(request, source.identity)
    const capture = owner.capture()
    let hold: PackedHold
    try {
      this.#current(capture, source)
      // Admitted before queued construction/normalization. The bounded request identity
      // supplies all later envelope strings; this covers both normalized copies and JSON
      // spelling/UTF-8 scratch through the pending receipt.
      const metadata = 8192 + checked.stagingBytes * 2
      hold = capture.workspace(metadata, metadata)
    } catch (error) {
      capture.release()
      throw error
    }
    const ticket = checked.value,
      budget = { ...limits }
    let encoding: PackedWork<PackedValue<PackedSerializedValue>> | undefined
    let output: PackedValue<PackedSerializedValue> | undefined
    let delivered = false
    let work: PackedWork<ResultMessage>
    const close = () => {
      if (this.#working === work) this.#working = undefined
      if (!delivered) {
        finishPackedCleanup([
          () => {
            encoding?.return()
          },
          () => output?.release(),
          () => hold.release(),
          () => capture.release(),
        ])
      }
    }
    const publisher = this
    work = new PackedWork(
      (function* () {
        const started = performance.now()
        publisher.#current(capture, source)
        encoding = capture.copyEncoding(budget.bytes) ?? capture.serialize([], budget)
        while (true) {
          publisher.#current(capture, source)
          const step = encoding.next()
          if (step.done) {
            output = step.value
            break
          }
          yield
        }
        encoding = undefined
        if (!output) throw new Error('Incomplete packed resync encoding')
        publisher.#current(capture, source)
        const wire = readPackedWire(
          {
            protocol: packedWireVersion,
            kind: 'full',
            sequence: ticket.sequence,
            requestToken: ticket.requestToken,
            resultToken: newPackedToken(),
            result: source.identity,
            sentAt: performance.timeOrigin + performance.now(),
            payload: output.value.payload,
            metadata: { cached: true, transportInMs: 0, serializeMs: performance.now() - started },
          },
          { sequence: ticket.sequence, result: source.identity, requestToken: ticket.requestToken },
        )
        const message = wire.message
        if (message.kind !== 'full') throw new Error('Invalid packed resync result')
        const acknowledgement: PackedAcknowledgement = Object.freeze({
          protocol: packedWireVersion,
          kind: 'accepted',
          sequence: ticket.sequence,
          result: source.identity,
          requestToken: ticket.requestToken,
          resultToken: message.resultToken,
        })
        publisher.#pending = { current: capture, output, source, message, acknowledgement, hold }
        delivered = true
        return message
      })(),
      close,
    )
    this.#working = work
    return work
  }
  #current(capture: PackedCapture, source: PackedSource): void {
    const owner = this.#alive()
    const stats = owner.stats
    if (stats.requested || stats.prepared || stats.preparingPhase)
      throw new Error('Packed resync requires an idle committed result')
    const current = owner.capture()
    try {
      if (capture.sourceResource !== source || !capture.sameRevision(current))
        throw new Error('Packed resync current result changed')
    } finally {
      current.release()
    }
  }
  acknowledge(value: unknown): void {
    const owner = this.#alive()
    const pending = this.#pending
    if (!pending) throw new Error('No packed offer pending')
    readPackedAcknowledgement(value, pending.acknowledgement)
    if (pending.message.payload.byteLength !== 0)
      throw new Error('Packed offer must transfer before acknowledgement')
    if (pending.current) this.#current(pending.current, pending.source)
    const record = { source: pending.source, token: pending.message.resultToken }
    const hold = owner.retain({
      resources: () => [
        { key: record, bytes: 512 },
        { key: pending.source, bytes: pending.source.retainedBytes },
      ],
    })
    try {
      if (pending.prepared) owner.commit(pending.prepared)
    } catch (error) {
      hold.release()
      throw error
    }
    this.#accepted?.hold.release()
    this.#accepted = { ...record, hold }
    this.#pending = undefined
    pending.hold.release()
    pending.output?.release()
    pending.current?.release()
  }
  cancel(): boolean {
    const owner = this.#alive()
    if (this.#working) {
      this.#working.return()
      return true
    }
    const pending = this.#pending
    if (!pending) return false
    // Revoke any escaped untransferred offer before releasing its outgoing reservation.
    if (pending.message.payload.byteLength)
      structuredClone(pending.message.payload, { transfer: [pending.message.payload] })
    this.#pending = undefined
    finishPackedCleanup([
      () => {
        if (pending.prepared && owner.discard(pending.prepared)) owner.invalidate()
      },
      () => pending.hold.release(),
      () => pending.output?.release(),
      () => pending.current?.release(),
    ])
    return true
  }
  reset(): void {
    finishPackedCleanup([
      () => {
        this.cancel()
      },
      () => {
        const accepted = this.#accepted
        this.#accepted = undefined
        accepted?.hold.release()
      },
    ])
  }
  /** Releases publisher ownership; the borrowed session is disposed separately. */
  dispose(): void {
    const owner = this.#owner
    if (!owner) return
    finishPackedCleanup([
      () => {
        if (!owner.stats.disposed) this.reset()
        else {
          const working = this.#working,
            pending = this.#pending
          const payload = pending?.message.payload
          if (payload?.byteLength) structuredClone(payload, { transfer: [payload] })
          this.#working = undefined
          this.#pending = undefined
          this.#accepted = undefined
          finishPackedCleanup([
            () => {
              working?.return()
            },
            () => pending?.output?.release(),
            () => pending?.current?.release(),
          ])
        }
      },
      () => this.#hold?.release(),
      () => {
        this.#hold = undefined
        this.#owner = undefined
      },
    ])
  }
}
