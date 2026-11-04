const encoder = new TextEncoder()
const c1 = 0x239b961b,
  c2 = 0xab0e9789,
  c3 = 0x38b34ae5,
  c4 = 0xa1e38b93

function rotate(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits))
}
function mix(value: number, first: number, bits: number, second: number): number {
  return Math.imul(rotate(Math.imul(value, first), bits), second)
}
function finish(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b)
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35)
  return value ^ (value >>> 16)
}

/** MurmurHash3 x86 128, seed 0, over UTF-8. Async preserves preparation cancellation points.
 * Cache indexing only: callers must compare the complete identity before reusing an entry.
 * Adapted from Austin Appleby's public-domain SMHasher reference implementation:
 * https://github.com/aappleby/smhasher/blob/master/src/MurmurHash3.cpp
 */
export async function murmurHash128(value: string): Promise<string> {
  const bytes = encoder.encode(value)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let h1 = 0,
    h2 = 0,
    h3 = 0,
    h4 = 0
  const end = bytes.length - (bytes.length % 16)
  for (let offset = 0; offset < end; offset += 16) {
    h1 ^= mix(view.getUint32(offset, true), c1, 15, c2)
    h1 = (Math.imul((rotate(h1, 19) + h2) | 0, 5) + 0x561ccd1b) | 0
    h2 ^= mix(view.getUint32(offset + 4, true), c2, 16, c3)
    h2 = (Math.imul((rotate(h2, 17) + h3) | 0, 5) + 0x0bcaa747) | 0
    h3 ^= mix(view.getUint32(offset + 8, true), c3, 17, c4)
    h3 = (Math.imul((rotate(h3, 15) + h4) | 0, 5) + 0x96cd1c35) | 0
    h4 ^= mix(view.getUint32(offset + 12, true), c4, 18, c1)
    h4 = (Math.imul((rotate(h4, 13) + h1) | 0, 5) + 0x32ac3b17) | 0
  }
  const tail = new Uint32Array(4)
  for (let offset = end; offset < bytes.length; offset++) {
    const index = offset - end
    tail[index >>> 2] = (tail[index >>> 2] ?? 0) | ((bytes[offset] ?? 0) << ((index % 4) * 8))
  }
  if (bytes.length - end > 12) h4 ^= mix(tail[3] ?? 0, c4, 18, c1)
  if (bytes.length - end > 8) h3 ^= mix(tail[2] ?? 0, c3, 17, c4)
  if (bytes.length - end > 4) h2 ^= mix(tail[1] ?? 0, c2, 16, c3)
  if (bytes.length > end) h1 ^= mix(tail[0] ?? 0, c1, 15, c2)
  h1 ^= bytes.length
  h2 ^= bytes.length
  h3 ^= bytes.length
  h4 ^= bytes.length
  h1 = (h1 + h2 + h3 + h4) | 0
  h2 = (h2 + h1) | 0
  h3 = (h3 + h1) | 0
  h4 = (h4 + h1) | 0
  h1 = finish(h1)
  h2 = finish(h2)
  h3 = finish(h3)
  h4 = finish(h4)
  h1 = (h1 + h2 + h3 + h4) | 0
  return [h1, h2 + h1, h3 + h1, h4 + h1]
    .map((word) => (word >>> 0).toString(16).padStart(8, '0'))
    .join('')
}

export function isTranslationKey(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
}
