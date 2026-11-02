/** One quota spans nested postprocessing walks, copies, and gap movements. */
export class MarkdownEventBudget {
  #advances = 0

  advance(): boolean {
    if (this.#advances === 256) {
      this.#advances = 1
      return true
    }
    this.#advances++
    return false
  }
}

/** Private transactional gap buffer. Interrupted mutations revoke the buffer. Native
 * array capacity changes and teardown remain atomic; this bounds element visits.
 */
export class MarkdownEventBuffer<T> {
  #left: T[] = []
  #right: T[] = []
  #closed = false

  get length(): number {
    this.#assertOpen()
    return this.#left.length + this.#right.length
  }

  get(index: number): T {
    this.#assertRange(index, 1)
    return (
      index < this.#left.length ? this.#left[index] : this.#right[this.length - index - 1]
    ) as T
  }

  *load(items: readonly T[], budget: MarkdownEventBudget): Generator<void> {
    if (this.length) throw new Error('Markdown event buffer already initialized')
    yield* this.splice(0, 0, items, budget)
  }

  *slice(
    from: number,
    to: number,
    budget: MarkdownEventBudget,
    prefix: readonly T[] = [],
  ): Generator<void, T[]> {
    this.#assertRange(from, to - from)
    const result: T[] = []
    let complete = false
    try {
      for (let index = 0; index < prefix.length; index++) {
        if (budget.advance()) yield
        result.push(prefix[index] as T)
      }
      for (let index = from; index < to; index++) {
        if (budget.advance()) yield
        result.push(this.get(index))
      }
      complete = true
      return result
    } finally {
      if (!complete) result.length = 0
    }
  }

  *splice(
    start: number,
    count: number,
    items: readonly T[],
    budget: MarkdownEventBudget,
  ): Generator<void> {
    this.#assertRange(start, count)
    let complete = false
    try {
      while (this.#left.length > start) {
        if (budget.advance()) yield
        this.#right.push(this.#left.pop() as T)
      }
      while (this.#left.length < start) {
        if (budget.advance()) yield
        this.#left.push(this.#right.pop() as T)
      }
      for (let index = 0; index < count; index++) {
        if (budget.advance()) yield
        this.#right.pop()
      }
      for (let index = 0; index < items.length; index++) {
        if (budget.advance()) yield
        this.#left.push(items[index] as T)
      }
      complete = true
    } finally {
      if (!complete) this.close()
    }
  }

  close(): void {
    this.#closed = true
    this.#left.length = 0
    this.#right.length = 0
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('Closed Markdown event buffer')
  }

  #assertRange(start: number, count: number): void {
    this.#assertOpen()
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(count) ||
      start < 0 ||
      count < 0 ||
      start + count > this.length
    )
      throw new Error('Invalid Markdown event range')
  }
}
