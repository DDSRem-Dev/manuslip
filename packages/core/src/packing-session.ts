import { semanticLimits } from './contracts'
import { PackedArena } from './packing-arena'
import { PackedCapture } from './packing-capture'
import { finishPackedCleanup } from './packing-cleanup'
import { PackedHold } from './packing-hold'
import { copyPackedOperations } from './packing-operations'
import { type PackedResource, PackedResources } from './packing-resources'
import { type PackedOperation, PackedRevision } from './packing-revision'
import { isPackedSource, type PackedIdentity, PackedSource, sameIdentity } from './packing-source'
import { PackedValue } from './packing-value'
import { PackedWork } from './packing-work'
import type { PackedWorkspaceBudget } from './packing-workspace'
import { readingBudgets } from './reading-limits'

export interface PackedSessionLimits {
  bytes: number
  retained: number
  staging: number
  captures: number
  readers: number
}
export interface PackedTicket {
  readonly identity: PackedIdentity
}
export interface PackedDelta {
  base: PackedIdentity
  baseSource: string
  result: PackedIdentity
  payload: ArrayBuffer
  operations: readonly PackedOperation[]
}
interface Request {
  ticket: PackedTicket
  source: PackedSource
}
interface Prepared {
  ticket: PackedTicket
  revision: PackedRevision
  epoch: number
  reserve: number
  inspections: Set<PackedCapture>
}
interface Preparing {
  work?: PackedWork<unknown>
  decode?: PackedWork<PackedArena>
  transform?: PackedWork<unknown>
  arena?: PackedArena
  arenaBytes: number
  entryBytes: number
  staging: number
  control: number
  reserve: number
  revisionBytes: number
  phase: 'index' | 'revision'
}
const ownerBytes = 256
const requestBytes = 128
const preparedBytes = 128
const captureBytes = 256
const readerBytes = 512
const preparationControlBytes = 2048

/**
 * Experimental ownership/admission layer, not a wire decoder or mdast validator. Receives
 * actual buffers, never exposes raw revisions, and unions shared resource identities.
 */
export class PackedSession {
  readonly #captureToken = Object.freeze({})
  readonly #limits: PackedSessionLimits
  readonly #resources = new PackedResources()
  #metadata = ownerBytes
  #current: PackedRevision | null = null
  #request: Request | null = null
  #prepared: Prepared | null = null
  #preparing: Preparing | undefined
  readonly #captures = new Set<PackedCapture>()
  readonly #holds = new Set<PackedHold>()
  #readers = 0
  #readerStaging = 0
  #epoch = 0
  #disposed = false
  constructor(limits: PackedSessionLimits) {
    for (const key of ['bytes', 'retained', 'staging', 'captures', 'readers'] as const) {
      const value = limits[key]
      if (!Number.isSafeInteger(value) || value < 0)
        throw new Error('Invalid packed session limits')
    }
    if (
      limits.bytes < 4 ||
      limits.bytes > semanticLimits.messageBytes ||
      limits.retained < ownerBytes ||
      limits.retained > semanticLimits.rendererBytes ||
      limits.staging < 1024 ||
      limits.staging > readingBudgets.workspace ||
      limits.captures > 256 ||
      limits.readers > 256
    )
      throw new Error('Invalid packed session limits')
    this.#limits = Object.freeze({
      bytes: limits.bytes,
      retained: limits.retained,
      staging: limits.staging,
      captures: limits.captures,
      readers: limits.readers,
    })
  }
  #alive() {
    if (this.#disposed) throw new Error('Packed session disposed')
  }
  #remaining(reserve = 0) {
    return this.#limits.retained - this.#resources.bytes - this.#metadata - reserve
  }
  #staging() {
    return this.#limits.staging - this.#readerStaging - (this.#preparing?.staging ?? 0)
  }
  get stats() {
    return Object.freeze({
      retainedBytes: this.#resources.bytes + this.#metadata,
      resources: this.#resources.size,
      captures: this.#captures.size,
      readers: this.#readers,
      readerStagingBytes: this.#readerStaging,
      holds: this.#holds.size,
      current: this.#current?.identity ?? null,
      requested: this.#request?.source.identity ?? null,
      prepared: this.#prepared?.revision.identity ?? null,
      preparedStagingBytes: this.#prepared?.revision.stagingBytes ?? 0,
      outgoingReservedBytes: (this.#prepared?.reserve ?? 0) + (this.#preparing?.reserve ?? 0),
      preparingBytes: this.#preparing
        ? this.#preparing.arenaBytes +
          this.#preparing.entryBytes +
          this.#preparing.control +
          this.#preparing.revisionBytes
        : 0,
      preparingStagingBytes: this.#preparing?.staging ?? 0,
      preparingPhase: this.#preparing?.phase ?? null,
      disposed: this.#disposed,
    })
  }
  /** A new request invalidates all earlier request/preparation tickets, including equal IDs. */
  begin(identity: PackedIdentity, source: string): PackedTicket {
    this.#alive()
    this.invalidate()
    const checked = new PackedSource(identity, source)
    return this.#begin(checked)
  }
  /** Share an already validated immutable source with derived data and its result. */
  beginPrepared(source: PackedSource): PackedTicket {
    this.#alive()
    if (!isPackedSource(source)) throw new Error('Invalid prepared packed source')
    this.invalidate()
    return this.#begin(source)
  }
  #begin(checked: PackedSource): PackedTicket {
    this.#resources.pin(
      () => [{ key: checked, bytes: checked.retainedBytes }],
      this.#remaining(requestBytes),
    )
    this.#metadata += requestBytes
    const ticket = Object.freeze({ identity: checked.identity })
    this.#request = { ticket, source: checked }
    return ticket
  }
  /**
   * Trusted internal derived-data footprint. Native outputs remain caller-owned: release
   * only when their uses end, not merely when a request commits or becomes obsolete.
   */
  retain(derived: { resources(): Iterable<PackedResource> }): PackedHold {
    return this.#retain(derived)
  }
  /** Trusted native output, independently charged until release or session disposal.
   * Admit the complete value before allocation (or exchange an existing reservation
   * synchronously). The weight must include every owned object/string and metadata.
   */
  own<T extends object>(value: T, bytes: number): PackedValue<T> {
    this.#alive()
    if (!value || typeof value !== 'object' || !Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error('Invalid packed native ownership')
    let output: PackedValue<T> | undefined
    const hold = this.#retain({ resources: () => [{ key: value, bytes }] }, () => output?.release())
    output = new PackedValue(value, hold, this.#captureToken, (next) => this.own(next, bytes))
    return output
  }
  #retain(derived: { resources(): Iterable<PackedResource> }, released?: () => void): PackedHold {
    this.#alive()
    if (this.#holds.size >= 256) throw new Error('Packed derived hold limit')
    const unique = new Map<object, number>()
    let entries = 0
    for (const { key, bytes } of derived.resources()) {
      if (++entries > 256) throw new Error('Invalid packed derived footprint')
      if (1024 + entries * 128 > this.#staging())
        throw new Error('Packed derived footprint exceeds staging limit')
      if (
        !key ||
        typeof key !== 'object' ||
        !Number.isSafeInteger(bytes) ||
        bytes < 0 ||
        unique.size >= 256 ||
        (unique.has(key) && unique.get(key) !== bytes)
      )
        throw new Error('Invalid packed derived footprint')
      unique.set(key, bytes)
    }
    const resources = [...unique].map(([key, bytes]) => ({ key, bytes }))
    const metadata = 256 + resources.length * 64
    this.#resources.pin(() => resources, this.#remaining(metadata))
    this.#metadata += metadata
    const hold = new PackedHold(() => {
      this.#holds.delete(hold)
      this.#resources.unpin(resources)
      this.#metadata -= metadata
      released?.()
    })
    this.#holds.add(hold)
    return hold
  }
  #requested(ticket: PackedTicket): Request {
    this.#alive()
    if (this.#request?.ticket !== ticket)
      throw new Error('Stale packed request; full resync may be required')
    if (this.#prepared || this.#preparing) throw new Error('Packed preparation already pending')
    return this.#request
  }
  #reserve(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error('Invalid outgoing packed reserve')
    if (bytes > this.#remaining()) throw new Error('Packed session exceeds retained limit')
  }
  #open(payload: ArrayBuffer, reserve: number): PackedArena {
    if (!(payload instanceof ArrayBuffer)) throw new Error('Invalid packed session payload')
    const available = this.#remaining(reserve + PackedResources.entryBytes)
    if (payload.byteLength > available) throw new Error('Packed session exceeds retained limit')
    const arena = PackedArena.open(payload, {
      ...this.#limits,
      retained: available,
      staging: this.#limits.staging - this.#readerStaging,
    })
    this.#resources.pin(
      () => [{ key: arena, bytes: arena.retainedBytes }],
      this.#remaining(reserve),
    )
    return arena
  }
  #prepare(ticket: PackedTicket, revision: PackedRevision, reserve: number): PackedTicket {
    if (this.#request?.ticket !== ticket) throw new Error('Stale packed request')
    // Transfer the complete pending overlay/reserve reservation to actual revision pins.
    // There is no scheduler suspension between removing it and admitting those pins.
    const pending = this.#preparing
    if (pending) {
      this.#metadata -= pending.revisionBytes + pending.reserve
      pending.revisionBytes = 0
      pending.reserve = 0
    }
    const prepared = Object.freeze({ identity: revision.identity })
    this.#resources.pin(() => revision.resources(), this.#remaining(reserve + preparedBytes))
    this.#metadata += preparedBytes + reserve
    this.#prepared = {
      ticket: prepared,
      revision,
      epoch: this.#epoch,
      reserve,
      inspections: new Set(),
    }
    return prepared
  }
  prepareFull(
    ticket: PackedTicket,
    identity: PackedIdentity,
    payload: ArrayBuffer,
    outgoingReserve = 0,
  ): PackedTicket {
    const request = this.#requested(ticket)
    if (!sameIdentity(identity, request.source.identity))
      throw new Error('Packed result identity mismatch')
    this.#reserve(outgoingReserve)
    const arena = this.#open(payload, outgoingReserve)
    try {
      return this.#full(ticket, request, arena, outgoingReserve)
    } finally {
      this.#resources.unpin([{ key: arena, bytes: arena.retainedBytes }])
    }
  }
  #full(ticket: PackedTicket, request: Request, arena: PackedArena, outgoingReserve: number) {
    const external = this.stats.retainedBytes - arena.retainedBytes - request.source.retainedBytes
    const retained =
      this.#limits.retained -
      (outgoingReserve - (this.#preparing?.reserve ?? 0)) -
      external -
      preparedBytes -
      PackedResources.entryBytes
    const revision = PackedRevision.fullPrepared(arena, request.source, {
      ...this.#limits,
      staging: this.#staging(),
      retained,
    })
    return this.#prepare(ticket, revision, outgoingReserve)
  }
  prepareDelta(ticket: PackedTicket, delta: PackedDelta, outgoingReserve = 0): PackedTicket {
    const request = this.#requested(ticket)
    const base = this.#current
    if (!base || !sameIdentity(delta.base, base.identity) || delta.baseSource !== base.source)
      throw new Error('Packed base unavailable; full resync required')
    if (!sameIdentity(delta.result, request.source.identity))
      throw new Error('Packed result identity mismatch')
    this.#reserve(outgoingReserve)
    const arena = this.#open(delta.payload, outgoingReserve)
    try {
      return this.#delta(ticket, request, base, delta, arena, outgoingReserve)
    } finally {
      this.#resources.unpin([{ key: arena, bytes: arena.retainedBytes }])
    }
  }
  #delta(
    ticket: PackedTicket,
    request: Request,
    base: PackedRevision,
    delta: PackedDelta,
    arena: PackedArena,
    outgoingReserve: number,
  ) {
    const revision = base.applyPrepared(
      {
        base: delta.base,
        baseSource: delta.baseSource,
        result: delta.result,
        source: request.source.text,
        arena,
        operations: delta.operations,
      },
      request.source,
      this.#deltaLimits(request, base, arena, outgoingReserve),
    )
    return this.#prepare(ticket, revision, outgoingReserve)
  }
  #deltaLimits(
    request: Request,
    base: PackedRevision,
    arena: PackedArena,
    outgoingReserve: number,
  ) {
    const external =
      this.stats.retainedBytes -
      base.retainedBytes -
      arena.retainedBytes -
      request.source.retainedBytes
    const retained =
      this.#limits.retained -
      (outgoingReserve - (this.#preparing?.reserve ?? 0)) -
      external -
      preparedBytes -
      2 * PackedResources.entryBytes
    return { retained, staging: this.#staging() }
  }
  /** Consume input eagerly; binary indexing and delta transforms yield before publication.
   */
  prepareFullSteps(
    ticket: PackedTicket,
    identity: PackedIdentity,
    payload: ArrayBuffer,
    outgoingReserve = 0,
  ): PackedWork<PackedTicket> {
    const request = this.#requested(ticket)
    if (!sameIdentity(identity, request.source.identity))
      throw new Error('Packed result identity mismatch')
    return this.#startPreparation(ticket, payload, outgoingReserve, 0, (arena) =>
      this.#full(ticket, request, arena, outgoingReserve),
    )
  }
  /** Index a request-owned temporary value without changing the committed/prepared result.
   * Its independent capture shares this session's source, resources and aggregate caps.
   * The caller releases it after composition; it is not a semantic validation or ACK.
   */
  stageFullSteps(ticket: PackedTicket, payload: ArrayBuffer): PackedWork<PackedCapture> {
    const request = this.#requested(ticket)
    return this.#startPreparation(ticket, payload, 0, 0, (arena) => {
      const revision = PackedRevision.fullPrepared(arena, request.source, {
        retained: this.#limits.retained,
        staging: this.#staging(),
      })
      return this.#capture(revision)
    })
  }
  prepareDeltaSteps(
    ticket: PackedTicket,
    delta: PackedDelta,
    outgoingReserve = 0,
  ): PackedWork<PackedTicket> {
    const request = this.#requested(ticket)
    const base = this.#current
    if (!base || !sameIdentity(delta.base, base.identity) || delta.baseSource !== base.source)
      throw new Error('Packed base unavailable; full resync required')
    if (!sameIdentity(delta.result, request.source.identity))
      throw new Error('Packed result identity mismatch')
    this.#reserve(outgoingReserve)
    if (!(delta.payload instanceof ArrayBuffer)) throw new Error('Invalid packed session payload')
    const copied = copyPackedOperations(delta.operations, (bytes) => {
      if (bytes > this.#staging()) throw new Error('Packed operations exceed staging limit')
      if (
        bytes +
          delta.payload.byteLength +
          256 +
          PackedResources.entryBytes +
          preparationControlBytes >
        this.#remaining(outgoingReserve)
      )
        throw new Error('Packed session exceeds retained limit')
    })
    const checked = {
      base: base.identity,
      baseSource: base.source,
      result: request.source.identity,
      payload: delta.payload,
      operations: copied.operations,
    }
    return this.#startPreparation(
      ticket,
      delta.payload,
      outgoingReserve,
      copied.bytes,
      (arena) =>
        new PackedWork(
          this.#deltaSteps(ticket, request, base, checked, arena, outgoingReserve, copied.bytes),
          () => {},
        ),
    )
  }
  *#deltaSteps(
    ticket: PackedTicket,
    request: Request,
    base: PackedRevision,
    delta: PackedDelta,
    arena: PackedArena,
    outgoingReserve: number,
    operationBytes: number,
  ): Generator<void, PackedTicket, undefined> {
    const pending = this.#preparing
    if (!pending) throw new Error('Missing packed preparation')
    const revision = yield* base.applyPreparedSteps(
      {
        base: delta.base,
        baseSource: delta.baseSource,
        result: delta.result,
        source: request.source.text,
        arena,
        operations: delta.operations,
      },
      request.source,
      this.#deltaLimits(request, base, arena, outgoingReserve),
      (owned, staging) => {
        if (this.#preparing !== pending || this.#request?.ticket !== ticket)
          throw new Error('Stale packed preparation')
        const bytes = owned + 2 * PackedResources.entryBytes
        const extra = bytes - pending.revisionBytes
        if (extra > this.#remaining()) throw new Error('Packed session exceeds retained limit')
        if (staging + operationBytes > this.#limits.staging - this.#readerStaging)
          throw new Error('Packed preparation exceeds staging limit')
        this.#metadata += extra
        pending.revisionBytes = bytes
        pending.staging = staging + operationBytes
      },
    )
    return this.#prepare(ticket, revision, outgoingReserve)
  }
  #startPreparation<T extends PackedTicket | PackedCapture>(
    ticket: PackedTicket,
    payload: ArrayBuffer,
    outgoingReserve: number,
    operationBytes: number,
    prepare: (arena: PackedArena) => T | PackedWork<T>,
  ): PackedWork<T> {
    this.#reserve(outgoingReserve)
    if (!(payload instanceof ArrayBuffer)) throw new Error('Invalid packed session payload')
    const control = preparationControlBytes + operationBytes
    const available = this.#remaining(outgoingReserve + control + PackedResources.entryBytes)
    if (payload.byteLength + 256 > available)
      throw new Error('Packed session exceeds retained limit')
    const pending: Preparing = {
      arenaBytes: payload.byteLength + 256,
      entryBytes: PackedResources.entryBytes,
      staging: operationBytes,
      control,
      reserve: outgoingReserve,
      revisionBytes: 0,
      phase: 'index',
    }
    this.#metadata += pending.arenaBytes + pending.entryBytes + control + outgoingReserve
    this.#preparing = pending
    try {
      pending.decode = PackedArena.openSteps(
        payload,
        { ...this.#limits, retained: available, staging: this.#staging() },
        (retained, staging) => {
          if (this.#preparing !== pending || this.#request?.ticket !== ticket)
            throw new Error('Stale packed preparation')
          const extra = retained - pending.arenaBytes
          if (extra > this.#remaining()) throw new Error('Packed session exceeds retained limit')
          if (staging + operationBytes > this.#limits.staging - this.#readerStaging)
            throw new Error('Packed preparation exceeds staging limit')
          this.#metadata += extra
          pending.arenaBytes = retained
          pending.staging = staging + operationBytes
        },
      )
      const work = new PackedWork(
        this.#finishPreparation(pending, ticket, operationBytes, prepare),
        () => this.#releasePreparation(pending),
      )
      pending.work = work
      return work
    } catch (error) {
      this.#releasePreparation(pending)
      throw error
    }
  }
  *#finishPreparation<T extends PackedTicket | PackedCapture>(
    pending: Preparing,
    ticket: PackedTicket,
    operationBytes: number,
    prepare: (arena: PackedArena) => T | PackedWork<T>,
  ): Generator<void, T | undefined, undefined> {
    if (!pending.decode) throw new Error('Missing packed decoder')
    let arena: PackedArena | undefined
    while (true) {
      const step = pending.decode.next()
      if (step.done) {
        arena = step.value
        break
      }
      yield
    }
    if (!arena || this.#preparing !== pending || this.#request?.ticket !== ticket)
      throw new Error('Stale packed preparation')
    // Move the reservation to the actual immutable arena identity without a suspended gap.
    this.#metadata -= pending.arenaBytes + pending.entryBytes
    pending.arenaBytes = 0
    pending.entryBytes = 0
    this.#resources.pin(() => [{ key: arena, bytes: arena.retainedBytes }], this.#remaining())
    pending.arena = arena
    pending.staging = operationBytes
    pending.phase = 'revision'
    const result = prepare(arena)
    if (!(result instanceof PackedWork)) return result
    pending.transform = result
    while (true) {
      const step = result.next()
      if (step.done) {
        if (!step.value) throw new Error('Incomplete packed revision preparation')
        return step.value
      }
      yield
    }
  }
  #releasePreparation(pending: Preparing): void {
    if (this.#preparing !== pending) return
    this.#preparing = undefined
    this.#metadata -=
      pending.arenaBytes +
      pending.entryBytes +
      pending.control +
      pending.reserve +
      pending.revisionBytes
    if (pending.arena)
      this.#resources.unpin([{ key: pending.arena, bytes: pending.arena.retainedBytes }])
    const decode = pending.decode
    const transform = pending.transform
    pending.work = undefined
    pending.decode = undefined
    pending.arena = undefined
    pending.transform = undefined
    finishPackedCleanup([() => decode?.return(), () => transform?.return()])
  }
  commit(ticket: PackedTicket): void {
    this.#alive()
    const prepared = this.#prepared
    if (!prepared || prepared.ticket !== ticket || prepared.epoch !== this.#epoch)
      throw new Error('Stale packed preparation')
    try {
      finishPackedCleanup(
        (function* () {
          for (const inspection of prepared.inspections) yield () => inspection.release()
        })(),
      )
    } catch (error) {
      // A failing inspection cleanup cannot publish a candidate or leave sibling forks live.
      finishPackedCleanup([
        () => {
          throw error
        },
        () => this.invalidate(),
      ])
      return
    }
    if (this.#current) this.#resources.unpin(this.#current.resources())
    this.#current = prepared.revision // Transfer the prepared pin to current ownership.
    this.#prepared = null
    this.#metadata -= preparedBytes + prepared.reserve
    this.#dropRequest()
    this.#epoch++
  }
  discard(ticket: PackedTicket): boolean {
    this.#alive()
    if (this.#prepared?.ticket !== ticket) return false
    this.#dropPrepared()
    return true
  }
  #dropPrepared(): void {
    const prepared = this.#prepared
    if (!prepared) return
    const session = this
    finishPackedCleanup(
      (function* () {
        for (const inspection of prepared.inspections) yield () => inspection.release()
        yield () => {
          session.#resources.unpin(prepared.revision.resources())
          session.#prepared = null
          session.#metadata -= preparedBytes + prepared.reserve
        }
      })(),
    )
  }
  #dropRequest(): void {
    if (!this.#request) return
    const source = this.#request.source
    this.#resources.unpin([{ key: source, bytes: source.retainedBytes }])
    this.#request = null
    this.#metadata -= requestBytes
  }
  invalidate(): void {
    this.#alive()
    finishPackedCleanup([
      () => {
        this.#preparing?.work?.return()
      },
      () => this.#dropPrepared(),
      () => this.#dropRequest(),
      () => {
        this.#epoch++
      },
    ])
  }
  /** Eviction drops the base; explicit live captures remain usable and charged. */
  evict(): void {
    this.#alive()
    finishPackedCleanup([
      () => this.invalidate(),
      () => {
        if (this.#current) this.#resources.unpin(this.#current.resources())
        this.#current = null
      },
    ])
  }
  #openReader(reserve = 0, staging = 0): () => void {
    this.#alive()
    if (
      !Number.isSafeInteger(reserve) ||
      reserve < 0 ||
      !Number.isSafeInteger(staging) ||
      staging < 0
    )
      throw new Error('Invalid packed reader reserve')
    if (staging > this.#staging()) throw new Error('Packed reader exceeds staging limit')
    const bytes = readerBytes + reserve
    if (this.#readers >= this.#limits.readers || this.#remaining() < bytes)
      throw new Error('Packed reader scope limit')
    this.#readers++
    this.#readerStaging += staging
    this.#metadata += bytes
    return () => {
      this.#readers--
      this.#readerStaging -= staging
      this.#metadata -= bytes
    }
  }
  #reserveWorkspace(retained: number, staging: number): PackedWorkspaceBudget {
    const close = this.#openReader()
    let reserve = 0,
      scratch = 0,
      released = false
    const budget: PackedWorkspaceBudget = {
      resize: (nextRetained, nextStaging) => {
        this.#alive()
        if (released) throw new Error('Packed workspace released')
        if (
          !Number.isSafeInteger(nextRetained) ||
          nextRetained < 0 ||
          !Number.isSafeInteger(nextStaging) ||
          nextStaging < 0
        )
          throw new Error('Invalid packed reader reserve')
        const growth = nextRetained - reserve
        if (nextStaging - scratch > this.#staging())
          throw new Error('Packed reader exceeds staging limit')
        if (growth > this.#remaining()) throw new Error('Packed reader scope limit')
        this.#metadata += growth
        this.#readerStaging += nextStaging - scratch
        reserve = nextRetained
        scratch = nextStaging
      },
      release: () => {
        if (released) return
        released = true
        this.#metadata -= reserve
        this.#readerStaging -= scratch
        close()
      },
    }
    try {
      budget.resize(retained, staging)
      return budget
    } catch (error) {
      budget.release()
      throw error
    }
  }
  capture(): PackedCapture {
    this.#alive()
    const revision = this.#current
    if (!revision) throw new Error('Packed base unavailable')
    return this.#capture(revision)
  }
  /** Inspect before schema/range validation and commit; the scope expires with preparation. */
  capturePrepared(ticket: PackedTicket): PackedCapture {
    this.#alive()
    const prepared = this.#prepared
    if (!prepared || prepared.ticket !== ticket) throw new Error('Stale packed preparation')
    return this.#capture(prepared.revision, prepared.inspections)
  }
  #capture(revision: PackedRevision, group?: Set<PackedCapture>): PackedCapture {
    this.#alive()
    if (this.#captures.size >= this.#limits.captures || this.#remaining() < captureBytes)
      throw new Error('Packed capture limit')
    this.#resources.pin(() => revision.resources(), this.#remaining(captureBytes))
    this.#metadata += captureBytes
    const capture = new PackedCapture(
      revision,
      (reserve, staging) => this.#openReader(reserve, staging),
      () => {
        this.#captures.delete(capture)
        this.#resources.unpin(revision.resources())
        this.#metadata -= captureBytes
        group?.delete(capture)
      },
      this.#captureToken,
      (value, bytes) => this.own(value, bytes),
      () => this.#capture(revision, group),
      (retained, staging) => this.#reserveWorkspace(retained, staging),
    )
    this.#captures.add(capture)
    group?.add(capture)
    return capture
  }
  dispose(): void {
    if (this.#disposed) return
    const session = this
    finishPackedCleanup(
      (function* () {
        yield () => session.evict()
        for (const capture of session.#captures) yield () => capture.release()
        for (const hold of session.#holds) yield () => hold.release()
        yield () => {
          session.#disposed = true
          session.#metadata -= ownerBytes
        }
      })(),
    )
  }
}
