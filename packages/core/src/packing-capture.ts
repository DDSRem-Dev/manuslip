import {
  PackedArrayLookup,
  type PackedArrayLookupCost,
  type PackedArrayLookupLimits,
  type PackedScopeFactory,
} from './packing-array-lookup'
import { finishPackedCleanup } from './packing-cleanup'
import { copyPackedEncoding } from './packing-copy'
import { PackedHold } from './packing-hold'
import type { PackedRevision } from './packing-revision'
import {
  type PackedSerializationLimits,
  type PackedSerializedValue,
  serializePackedViewSteps,
} from './packing-serialize'
import { admitPackedKeys, admitScalar, type ScalarLimits } from './packing-text'
import type { PackedValue } from './packing-value'
import type { PackedArrayIndex, PackedPath, PackedPrefix, PackedView } from './packing-view'
import { PackedWork } from './packing-work'
import { PackedWorkspace, type PackedWorkspaceFactory } from './packing-workspace'

type Iterate = (view: PackedView) => PackedItems
type IterateSteps = (view: PackedView) => PackedItemSteps
type Stream = (view: PackedView, limits: ScalarLimits) => PackedTextSteps
const emptyPath: PackedPath = Object.freeze([])
const indexedScope: PackedScopeFactory = (get, iterate, stream, steps) =>
  new PackedReadScope(get, iterate, stream, steps)
interface ItemSlot {
  view: PackedView | null
  version: number
}

/** Revocable reader; it stores a guarded lookup, never a raw revision/arena/view. */
export class PackedReadScope {
  readonly #get: () => PackedView
  #path: PackedPrefix = emptyPath
  readonly #iterate: Iterate
  readonly #stream: Stream
  readonly #steps: IterateSteps
  constructor(get: () => PackedView, iterate: Iterate, stream: Stream, steps: IterateSteps) {
    this.#get = get
    this.#iterate = iterate
    this.#stream = stream
    this.#steps = steps
    Object.freeze(this)
  }
  /** Guarded child scope. Item scopes expire with their parent; capture scopes revoke on
   * release. Copy the bounded path before suspension so callers cannot redirect a read.
   */
  at(path: PackedPath): PackedReadScope {
    if (
      !Array.isArray(path) ||
      path.length > 128 ||
      path.some((part) =>
        typeof part === 'string' ? part.length > 1024 : !Number.isSafeInteger(part) || part < 0,
      )
    )
      throw new Error('Invalid packed reader path')
    const checked = Object.freeze([...path])
    const selected = this.#get().scopePath(checked, this.#path)
    const scope = new PackedReadScope(this.#get, this.#iterate, this.#stream, this.#steps)
    scope.#path = selected
    return scope
  }
  kind(path: PackedPath = emptyPath) {
    return this.#get().kind(path, this.#path)
  }
  /** Paths are checked when composed over an immutable view. Recheck only the guarded
   * capture/item lookup at suspension boundaries; no selected record or view escapes.
   */
  assertOpen(): void {
    this.#get()
  }
  hasField(key: string): boolean {
    return this.#get().hasField(key, this.#path)
  }
  length(path: PackedPath = emptyPath) {
    return this.#get().length(path, this.#path)
  }
  textLength(path: PackedPath = emptyPath) {
    return this.#get().textLength(path, this.#path)
  }
  scalarCost(path: PackedPath = emptyPath) {
    return this.#get().scalarCost(path, this.#path)
  }
  scalarType(path: PackedPath = emptyPath) {
    return this.#get().scalarType(path, this.#path)
  }
  scalar(path: PackedPath, limits: ScalarLimits) {
    return this.#get().readScalar(limits, path, this.#path)
  }
  textStepCost(path: PackedPath = emptyPath) {
    return this.#get().textStepCost(path, this.#path)
  }
  /** Borrow an immutable short arena string without collecting decoder chunks. The caller
   * must admit any independent native output lifetime; long/edited text returns undefined.
   */
  cachedText(path: PackedPath = emptyPath): string | undefined {
    return this.#get().cachedText(path, this.#path)
  }
  /** Opaque source-free record identity, not a content hash or semantic certificate. */
  recordKey(path: PackedPath = emptyPath) {
    return this.#get().recordKey(path, this.#path)
  }
  /** Internal imports retain source-free metadata and recheck this scope on every read.
   * A transformed/composite subtree returns undefined and keeps ordinary traversal.
   */
  encodedRecord(reference?: number) {
    return this.#get().encodedRecord(this.#path, reference)
  }
  encodedReference(reference: number, offset: number) {
    return this.#get().encodedReference(this.#path, reference, offset)
  }
  encodedTextSteps(reference: number, limits: ScalarLimits): PackedTextSteps {
    return this.#stream(this.#get().encodedText(this.#path, reference), limits)
  }
  /** Each advance emits <=4098 UTF-16 units or undefined progress. An opened stream owns
   * its reader scope independently of parent-item advancement, until close/capture release.
   * Earlier emitted strings retained by the caller need their own output admission.
   */
  textSteps(path: PackedPath, limits: ScalarLimits): PackedTextSteps {
    return this.#stream(this.#get().at(path, this.#path), limits)
  }
  keys(path: PackedPath, limits: ScalarLimits): readonly string[] {
    const keys = this.#get().keys(path, this.#path)
    admitPackedKeys(keys, limits)
    return Object.freeze([...keys])
  }
  /** Atomic schema check; no shape, arena or view escapes the original guarded lookup. */
  matchesKeys(
    path: PackedPath,
    required: readonly string[],
    optional: readonly string[],
    limits: ScalarLimits,
  ): boolean {
    return this.#get().matchesKeys(required, optional, limits, path, this.#path)
  }
  keyCount(path: PackedPath = emptyPath): number {
    return this.#get().keyCount(path, this.#path)
  }
  position(path: PackedPath, limits: ScalarLimits) {
    return this.#get().readPosition(limits, path, this.#path)
  }
  /** Each item expires on the next advance/return; nested iterators own their own scope. */
  elements(path: PackedPath = emptyPath): PackedItems {
    const view = this.#get().at(path, this.#path)
    view.length() // Check the kind before opening a retained iterator scope.
    return this.#iterate(view)
  }
  /** Like elements, with undefined progress after at most 256 discarded references and
   * at segment boundaries. Every advance expires the preceding item, including progress.
   */
  elementSteps(path: PackedPath = emptyPath): PackedItemSteps {
    const view = this.#get().at(path, this.#path)
    view.length()
    return this.#steps(view)
  }
}

export class PackedItemSteps implements IterableIterator<PackedReadScope | undefined> {
  #inner: Pick<Generator<PackedView | undefined>, 'next' | 'return'> | null
  readonly #slot: ItemSlot = { view: null, version: 0 }
  readonly #iterate: Iterate
  readonly #stream: Stream
  readonly #steps: IterateSteps
  #closed: (() => void) | null
  #revoke: (() => void) | null
  #running = false
  constructor(
    inner: Pick<Generator<PackedView | undefined>, 'next' | 'return'>,
    iterate: Iterate,
    stream: Stream,
    steps: IterateSteps,
    closed: () => void,
    revoke?: () => void,
  ) {
    this.#inner = inner
    this.#iterate = iterate
    this.#stream = stream
    this.#steps = steps
    this.#closed = closed
    this.#revoke = revoke ?? null
    Object.freeze(this)
  }
  [Symbol.iterator]() {
    return this
  }
  next(): IteratorResult<PackedReadScope | undefined> {
    this.#slot.view = null
    const version = ++this.#slot.version
    const inner = this.#inner
    if (!inner) return { done: true, value: undefined }
    if (this.#running) {
      this.return()
      throw new Error('Reentrant packed work')
    }
    this.#running = true
    try {
      const next = inner.next()
      if (this.#inner !== inner) return { done: true, value: undefined }
      if (next.done) return this.return()
      if (next.value === undefined) return { done: false, value: undefined }
      this.#slot.view = next.value
      const slot = this.#slot
      return {
        done: false,
        value: new PackedReadScope(
          () => {
            if (!slot.view || slot.version !== version) throw new Error('Packed item scope expired')
            return slot.view
          },
          this.#iterate,
          this.#stream,
          this.#steps,
        ),
      }
    } catch (error) {
      this.return()
      throw error
    } finally {
      this.#running = false
      if (this.#inner !== inner) inner.return(undefined)
    }
  }
  return(): IteratorReturnResult<undefined> {
    const inner = this.#inner
    this.#inner = null
    this.#slot.view = null
    this.#slot.version++
    const revoke = this.#revoke
    this.#revoke = null
    try {
      revoke?.()
    } finally {
      try {
        if (!this.#running) inner?.return(undefined)
      } finally {
        const closed = this.#closed
        this.#closed = null
        closed?.()
      }
    }
    return { done: true, value: undefined }
  }
}

/** Explicit synchronous contract. Cooperative consumers use PackedItemSteps directly. */
export class PackedItems extends PackedItemSteps implements IterableIterator<PackedReadScope> {
  override next(): IteratorResult<PackedReadScope> {
    while (true) {
      const step = super.next()
      if (step.done) return this.return()
      if (step.value !== undefined) return { done: false, value: step.value }
    }
  }
}

/** Capture-owned streaming scope. Closing clears all arena/view/owner references, including
 * when the underlying generator never started. Native chunks remain independently owned.
 */
export class PackedTextSteps implements IterableIterator<string | undefined> {
  #inner: Generator<string | undefined> | null
  #closed: (() => void) | null
  constructor(inner: Generator<string | undefined>, closed: () => void) {
    this.#inner = inner
    this.#closed = closed
    Object.freeze(this)
  }
  [Symbol.iterator]() {
    return this
  }
  next(): IteratorResult<string | undefined> {
    const inner = this.#inner
    if (!inner) return { done: true, value: undefined }
    try {
      const next = inner.next()
      return next.done ? this.return() : next
    } catch (error) {
      this.return()
      throw error
    }
  }
  return(): IteratorResult<string | undefined> {
    const inner = this.#inner
    this.#inner = null
    try {
      inner?.return(undefined)
    } finally {
      const closed = this.#closed
      this.#closed = null
      closed?.()
    }
    return { done: true, value: undefined }
  }
  throw(error: unknown): IteratorResult<string | undefined> {
    this.return()
    throw error
  }
}

/** Session-owned capture. Release revokes every escaped reader and closes its iterators. */
export class PackedCapture {
  readonly #ownerToken: object
  readonly reader: PackedReadScope
  #revision: PackedRevision | null
  #released: (() => void) | null
  #open: ((reserve?: number, staging?: number) => () => void) | null
  #own: (<T extends object>(value: T, bytes: number) => PackedValue<T>) | null
  #fork: (() => PackedCapture) | null
  readonly #iterators = new Set<PackedItemSteps | PackedTextSteps | PackedWork<unknown, unknown>>()
  readonly #workspaces = new Set<PackedHold | PackedWorkspace>()
  #reserve: PackedWorkspaceFactory | null
  readonly #dispatch: Iterate
  readonly #stream: Stream
  readonly #steps: IterateSteps
  constructor(
    revision: PackedRevision,
    open: (reserve?: number, staging?: number) => () => void,
    released: () => void,
    ownerToken: object = Object.freeze({}),
    own?: <T extends object>(value: T, bytes: number) => PackedValue<T>,
    fork?: () => PackedCapture,
    reserve?: PackedWorkspaceFactory,
  ) {
    this.#ownerToken = ownerToken
    this.#revision = revision
    this.#open = open
    this.#own = own ?? null
    this.#fork = fork ?? null
    this.#reserve = reserve ?? null
    this.#released = released
    this.#dispatch = (view) => this.#iterate(view)
    this.#stream = (view, limits) => this.#textSteps(view, limits)
    this.#steps = (view) => this.#elementSteps(view)
    this.reader = new PackedReadScope(
      () => this.#current().root,
      this.#dispatch,
      this.#stream,
      this.#steps,
    )
    Object.freeze(this)
  }
  #current(): PackedRevision {
    if (!this.#revision) throw new Error('Packed capture released')
    return this.#revision
  }
  get identity() {
    return this.#current().identity
  }
  /** Complete immutable revision charge, including all shared arena dependencies.
   * This is independent of the most recent delta's wire size and excludes consumers.
   */
  get retainedBytes(): number {
    return this.#current().retainedBytes
  }
  /** Independently pin this exact immutable revision. Prepared forks share revocation. */
  retain(): PackedCapture {
    this.#current()
    if (!this.#fork) throw new Error('Packed capture cannot be retained')
    return this.#fork()
  }
  sameOwner(other: PackedCapture): boolean {
    this.#current()
    other.#current()
    return this.#ownerToken === other.#ownerToken
  }
  /** Exact immutable graph identity, including overlays, without exposing its revision. */
  sameRevision(other: PackedCapture): boolean {
    const revision = this.#current()
    return revision === other.#current() && this.#ownerToken === other.#ownerToken
  }
  /** Source-free weak identity predicate. It does not pin or authorize any graph;
   * validators can use it to recognize the same prepared revision after commit revokes
   * inspection captures. Callers separately admit the predicate's metadata lifetime.
   */
  revisionWitness(): (candidate: PackedCapture) => boolean {
    const revision = new WeakRef(this.#current()),
      owner = this.#ownerToken
    return (candidate) =>
      candidate.#current() === revision.deref() && candidate.#ownerToken === owner
  }
  /** Independently ownable immutable source; callers account its lifetime separately. */
  get sourceResource() {
    return this.#current().sourceResource
  }
  /** Internal validator scratch/output ownership; admitted before allocating. The scope
   * consumes one reader slot and closes automatically when its capture is revoked.
   */
  workspace(retained: number, staging: number): PackedHold {
    this.#current()
    if (!this.#open) throw new Error('Packed capture released')
    const closeBudget = this.#open(retained, staging)
    const hold = new PackedHold(() => {
      this.#workspaces.delete(hold)
      closeBudget()
    })
    this.#workspaces.add(hold)
    return hold
  }
  /** Resizable output/scratch under one reader slot, with no release/reacquire gap. */
  reserveWorkspace(retained: number, staging: number): PackedWorkspace {
    this.#current()
    if (!this.#reserve) throw new Error('Packed capture cannot reserve workspace')
    const budget = this.#reserve(retained, staging)
    const workspace = new PackedWorkspace(budget.resize, () => {
      this.#workspaces.delete(workspace)
      budget.release()
    })
    this.#workspaces.add(workspace)
    return workspace
  }
  /** Independently owned native output in this capture's exact session ledger.
   * Unlike workspace(), capture closure does not release it; its owner must do so.
   */
  own<T extends object>(value: T, bytes: number): PackedValue<T> {
    this.#current()
    if (!this.#own) throw new Error('Packed capture has no native output owner')
    return this.#own(value, bytes)
  }
  /** Serialize complete selected values, including lazy transforms, without a native tree.
   * Cancellation/revocation closes all work; successful output owns an independent lease.
   */
  serialize(
    path: PackedPath,
    limits: PackedSerializationLimits,
  ): PackedWork<PackedValue<PackedSerializedValue>> {
    this.reader.at(path) // Validate/copy paths before exposing a raw internal view to work.
    const view = this.#current().root.at([...path])
    return this.work(serializePackedViewSteps(this, view, { ...limits }))
  }
  /** Low-workspace copy for a complete untransformed encoding. Returns undefined for an
   * overlay; callers can choose measured serialization or an explicit capacity fallback.
   */
  copyEncoding(byteLimit: number): PackedWork<PackedValue<PackedSerializedValue>> | undefined {
    const view = this.#current().root
    if (!view.encoding()) return undefined
    return this.work(copyPackedEncoding(this, view, byteLimit))
  }
  /** Cooperatively index one array under a single reservation. Borrowed lookup scopes
   * avoid rescanning lazy prefixes and all revoke when the inspector/capture closes.
   */
  inspectArray(
    path: PackedPath,
    limits: PackedArrayLookupLimits,
    inspect: (lookup: PackedArrayLookup, cost: PackedArrayLookupCost) => Generator<void>,
  ): PackedWork<void> {
    return this.work(this.inspectArraySteps(path, limits, inspect))
  }
  /** Internal array borrow under an enclosing capture-owned work item. The parent must
   * close this entire delegation chain; independent callers use inspectArray instead.
   */
  inspectArraySteps(
    path: PackedPath,
    limits: PackedArrayLookupLimits,
    inspect: (lookup: PackedArrayLookup, cost: PackedArrayLookupCost) => Generator<void>,
  ): Generator<void> {
    this.reader.at(path)
    if (path.length > 64 || typeof inspect !== 'function')
      throw new Error('Invalid packed array inspection')
    const checked = [...path]
    const budget = { ...limits }
    const capture = this
    const work = (function* () {
      for (const key of ['retained', 'staging', 'items'] as const)
        if (!Number.isSafeInteger(budget[key]) || budget[key] < 0)
          throw new Error('Invalid packed array lookup limits')
      const view = capture.#current().root.at(checked)
      const size = view.length()
      if (size > budget.items) throw new Error('Packed array lookup item limit')
      const compact = budget.compact ? view.compactArrayBytes() : undefined
      const bytes = 16384 + (compact ?? size * 512)
      if (
        !Number.isSafeInteger(bytes) ||
        bytes + 2 * 512 > budget.retained ||
        bytes > budget.staging
      )
        throw new Error('Packed array lookup exceeds workspace limit')
      const hold = capture.workspace(bytes, bytes)
      let lookup: PackedArrayLookup | undefined
      let failed = false
      try {
        let values: PackedView[] | PackedArrayIndex
        if (compact !== undefined) values = yield* view.indexArraySteps()
        else {
          values = new Array<PackedView>(size)
          let index = 0
          for (const value of view.elementSteps()) {
            if (value !== undefined) values[index++] = value
            yield
          }
          if (index !== size) throw new Error('Invalid packed array lookup cardinality')
        }
        lookup = new PackedArrayLookup(
          values,
          { iterate: capture.#dispatch, stream: capture.#stream, steps: capture.#steps },
          indexedScope,
        )
        yield
        yield* inspect(
          lookup,
          Object.freeze({ retainedBytes: bytes, stagingBytes: bytes, items: size }),
        )
      } catch (error) {
        failed = true
        throw error
      } finally {
        finishPackedCleanup([() => lookup?.close(), () => hold.release()], failed)
      }
    })()
    return (function* () {
      let failed = false
      try {
        while (true) {
          capture.identity
          const next = work.next()
          capture.identity
          if (next.done) return
          yield
        }
      } catch (error) {
        failed = true
        throw error
      } finally {
        finishPackedCleanup([() => work.return(undefined)], failed)
      }
    })()
  }
  /** Own a queued validator, including before its first advance. Revocation closes its
   * suspended frames/indexes instead of merely releasing their accounting reservation.
   * Optional cleanup also runs for queued work whose generator never starts.
   */
  work<T, Yield = void>(
    iterator: Generator<Yield, T | undefined, undefined>,
    closed?: () => void,
  ): PackedWork<T, Yield> {
    this.#current()
    if (!this.#open) throw new Error('Packed capture released')
    const closeBudget = this.#open()
    const work = new PackedWork(iterator, () => {
      this.#iterators.delete(work)
      try {
        closeBudget()
      } finally {
        closed?.()
      }
    })
    this.#iterators.add(work)
    return work
  }
  #iterate(view: PackedView): PackedItems {
    return this.#items(
      (closed) =>
        new PackedItems(view.elements(), this.#dispatch, this.#stream, this.#steps, closed),
    )
  }
  #elementSteps(view: PackedView): PackedItemSteps {
    return this.#items((closed) => {
      const cursor = view.elementCursor()
      return new PackedItemSteps(
        cursor.steps,
        this.#dispatch,
        this.#stream,
        this.#steps,
        closed,
        cursor.revoke,
      )
    })
  }
  #items<T extends PackedItemSteps>(create: (closed: () => void) => T): T {
    this.#current()
    if (!this.#open) throw new Error('Packed capture released')
    const closeBudget = this.#open()
    const iterator = create(() => {
      this.#iterators.delete(iterator)
      closeBudget()
    })
    this.#iterators.add(iterator)
    return iterator
  }
  #textSteps(view: PackedView, limits: ScalarLimits): PackedTextSteps {
    this.#current()
    if (!this.#open) throw new Error('Packed capture released')
    const cost = view.textStepCost()
    admitScalar(cost, limits)
    const closeBudget = this.#open(cost.retained + cost.workspace, cost.workspace)
    const iterator = new PackedTextSteps(view.textSteps(), () => {
      this.#iterators.delete(iterator)
      closeBudget()
    })
    this.#iterators.add(iterator)
    return iterator
  }
  release(): void {
    this.#revision = null
    this.#open = null
    this.#own = null
    this.#fork = null
    this.#reserve = null
    const released = this.#released
    this.#released = null
    const capture = this
    finishPackedCleanup(
      (function* () {
        for (const iterator of capture.#iterators)
          yield () => {
            iterator.return()
          }
        for (const hold of capture.#workspaces) yield () => hold.release()
        yield () => released?.()
      })(),
    )
  }
}
