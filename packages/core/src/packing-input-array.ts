import { finishPackedCleanup } from './packing-cleanup'
import type { PackedEncodingBudget } from './packing-encode-budget'
import { PackedWork } from './packing-work'

/** Cooperative progress from a trusted array source, with no JSON element to encode. */
export const packedArrayPause = Symbol('packed array progress')

export interface PackedArrayRecord {
  readonly input: PackedArrayInput
  id: number | undefined
}
export interface PackedArrayInputs {
  adopt(inputs: readonly PackedArrayInput[]): void
  get(value: object): PackedArrayRecord | undefined
  next(record: PackedArrayRecord): IteratorResult<unknown>
  finish(record: PackedArrayRecord, id: number): void
  close(preserveFailure?: boolean): void
}

/** Trusted, single-use array input. The encoder owns the iterator after claiming all
 * declared inputs, including inputs it never visits. Completion runs before the next
 * subtree is read; it may populate private containers that have not been traversed yet.
 * Input callbacks and their native allocations remain the caller's responsibility.
 */
export class PackedArrayInput {
  #work: PackedWork<unknown, unknown> | undefined
  #owner: object | undefined
  #used = false
  #completed: ((value: unknown) => void) | undefined
  constructor(
    iterator: Generator<unknown, unknown, undefined> | PackedWork<unknown, unknown>,
    completed?: (value: unknown) => void,
  ) {
    if (
      !iterator ||
      typeof iterator.next !== 'function' ||
      typeof iterator.return !== 'function' ||
      typeof iterator.throw !== 'function'
    )
      throw new Error('Invalid packed array iterator')
    this.#work = iterator instanceof PackedWork ? iterator : new PackedWork(iterator, () => {})
    this.#completed = completed
    Object.freeze(this)
  }
  #close(): void {
    const work = this.#work
    this.#work = undefined
    this.#owner = undefined
    this.#completed = undefined
    this.#used = true
    work?.return()
  }
  /** Explicit revocation also makes an active encoder fail instead of accepting a prefix. */
  return(): void {
    this.#close()
  }
  /** Internal atomic ownership transfer. Validation/registry admission precede claims;
   * no user callbacks run until an encoding advance pulls a declared iterator.
   */
  static own(inputs: readonly PackedArrayInput[], budget: PackedEncodingBudget): PackedArrayInputs {
    if (!Array.isArray(inputs)) throw new Error('Invalid packed array inputs')
    budget.charge(512)
    const owner = Object.freeze({})
    const records = new Map<object, PackedArrayRecord>()
    let closed = false
    const adopt = (sources: readonly PackedArrayInput[]) => {
      if (closed || !Array.isArray(sources)) throw new Error('Invalid packed array inputs')
      budget.charge(sources.length * 256)
      const pending = new Map<object, PackedArrayRecord>()
      for (const input of sources) {
        if (
          !input ||
          typeof input !== 'object' ||
          !(#work in input) ||
          input.#used ||
          !input.#work ||
          records.has(input) ||
          pending.has(input)
        )
          throw new Error('Invalid or consumed packed array input')
        pending.set(input, { input, id: undefined })
      }
      for (const [input, record] of pending) {
        record.input.#used = true
        record.input.#owner = owner
        records.set(input, record)
      }
    }
    adopt(inputs)
    return {
      adopt,
      get(value) {
        return records.get(value)
      },
      next(record) {
        const input = record.input
        if (closed || input.#owner !== owner || !input.#work)
          throw new Error('Packed array input cancelled')
        const step = input.#work.next()
        if (step.done) {
          const completed = input.#completed
          input.#completed = undefined
          completed?.(step.value)
        }
        if (!closed && input.#owner !== owner) throw new Error('Packed array input cancelled')
        return step
      },
      finish(record, id) {
        record.id = id
        record.input.#close()
      },
      close(preserveFailure = false) {
        if (closed) return
        closed = true
        try {
          finishPackedCleanup(
            (function* () {
              for (const { input } of records.values()) yield () => input.#close()
            })(),
            preserveFailure,
          )
        } finally {
          records.clear()
        }
      },
    }
  }
}
