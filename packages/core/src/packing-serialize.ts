import { semanticLimits } from './contracts'
import type { PackedCapture } from './packing-capture'
import { PackedOutput } from './packing-output'
import { PackedRecordCache } from './packing-record-cache'
import { serializePackedText } from './packing-serialize-text'
import type { PackedValue } from './packing-value'
import type { PackedView } from './packing-view'

export interface PackedSerializationLimits {
  bytes: number
  /** Complete encoder workspace reservation, including tables, frames and text scratch. */
  workspace: number
  nodes: number
  depth: number
}
export interface PackedSerializedValue {
  readonly payload: ArrayBuffer
  readonly records: number
  readonly workspaceBytes: number
}

/** Explicit working weights, not a portable heap bound. Output has its own lifetime. */
class Workspace {
  used: number
  peak: number
  constructor(
    readonly limits: PackedSerializationLimits,
    readonly admit: (bytes: number) => void,
    shapes = 0,
  ) {
    this.used = 65536 + (limits.depth + 1) * 2048 + shapes
    this.peak = this.used
    if (this.used > limits.workspace)
      throw new Error('Packed serialization exceeds workspace limit')
    this.admit(this.used)
  }
  take(bytes: number): void {
    if (bytes > this.limits.workspace - this.used)
      throw new Error('Packed serialization exceeds workspace limit')
    // Admit growth before a remapping table, frame, key or shape is allocated. Keep
    // the pass's high-water reservation until its generator/record maps are gone.
    if (this.used + bytes > this.peak) this.admit(this.used + bytes)
    this.used += bytes
    this.peak = Math.max(this.peak, this.used)
  }
  release(bytes: number): void {
    this.used -= bytes
  }
}

interface Shapes {
  values: string[][]
  ids: Map<string, number>
  bytes: number
  sealed: boolean
}
interface Pass {
  output: PackedOutput
  shapes: Shapes
  workspace: Workspace
  records: PackedRecordCache
  count: number
  positions: number
  nodes: number
}

function shape(keys: readonly string[], pass: Pass): number {
  const temporary = 64 + (2 + keys.reduce((sum, key) => sum + key.length * 6 + 3, 0)) * 2
  pass.workspace.take(temporary)
  try {
    const encoded = JSON.stringify(keys)
    const known = pass.shapes.ids.get(encoded)
    if (known !== undefined) return known
    if (pass.shapes.sealed) throw new Error('Unstable packed serialization shape')
    const bytes = 256 + encoded.length * 2 + keys.length * 16
    pass.workspace.take(bytes)
    pass.shapes.bytes += bytes
    const id = pass.shapes.values.length
    pass.shapes.ids.set(encoded, id)
    pass.shapes.values.push([...keys])
    return id
  } finally {
    pass.workspace.release(temporary)
  }
}

/** Postorder emission: only active ancestor references are retained, never a native tree
 * or a table of all decoded records. Replaying the immutable view produces the same IDs.
 */
function* visit(view: PackedView, pass: Pass, depth = 0): Generator<void, number, undefined> {
  if (++pass.nodes > pass.workspace.limits.nodes || depth > pass.workspace.limits.depth)
    throw new Error('Packed serialization node/depth limit')
  if (pass.nodes % 32 === 0) yield
  const kind = view.kind()
  const key = view.recordKey()
  const slot = key ? pass.records.slot(key, kind === 'scalar') : undefined
  const existing = slot?.chunk[slot.index]
  if (existing) return existing - 1
  const { output } = pass
  let id: number
  if (kind === 'scalar') {
    if (view.scalarType() === 'string') {
      id = pass.count++
      output.uint(5)
      yield* serializePackedText(view, output)
    } else {
      const scalar = view.readScalar({ retained: 16, staging: 0 })
      if (typeof scalar === 'string') throw new Error('Unstable packed scalar')
      id = pass.count++
      if (scalar === null) output.uint(0)
      else if (typeof scalar === 'boolean') output.uint(scalar ? 2 : 1)
      else {
        const unsigned =
          Number.isInteger(scalar) && scalar >= 0 && scalar <= 0xffffffff && !Object.is(scalar, -0)
        output.uint(unsigned ? 3 : 4)
        if (unsigned) output.uint(scalar)
        else output.number(scalar)
      }
    }
  } else if (kind === 'position') {
    const value = view.position()
    id = pass.count++
    pass.positions++
    output.uint(7)
    for (const point of [value.start, value.end]) {
      output.uint(point.line)
      output.uint(point.column)
      output.uint(point.offset)
    }
  } else {
    const length = kind === 'array' ? view.length() : view.keyCount()
    if (kind === 'object' && length > 64) throw new Error('Packed serialization key limit')
    const bytes = 64 + length * 16
    pass.workspace.take(bytes)
    try {
      const refs: number[] = []
      let schema = -1
      if (kind === 'array') {
        for (const child of view.elementSteps()) {
          if (child !== undefined) refs.push(yield* visit(child, pass, depth + 1))
          yield
        }
      } else {
        const keys = view.keys()
        if (keys.some((name) => name.length > 1024))
          throw new Error('Packed serialization key limit')
        schema = shape(keys, pass)
        for (const name of keys) refs.push(yield* visit(view.at([name]), pass, depth + 1))
      }
      id = pass.count++
      output.uint(schema < 0 ? 6 : schema + 8)
      if (schema < 0) output.uint(refs.length)
      for (const [index, ref] of refs.entries()) {
        output.uint(ref)
        if (index % 256 === 255) yield
      }
    } finally {
      pass.workspace.release(bytes)
    }
  }
  if (slot) slot.chunk[slot.index] = id + 1
  return id
}

function* header(output: PackedOutput, shapes: Shapes, positions: number, records: number) {
  for (const byte of [77, 83, 80, 50]) output.byte(byte)
  output.uint(shapes.values.length)
  for (const keys of shapes.values) {
    output.uint(keys.length)
    for (const key of keys) {
      output.string(key)
      yield
    }
  }
  output.uint(positions)
  output.uint(records)
}

/** Capture-internal entry point. Only an independently owned exact-size buffer escapes.
 * Maps/frames are reserved before allocation; output is admitted before native allocation.
 */
export function* serializePackedViewSteps(
  capture: PackedCapture,
  view: PackedView,
  limits: PackedSerializationLimits,
): Generator<void, PackedValue<PackedSerializedValue>, undefined> {
  for (const key of ['bytes', 'workspace', 'nodes', 'depth'] as const)
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0)
      throw new Error('Invalid packed serialization limits')
  if (limits.bytes < 4 || limits.bytes > semanticLimits.messageBytes || limits.depth > 128)
    throw new Error('Invalid packed serialization limits')
  const reservation = capture.reserveWorkspace(0, 0)
  let owned: PackedValue<PackedSerializedValue> | undefined
  let delivered = false
  try {
    const admit = (bytes: number) => reservation.resize(bytes, bytes)
    const workspace = new Workspace(limits, admit)
    const shapes: Shapes = { values: [], ids: new Map(), bytes: 0, sealed: false }
    const measure = new PackedOutput(limits.bytes)
    // A separate generator scope drops the first pass's remapping before allocation/replay.
    const plan = yield* runPass(view, measure, shapes, workspace)
    shapes.sealed = true
    const prefix = new PackedOutput(limits.bytes)
    yield* header(prefix, shapes, plan.positions, plan.count)
    prefix.uint(plan.root)
    const bytes = prefix.length + measure.length
    if (bytes > limits.bytes) throw new Error('Packed serialization exceeds byte limit')
    const allocation = capture.workspace(bytes + 256, 0)
    let payload: ArrayBuffer
    try {
      payload = new ArrayBuffer(bytes)
    } finally {
      allocation.release()
    }
    // Synchronous reservation exchange: no suspension or caller code runs in between.
    const value = { payload, records: plan.count, workspaceBytes: 0 }
    owned = capture.own(value, bytes + 256)
    const output = new PackedOutput(bytes, payload)
    yield* header(output, shapes, plan.positions, plan.count)
    // runPass has ended: its measurement maps are unreachable. The shapes remain
    // live and are included in the replay's initial reservation before suspension.
    const replay = new Workspace(limits, admit, shapes.bytes)
    const actual = yield* runPass(view, output, shapes, replay)
    output.uint(actual.root)
    if (
      output.length !== bytes ||
      actual.root !== plan.root ||
      actual.count !== plan.count ||
      actual.positions !== plan.positions
    )
      throw new Error('Unstable packed serialization')
    value.workspaceBytes = Math.max(workspace.peak, replay.peak)
    Object.freeze(value)
    delivered = true
    return owned
  } finally {
    if (!delivered) owned?.release()
    reservation.release()
  }
}

function* runPass(view: PackedView, output: PackedOutput, shapes: Shapes, workspace: Workspace) {
  const pass: Pass = {
    output,
    shapes,
    workspace,
    records: new PackedRecordCache((bytes) => workspace.take(bytes)),
    count: 0,
    positions: 0,
    nodes: 0,
  }
  const root = yield* visit(view, pass)
  return { root, count: pass.count, positions: pass.positions }
}
