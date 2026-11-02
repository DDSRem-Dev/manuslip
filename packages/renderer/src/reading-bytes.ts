/** UTF-8 JSON size for owned, acyclic reading records. Count strings directly rather
 * than constructing a complete JSON string and an equally large TextEncoder buffer.
 * Reading projections contain plain records/arrays/scalars, without toJSON hooks.
 */
export function readingJsonBytes(value: unknown): number {
  const active = new Set<object>()
  function string(text: string): number {
    let bytes = 2
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index)
      if (code === 34 || code === 92) bytes += 2
      else if (code < 32)
        bytes += code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : 6
      else if (code < 128) bytes++
      else if (code < 2048) bytes += 2
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(index + 1)
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4
          index++
        } else bytes += 6
      } else bytes += code >= 0xdc00 && code <= 0xdfff ? 6 : 3
    }
    return bytes
  }
  function count(item: unknown, depth: number): number | undefined {
    if (typeof item === 'string') return string(item)
    if (item === null) return 4
    if (typeof item === 'boolean') return item ? 4 : 5
    if (typeof item === 'number') return Number.isFinite(item) ? String(item).length : 4
    if (typeof item === 'bigint') throw new Error('Invalid reading JSON value')
    if (typeof item !== 'object') return undefined
    if (depth > 128 || active.has(item)) throw new Error('Invalid reading JSON structure')
    active.add(item)
    let bytes = 2,
      entries = 0
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index++) {
        bytes += (entries++ ? 1 : 0) + (count(item[index], depth + 1) ?? 4)
      }
    } else {
      const prototype = Object.getPrototypeOf(item)
      if (prototype !== Object.prototype && prototype !== null)
        throw new Error('Invalid reading JSON record')
      for (const key of Object.keys(item)) {
        const size = count(Reflect.get(item, key), depth + 1)
        if (size !== undefined) bytes += (entries++ ? 1 : 0) + string(key) + 1 + size
      }
    }
    active.delete(item)
    return bytes
  }
  const bytes = count(value, 0)
  if (bytes === undefined) throw new Error('Invalid reading JSON value')
  return bytes
}
