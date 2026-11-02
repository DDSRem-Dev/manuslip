import iconv from 'iconv-lite'
import jschardet from 'jschardet'
import type { Newline } from '../../shared/file-contracts'
import { FileOperationError } from './errors'

export interface EncodingInfo {
  encoding: string
  bom: boolean
  newline: Newline
  unsafeDecoding: boolean
}
export function decodeDocument(
  bytes: Buffer,
  selectedEncoding?: string,
): { text: string; metadata: EncodingInfo } {
  let encoding = selectedEncoding || 'utf8'
  let bom = false
  let body = bytes
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    encoding = 'utf8'
    bom = true
    body = bytes.subarray(3)
  } else if (bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) {
    encoding = 'utf16le'
    bom = true
    body = bytes.subarray(2)
  } else if (bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) {
    encoding = 'utf16be'
    bom = true
    body = bytes.subarray(2)
  } else if (!selectedEncoding) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(body)
    } catch {
      encoding = jschardet.detect(bytes).encoding || 'windows-1252'
    }
  }
  if (!iconv.encodingExists(encoding)) throw new FileOperationError('file-encoding')
  const decoded = iconv.decode(body, encoding, { stripBOM: false })
  const roundTrip = iconv.encode(decoded, encoding, { addBOM: false }).equals(body)
  const utf = /^utf[-_]?8$/i.test(encoding) || /^utf[-_]?16/i.test(encoding)
  const confidence = selectedEncoding || bom || utf ? 1 : jschardet.detect(bytes).confidence
  const kinds = new Set<string>()
  for (const match of decoded.matchAll(/\r\n|\r|\n/g)) {
    kinds.add(match[0])
    if (kinds.size > 1) break
  }
  const newline: Newline =
    kinds.size > 1 ? 'mixed' : kinds.has('\r\n') ? 'crlf' : kinds.has('\r') ? 'cr' : 'lf'
  return {
    text: decoded.replace(/\r\n|\r/g, '\n'),
    metadata: {
      encoding,
      bom,
      newline,
      unsafeDecoding: !roundTrip || confidence < 0.95 || (!utf && !selectedEncoding && !bom),
    },
  }
}

export function encodeDocument(text: string, metadata: EncodingInfo): Buffer {
  if (metadata.unsafeDecoding) throw new FileOperationError('file-unsafe')
  if (metadata.newline === 'mixed') throw new FileOperationError('file-newlines')
  const separator = metadata.newline === 'crlf' ? '\r\n' : metadata.newline === 'cr' ? '\r' : '\n'
  const restored = text.replace(/\r\n|\r|\n/g, separator)
  const bytes = iconv.encode(restored, metadata.encoding, { addBOM: false })
  if (iconv.decode(bytes, metadata.encoding, { stripBOM: false }) !== restored)
    throw new FileOperationError('file-encoding')
  const bom = metadata.bom
    ? /^utf[-_]?8$/i.test(metadata.encoding)
      ? Buffer.from([0xef, 0xbb, 0xbf])
      : /^utf[-_]?16be$/i.test(metadata.encoding)
        ? Buffer.from([0xfe, 0xff])
        : /^utf[-_]?16le$/i.test(metadata.encoding)
          ? Buffer.from([0xff, 0xfe])
          : Buffer.alloc(0)
    : Buffer.alloc(0)
  return Buffer.concat([bom, bytes])
}
