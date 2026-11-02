/** One element-visit quota across private revision path and copy helpers. */
export class PackedMetadataBudget {
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
