/** A forward-only work queue that drops consumed references and bounds unused capacity. */
export class TranslationQueue<T extends object> {
  private items: (T | undefined)[] = []
  private head = 0

  get first(): T | undefined {
    return this.items[this.head]
  }

  reset(items: Iterable<T>): void {
    this.items = Array.from(items)
    this.head = 0
  }

  take(): T | undefined {
    const item = this.items[this.head]
    if (item === undefined) return undefined
    this.items[this.head++] = undefined
    if (this.head === this.items.length) this.clear()
    else if (this.head >= 1024 && this.head * 2 >= this.items.length) {
      this.items = this.items.slice(this.head)
      this.head = 0
    }
    return item
  }

  clear(): void {
    this.items = []
    this.head = 0
  }
}
