import { PackedReader } from './packing-bytes'
import { finishPackedSteps } from './packing-work'

export interface PositionBounds {
  readonly minimum: number
  readonly maximum: number
  readonly visits: number
  readonly depth: number
}

/** Temporary summaries of the already validated, backward-reference-only record DAG.
 * Counts retain expanded alias multiplicity; saturation preserves rejection thresholds.
 * The table never retains an arena, reader or payload and never decodes scalar strings.
 */
export class PackedPositionSummary {
  readonly stagingBytes: number
  readonly #values: Uint32Array
  private constructor(values: Uint32Array, stagingBytes: number) {
    this.#values = values
    this.stagingBytes = stagingBytes
    Object.freeze(this)
  }
  static build(
    input: PackedReader,
    offsets: Uint32Array,
    shapes: readonly (readonly string[])[],
    stage: (bytes: number) => void,
  ): PackedPositionSummary {
    return finishPackedSteps(PackedPositionSummary.buildSteps(input, offsets, shapes, stage))
  }
  static *buildSteps(
    input: PackedReader,
    offsets: Uint32Array,
    shapes: readonly (readonly string[])[],
    stage: (bytes: number) => void,
  ): Generator<void, PackedPositionSummary, undefined> {
    const stagingBytes = 1024 + offsets.length * 16
    stage(stagingBytes) // Admit the complete table before allocating its buffer.
    const values = new Uint32Array(offsets.length * 4)
    let work = 0
    for (let record = 0; record < offsets.length; record++) {
      const reader = new PackedReader(input, offsets[record])
      const tag = reader.uint()
      let minimum = 0xffffffff
      let maximum = 0
      let visits = 1
      let depth = 0
      if (tag === 7) {
        reader.uint()
        reader.uint()
        const start = reader.uint()
        reader.uint()
        reader.uint()
        const end = reader.uint()
        minimum = Math.min(start, end)
        maximum = Math.max(start, end)
      } else if (tag === 6 || tag >= 8) {
        const size = tag === 6 ? reader.uint() : shapes[tag - 8]?.length
        if (size === undefined) throw new Error('Invalid packed position summary shape')
        depth = 1
        for (let cursor = 0; cursor < size; cursor++) {
          const child = reader.uint()
          if (child >= record) throw new Error('Invalid packed position summary reference')
          const base = child * 4
          // child < record proves these initialized table coordinates exist.
          minimum = Math.min(minimum, values[base] as number)
          maximum = Math.max(maximum, values[base + 1] as number)
          visits = Math.min(800001, visits + (values[base + 2] as number))
          depth = Math.min(257, Math.max(depth, 1 + (values[base + 3] as number)))
          if (++work === 256) {
            work = 0
            yield
          }
        }
      }
      const base = record * 4
      values[base] = minimum
      values[base + 1] = maximum
      values[base + 2] = visits
      values[base + 3] = depth
      if (++work === 256) {
        work = 0
        yield
      }
    }
    return new PackedPositionSummary(values, stagingBytes)
  }
  at(reference: number): PositionBounds {
    if (!Number.isSafeInteger(reference) || reference < 0 || reference >= this.#values.length / 4)
      throw new Error('Invalid packed position summary record')
    const base = reference * 4
    return Object.freeze({
      minimum: this.#values[base] as number,
      maximum: this.#values[base + 1] as number,
      visits: this.#values[base + 2] as number,
      depth: this.#values[base + 3] as number,
    })
  }
}
