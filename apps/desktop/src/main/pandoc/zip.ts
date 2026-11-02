import { crc32, inflateRawSync } from 'node:zlib'
import { pandocLimits } from '../../shared/pandoc-contracts'
import { FileOperationError } from '../files/errors'

const invalid = (): never => {
  throw new FileOperationError('pandoc-failed')
}
const safeName = (name: string): boolean =>
  name.length > 0 &&
  name.length <= 512 &&
  !name.includes('\\') &&
  !name.includes(':') &&
  !name.startsWith('/') &&
  ![...name].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) &&
  !name
    .split('/')
    .some(
      (part, index, parts) => part === '.' || part === '..' || (!part && index < parts.length - 1),
    )

/** Inspect the bounded central directory before decompressing individual entries. */
export function readPandocZip(bytes: Buffer): Map<string, Buffer> {
  if (bytes.length < 22 || bytes.length > pandocLimits.output) return invalid()
  let end = bytes.length - 22
  for (; end >= Math.max(0, bytes.length - 65557); end--)
    if (
      bytes.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + bytes.readUInt16LE(end + 20) === bytes.length
    )
      break
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) return invalid()
  const count = bytes.readUInt16LE(end + 10),
    offset = bytes.readUInt32LE(end + 16),
    size = bytes.readUInt32LE(end + 12)
  if (
    bytes.readUInt32LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 8) !== count ||
    !count ||
    count > 4096 ||
    offset + size !== end
  )
    return invalid()
  let cursor = offset,
    expanded = 0
  const files = new Map<string, Buffer>(),
    ranges: { start: number; end: number }[] = []
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) return invalid()
    const flags = bytes.readUInt16LE(cursor + 8),
      method = bytes.readUInt16LE(cursor + 10),
      checksum = bytes.readUInt32LE(cursor + 16),
      packed = bytes.readUInt32LE(cursor + 20),
      unpacked = bytes.readUInt32LE(cursor + 24),
      length = bytes.readUInt16LE(cursor + 28),
      extra = bytes.readUInt16LE(cursor + 30),
      comment = bytes.readUInt16LE(cursor + 32),
      local = bytes.readUInt32LE(cursor + 42)
    if (
      cursor + 46 + length + extra + comment > end ||
      ![0, 8].includes(method) ||
      flags & ~0x080e ||
      bytes.readUInt16LE(cursor + 34) !== 0 ||
      unpacked > pandocLimits.output ||
      expanded + unpacked > pandocLimits.output ||
      local + 30 > offset ||
      bytes.readUInt32LE(local) !== 0x04034b50
    )
      return invalid()
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + length)
    let name: string
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(rawName)
    } catch {
      return invalid()
    }
    if (
      !safeName(name) ||
      files.has(name) ||
      bytes.readUInt16LE(local + 6) !== flags ||
      bytes.readUInt16LE(local + 8) !== method
    )
      return invalid()
    const localLength = bytes.readUInt16LE(local + 26),
      start = local + 30 + localLength + bytes.readUInt16LE(local + 28),
      finish = start + packed
    if (
      !bytes.subarray(local + 30, local + 30 + localLength).equals(rawName) ||
      finish > offset ||
      start < local + 30 ||
      ranges.some((range) => local < range.end && finish > range.start)
    )
      return invalid()
    let rangeEnd = finish
    if (flags & 8) {
      const descriptor =
        finish + (finish + 4 <= offset && bytes.readUInt32LE(finish) === 0x08074b50 ? 4 : 0)
      if (
        descriptor + 12 > offset ||
        bytes.readUInt32LE(descriptor) !== checksum ||
        bytes.readUInt32LE(descriptor + 4) !== packed ||
        bytes.readUInt32LE(descriptor + 8) !== unpacked
      )
        return invalid()
      rangeEnd = descriptor + 12
    } else if (
      bytes.readUInt32LE(local + 14) !== checksum ||
      bytes.readUInt32LE(local + 18) !== packed ||
      bytes.readUInt32LE(local + 22) !== unpacked
    )
      return invalid()
    if (ranges.some((range) => local < range.end && rangeEnd > range.start)) return invalid()
    ranges.push({ start: local, end: rangeEnd })
    let content: Buffer
    try {
      content =
        method === 0
          ? bytes.subarray(start, finish)
          : inflateRawSync(bytes.subarray(start, finish), {
              maxOutputLength: Math.max(1, unpacked),
            })
    } catch {
      return invalid()
    }
    if (content.length !== unpacked || crc32(content) !== checksum) return invalid()
    files.set(name, content)
    expanded += unpacked
    cursor += 46 + length + extra + comment
  }
  if (cursor !== end) return invalid()
  ranges.sort((a, b) => a.start - b.start)
  if (
    ranges[0]?.start !== 0 ||
    ranges[ranges.length - 1]?.end !== offset ||
    ranges.some((range, index) => index > 0 && ranges[index - 1]?.end !== range.start)
  )
    return invalid()
  return files
}

/** Store-only ZIP avoids an additional compressor allocation for generated PNG media. */
export function writePandocZip(files: ReadonlyMap<string, Buffer>): Buffer {
  if (!files.size || files.size > pandocLimits.mediaFiles + 2) return invalid()
  const local: Buffer[] = [],
    central: Buffer[] = []
  let offset = 0,
    centralSize = 0
  for (const [name, content] of files) {
    if (!safeName(name) || name.endsWith('/')) return invalid()
    const encoded = Buffer.from(name),
      checksum = crc32(content),
      header = Buffer.alloc(30),
      entry = Buffer.alloc(46)
    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(0x21, 12)
    header.writeUInt32LE(checksum, 14)
    header.writeUInt32LE(content.length, 18)
    header.writeUInt32LE(content.length, 22)
    header.writeUInt16LE(encoded.length, 26)
    entry.writeUInt32LE(0x02014b50)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(0x800, 8)
    entry.writeUInt16LE(0x21, 14)
    entry.writeUInt32LE(checksum, 16)
    entry.writeUInt32LE(content.length, 20)
    entry.writeUInt32LE(content.length, 24)
    entry.writeUInt16LE(encoded.length, 28)
    entry.writeUInt32LE(offset, 42)
    const next = offset + header.length + encoded.length + content.length
    centralSize += entry.length + encoded.length
    if (next + centralSize + 22 > pandocLimits.output) throw new FileOperationError('pandoc-limit')
    local.push(header, encoded, content)
    central.push(entry, encoded)
    offset = next
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(files.size, 8)
  end.writeUInt16LE(files.size, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, ...central, end], offset + centralSize + 22)
}
