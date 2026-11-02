import { PackedReader, PackedWriter } from './packing-bytes'
import type { PackedItemSteps, PackedReadScope } from './packing-capture'
import { finishPackedCleanup } from './packing-cleanup'
import { PackedEncodingBudget, type PackedEncodingLimits } from './packing-encode-budget'
import {
  PackedArrayInput,
  type PackedArrayInputs,
  type PackedArrayRecord,
  packedArrayPause,
} from './packing-input-array'
import {
  PackedCaptureInput,
  type PackedCaptureInputs,
  type PackedTextReplay,
} from './packing-input-capture'
import {
  isPositionNode,
  PackedPositions,
  type PositionCoordinates,
  positionValues,
} from './packing-positions'
import { PackedRecordCache, type PackedRecordSlot } from './packing-record-cache'
import { PackedRecordIndex } from './packing-record-index'
import type { PackedEncodedRecord } from './packing-record-read'
import { PackedSequence } from './packing-sequence'
import { PackedStringRecords } from './packing-string-records'
import { admitPackedKeys } from './packing-text'
import { finishPackedSteps, PackedWork } from './packing-work'

// Experimental, not used by the application's semantic protocol. All objects returned by
// unpackValue are immutable: equal value records may share identity, including positions.
type Scalar = null | boolean | number | string
interface Frame {
  value: unknown
  reader?: PackedReadScope
  importRecords?: boolean
  encoded?: PackedEncodedRecord
  recordId?: number
  cursor?: number
  kind?: ReturnType<PackedReadScope['kind']>
  replay?: PackedTextReplay
  record?: PackedRecordSlot
  children?: unknown[]
  keys?: readonly string[]
  stream?: PackedArrayRecord
  elements?: PackedItemSteps
  streamDone?: boolean
  sequence?: boolean
  shape?: number
  refs: number[] | undefined
  working: number
}
const magic = [77, 83, 80, 50] // MSP2, an explicitly versioned experiment.
const negativeZero = Symbol('negative zero')
const scalarKey = (value: Scalar) => (Object.is(value, -0) ? negativeZero : value)

/** Lossless JSON-value DAG, with schema/string/point sharing and backward-only references. */
export function packValue(
  value: unknown,
  byteLimit: number,
  limits?: PackedEncodingLimits,
): ArrayBuffer {
  const output = finishPackedSteps(packValueSteps(value, byteLimit, limits))
  if (!output) throw new Error('Incomplete packed encoding')
  return output
}

/** Cooperative encoding of stable caller-owned input. Cancellation clears all encoder state.
 * Native key enumeration, shape spelling/map lookup and output allocation remain atomic.
 * Optional limits bound weighted live encoder construction, visits and depth independently
 * of wire bytes. Native enumeration is admitted immediately after its returned list exists;
 * key spelling, child arrays, table insertion and writer buffers are admitted before growth.
 * Input graph ownership and aggregate physical process memory remain the caller's concern.
 */
export function packValueSteps(
  value: unknown,
  byteLimit: number,
  limits?: PackedEncodingLimits,
  admitOutput?: (bytes: number) => void,
): PackedWork<ArrayBuffer> {
  if (!Number.isSafeInteger(byteLimit) || byteLimit < magic.length)
    throw new Error('Invalid packed byte limit')
  const budget = limits ? new PackedEncodingBudget(limits) : undefined
  return new PackedWork(
    encodeValueSteps(value, byteLimit, budget, undefined, admitOutput),
    () => {},
  )
}

/** Internal stream input: declared arrays are consumed once into the same MSP2 record
 * tables as native values. Limits are mandatory for unknown-length inputs. Closing the
 * work revokes every claimed input, including unopened ones. Other subtrees must stay
 * stable while being encoded; callbacks may populate private, unread containers.
 * Optional same-owner captured readers/replayed text use exact emitted-byte string
 * interning and revoke at every advance. Their native encoder working ledger remains
 * separate from session ownership; this is not aggregate physical memory admission.
 */
export function packStreamedValueSteps(
  value: unknown,
  byteLimit: number,
  limits: PackedEncodingLimits,
  inputs: readonly PackedArrayInput[],
  admitOutput?: (bytes: number) => void,
  captures: readonly PackedCaptureInput[] = [],
): PackedWork<ArrayBuffer> {
  if (!Number.isSafeInteger(byteLimit) || byteLimit < magic.length)
    throw new Error('Invalid packed byte limit')
  const budget = new PackedEncodingBudget(limits)
  const owned = PackedArrayInput.own(inputs, budget)
  let borrowed: PackedCaptureInputs | undefined
  try {
    if (captures.length) borrowed = PackedCaptureInput.own(captures, budget)
  } catch (error) {
    owned.close(true)
    throw error
  }
  const close = (preserveFailure = false) =>
    finishPackedCleanup(
      [() => owned.close(preserveFailure), () => borrowed?.close(preserveFailure)],
      preserveFailure,
    )
  return new PackedWork(
    (function* () {
      const work = encodeValueSteps(value, byteLimit, budget, owned, admitOutput, borrowed)
      try {
        if (!borrowed) return yield* work
        while (true) {
          borrowed.assertOpen()
          const next = work.next()
          borrowed.assertOpen()
          if (next.done) return next.value
          yield
        }
      } catch (error) {
        close(true)
        throw error
      } finally {
        work.return(undefined)
      }
    })(),
    () => close(),
  )
}

/** Internal sibling encoder; keys follow Object.keys order. The final envelope shape
 * is fixed before the first record, and inputs are supplied in that same order.
 */
export function createPackedSequenceEncoding(
  keys: readonly string[],
  byteLimit: number,
  limits: PackedEncodingLimits,
  admitOutput?: (bytes: number) => void,
): PackedSequence {
  if (!Number.isSafeInteger(byteLimit) || byteLimit < magic.length)
    throw new Error('Invalid packed byte limit')
  const budget = new PackedEncodingBudget(limits)
  return new PackedSequence(keys, budget, (sequence) =>
    encodeValueSteps(
      sequence.value,
      byteLimit,
      budget,
      sequence.inputs,
      admitOutput,
      sequence.captures,
      sequence,
    ),
  )
}

function* encodeValueSteps(
  value: unknown,
  byteLimit: number,
  budget?: PackedEncodingBudget,
  inputs?: PackedArrayInputs,
  admitOutput?: (bytes: number) => void,
  captures?: PackedCaptureInputs,
  sequence?: PackedSequence,
): Generator<void, ArrayBuffer | undefined, undefined> {
  // Fixed containers, position probes, index cursors, and bounded JSON/UTF-8 chunks.
  budget?.charge(1024 + 256 * 1024)
  budget?.frame(1)
  let probeKeys = 0
  const admitKeys = budget
    ? (keys: readonly string[]) => {
        probeKeys += budget.keys(keys)
      }
    : undefined
  const shapes: (readonly string[])[] = []
  const shapeIds = new Map<string, number>()
  // Two source-free cursors borrow key arrays already retained by shapes. Their fixed
  // slots share the encoder's existing cursor reservation; no arena or new table is held.
  let firstShape: readonly string[] | undefined
  let secondShape: readonly string[] | undefined
  let firstShapeId = 0
  let secondShapeId = 0
  const allocate = budget ? (bytes: number) => budget.charge(bytes) : undefined
  const body = new PackedWriter(byteLimit, allocate)
  let records = 0
  let internBytes = 0
  const intern = (bytes: number) => {
    if (budget) {
      budget.charge(bytes)
      internBytes += bytes
    }
  }
  const scalarIds = new Map<Scalar | symbol, number>()
  const capturedRecords = captures ? new PackedRecordCache(intern) : undefined
  const recordIds = new PackedRecordIndex(body, budget)
  const stringIds =
    captures && budget ? new PackedStringRecords(body, budget, byteLimit) : undefined
  let completed = new WeakMap<object, number>()
  let completedEntries = 0
  // This only accelerates identity revisits. Value interning remains authoritative
  // after eviction, and revisited children consume the normal traversal allowance.
  const completedLimit = budget ? 4096 : Infinity
  const active = new WeakSet<object>()
  const stack: Frame[] = [{ value, refs: undefined, working: 192 }]
  let positions = 0
  let advances = 0
  let root: number | undefined
  let pendingSequence: number | undefined
  const finish = (id: number, known = false) => {
    const frame = stack.pop()
    if (frame?.record) frame.record.chunk[frame.record.index] = id + 1
    if (frame?.stream) inputs?.finish(frame.stream, id)
    if (frame?.value && typeof frame.value === 'object') {
      if (!known && !frame.reader) {
        if (completedEntries === completedLimit) {
          completed = new WeakMap()
          const released = completedEntries * 96
          budget?.release(released)
          internBytes -= released
          completedEntries = 0
        }
        intern(96)
        completed.set(frame.value, id)
        completedEntries++
      }
      active.delete(frame.value)
    }
    if (frame?.sequence) {
      pendingSequence = id
      frame.value = undefined
      frame.children = undefined
      frame.keys = undefined
      frame.reader = undefined
      frame.encoded = undefined
      frame.replay = undefined
    }
    if (frame) budget?.release(frame.working + (frame.refs?.length ?? 0) * 16)
    const parent = stack.at(-1)
    if (parent) {
      if (!parent.refs) throw new Error('Missing packed parent references')
      budget?.charge(16)
      parent.refs.push(id)
    } else root = id
  }
  try {
    while (stack.length || pendingSequence !== undefined) {
      if (pendingSequence !== undefined) {
        const id = pendingSequence
        pendingSequence = undefined
        if (!sequence) throw new Error('Missing packed sequence')
        sequence.park(function* (admit) {
          let bytes = 0
          const allocate = (size: number) => {
            budget?.charge(size)
            bytes += size
          }
          const suffix = new PackedWriter(5, allocate)
          let header: PackedWriter | undefined
          try {
            suffix.uint(id)
            header = yield* packedHeaderSteps(
              shapes,
              positions,
              records,
              byteLimit - body.length - suffix.length,
              allocate,
            )
            return yield* body.finishSteps(header, admit, suffix, allocate)
          } finally {
            header?.discard()
            suffix.discard()
            budget?.release(bytes)
          }
        })
        yield
        sequence.resume()
        continue
      }
      if (++advances % 64 === 0) yield
      const frame = stack.at(-1)
      if (!frame) break
      // A container's shape marks completed entry work. Child resumption can go
      // straight to its next edge without repeating scalar/position/identity probes.
      if (frame.shape === undefined) {
        if (sequence && frame.value === sequence.token) {
          if (frame.sequence) throw new Error('Invalid packed sequence input')
          frame.value = sequence.take()
          frame.sequence = true
          if (frame.value === sequence.token) throw new Error('Invalid packed sequence input')
        }
        let item = frame.value
        const captured = frame.reader ? undefined : captures?.get(item)
        if (captured && 'reader' in captured) {
          frame.reader = captured.reader
          frame.importRecords = captured.records
        }
        if (captured || frame.reader) {
          budget?.charge(320)
          frame.working += 320
          if (frame.reader) {
            const encoded = frame.importRecords
              ? frame.reader.encodedRecord(frame.recordId)
              : undefined
            frame.encoded = encoded
            frame.kind = encoded
              ? encoded.tag <= 5
                ? 'scalar'
                : encoded.tag === 6
                  ? 'array'
                  : encoded.tag === 7
                    ? 'position'
                    : 'object'
              : frame.reader.kind()
            const key = encoded ?? frame.reader.recordKey()
            if (key && capturedRecords) {
              frame.record = capturedRecords.slot(key, frame.kind === 'scalar')
              const known = frame.record.chunk[frame.record.index]
              if (known) {
                finish(known - 1, true)
                continue
              }
            }
          } else if (captured && 'text' in captured) frame.replay = captured.text
        }
        const reader = frame.reader
        const encoded = frame.encoded
        const capturedKind = frame.kind
        const replay = frame.replay
        if (
          replay ||
          (reader &&
            capturedKind === 'scalar' &&
            (encoded ? encoded.tag === 5 : reader.scalarType() === 'string'))
        ) {
          if (!stringIds || !captures) throw new Error('Missing packed capture input registry')
          const text =
            replay ??
            (() => {
              if (!reader) throw new Error('Missing packed capture text reader')
              const limits = { retained: 16384, staging: 1024 * 1024 }
              return encoded
                ? reader.encodedTextSteps(encoded.record, limits)
                : reader.textSteps([], limits)
            })
          const tracked = function* () {
            const iterator = captures.track(text())
            try {
              yield* iterator
            } finally {
              try {
                iterator.return(undefined)
              } finally {
                captures.forget(iterator)
              }
            }
          }
          finish(yield* stringIds.encodeSteps(tracked, () => records++))
          continue
        }
        if (reader && capturedKind === 'scalar')
          item = encoded ? encoded.value : reader.scalar([], { retained: 16, staging: 0 })
        if (
          item === null ||
          typeof item === 'string' ||
          typeof item === 'number' ||
          typeof item === 'boolean'
        ) {
          if (typeof item === 'number' && !Number.isFinite(item))
            throw new Error('Non-JSON packed value')
          const scalar = item as Scalar
          if (typeof scalar === 'string' && stringIds && (!sequence || sequence.borrowing)) {
            if (sequence) {
              const known = scalarIds.get(scalar)
              if (known !== undefined) {
                finish(known)
                continue
              }
            }
            const id = yield* stringIds.encodeSteps(
              function* () {
                for (let from = 0; from < scalar.length; from += 4096)
                  yield scalar.slice(from, from + 4096)
              },
              () => records++,
            )
            if (sequence) {
              intern(160 + scalar.length * 2)
              scalarIds.set(scalar, id)
            }
            finish(id)
            continue
          }
          let id = scalarIds.get(scalarKey(scalar))
          if (id === undefined) {
            intern(160 + (sequence && typeof scalar === 'string' ? scalar.length * 2 : 0))
            id = records++
            scalarIds.set(scalarKey(scalar), id)
            if (scalar === null) body.uint(0)
            else if (scalar === false) body.uint(1)
            else if (scalar === true) body.uint(2)
            else if (typeof scalar === 'number') {
              const unsigned =
                Number.isInteger(scalar) &&
                scalar >= 0 &&
                scalar <= 0xffffffff &&
                !Object.is(scalar, -0)
              body.uint(unsigned ? 3 : 4)
              if (unsigned) body.uint(scalar)
              else body.number(scalar)
            } else {
              body.uint(5)
              const start = body.length
              yield* body.stringSteps(scalar)
              if (sequence && stringIds) yield* stringIds.registerSteps(id, start)
            }
          }
          finish(id)
          if (records > byteLimit) throw new Error('Packed value exceeds byte limit')
          continue
        } else if (reader || (item && typeof item === 'object')) {
          let object: object | null = reader ?? (item as object)
          const known = reader ? undefined : completed.get(object)
          if (known !== undefined) {
            object = null
            item = undefined
            finish(known, true)
            continue
          }
          let position: PositionCoordinates | null = null
          if (reader && capturedKind === 'position') {
            if (encoded?.position) position = encoded.position
            else {
              const value = reader.position([], { retained: 512, staging: 0 })
              position = [
                value.start.line,
                value.start.column,
                value.start.offset,
                value.end.line,
                value.end.column,
                value.end.offset,
              ]
            }
          } else if (!reader && !frame.children && !frame.stream) {
            try {
              position = positionValues(object, admitKeys)
            } finally {
              budget?.release(probeKeys)
              probeKeys = 0
            }
          }
          if (position) {
            let found = recordIds.lookupSmall(7, position)
            if (!found) {
              yield
              found = yield* recordIds.lookupSteps(7, position)
            }
            let id = found.id
            if (id === undefined) {
              id = records++
              const offset = body.length
              body.uint(7)
              for (const coordinate of position) body.uint(coordinate)
              if (!recordIds.insertSmall(found.hash, id, offset)) {
                yield
                yield* recordIds.insertSteps(found.hash, id, offset)
              }
              positions++
            }
            position = null
            object = null
            item = undefined
            finish(id)
            continue
          }
          if (!frame.children && !frame.keys && !frame.stream && !frame.elements) {
            if (!reader && active.has(object)) throw new Error('Cyclic packed value')
            budget?.charge(64)
            frame.working += 64
            if (!reader) active.add(object)
            if (reader && capturedKind === 'array') {
              if (!captures) throw new Error('Missing packed capture input registry')
              budget?.charge(320)
              frame.working += 320
              frame.shape = -1
              if (encoded) frame.cursor = encoded.next
              else frame.elements = captures.track(reader.elementSteps())
            } else if (Array.isArray(item)) {
              frame.shape = -1
              frame.children = item
            } else {
              const stream = inputs?.get(object)
              if (stream) {
                if (stream.id !== undefined) {
                  finish(stream.id, true)
                  continue
                }
                // Live stream state, one iterator result and its handoff scratch.
                budget?.charge(320)
                frame.working += 320
                frame.shape = -1
                frame.stream = stream
              } else {
                if (
                  !reader &&
                  Object.getPrototypeOf(object) !== Object.prototype &&
                  Object.getPrototypeOf(object) !== null &&
                  !isPositionNode(object)
                )
                  throw new Error('Non-JSON packed object')
                const ownKeys =
                  encoded?.keys ??
                  (reader ? reader.keys([], { retained: 65536, staging: 0 }) : Object.keys(object))
                if (encoded) admitPackedKeys(ownKeys, { retained: 65536, staging: 0 })
                const keyBytes = budget?.keys(ownKeys) ?? 0
                frame.working += keyBytes
                const keys = reader
                  ? ownKeys
                  : ownKeys.filter((key) => Reflect.get(object as object, key) !== undefined)
                let shape =
                  encoded && keys === firstShape
                    ? firstShapeId
                    : encoded && keys === secondShape
                      ? secondShapeId
                      : undefined
                if (shape === undefined) {
                  const shapeKey = JSON.stringify(keys)
                  shape = shapeIds.get(shapeKey)
                  if (shape === undefined) {
                    // Transfer an independently admitted shape/key spelling into the table.
                    budget?.charge(keyBytes)
                    shape = shapes.length
                    shapeIds.set(shapeKey, shape)
                    shapes.push(keys)
                  }
                  // Equal shapes from another arena still use canonical spelling lookup.
                  // Borrow only the exact key array already owned by the shape table.
                  if (encoded && shapes[shape] === keys) {
                    secondShape = firstShape
                    secondShapeId = firstShapeId
                    firstShape = keys
                    firstShapeId = shape
                  }
                }
                frame.shape = shape
                // Captured values are immutable and already belong to the claimed source.
                // Keep only their keys; open one guarded child when its frame is visited.
                if (reader) {
                  frame.keys = keys
                  if (encoded) frame.cursor = encoded.next
                } else frame.children = keys.map((key) => Reflect.get(object as object, key))
              }
            }
          }
          object = null
        } else throw new Error('Non-JSON packed value')
        // Suspended generators may keep dead lexical slots. A resumed container
        // skips this entry block, so release native inputs before its next edge.
        item = undefined
      }
      const reader = frame.reader
      // Scalars, positions and completed aliases never collect child references.
      // Keep the same admitted frame weight; create the list only for a live container.
      frame.refs ??= []
      const refs = frame.refs
      if (reader && frame.encoded && refs.length < frame.encoded.length) {
        if (frame.cursor === undefined) throw new Error('Missing packed record cursor')
        const next = reader.encodedReference(frame.encoded.record, frame.cursor)
        frame.cursor = next.next
        // Preserve the existing captured-array handoff boundary and per-edge visit/depth charge.
        if (frame.encoded.tag === 6) yield
        budget?.frame(stack.length + 1)
        const known = capturedRecords?.untransformed(frame.encoded.token, next.reference)
        if (known !== undefined) {
          // This is still a logical child advance, including its original progress point
          // and 192 + 320 working charge. Only the transient child frame is unnecessary.
          if (++advances % 64 === 0) yield
          budget?.charge(320)
          reader.assertOpen()
          budget?.release(512)
          budget?.charge(16)
          refs.push(known)
          continue
        }
        stack.push({
          value: undefined,
          reader,
          importRecords: true,
          recordId: next.reference,
          refs: undefined,
          working: 192,
        })
        continue
      }
      if (frame.elements && !frame.streamDone) {
        const next = frame.elements.next()
        yield
        if (!next.done) {
          if (!next.value) continue
          budget?.frame(stack.length + 1)
          stack.push({
            value: undefined,
            reader: next.value,
            importRecords: frame.importRecords,
            refs: undefined,
            working: 192,
          })
          continue
        }
        captures?.forget(frame.elements)
        frame.streamDone = true
      }
      if (frame.stream && !frame.streamDone) {
        if (!inputs) throw new Error('Missing packed array inputs')
        const next = inputs.next(frame.stream)
        // Every callback/array advance suspends before interpreting its result. This
        // also lets reentrant owner cancellation revoke the result without publishing it.
        yield
        if (!next.done) {
          if (next.value === packedArrayPause) continue
          budget?.frame(stack.length + 1)
          stack.push({ value: next.value, refs: undefined, working: 192 })
          continue
        }
        frame.streamDone = true
      }
      if (reader && frame.keys && refs.length < frame.keys.length) {
        const key = frame.keys[refs.length]
        if (key === undefined) throw new Error('Missing packed capture field')
        budget?.frame(stack.length + 1)
        stack.push({
          value: undefined,
          reader: reader.at([key]),
          importRecords: frame.importRecords,
          refs: undefined,
          working: 192,
        })
      } else if (frame.children && refs.length < frame.children.length) {
        budget?.frame(stack.length + 1)
        stack.push({ value: frame.children[refs.length], refs: undefined, working: 192 })
      } else {
        const shape = frame.shape ?? -1
        if (shape < -1 || shape > 0xfffffff7) throw new Error('Invalid packed shape')
        const tag = shape < 0 ? 6 : shape + 8
        let found = recordIds.lookupSmall(tag, refs)
        if (!found) {
          yield
          found = yield* recordIds.lookupSteps(tag, refs)
        }
        let id = found.id
        if (id === undefined) {
          id = records++
          const offset = body.length
          body.uint(tag)
          if (shape < 0) body.uint(refs.length)
          for (const [index, reference] of refs.entries()) {
            body.uint(reference)
            if (index % 256 === 255) yield
          }
          if (!recordIds.insertSmall(found.hash, id, offset)) {
            yield
            yield* recordIds.insertSteps(found.hash, id, offset)
          }
        }
        finish(id)
      }
      if (records > byteLimit) throw new Error('Packed value exceeds byte limit')
    }
    // The root can share an interned ID. Resolve it before dropping all identity tables.
    if (root === undefined) throw new Error('Missing packed root')
    body.uint(root)
    completed = new WeakMap()
    scalarIds.clear()
    recordIds.clear()
    capturedRecords?.clear()
    stringIds?.clear()
    shapeIds.clear()
    firstShape = undefined
    secondShape = undefined
    budget?.release(internBytes)
    // Shapes still own their retained key lists and spelling allowance. Body/header
    // chunks and the single combined output are independently admitted. The header
    // has only the remaining wire allowance, so the actual combined cap never grows.
    const writer = yield* packedHeaderSteps(
      shapes,
      positions,
      records,
      byteLimit - body.length,
      allocate,
    )
    return yield* body.finishSteps(writer, admitOutput)
  } finally {
    stack.length = 0
    value = undefined
    pendingSequence = undefined
    completed = new WeakMap()
    scalarIds.clear()
    recordIds.clear()
    capturedRecords?.clear()
    stringIds?.clear()
    shapeIds.clear()
    shapes.length = 0
    firstShape = undefined
    secondShape = undefined
    body.discard()
  }
}

function* packedHeaderSteps(
  shapes: readonly (readonly string[])[],
  positions: number,
  records: number,
  limit: number,
  allocate?: (bytes: number) => void,
): Generator<void, PackedWriter, undefined> {
  const writer = new PackedWriter(limit, allocate)
  for (const byte of magic) writer.byte(byte)
  writer.uint(shapes.length)
  for (const shape of shapes) {
    writer.uint(shape.length)
    for (const key of shape) yield* writer.stringSteps(key)
    yield
  }
  writer.uint(positions)
  writer.uint(records)
  return writer
}

export interface UnpackedValue {
  value: unknown
  /** Explicit accounting of unique decoded values; not measured heap bytes or a heap bound. */
  retainedBytes: number
  stagingBytes: number
  records: number
}

/** Decode complete bounded input without recursive traversal or trusting claimed byte counts. */
export function unpackValue(
  payload: ArrayBuffer,
  limits: { bytes: number; retained: number; staging: number },
): UnpackedValue {
  if (
    !(payload instanceof ArrayBuffer) ||
    !Number.isSafeInteger(limits.bytes) ||
    limits.bytes < magic.length ||
    payload.byteLength > limits.bytes ||
    !Number.isSafeInteger(limits.retained) ||
    limits.retained < 0 ||
    !Number.isSafeInteger(limits.staging) ||
    limits.staging < 0
  )
    throw new Error('Invalid packed limits')
  const reader = new PackedReader(payload)
  for (const byte of magic) if (reader.byte() !== byte) throw new Error('Unknown packed version')
  let retainedBytes = 0
  let stagingBytes = 0
  let tableBytes = 0
  let workspaceBytes = 0
  const stage = (bytes: number) => {
    tableBytes += bytes
    stagingBytes = tableBytes + workspaceBytes
    if (stagingBytes > limits.staging) throw new Error('Packed value exceeds staging limit')
  }
  const workspace = (bytes: number) => {
    workspaceBytes = Math.max(workspaceBytes, bytes)
    stage(0)
  }
  const charge = (bytes: number) => {
    retainedBytes += bytes
    if (retainedBytes > limits.retained) throw new Error('Packed value exceeds retained limit')
  }
  const shapes: string[][] = []
  const keys = new Set<string>()
  const shapeCount = reader.uint()
  if (shapeCount > reader.remaining) throw new Error('Invalid packed shapes')
  stage(shapeCount * 48)
  for (let index = 0; index < shapeCount; index++) {
    const count = reader.uint()
    if (count > reader.remaining) throw new Error('Invalid packed shape')
    stage(count * 8 + 96)
    const shape: string[] = []
    const seen = new Set<string>()
    for (let keyIndex = 0; keyIndex < count; keyIndex++) {
      const before = reader.position
      const key = reader.string(limits.staging - tableBytes)
      workspace(512 + (reader.position - before) * 4)
      stage(32 + key.length * 2)
      if (seen.has(key)) throw new Error('Duplicate packed key')
      seen.add(key)
      if (!keys.has(key)) {
        keys.add(key)
        charge(32 + key.length * 2)
      }
      shape.push(key)
    }
    shapes.push(shape)
  }
  const positionCount = reader.uint()
  if (positionCount > Math.floor(reader.remaining / 7))
    throw new Error('Invalid packed position count')
  // Six uint32 coordinates per position, plus one shared prototype/table reserve.
  charge(positionCount * 24 + (positionCount ? 256 : 0))
  const positions = new PackedPositions(positionCount)
  const count = reader.uint()
  if (count > reader.remaining) throw new Error('Invalid packed record count')
  stage(count * 9 + 48)
  const values: unknown[] = []
  const positionTags = new Uint8Array(count)
  const materialize = (reference: number) => {
    const value = values[reference]
    if (!positionTags[reference]) return value
    const index = Number(value)
    if (!positions.hasView(index)) charge(96)
    return positions.materialize(index)
  }
  const reference = () => {
    const id = reader.uint()
    if (id >= values.length) throw new Error('Forward or invalid packed reference')
    return id
  }
  for (let index = 0; index < count; index++) {
    const tag = reader.uint()
    if (tag <= 2) {
      charge(8)
      values.push(tag === 0 ? null : tag === 2)
    } else if (tag <= 4) {
      charge(8)
      values.push(tag === 3 ? reader.uint() : reader.number())
    } else if (tag === 5) {
      const before = reader.position
      const string = reader.indexedString(limits.staging - tableBytes)
      workspace(string.workspace)
      charge(32 + string.length * 2)
      if (string.value !== undefined) values.push(string.value)
      else {
        // The output string is charged above; only the temporary JSON spelling uses staging.
        workspace(512 + string.encodedBytes * 2)
        values.push(new PackedReader(reader, before).string(limits.staging - tableBytes, true))
      }
    } else if (tag === 6) {
      const length = reader.uint()
      if (length > reader.remaining) throw new Error('Invalid packed array')
      charge(48 + length * 8)
      const array: unknown[] = []
      for (let item = 0; item < length; item++) array.push(materialize(reference()))
      values.push(Object.freeze(array))
    } else if (tag === 7) {
      const coordinates: number[] = []
      for (let coordinate = 0; coordinate < 6; coordinate++) coordinates.push(reader.uint())
      values.push(positions.add(coordinates))
      positionTags[index] = 1
    } else {
      const shape = shapes[tag - 8]
      if (!shape) throw new Error('Unknown packed shape')
      charge(48 + shape.length * 16)
      const refs = shape.map(() => reference())
      const positionIndex = shape.indexOf('position')
      const position = refs[positionIndex]
      const object: Record<string, unknown> =
        position !== undefined && positionTags[position] ? positions.node() : {}
      for (let keyIndex = 0; keyIndex < shape.length; keyIndex++) {
        const key = shape[keyIndex]
        if (key === undefined) throw new Error('Invalid packed key')
        const raw = refs[keyIndex]
        if (raw === undefined) throw new Error('Invalid packed reference')
        if (key === 'position' && positionTags[raw]) positions.attach(object, Number(values[raw]))
        else {
          const value = materialize(raw)
          if (key === '__proto__') Object.defineProperty(object, key, { value, enumerable: true })
          else object[key] = value
        }
      }
      values.push(Object.freeze(object))
    }
  }
  const root = reader.uint()
  if (root >= values.length || reader.remaining !== 0 || !positions.complete)
    throw new Error('Invalid packed root or trailing bytes')
  const value = materialize(root)
  return { value, retainedBytes, stagingBytes, records: count }
}
