import type { PackedCapture } from '../../core/src/packing-capture'
import type { PackedWork } from '../../core/src/packing-work'
import type { PackedWorkspace } from '../../core/src/packing-workspace'
import type { ReadingProjection } from './reading'

/** Capture-owned completed output. The existing reservation moves here without a second
 * allocation or an uncharged gap. Raw values are borrowed until release/capture revocation;
 * callers retaining them further must provide their own admission.
 */
export class PackedReadingOutput {
  #value: ReadingProjection | undefined
  #budget: PackedWorkspace | undefined
  #lifetime: PackedWork<void> | undefined
  constructor(capture: PackedCapture, value: ReadingProjection, budget: PackedWorkspace) {
    this.#value = value
    this.#budget = budget
    const output = this
    try {
      this.#lifetime = capture.work(
        (function* () {
          try {
            yield
          } finally {
            output.release()
          }
        })(),
      )
      this.#lifetime.next()
    } catch (error) {
      this.release()
      throw error
    }
  }
  get value(): ReadingProjection {
    if (!this.#value) throw new Error('Packed reading output released')
    return this.#value
  }
  release(): void {
    this.#value = undefined
    const work = this.#lifetime,
      budget = this.#budget
    this.#lifetime = undefined
    this.#budget = undefined
    try {
      work?.return()
    } finally {
      budget?.release()
    }
  }
}
