import { PackedMetadataBudget } from './packing-metadata-budget'
import {
  appendSegmentSliceSteps,
  assembleSegmentSuffixSteps,
  segmentGeometrySteps,
} from './packing-segment-steps'
import { elementSteps, fieldEntries } from './packing-traversal'
import {
  kind,
  length,
  type PackedNode,
  type PackedSegment,
  PackedView,
  rangeSegment,
  segments,
  sliceSegments,
} from './packing-view'
import { finishPackedSteps, PackedWork } from './packing-work'

interface RangeOwner {
  node: PackedNode | undefined
  charge: ((bytes: number) => void) | undefined
  stage: ((bytes: number) => void) | undefined
  budget: PackedMetadataBudget | undefined
  suffix: PackedSegment[] | undefined
}

/** Shift immediate numeric from/to pairs; position records and nested objects stay exact. */
export function rangeSuffix(
  node: PackedNode,
  start: number,
  offset: number,
  charge: (bytes: number) => void,
  stage: (bytes: number) => void,
): PackedNode {
  const result = finishPackedSteps(rangeSuffixSteps(node, start, offset, charge, stage, false))
  if (!result) throw new Error('Incomplete packed range shift')
  return result
}
export function rangeSuffixSteps(
  node: PackedNode,
  start: number,
  offset: number,
  charge: (bytes: number) => void,
  stage: (bytes: number) => void,
  cooperative = true,
  budget = new PackedMetadataBudget(),
): PackedWork<PackedNode> {
  const owner: RangeOwner = { node, charge, stage, budget, suffix: undefined }
  return rangeWork(owner, start, offset, cooperative)
}
function rangeWork(
  owner: RangeOwner,
  start: number,
  offset: number,
  cooperative: boolean,
): PackedWork<PackedNode> {
  return new PackedWork(rangeSteps(owner, start, offset, cooperative), () => {
    if (owner.suffix) owner.suffix.length = 0
    owner.node = undefined
    owner.charge = undefined
    owner.stage = undefined
    owner.budget = undefined
    owner.suffix = undefined
  })
}
function* rangeSteps(
  owner: RangeOwner,
  start: number,
  offset: number,
  cooperative: boolean,
): Generator<void, PackedNode, undefined> {
  const node = owner.node as PackedNode
  const charge = owner.charge as (bytes: number) => void
  const stage = owner.stage as (bytes: number) => void
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
    throw new Error('Invalid packed range shift')
  charge(256 + (geometry ? geometry.count : segments(node).length) * 512)
  stage(2048 + (geometry ? geometry.count : segments(node).length) * 256)
  const suffix: PackedSegment[] = cooperative ? [] : sliceSegments(node, start, size)
  owner.suffix = suffix
  if (cooperative && !(yield* appendSegmentSliceSteps(suffix, node, start, size, budget)))
    throw new Error('Incomplete packed range suffix')
  let visits = 0
  for (let index = 0; index < suffix.length; index++) {
    if (cooperative && budget.advance()) yield
    const segment = suffix[index]
    if (!segment) throw new Error('Missing packed range segment')
    if (!('value' in segment) && RangeProof.covers(segment, offset)) {
      visits += segment.length
      if (visits > 800000) throw new Error('Packed range shift node limit')
      yield
      continue
    }
    let minimum = Infinity,
      maximum = -Infinity,
      count = 0
    for (const item of elementSteps({ segments: [segment], length: segment.length }, budget)) {
      if (item === undefined) {
        yield
        continue
      }
      if (cooperative && budget.advance()) yield
      if (++visits > 800000) throw new Error('Packed range shift node limit')
      if (kind(item) !== 'object') throw new Error('Packed range shift requires objects')
      let from: number | undefined,
        to: number | undefined,
        fields = 0
      const view = new PackedView(item)
      // Semantic descriptors have small immutable shapes. Bound both direct lookups;
      // wide arbitrary objects retain the yielding single-pass scan below.
      if (view.keyCount() <= 16) {
        if (!view.hasField('from') || !view.hasField('to'))
          throw new Error('Missing packed range field')
        from = checked(view.readScalar({ retained: 16, staging: 0 }, ['from']), offset)
        to = checked(view.readScalar({ retained: 16, staging: 0 }, ['to']), offset)
      } else {
        for (const [key, field] of fieldEntries(item)) {
          if (cooperative && budget.advance()) yield
          if (key === 'from' || key === 'to') {
            const value = checked(
              new PackedView(field).readScalar({ retained: 16, staging: 0 }),
              offset,
            )
            if (key === 'from') from = value
            else to = value
            if (from !== undefined && to !== undefined) break
          }
          if (!cooperative && ++fields === 256) {
            fields = 0
            yield
          }
        }
      }
      if (from === undefined || to === undefined) throw new Error('Missing packed range field')
      if (from > to) throw new Error('Invalid packed range ordering')
      minimum = Math.min(minimum, from)
      maximum = Math.max(maximum, to)
      count++
      // One forward scan handles both fields. Keep each object's bounded final scan in
      // its own advance, including when a wide shape ends just before the yield boundary.
      yield
    }
    if (!('value' in segment) && count > 0) {
      if (count !== segment.length) throw new Error('Invalid packed range segment')
      // This proof belongs to the immutable overlay. Its token has no arena/source backlink;
      // subsequent slices/transforms can share it without a global cache or owner extension.
      charge(512)
      suffix[index] = Object.freeze({
        ...segment,
        rangeProof: new RangeProof(rangeProofKey, segment, minimum, maximum),
      })
    }
  }
  if (cooperative) {
    const result = yield* assembleSegmentSuffixSteps(
      node,
      start,
      size,
      suffix,
      offset,
      true,
      budget,
    )
    if (!result) throw new Error('Incomplete packed range assembly')
    return result
  }
  const result = sliceSegments(node, 0, start)
  for (const segment of suffix) result.push(rangeSegment(segment, offset))
  for (const segment of result) Object.freeze(segment)
  return Object.freeze({ segments: Object.freeze(result), length: size })
}

function checked(value: unknown, offset: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 0xffffffff ||
    value + offset < 0 ||
    value + offset > 0xffffffff
  )
    throw new Error('Packed range shift exceeds offset range')
  return value
}

type ArenaSegment = Exclude<PackedSegment, { value: PackedNode }>
const rangeProofKey = Object.freeze({})

/** Sealed numeric evidence only. Never retain an arena, node, view or predecessor. */
class RangeProof {
  readonly #token: object
  readonly #record: number
  readonly #from: number
  readonly #length: number
  readonly #offset: number
  readonly #minimum: number
  readonly #maximum: number
  constructor(key: object, segment: ArenaSegment, minimum: number, maximum: number) {
    if (key !== rangeProofKey) throw new Error('Invalid packed range proof')
    this.#token = segment.arena.recordToken(segment.id)
    this.#record = segment.id
    this.#from = segment.from
    this.#length = segment.length
    this.#offset = segment.rangeOffset ?? 0
    this.#minimum = minimum
    this.#maximum = maximum
    Object.freeze(this)
  }
  static covers(segment: ArenaSegment, offset: number): boolean {
    const proof = segment.rangeProof
    if (
      typeof proof !== 'object' ||
      proof === null ||
      !(#token in proof) ||
      proof.#token !== segment.arena.recordToken(segment.id) ||
      proof.#record !== segment.id ||
      !Number.isSafeInteger(segment.from) ||
      !Number.isSafeInteger(segment.length) ||
      segment.length < 0 ||
      segment.from < proof.#from ||
      segment.from + segment.length > proof.#from + proof.#length
    )
      return false
    const shift = (segment.rangeOffset ?? 0) - proof.#offset
    const minimum = proof.#minimum + shift
    const maximum = proof.#maximum + shift
    // A subset may exclude an old extreme. In that case a conservative bound miss falls
    // back to full validation, so a safe narrowed shift is never rejected by stale bounds.
    return (
      Number.isSafeInteger(shift) &&
      minimum >= 0 &&
      maximum <= 0xffffffff &&
      minimum + offset >= 0 &&
      maximum + offset <= 0xffffffff
    )
  }
}

Object.freeze(RangeProof.prototype)
Object.freeze(RangeProof)
