import type { SourceRange } from './contracts'

interface Segment<T> {
  readonly values: readonly T[]
  readonly start: number
  readonly length: number
  readonly offset: number
  readonly block: number
}

/** Flat immutable range segments; neither a preceding index nor its source is retained. */
export class DependencyRanges<T extends Readonly<SourceRange>> {
  readonly #segments: readonly Segment<T>[]
  readonly length: number
  readonly segments: number
  private constructor(segments: Segment<T>[]) {
    this.#segments = Object.freeze(segments.map((segment) => Object.freeze(segment)))
    this.length = segments.reduce((sum, segment) => sum + segment.length, 0)
    this.segments = segments.length
    Object.freeze(this)
  }
  static from<T extends Readonly<SourceRange>>(values: readonly T[]): DependencyRanges<T> {
    return new DependencyRanges(
      values.length ? [{ values, start: 0, length: values.length, offset: 0, block: 0 }] : [],
    )
  }
  at(index: number): T | undefined {
    if (!Number.isInteger(index)) return undefined
    if (index < 0) index += this.length
    if (index < 0 || index >= this.length) return undefined
    for (const segment of this.#segments) {
      if (index >= segment.length) {
        index -= segment.length
        continue
      }
      return this.#value(segment, index)
    }
    return undefined
  }
  #value(segment: Segment<T>, index: number): T {
    const value = segment.values[segment.start + index]
    if (!value) throw new Error('Missing semantic dependency range')
    if (!segment.offset && !segment.block) return value
    return Object.freeze({
      ...value,
      from: value.from + segment.offset,
      to: value.to + segment.offset,
      ...('block' in value ? { block: (value.block as number) + segment.block } : {}),
    })
  }
  *[Symbol.iterator](): Generator<T> {
    for (const segment of this.#segments)
      for (let index = 0; index < segment.length; index++) yield this.#value(segment, index)
  }
  map<U>(visit: (value: T, index: number) => U): U[] {
    const result: U[] = []
    let index = 0
    for (const value of this) result.push(visit(value, index++))
    return result
  }
  filter(visit: (value: T, index: number) => unknown): T[] {
    const result: T[] = []
    let index = 0
    for (const value of this) if (visit(value, index++)) result.push(value)
    return result
  }
  findIndex(visit: (value: T, index: number) => unknown): number {
    let index = 0
    for (const value of this) {
      if (visit(value, index)) return index
      index++
    }
    return -1
  }
  /** Splice absolute replacement ranges, then shift only the surviving suffix. */
  splice(
    start: number,
    remove: number,
    values: readonly T[],
    offset: number,
    block: number,
  ): DependencyRanges<T> {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(remove) ||
      start < 0 ||
      remove < 0 ||
      start + remove > this.length ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(block)
    )
      throw new Error('Invalid semantic dependency splice')
    const segments: Segment<T>[] = []
    const add = (segment: Segment<T>) => {
      if (!segment.length) return
      const previous = segments.at(-1)
      if (
        previous &&
        previous.values === segment.values &&
        previous.start + previous.length === segment.start &&
        previous.offset === segment.offset &&
        previous.block === segment.block
      )
        segments[segments.length - 1] = { ...previous, length: previous.length + segment.length }
      else segments.push(segment)
    }
    const copy = (from: number, to: number, delta: number, blocks: number) => {
      let position = 0
      for (const segment of this.#segments) {
        const left = Math.max(from, position)
        const right = Math.min(to, position + segment.length)
        if (left < right)
          add({
            ...segment,
            start: segment.start + left - position,
            length: right - left,
            offset: segment.offset + delta,
            block: segment.block + blocks,
          })
        position += segment.length
      }
    }
    copy(0, start, 0, 0)
    add({ values, start: 0, length: values.length, offset: 0, block: 0 })
    copy(start + remove, this.length, offset, block)
    if (segments.length > 4096)
      throw new Error('Semantic dependency segment limit; full resync required')
    return new DependencyRanges(segments)
  }
}

export type DependencyRecords<T extends Readonly<SourceRange>> = readonly T[] | DependencyRanges<T>
