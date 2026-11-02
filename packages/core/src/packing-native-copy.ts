import type { PackedItemSteps, PackedReadScope } from './packing-capture'
import type { PackedNativeLimits } from './packing-native-steps'
import type { PackedEncodedRecord } from './packing-record-read'
import { admitPackedKeys } from './packing-text'
import { validationStreamLimits } from './packing-validation-read'
import type { PackedPath } from './packing-view'
import { PackedWordBuffer } from './packing-word-buffer'

export interface PackedNativePlan {
  retained: number
  longest: number
  nodes: number
}
interface NativeProgress {
  nodes: number
}
/** Admit one complete value's own allocation before constructing it. Collector scratch
 * is needed only for long/edited strings; bounded arena strings are already available.
 */
export type PackedNativeAllocation = (bytes: number, collector: number, depth: number) => void
const nativeBatchNodes = 16
const emptyPath: PackedPath = Object.freeze([])
function keys(scope: PackedReadScope, path: PackedPath): readonly string[] {
  if (scope.keyCount(path) > 64) throw new Error('Packed native key limit')
  return scope.keys(path, { retained: 8192, staging: 8192 })
}
/** A private recursion path replaces temporary child scopes, preserving per-field checks. */
function fieldPath(path: PackedPath, key: string): PackedPath {
  if (key.length > 1024) throw new Error('Invalid packed reader path')
  return [...path, key]
}

/** Internal planning only. Caller owns frames and uses admit before each allocation.
 * At most 16 new value visits share a batch. Array advances and lexical progress always
 * yield separately; recursive completion is additionally bounded by the depth limit.
 * The mutable plan must remain private until this generator finishes.
 */
export function* measurePackedNative(
  scope: PackedReadScope,
  limits: Pick<PackedNativeLimits, 'nodes' | 'depth'>,
  plan: PackedNativePlan,
  admit: () => void,
  depth = 0,
  progress: NativeProgress = { nodes: 0 },
  path: PackedPath = emptyPath,
): Generator<void> {
  if (++plan.nodes > limits.nodes || depth > limits.depth)
    throw new Error('Packed native node/depth limit')
  if (++progress.nodes >= nativeBatchNodes) {
    progress.nodes = 0
    yield
  }
  switch (scope.kind(path)) {
    case 'scalar':
      if (scope.scalarType(path) === 'string') {
        const length = scope.textLength(path)
        plan.retained += 32 + length * 2
        plan.longest = Math.max(plan.longest, length)
      } else plan.retained += 16
      break
    case 'position':
      plan.retained += 272
      break
    case 'array':
      plan.retained += 64 + scope.length(path) * 8
      admit()
      // Isolate each potentially discarded-prefix scan from earlier reference reads.
      // Undefined progress must always reach the caller; never batch array advances.
      progress.nodes = 0
      yield
      for (const child of scope.elementSteps(path)) {
        if (child !== undefined)
          yield* measurePackedNative(child, limits, plan, admit, depth + 1, progress)
        progress.nodes = 0
        yield
      }
      break
    case 'object': {
      const fields = keys(scope, path)
      plan.retained += 64 + fields.reduce((sum, key) => sum + 64 + key.length * 2, 0)
      admit()
      for (const key of fields) {
        yield* measurePackedNative(
          scope,
          limits,
          plan,
          admit,
          depth + 1,
          progress,
          fieldPath(path, key),
        )
      }
    }
  }
  admit()
}

interface CopyFrame {
  scope: PackedReadScope | undefined
  path: PackedPath
  depth: number
  array: unknown[] | undefined
  object: Record<string, unknown> | undefined
  ownSlots: boolean
  fields: readonly string[]
  at: number
  items: PackedItemSteps | undefined
  encoded: PackedEncodedRecord | undefined
  cursor: number
}
const emptyFields: readonly string[] = Object.freeze([])

/** Drop completed sibling ownership immediately, even while this depth is idle. */
function clearCopyFrame(frame: CopyFrame): void {
  frame.scope = undefined
  frame.path = emptyPath
  frame.depth = 0
  frame.array = undefined
  frame.object = undefined
  frame.ownSlots = false
  frame.fields = emptyFields
  frame.at = 0
  frame.items = undefined
  frame.encoded = undefined
  frame.cursor = 0
}

/** Common parser records can allocate their complete admitted shape once. Own writable
 * data slots make later assignment safe even with inherited setters; final freeze gives
 * the same descriptors as the generic defineProperty path. Other shapes stay generic.
 */
function nativeRecord(fields: readonly string[]): Record<string, unknown> | undefined {
  if (fields.length !== 3 || fields[0] !== 'type' || fields[2] !== 'position') return undefined
  if (fields[1] === 'children') return { type: undefined, children: undefined, position: undefined }
  if (fields[1] === 'value') return { type: undefined, value: undefined, position: undefined }
  return undefined
}

function closeCopyFrames(frames: CopyFrame[], preserveFailure: boolean): void {
  let failure: { error: unknown } | undefined
  for (let index = frames.length - 1; index >= 0; index--) {
    const frame = frames[index]
    if (!frame) continue
    const items = frame.items
    clearCopyFrame(frame)
    try {
      items?.return()
    } catch (error) {
      failure ??= { error }
    }
  }
  frames.length = 0
  if (failure && !preserveFailure) throw failure.error
}

/** Internal copy under either complete preflight admission or an allocation callback.
 * An explicit bounded-depth stack avoids delegating every yield through recursive generators.
 * Bounded cached arena strings are borrowed under the output reservation; edited/long
 * values use the collector. Callers retain admission through inspector suspension.
 * One frame per active depth is reused within this traversal, under the existing depth
 * reservation. Completed slots drop all graph references. Every open array closes on
 * exit/cancellation; no frame survives traversal cleanup.
 */
export function* copyPackedNative(
  scope: PackedReadScope,
  progress: NativeProgress = { nodes: 0 },
  allocate?: PackedNativeAllocation,
  records = false,
): Generator<void, unknown> {
  const frames: CopyFrame[] = []
  const pool: CopyFrame[] = []
  const enter = (
    scope: PackedReadScope,
    path: PackedPath,
    depth: number,
    encoded: PackedEncodedRecord | undefined,
  ) => {
    let frame = pool[frames.length]
    if (!frame) {
      frame = {
        scope: undefined,
        path: emptyPath,
        depth: 0,
        array: undefined,
        object: undefined,
        ownSlots: false,
        fields: emptyFields,
        at: 0,
        items: undefined,
        encoded: undefined,
        cursor: 0,
      }
      pool[frames.length] = frame
    }
    frame.scope = scope
    frame.path = path
    frame.depth = depth
    frame.encoded = encoded
    frame.cursor = encoded?.next ?? 0
    frames.push(frame)
    return frame
  }
  let nextScope: PackedReadScope | undefined = scope
  let nextPath: PackedPath = emptyPath
  let nextDepth = 0
  let nextRecord: number | undefined
  let value: unknown
  let complete = false
  let failed = false
  try {
    while (true) {
      if (nextScope) {
        const scope = nextScope,
          path = nextPath,
          depth = nextDepth,
          reference = nextRecord
        nextScope = undefined
        nextRecord = undefined
        if (++progress.nodes >= nativeBatchNodes) {
          progress.nodes = 0
          yield
        }
        // Metadata is source-free; every read still goes through the original guard.
        // Composite/transformed paths retain the ordinary reader and its lazy semantics.
        const encoded = records && !path.length ? scope.encodedRecord(reference) : undefined
        const kind = encoded
          ? encoded.tag <= 5
            ? 'scalar'
            : encoded.tag === 6
              ? 'array'
              : encoded.tag === 7
                ? 'position'
                : 'object'
          : scope.kind(path)
        switch (kind) {
          case 'scalar': {
            if (encoded ? encoded.tag !== 5 : scope.scalarType(path) !== 'string') {
              allocate?.(16, 0, depth)
              if (encoded) scope.assertOpen()
              value = encoded ? encoded.value : scope.scalar(path, { retained: 16, staging: 0 })
            } else {
              const length = encoded ? encoded.length : scope.textLength(path)
              const cached = encoded ? encoded.text : scope.cachedText(path)
              allocate?.(32 + length * 2, cached === undefined ? length : 0, depth)
              if (encoded) scope.assertOpen()
              if (!length) value = ''
              else if (cached !== undefined) value = cached
              else {
                const buffer = PackedWordBuffer.create(length)
                try {
                  const text = encoded
                    ? scope.encodedTextSteps(encoded.record, validationStreamLimits)
                    : scope.textSteps(path, validationStreamLimits)
                  for (const chunk of text) {
                    if (chunk !== undefined) buffer.append(chunk)
                    progress.nodes = 0
                    yield
                  }
                  yield
                  value = buffer.finish()
                } finally {
                  buffer.close()
                }
              }
            }
            complete = true
            break
          }
          case 'position': {
            allocate?.(272, 0, depth)
            if (encoded?.position) {
              scope.assertOpen()
              const [line, column, offset, endLine, endColumn, endOffset] = encoded.position
              value = Object.freeze({
                start: Object.freeze({ line, column, offset }),
                end: Object.freeze({ line: endLine, column: endColumn, offset: endOffset }),
              })
            } else value = scope.position(path, { retained: 272, staging: 0 })
            complete = true
            break
          }
          case 'array': {
            const length = encoded ? encoded.length : scope.length(path)
            allocate?.(64 + length * 8, 0, depth)
            if (encoded) scope.assertOpen()
            const values = new Array<unknown>(length)
            enter(scope, path, depth, encoded).array = values
            progress.nodes = 0
            yield
            break
          }
          case 'object': {
            const fields = encoded?.keys ?? keys(scope, path)
            if (encoded) {
              if (fields.length > 64) throw new Error('Packed native key limit')
              admitPackedKeys(fields, { retained: 8192, staging: 8192 })
            }
            allocate?.(64 + fields.reduce((sum, key) => sum + 64 + key.length * 2, 0), 0, depth)
            if (encoded) scope.assertOpen()
            const record = nativeRecord(fields)
            const frame = enter(scope, path, depth, encoded)
            frame.object = record ?? {}
            frame.ownSlots = record !== undefined
            frame.fields = fields
            break
          }
        }
      }
      if (complete) {
        const parent = frames.at(-1)
        if (!parent) {
          scope.assertOpen()
          return value
        }
        if (parent.array) {
          parent.array[parent.at++] = value
          if (parent.encoded) {
            // A native indexed setter may revoke the source during assignment.
            if (!parent.scope) throw new Error('Missing packed native scope')
            parent.scope.assertOpen()
            // Count completed slots as well as new values. Private numeric cursors
            // do not perform an item-iterator handoff or a discarded-prefix scan.
            if (++progress.nodes >= nativeBatchNodes) {
              progress.nodes = 0
              yield
            }
          } else {
            progress.nodes = 0
            yield
          }
        } else {
          const key = parent.fields[parent.at++]
          if (key === undefined) throw new Error('Invalid packed native field count')
          if (!parent.object) throw new Error('Missing packed native object')
          if (parent.ownSlots) parent.object[key] = value
          else Object.defineProperty(parent.object, key, { value, enumerable: true })
        }
        value = undefined
        complete = false
      }
      const frame = frames.at(-1)
      if (!frame?.scope) throw new Error('Missing packed native frame')
      if (!frame.array) {
        const key = frame.fields[frame.at]
        if (key === undefined) {
          frames.pop()
          value = Object.freeze(frame.object)
          clearCopyFrame(frame)
          complete = true
        } else {
          nextScope = frame.scope
          if (frame.encoded) {
            if (key.length > 1024) throw new Error('Invalid packed reader path')
            const next = frame.scope.encodedReference(frame.encoded.record, frame.cursor)
            frame.cursor = next.next
            nextRecord = next.reference
            nextPath = emptyPath
          } else nextPath = fieldPath(frame.path, key)
          nextDepth = frame.depth + 1
        }
      } else if (frame.encoded) {
        if (frame.at === frame.array.length) {
          frames.pop()
          value = Object.freeze(frame.array)
          clearCopyFrame(frame)
          complete = true
        } else {
          const next = frame.scope.encodedReference(frame.encoded.record, frame.cursor)
          frame.cursor = next.next
          nextScope = frame.scope
          nextRecord = next.reference
          nextPath = emptyPath
          nextDepth = frame.depth + 1
        }
      } else {
        frame.items ??= frame.scope.elementSteps(frame.path)
        const child = frame.items.next()
        if (child.done) {
          if (frame.at !== frame.array.length) throw new Error('Invalid packed native cardinality')
          frames.pop()
          value = Object.freeze(frame.array)
          clearCopyFrame(frame)
          complete = true
        } else if (child.value === undefined) {
          progress.nodes = 0
          yield
        } else {
          nextScope = child.value
          nextPath = emptyPath
          nextDepth = frame.depth + 1
        }
      }
    }
  } catch (error) {
    failed = true
    throw error
  } finally {
    try {
      closeCopyFrames(frames, failed)
    } finally {
      pool.length = 0
    }
  }
}
