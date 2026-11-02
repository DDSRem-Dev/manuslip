import { PackedArena } from './packing-arena'
import { replaceChildSteps, spliceSteps, spliceTextSteps } from './packing-copy-steps'
import { PackedMetadataBudget } from './packing-metadata-budget'
import { offsetSuffix, offsetSuffixSteps } from './packing-offsets'
import { rangeSuffix, rangeSuffixSteps } from './packing-ranges'
import type { PackedResource } from './packing-resources'
import {
  identityKeys,
  isPackedSource,
  type PackedIdentity,
  PackedSource,
  sameIdentity,
} from './packing-source'
import { childSteps } from './packing-traversal'
import {
  child,
  type PackedNode,
  type PackedPath,
  PackedView,
  replaceChild,
  splice,
  spliceText,
} from './packing-view'
import { finishPackedSteps } from './packing-work'

export type { PackedIdentity } from './packing-source'
export interface RevisionLimits {
  retained: number
  staging: number
}
export type RevisionAdmission = (ownedBytes: number, stagingBytes: number) => void
export type PackedOperation =
  | { kind: 'replace'; path: PackedPath; record: number }
  | { kind: 'splice'; path: PackedPath; start: number; remove: number; record: number }
  | { kind: 'text'; path: PackedPath; start: number; remove: number; record: number }
  | { kind: 'offset'; path: PackedPath; start: number; offset: number }
  | { kind: 'range'; path: PackedPath; start: number; offset: number }
export interface PackedUpdate {
  base: PackedIdentity
  baseSource: string
  result: PackedIdentity
  source: string
  arena: PackedArena
  operations: readonly PackedOperation[]
}
interface OverlayResource {
  bytes: number
  previous: OverlayResource | undefined
}
function validateLimits(limits: RevisionLimits) {
  for (const value of [limits.retained, limits.staging])
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid packed revision limits')
  if (limits.staging < 1024) throw new Error('Packed revision exceeds staging limit')
}

/**
 * Experimental persistent graph, not an application transport or semantic validator. Each result
 * owns all its arena dependencies; it never retains its predecessor object. Cumulative overlay
 * weights deliberately overcharge obsolete metadata. Session-wide capture ownership is separate.
 */
export class PackedRevision {
  readonly identity: PackedIdentity
  readonly source: string
  readonly retainedBytes: number
  readonly preparationBytes: number
  readonly stagingBytes: number
  readonly root: PackedView
  readonly #node: PackedNode
  readonly #source: PackedSource
  readonly #arenas: ReadonlySet<PackedArena>
  readonly #overlay: OverlayResource | undefined
  readonly #overlayBytes: number
  /** Immutable source ownership only; no arena or revision internals escape. */
  get sourceResource(): PackedSource {
    return this.#source
  }
  private constructor(
    source: PackedSource,
    node: PackedNode,
    arenas: ReadonlySet<PackedArena>,
    overlay: OverlayResource | undefined,
    overlayBytes: number,
    retainedBytes: number,
    preparationBytes: number,
    stagingBytes: number,
  ) {
    this.identity = source.identity
    this.source = source.text
    this.#source = source
    this.#node = node
    this.#arenas = arenas
    this.#overlay = overlay
    this.#overlayBytes = overlayBytes
    this.retainedBytes = retainedBytes
    this.preparationBytes = preparationBytes
    this.stagingBytes = stagingBytes
    this.root = new PackedView(node)
    Object.freeze(this)
  }
  static full(
    arena: PackedArena,
    source: string,
    identity: PackedIdentity,
    limits: RevisionLimits,
  ): PackedRevision {
    validateLimits(limits)
    return PackedRevision.fullPrepared(arena, new PackedSource(identity, source), limits)
  }
  static fullPrepared(
    arena: PackedArena,
    source: PackedSource,
    limits: RevisionLimits,
  ): PackedRevision {
    validateLimits(limits)
    if (!isPackedSource(source)) throw new Error('Invalid prepared packed source')
    const retained = arena.retainedBytes + source.retainedBytes + 208
    if (retained > limits.retained) throw new Error('Packed revision exceeds retained limit')
    return new PackedRevision(
      source,
      { arena, id: arena.root },
      new Set([arena]),
      undefined,
      0,
      retained,
      retained,
      1024,
    )
  }
  /** Ordered operations use the preceding operation's paths. Any failure publishes nothing. */
  apply(update: PackedUpdate, limits: RevisionLimits): PackedRevision {
    validateLimits(limits)
    return this.applyPrepared(update, new PackedSource(update.result, update.source), limits)
  }
  applyPrepared(
    update: PackedUpdate,
    source: PackedSource,
    limits: RevisionLimits,
  ): PackedRevision {
    return finishPackedSteps(this.#applySteps(update, source, limits, false))
  }
  /** Trusted immutable update/source inputs; sessions copy the envelope before queuing.
   * No partially validated revision escapes. Callers forward every yielded work unit.
   */
  *applyPreparedSteps(
    update: PackedUpdate,
    source: PackedSource,
    limits: RevisionLimits,
    admission: RevisionAdmission,
  ): Generator<void, PackedRevision, undefined> {
    return yield* this.#applySteps(update, source, limits, true, admission)
  }
  *#applySteps(
    update: PackedUpdate,
    source: PackedSource,
    limits: RevisionLimits,
    cooperative: boolean,
    admission?: RevisionAdmission,
  ): Generator<void, PackedRevision, undefined> {
    validateLimits(limits)
    if (
      !update?.base ||
      identityKeys.some((key) => update.base[key] !== this.identity[key]) ||
      update.baseSource !== this.source
    )
      throw new Error('Packed base mismatch; full resync required')
    if (
      !isPackedSource(source) ||
      !sameIdentity(source.identity, update.result) ||
      source.text !== update.source
    )
      throw new Error('Invalid prepared packed source')
    const result = source.identity
    if (
      result.revision <= this.identity.revision ||
      identityKeys.some(
        (key) => key !== 'revision' && key !== 'sourceHash' && result[key] !== this.identity[key],
      )
    )
      throw new Error('Packed revision ownership changed; full resync required')
    if (
      !(update.arena instanceof PackedArena) ||
      !Array.isArray(update.operations) ||
      update.operations.length > 1024
    )
      throw new Error('Invalid packed update')
    const arenas = new Set(this.#arenas)
    arenas.add(update.arena)
    let retained = source.retainedBytes + 128 + arenas.size * 80 + this.#overlayBytes
    for (const arena of arenas) retained += arena.retainedBytes
    let extra = 0
    let staging = Math.max(1024, 256 + update.operations.length * 32)
    const previous = this.#source.retainedBytes + this.#arenas.size * 80 + 128
    const admit = () => {
      // Both exact source strings and the old capture remain live throughout preparation.
      if (retained + extra + previous > limits.retained)
        throw new Error('Packed revision exceeds retained limit')
      if (staging > limits.staging) throw new Error('Packed revision exceeds staging limit')
      admission?.(extra + 128 + arenas.size * 80, staging)
    }
    const charge = (bytes: number) => {
      extra += bytes
      admit()
    }
    charge(192) // Immutable shared overlay-resource link, including empty ordered updates.
    let node = this.#node
    const budget = new PackedMetadataBudget()
    for (const operation of update.operations as readonly PackedOperation[]) {
      if (cooperative && budget.advance()) yield
      if (
        !operation ||
        (operation.kind !== 'replace' &&
          operation.kind !== 'splice' &&
          operation.kind !== 'text' &&
          operation.kind !== 'offset' &&
          operation.kind !== 'range') ||
        !Array.isArray(operation.path) ||
        operation.path.length > 128
      )
        throw new Error('Invalid packed operation')
      for (const part of operation.path) {
        if (cooperative && budget.advance()) yield
        if (
          (typeof part !== 'string' &&
            !(typeof part === 'number' && Number.isSafeInteger(part) && part >= 0)) ||
          (typeof part === 'string' && part.length > 1024)
        )
          throw new Error('Invalid packed operation')
      }
      const transform = operation.kind === 'offset' || operation.kind === 'range'
      if (!transform) update.arena.kind(operation.record)
      staging = Math.max(staging, 256 + update.operations.length * 32 + operation.path.length * 160)
      admit()
      const ancestors: { node: PackedNode; part: string | number }[] = []
      let selected = node
      for (const part of operation.path) {
        if (cooperative && budget.advance()) yield
        ancestors.push({ node: selected, part })
        selected = cooperative ? yield* childSteps(selected, part, budget) : child(selected, part)
      }
      const replacement = transform
        ? undefined
        : Object.freeze({ arena: update.arena, id: operation.record })
      let next: PackedNode | undefined
      if (transform) {
        const stage = (bytes: number) => {
          staging = Math.max(staging, bytes + operation.path.length * 160)
          admit()
        }
        next = cooperative
          ? yield* (operation.kind === 'range' ? rangeSuffixSteps : offsetSuffixSteps)(
              selected,
              operation.start,
              operation.offset,
              charge,
              stage,
              true,
              budget,
            )
          : (operation.kind === 'range' ? rangeSuffix : offsetSuffix)(
              selected,
              operation.start,
              operation.offset,
              charge,
              stage,
            )
      } else if (operation.kind === 'replace') next = replacement
      else if (operation.kind === 'text')
        next = cooperative
          ? yield* spliceTextSteps(
              selected,
              operation.start,
              operation.remove,
              update.arena,
              operation.record,
              charge,
              budget,
            )
          : spliceText(
              selected,
              operation.start,
              operation.remove,
              update.arena,
              operation.record,
              charge,
            )
      else
        next = cooperative
          ? yield* spliceSteps(
              selected,
              operation.start,
              operation.remove,
              replacement,
              false,
              charge,
              budget,
            )
          : splice(selected, operation.start, operation.remove, replacement, false, charge)
      if (!next) throw new Error('Incomplete packed metadata copy')
      charge(64)
      for (let index = ancestors.length - 1; index >= 0; index--) {
        if (cooperative && budget.advance()) yield
        const ancestor = ancestors[index]
        if (!ancestor) throw new Error('Missing packed ancestor')
        next = cooperative
          ? yield* replaceChildSteps(ancestor.node, ancestor.part, next, charge, budget)
          : replaceChild(ancestor.node, ancestor.part, next, charge)
        if (!next) throw new Error('Incomplete packed ancestor copy')
      }
      node = next
      if (cooperative) yield
    }
    retained += extra
    return new PackedRevision(
      source,
      node,
      arenas,
      Object.freeze({ bytes: extra, previous: this.#overlay }),
      this.#overlayBytes + extra,
      retained,
      retained + previous,
      staging,
    )
  }
  /** Internal ownership footprint. A session never exposes these keys or raw revisions. */
  *resources(): Generator<PackedResource> {
    yield { key: this.#source, bytes: this.#source.retainedBytes }
    yield { key: this, bytes: 128 + this.#arenas.size * 80 }
    for (const arena of this.#arenas) yield { key: arena, bytes: arena.retainedBytes }
    for (let overlay = this.#overlay; overlay; overlay = overlay.previous)
      yield { key: overlay, bytes: overlay.bytes }
  }
}
