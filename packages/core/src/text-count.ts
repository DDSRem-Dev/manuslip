/** Match string iteration, including lone surrogates, without building code-point strings or an array. */
export function countCodePoints(source: string): number {
  let count = source.length
  for (let index = 0; index < source.length; index++) {
    const high = source.charCodeAt(index)
    if (high >= 0xd800 && high <= 0xdbff) {
      const low = source.charCodeAt(index + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        count--
        index++
      }
    }
  }
  return count
}

/** TextEncoder's exact byte length, including replacement of lone surrogates, without an output buffer. */
export function utf8Bytes(value: string): number {
  // Keep TextEncoder's default/coercion behavior for untyped callers of the existing API.
  const source = value === undefined ? '' : `${value}`
  let bytes = source.length
  for (let index = 0; index < source.length; index++) {
    const unit = source.charCodeAt(index)
    if (unit < 0x80) continue
    if (unit < 0x800) bytes++
    else {
      bytes += 2
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const low = source.charCodeAt(index + 1)
        if (low >= 0xdc00 && low <= 0xdfff) index++
      }
    }
  }
  return bytes
}
