/** A traversal yields after at most 16 counted node/property visits or 4096 text
 * units. Every true result requires an immediate yield. Explicit native-call barriers
 * reset the counters too, so earlier cheap work cannot accumulate around those calls.
 * Logical node/depth limits and allocation admission are checked independently.
 */
export class ProjectionTraversalBudget {
  #operations = 0
  #units = 0
  step(): boolean {
    if (++this.#operations < 16) return false
    this.reset()
    return true
  }
  get textCapacity(): number {
    return 4096 - this.#units
  }
  text(units: number): boolean {
    this.#units += units
    if (this.#units < 4096) return false
    this.reset()
    return true
  }
  reset(): void {
    this.#operations = 0
    this.#units = 0
  }
}
