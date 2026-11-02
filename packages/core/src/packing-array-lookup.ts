import type {
  PackedItemSteps,
  PackedItems,
  PackedReadScope,
  PackedTextSteps,
} from './packing-capture'
import type { ScalarLimits } from './packing-text'
import type { PackedArrayIndex, PackedView } from './packing-view'

export interface PackedArrayLookupLimits extends ScalarLimits {
  items: number
  /** Use dense record IDs for plain arena arrays; overlays retain ordinary indexing. */
  compact?: boolean
}
export interface PackedArrayLookupCost {
  readonly retainedBytes: number
  readonly stagingBytes: number
  readonly items: number
}
export interface PackedArrayReaders {
  iterate(view: PackedView): PackedItems
  stream(view: PackedView, limits: ScalarLimits): PackedTextSteps
  steps(view: PackedView): PackedItemSteps
}
export type PackedScopeFactory = (
  get: () => PackedView,
  iterate: PackedArrayReaders['iterate'],
  stream: PackedArrayReaders['stream'],
  steps: PackedArrayReaders['steps'],
) => PackedReadScope

/** Private views remain inside an admitted inspector. Escaped scopes reference this
 * revocable index, whose close clears both views and every capture/owner callback.
 * An independently opened text/array stream has its own existing capture-owned lifetime.
 */
export class PackedArrayLookup {
  #values: readonly PackedView[] | PackedArrayIndex | undefined
  #readers: PackedArrayReaders | undefined
  readonly #scope: PackedScopeFactory
  constructor(
    values: readonly PackedView[] | PackedArrayIndex,
    readers: PackedArrayReaders,
    scope: PackedScopeFactory,
  ) {
    this.#values = values
    this.#readers = readers
    this.#scope = scope
    Object.freeze(this)
  }
  get length(): number {
    if (!this.#values) throw new Error('Packed array lookup closed')
    return this.#values.length
  }
  #value(index: number): PackedView {
    if (!this.#values) throw new Error('Packed array lookup closed')
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.#values.length)
      throw new Error('Invalid packed array lookup index')
    const value = 'get' in this.#values ? this.#values.get(index) : this.#values[index]
    if (!value) throw new Error('Missing packed array lookup item')
    return value
  }
  #handlers(): PackedArrayReaders {
    if (!this.#readers) throw new Error('Packed array lookup closed')
    return this.#readers
  }
  at(index: number): PackedReadScope {
    this.#value(index)
    return this.#scope(
      () => this.#value(index),
      (view) => this.#handlers().iterate(view),
      (view, limits) => this.#handlers().stream(view, limits),
      (view) => this.#handlers().steps(view),
    )
  }
  close(): void {
    this.#values = undefined
    this.#readers = undefined
  }
}
