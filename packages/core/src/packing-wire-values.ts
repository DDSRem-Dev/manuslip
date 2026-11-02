import type { PackedOperation } from './packing-revision'
import { identityKeys, type PackedIdentity, packedIdentityStringLimits } from './packing-source'

/** Accept only structured-clone data properties, never accessors or class instances. */
export function wireRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid packed wire object')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error('Invalid packed wire object')
  const own = Reflect.ownKeys(value)
  if (
    own.length !== keys.length ||
    own.some((key) => typeof key !== 'string' || !keys.includes(key))
  )
    throw new Error('Invalid packed wire fields')
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      throw new Error('Invalid packed wire data property')
  }
  return value as Record<string, unknown>
}
export function wireInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new Error('Invalid packed wire integer')
  return value
}
export function wireTime(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error('Invalid packed wire timing')
  return value
}
export class WireBudget {
  retained = 1024
  units = 0
  charge(bytes: number, units = 0) {
    this.retained += bytes
    this.units += units
    if (this.retained > 512 * 1024 || this.units > 64 * 1024)
      throw new Error('Packed wire envelope exceeds admission limit')
  }
}
export function wireString(value: unknown, maximum: number, budget: WireBudget): string {
  if (typeof value !== 'string' || !value.length || value.length > maximum)
    throw new Error('Invalid packed wire string')
  budget.charge(64 + value.length * 2, value.length + 2)
  return value
}
export function wireIdentity(value: unknown, budget: WireBudget): PackedIdentity {
  const input = wireRecord(value, identityKeys)
  budget.charge(512)
  const identity = {
    generation: wireInteger(input.generation),
    revision: wireInteger(input.revision),
    documentId: wireString(input.documentId, packedIdentityStringLimits.documentId, budget),
    sourceHash: wireString(input.sourceHash, 64, budget),
    parserVersion: wireString(
      input.parserVersion,
      packedIdentityStringLimits.parserVersion,
      budget,
    ),
    rendererVersion: wireString(
      input.rendererVersion,
      packedIdentityStringLimits.rendererVersion,
      budget,
    ),
    options: wireString(input.options, packedIdentityStringLimits.options, budget),
  }
  return Object.freeze(identity)
}
function wireArray(value: unknown, maximum: number, budget: WireBudget): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum
  )
    throw new Error('Invalid packed wire array')
  budget.charge(64 + value.length * 16, value.length + 2)
  if (Reflect.ownKeys(value).length !== value.length + 1)
    throw new Error('Invalid packed wire array fields')
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      throw new Error('Invalid packed wire array item')
  }
  return value
}
const operationFields = {
  replace: ['kind', 'path', 'record'],
  splice: ['kind', 'path', 'start', 'remove', 'record'],
  text: ['kind', 'path', 'start', 'remove', 'record'],
  offset: ['kind', 'path', 'start', 'offset'],
  range: ['kind', 'path', 'start', 'offset'],
} as const
export function wireOperations(value: unknown, budget: WireBudget): readonly PackedOperation[] {
  const input = wireArray(value, 1024, budget)
  const result: PackedOperation[] = []
  for (const item of input) {
    // Read kind only after checking its descriptor; dispatch cannot invoke a getter.
    const descriptor =
      item && typeof item === 'object' ? Object.getOwnPropertyDescriptor(item, 'kind') : undefined
    const kind: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined
    if (typeof kind !== 'string' || !Object.hasOwn(operationFields, kind))
      throw new Error('Invalid packed wire operation')
    const operation = wireRecord(item, operationFields[kind as keyof typeof operationFields])
    budget.charge(384)
    const path = wireArray(operation.path, 128, budget).map((part) => {
      if (typeof part === 'string') {
        if (part.length > 1024) throw new Error('Invalid packed wire path')
        budget.charge(64 + part.length * 2, part.length + 2)
        return part
      }
      return wireInteger(part)
    })
    Object.freeze(path)
    if (kind === 'replace')
      result.push(Object.freeze({ kind, path, record: wireInteger(operation.record, 0xffffffff) }))
    else if (kind === 'splice' || kind === 'text')
      result.push(
        Object.freeze({
          kind,
          path,
          start: wireInteger(operation.start),
          remove: wireInteger(operation.remove),
          record: wireInteger(operation.record, 0xffffffff),
        }),
      )
    else {
      const offset = operation.offset
      if (
        typeof offset !== 'number' ||
        !Number.isSafeInteger(offset) ||
        Math.abs(offset) > 0xffffffff
      )
        throw new Error('Invalid packed wire offset')
      result.push(
        Object.freeze({
          kind: kind as 'offset' | 'range',
          path,
          start: wireInteger(operation.start),
          offset,
        }),
      )
    }
  }
  return Object.freeze(result)
}
