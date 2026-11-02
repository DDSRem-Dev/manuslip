import type { PackedOperation } from './packing-revision'

/** Copy the bounded operation envelope before suspending preparation. Admission runs before
 * each allocation; caller mutations cannot change paths or retain arbitrary object values.
 */
export function copyPackedOperations(
  operations: readonly PackedOperation[],
  admit: (bytes: number) => void,
): { operations: readonly PackedOperation[]; bytes: number } {
  if (!Array.isArray(operations) || operations.length > 1024)
    throw new Error('Invalid packed update')
  let bytes = 256 + operations.length * 128
  admit(bytes)
  const copied: PackedOperation[] = []
  for (const operation of operations) {
    if (
      !operation ||
      !['replace', 'splice', 'text', 'offset', 'range'].includes(operation.kind) ||
      !Array.isArray(operation.path) ||
      operation.path.length > 128
    )
      throw new Error('Invalid packed operation')
    bytes += 48 + operation.path.length * 16
    for (const part of operation.path) {
      if (
        typeof part !== 'string' &&
        !(typeof part === 'number' && Number.isSafeInteger(part) && part >= 0)
      )
        throw new Error('Invalid packed operation')
      if (typeof part === 'string') {
        if (part.length > 1024) throw new Error('Invalid packed operation')
        bytes += 32 + part.length * 2
      }
    }
    admit(bytes)
    const path = Object.freeze([...operation.path])
    const integer = (value: number) => {
      if (!Number.isSafeInteger(value)) throw new Error('Invalid packed operation')
      return value
    }
    if (operation.kind === 'replace')
      copied.push(Object.freeze({ kind: operation.kind, path, record: integer(operation.record) }))
    else if (operation.kind === 'splice' || operation.kind === 'text')
      copied.push(
        Object.freeze({
          kind: operation.kind,
          path,
          start: integer(operation.start),
          remove: integer(operation.remove),
          record: integer(operation.record),
        }),
      )
    else
      copied.push(
        Object.freeze({
          kind: operation.kind,
          path,
          start: integer(operation.start),
          offset: integer(operation.offset),
        }),
      )
  }
  return { operations: Object.freeze(copied), bytes }
}
