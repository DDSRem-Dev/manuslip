import iconv from 'iconv-lite'
import { describe, expect, it } from 'vitest'
import { decodeDocument, encodeDocument } from '../../../../src/main/files/encoding'

describe('lossless document bytes', () => {
  it.each([
    Buffer.from('# Hello 世界\r\n\r\n😀\r\n'),
    Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('你好\n')]),
    iconv.encode('日本語\r\nText\r\n', 'utf16le', { addBOM: true }),
    iconv.encode('日本語\nText\n', 'utf16be', { addBOM: true }),
    Buffer.from('a\rb\r'),
    Buffer.alloc(0),
  ])('preserves BOM, Unicode, and newline bytes on round trip (%j)', (bytes) => {
    const decoded = decodeDocument(bytes)
    expect(encodeDocument(decoded.text, decoded.metadata)).toEqual(bytes)
  })
  it('opens a selected legacy encoding and rejects unrepresentable edits', () => {
    const bytes = iconv.encode('Résumé café\r\n', 'windows-1252')
    const decoded = decodeDocument(bytes, 'windows-1252')
    expect(decoded.metadata.unsafeDecoding).toBe(false)
    expect(encodeDocument(decoded.text, decoded.metadata)).toEqual(bytes)
    expect(() => encodeDocument(`${decoded.text}世界`, decoded.metadata)).toThrow('cannot be saved')
  })
  it('keeps uncertain detection and malformed UTF-8 from overwriting original bytes', () => {
    const detected = decodeDocument(iconv.encode('Café', 'windows-1252'))
    expect(detected.metadata.unsafeDecoding).toBe(true)
    expect(() => encodeDocument(detected.text, detected.metadata)).toThrow('Choose an encoding')
    const malformed = decodeDocument(Buffer.from([0xef, 0xbb, 0xbf, 0xff]))
    expect(malformed.metadata.unsafeDecoding).toBe(true)
    expect(() => encodeDocument(malformed.text, malformed.metadata)).toThrow()
  })
  it('refuses mixed line endings until normalization is explicitly selected', () => {
    const decoded = decodeDocument(Buffer.from('first\r\nsecond\nthird\r'))
    expect(decoded.metadata.newline).toBe('mixed')
    expect(decoded.text).toBe('first\nsecond\nthird\n')
    expect(() => encodeDocument(decoded.text, decoded.metadata)).toThrow('mixed line endings')
    expect(encodeDocument(decoded.text, { ...decoded.metadata, newline: 'crlf' }).toString()).toBe(
      'first\r\nsecond\r\nthird\r\n',
    )
  })
})
