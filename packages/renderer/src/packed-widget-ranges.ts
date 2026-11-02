export interface PackedWidgetRange {
  from: number
  to: number
  first: number
  last: number
}

/** Numeric last-wins source ranges and dense spool offsets. Reservations include Map
 * entries, old/new typed storage during growth, sorted indices and one current range.
 * These are explicit logical weights, not calibrated physical heap measurements.
 */
export class PackedWidgetRanges {
  #ranges = new Map<number, number>()
  #rows = new Uint32Array(0)
  constructor(
    readonly sourceLength: number,
    readonly admit: (bytes: number) => void,
  ) {}
  *setSteps(value: PackedWidgetRange): Generator<void> {
    const key = value.from * (this.sourceLength + 1) + value.to
    const known = this.#ranges.get(key)
    const index = known ?? this.#ranges.size
    const size = Math.max(this.#ranges.size, index + 1)
    this.admit(65536 + size * 256)
    if (size * 4 > this.#rows.length) {
      const rows = new Uint32Array(Math.max(1024, this.#rows.length * 2, size * 4))
      for (let from = 0; from < this.#rows.length; from += 1024) {
        rows.set(this.#rows.subarray(from, from + 1024), from)
        yield
      }
      this.#rows = rows
    }
    this.#rows.set([value.from, value.to, value.first, value.last], index * 4)
    if (known === undefined) this.#ranges.set(key, index)
  }
  *values(): Generator<PackedWidgetRange | undefined> {
    const sorted = new Uint32Array(this.#ranges.size)
    for (let i = 0; i < sorted.length; i++) {
      sorted[i] = i
      if (i % 256 === 255) yield
    }
    sorted.sort(
      (a, b) =>
        (this.#rows[a * 4] ?? 0) - (this.#rows[b * 4] ?? 0) ||
        (this.#rows[b * 4 + 1] ?? 0) - (this.#rows[a * 4 + 1] ?? 0),
    )
    yield
    for (const i of sorted) {
      yield {
        from: this.#rows[i * 4] ?? 0,
        to: this.#rows[i * 4 + 1] ?? 0,
        first: this.#rows[i * 4 + 2] ?? 0,
        last: this.#rows[i * 4 + 3] ?? 0,
      }
    }
  }
  clear(release = true): void {
    this.#ranges.clear()
    this.#rows = new Uint32Array(0)
    if (release) this.admit(65536)
  }
}
