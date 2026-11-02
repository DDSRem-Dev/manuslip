import type { PackedArena } from './packing-arena'
import { PackedMetadataBudget } from './packing-metadata-budget'
import type { PackedPositionSummary } from './packing-position-summary'
import {
  appendSegmentSliceSteps,
  assembleSegmentSuffixSteps,
  segmentGeometrySteps,
} from './packing-segment-steps'
import { elementSteps, fieldEntries } from './packing-traversal'
import {
  kind,
  length,
  offsetSegment,
  type PackedNode,
  type PackedSegment,
  PackedView,
  segments,
  sliceSegments,
} from './packing-view'
import { finishPackedSteps, PackedWork } from './packing-work'

interface OffsetOwner {
  node: PackedNode | undefined
  charge: ((bytes: number) => void) | undefined
  stage: ((bytes: number) => void) | undefined
  budget: PackedMetadataBudget | undefined
  suffix: PackedSegment[] | undefined
}

/** Explicit synchronous contract, sharing validation and exact admission with the step path. */
export function offsetSuffix(
  node: PackedNode,
  start: number,
  offset: number,
  charge: (bytes: number) => void,
  stage: (bytes: number) => void,
): PackedNode {
  const result = finishPackedSteps(offsetSuffixSteps(node, start, offset, charge, stage, false))
  if (!result) throw new Error('Incomplete packed position shift')
  return result
}

/** Validate the complete selected suffix before returning immutable segment metadata.
 * DAG summaries retain expanded alias/depth limits and remain temporary caller scratch.
 */
export function offsetSuffixSteps(
  node: PackedNode,
  start: number,
  offset: number,
  charge: (bytes: number) => void,
  stage: (bytes: number) => void,
  cooperative = true,
  budget = new PackedMetadataBudget(),
): PackedWork<PackedNode> {
  const owner: OffsetOwner = { node, charge, stage, budget, suffix: undefined }
  return offsetWork(owner, start, offset, cooperative)
}
function offsetWork(
  owner: OffsetOwner,
  start: number,
  offset: number,
  cooperative: boolean,
): PackedWork<PackedNode> {
  return new PackedWork(offsetSteps(owner, start, offset, cooperative), () => {
    if (owner.suffix) owner.suffix.length = 0
    owner.node = undefined
    owner.charge = undefined
    owner.stage = undefined
    owner.budget = undefined
    owner.suffix = undefined
  })
}
function* offsetSteps(
  owner: OffsetOwner,
  start: number,
  offset: number,
  cooperative: boolean,
): Generator<void, PackedNode, undefined> {
  const node = owner.node as PackedNode
  const charge = owner.charge as (bytes: number) => void
  const budget = owner.budget as PackedMetadataBudget
  const geometry = cooperative ? yield* segmentGeometrySteps(node, budget) : undefined
  if (cooperative && !geometry) throw new Error('Incomplete packed array geometry')
  const size = geometry ? geometry.size : length(node)
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start > size ||
    !Number.isSafeInteger(offset) ||
    Math.abs(offset) > 0xffffffff
  )
    throw new Error('Invalid packed position shift')
  charge(256 + (geometry ? geometry.count : segments(node).length) * 512)
  const suffix: PackedSegment[] = cooperative ? [] : sliceSegments(node, start, size)
  owner.suffix = suffix
  if (cooperative && !(yield* appendSegmentSliceSteps(suffix, node, start, size, budget)))
    throw new Error('Incomplete packed position suffix')
  const frames: Pick<Generator<PackedNode | undefined>, 'next' | 'return'>[] = []
  const summaries = new Map<PackedArena, PackedPositionSummary>()
  let summaryBytes = 0
  let visits = 1 // The selected array itself, shared by all segment traversals.
  let topItems = 0
  let minimum = Infinity,
    maximum = -Infinity,
    depth = 1
  const scratch = (extra = 0) =>
    (owner.stage as (bytes: number) => void)(1024 + summaryBytes + frames.length * 512 + extra)
  const visit = function* (value: PackedNode): Generator<void> {
    const budget = owner.budget as PackedMetadataBudget
    let packed = value
    let shifted = offset
    while ('shifted' in packed || 'ranged' in packed) {
      if (cooperative && budget.advance()) yield
      if ('shifted' in packed) {
        shifted += packed.offset
        packed = packed.shifted
      } else packed = packed.ranged
    }
    if ('arena' in packed && visits >= 4096) {
      let summary = summaries.get(packed.arena)
      const type = packed.arena.kind(packed.id)
      const remainingWork = (visits / Math.max(1, topItems)) * (size - start - topItems)
      if (
        !summary &&
        (type === 'array' || type === 'object') &&
        remainingWork >= packed.arena.records / 4
      ) {
        const admit = (bytes: number) => scratch(bytes + 256)
        if (cooperative) {
          yield
          summary = yield* packed.arena.summarizePositionSteps(admit)
          yield
        } else summary = packed.arena.summarizePositions(admit)
        summaryBytes += summary.stagingBytes + 256
        summaries.set(packed.arena, summary)
      }
      if (summary) {
        const bounds = summary.at(packed.id)
        visits += bounds.visits
        if (visits > 800000) throw new Error('Packed position shift node limit')
        if (frames.length + bounds.depth > 256) throw new Error('Packed position shift depth limit')
        depth = Math.max(depth, frames.length + bounds.depth)
        if (
          bounds.minimum <= bounds.maximum &&
          (bounds.minimum + shifted < 0 || bounds.maximum + shifted > 0xffffffff)
        )
          throw new Error('Packed position shift exceeds offset range')
        if (bounds.minimum <= bounds.maximum) {
          minimum = Math.min(minimum, bounds.minimum + shifted - offset)
          maximum = Math.max(maximum, bounds.maximum + shifted - offset)
        }
        return
      }
    }
    if (++visits > 800000) throw new Error('Packed position shift node limit')
    const type = kind(value)
    if (type === 'position') {
      const position = new PackedView(value).position()
      for (const point of [position.start, position.end]) {
        if (cooperative && budget.advance()) yield
        const shifted = point.offset + offset
        if (!Number.isSafeInteger(shifted) || shifted < 0 || shifted > 0xffffffff)
          throw new Error('Packed position shift exceeds offset range')
        minimum = Math.min(minimum, point.offset)
        maximum = Math.max(maximum, point.offset)
      }
    } else if (type === 'array' || type === 'object') {
      if (frames.length >= 256) throw new Error('Packed position shift depth limit')
      scratch(512)
      frames.push(type === 'array' ? elementSteps(value, budget) : objectValues(value))
      depth = Math.max(depth, frames.length)
    }
  }
  try {
    scratch(512)
    for (let index = 0; index < suffix.length; index++) {
      if (cooperative && budget.advance()) yield
      const segment = suffix[index]
      if (!segment) throw new Error('Missing packed position segment')
      const proof = 'value' in segment ? undefined : PositionProof.for(segment, offset)
      if (proof) {
        visits += proof.visits
        if (visits > 800000) throw new Error('Packed position shift node limit')
        if (proof.depth > 256) throw new Error('Packed position shift depth limit')
        topItems += segment.length
        yield
        continue
      }
      const before = visits
      const beforeItems = topItems
      minimum = Infinity
      maximum = -Infinity
      depth = 1
      frames.push(elementSteps({ segments: [segment], length: segment.length }, budget))
      while (frames.length) {
        if (cooperative && budget.advance()) yield
        const frame = frames[frames.length - 1]
        if (!frame) throw new Error('Missing packed shift frame')
        const item = frame.next()
        if (item.done) frames.pop()
        else if (item.value === undefined) {
          yield
        } else {
          if (frames.length === 1) topItems++
          yield* visit(item.value)
        }
      }
      if (!('value' in segment)) {
        if (topItems - beforeItems !== segment.length)
          throw new Error('Invalid packed position segment')
        charge(512)
        suffix[index] = Object.freeze({
          ...segment,
          positionProof: new PositionProof(
            positionProofKey,
            segment,
            minimum,
            maximum,
            visits - before,
            depth,
          ),
        })
      }
    }
  } finally {
    for (const frame of frames) frame.return(undefined)
    frames.length = 0
    summaries.clear()
  }
  if (cooperative) {
    const result = yield* assembleSegmentSuffixSteps(
      node,
      start,
      size,
      suffix,
      offset,
      false,
      budget,
    )
    if (!result) throw new Error('Incomplete packed position assembly')
    return result
  }
  const result = [
    ...sliceSegments(node, 0, start),
    ...suffix.map((segment) => offsetSegment(segment, offset)),
  ]
  for (const segment of result) Object.freeze(segment)
  return Object.freeze({ segments: Object.freeze(result), length: size })
}
function* objectValues(node: PackedNode): Generator<PackedNode> {
  for (const [, value] of fieldEntries(node)) yield value
}

type ArenaSegment = Exclude<PackedSegment, { value: PackedNode }>
const positionProofKey = Object.freeze({})

/** Exact immutable segment facts only; no graph, summary table or predecessor ownership. */
class PositionProof {
  readonly #token: object
  readonly #record: number
  readonly #from: number
  readonly #length: number
  readonly #offset: number
  readonly #rangeOffset: number
  readonly #minimum: number
  readonly #maximum: number
  readonly #visits: number
  readonly #depth: number
  constructor(
    key: object,
    segment: ArenaSegment,
    minimum: number,
    maximum: number,
    visits: number,
    depth: number,
  ) {
    if (key !== positionProofKey) throw new Error('Invalid packed position proof')
    this.#token = segment.arena.recordToken(segment.id)
    this.#record = segment.id
    this.#from = segment.from
    this.#length = segment.length
    this.#offset = segment.offset ?? 0
    this.#rangeOffset = segment.rangeOffset ?? 0
    this.#minimum = minimum
    this.#maximum = maximum
    this.#visits = visits
    this.#depth = depth
    Object.freeze(this)
  }
  get visits() {
    return this.#visits
  }
  get depth() {
    return this.#depth
  }
  static for(segment: ArenaSegment, offset: number): PositionProof | undefined {
    const proof = segment.positionProof
    if (
      typeof proof !== 'object' ||
      proof === null ||
      !(#token in proof) ||
      proof.#token !== segment.arena.recordToken(segment.id) ||
      proof.#record !== segment.id ||
      proof.#from !== segment.from ||
      proof.#length !== segment.length ||
      proof.#rangeOffset !== (segment.rangeOffset ?? 0)
    )
      return undefined
    const shift = (segment.offset ?? 0) - proof.#offset
    if (!Number.isSafeInteger(shift)) return undefined
    if (proof.#minimum <= proof.#maximum) {
      const minimum = proof.#minimum + shift
      const maximum = proof.#maximum + shift
      if (
        minimum < 0 ||
        maximum > 0xffffffff ||
        minimum + offset < 0 ||
        maximum + offset > 0xffffffff
      )
        return undefined
    }
    return proof
  }
}

Object.freeze(PositionProof.prototype)
Object.freeze(PositionProof)
