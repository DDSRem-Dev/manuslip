/** Explicit synchronous contract for the same implementation used by cooperative callers. */
export function finishPackedSteps<T>(steps: Iterator<void, T, undefined>): T {
  while (true) {
    const step = steps.next()
    if (step.done) return step.value
  }
}

/** Revocable scheduler handle. Closing it drops the generator and owner callback, including
 * before the generator starts. Reentrant cancellation defers generator.return until next
 * unwinds, while revoking the owner immediately. A queued closed handle retains no owner.
 */
export class PackedWork<T, Yield = void>
  implements IterableIterator<Yield, T | undefined, undefined>
{
  readonly [Symbol.toStringTag] = 'Generator'
  #iterator: Generator<Yield, T | undefined, undefined> | undefined
  #closed: (() => void) | undefined
  #running = false
  constructor(iterator: Generator<Yield, T | undefined, undefined>, closed: () => void) {
    this.#iterator = iterator
    this.#closed = closed
  }
  [Symbol.iterator](): IterableIterator<Yield, T | undefined, undefined> {
    return this
  }
  #close(): void {
    this.#iterator = undefined
    const closed = this.#closed
    this.#closed = undefined
    closed?.()
  }
  next(): IteratorResult<Yield, T | undefined> {
    const iterator = this.#iterator
    if (!iterator) return { done: true, value: undefined }
    if (this.#running) throw new Error('Reentrant packed work')
    this.#running = true
    try {
      const result = iterator.next()
      if (this.#iterator !== iterator) return { done: true, value: undefined }
      if (result.done) this.#close()
      return result
    } catch (error) {
      this.#close()
      throw error
    } finally {
      this.#running = false
      if (this.#iterator !== iterator) iterator.return(undefined)
    }
  }
  return(): IteratorResult<Yield, T | undefined> {
    const iterator = this.#iterator
    const running = this.#running
    try {
      this.#close()
    } finally {
      if (!running) iterator?.return(undefined)
    }
    return { done: true, value: undefined }
  }
  throw(error: unknown): IteratorResult<Yield, T | undefined> {
    this.return()
    throw error
  }
}
