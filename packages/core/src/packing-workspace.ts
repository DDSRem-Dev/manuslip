export interface PackedWorkspaceBudget {
  resize(retained: number, staging: number): void
  release(): void
}
export type PackedWorkspaceFactory = (retained: number, staging: number) => PackedWorkspaceBudget

/** One capture-owned reader reservation. Resize admits the new total atomically; a failed
 * resize preserves the previous reservation. Closed handles retain no owner callbacks.
 */
export class PackedWorkspace {
  #resize: PackedWorkspaceBudget['resize'] | null
  #release: (() => void) | null
  constructor(resize: PackedWorkspaceBudget['resize'], release: () => void) {
    this.#resize = resize
    this.#release = release
    Object.freeze(this)
  }
  resize(retained: number, staging: number): void {
    if (!this.#resize) throw new Error('Packed workspace released')
    this.#resize(retained, staging)
  }
  release(): void {
    this.#resize = null
    const release = this.#release
    this.#release = null
    release?.()
  }
}
