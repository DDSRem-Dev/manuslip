import { expect, it } from 'vitest'
import { inspectPandocOutput } from '../../../../src/main/pandoc/output'
import { readPandocZip, writePandocZip } from '../../../../src/main/pandoc/zip'

// Generated independently with System.IO.Compression.ZipArchive, using deflate.
const fixture = Buffer.from(
  'UEsDBBQAAAAIADdOYV3SrUzyIAAAAB4AAAAMAAAAZG9jdW1lbnQudGV488xLSS1IzUtJzStReLJj7bNp7QqpFYnJJQpJlSWpxQBQSwMEFAAAAAgAN05hXdKtTPIgAAAAHgAAAA4AAABtZWRpYS9wbG90LnBuZ/PMS0ktSM1LSc0rUXiyY+2zae0KqRWJySUKSZUlqcUAUEsBAhQAFAAAAAgAN05hXdKtTPIgAAAAHgAAAAwAAAAAAAAAAAAAAAAAAAAAAGRvY3VtZW50LnRleFBLAQIUABQAAAAIADdOYV3SrUzyIAAAAB4AAAAOAAAAAAAAAAAAAAAAAEoAAABtZWRpYS9wbG90LnBuZ1BLBQYAAAAAAgACAHYAAACWAAAAAAA=',
  'base64',
)
const central = fixture.readUInt32LE(fixture.length - 6)
it('reads independently produced deflate entries with exact multilingual bytes', () => {
  const files = readPandocZip(fixture)
  expect([...files.keys()]).toEqual(['document.tex', 'media/plot.png'])
  expect(files.get('document.tex')?.toString()).toBe('Independent 中文 exact bytes')
  expect(files.get('media/plot.png')).toEqual(files.get('document.tex'))
})
it.each([
  ['truncated directory', (bytes: Buffer) => bytes.subarray(0, bytes.length - 2)],
  [
    'bad signature',
    (bytes: Buffer) => {
      bytes.writeUInt32LE(0, 0)
      return bytes
    },
  ],
  [
    'encrypted entry',
    (bytes: Buffer) => {
      bytes.writeUInt16LE(1, central + 8)
      return bytes
    },
  ],
  [
    'unsupported compression',
    (bytes: Buffer) => {
      bytes.writeUInt16LE(99, central + 10)
      return bytes
    },
  ],
  [
    'unsafe path',
    (bytes: Buffer) => {
      bytes.write('../other.tex', central + 46)
      return bytes
    },
  ],
  [
    'invalid UTF-8 name',
    (bytes: Buffer) => {
      bytes[central + 46] = 255
      return bytes
    },
  ],
  [
    'local checksum mismatch',
    (bytes: Buffer) => {
      bytes[14] = (bytes[14] || 0) ^ 1
      return bytes
    },
  ],
  [
    'compressed corruption',
    (bytes: Buffer) => {
      bytes[45] = (bytes[45] || 0) ^ 1
      return bytes
    },
  ],
  [
    'declared expansion beyond cap',
    (bytes: Buffer) => {
      bytes.writeUInt32LE(0xffffffff, central + 24)
      return bytes
    },
  ],
  [
    'actual expansion beyond declaration',
    (bytes: Buffer) => {
      bytes.writeUInt32LE(1, 22)
      bytes.writeUInt32LE(1, central + 24)
      return bytes
    },
  ],
  [
    'too many entries',
    (bytes: Buffer) => {
      bytes.writeUInt16LE(4097, bytes.length - 14)
      bytes.writeUInt16LE(4097, bytes.length - 12)
      return bytes
    },
  ],
] as const)('rejects %s before accepting an output container', (_name, change) => {
  expect(() => readPandocZip(change(Buffer.from(fixture)))).toThrow()
})
it('writes valid UTF-8 names, exact CRC-protected bytes and a complete directory', () => {
  const files = new Map([
    ['document.tex', Buffer.from('Unicode 中文\r\n')],
    ['media/plot.png', Buffer.from([1, 2, 3, 4])],
  ])
  const bytes = writePandocZip(files)
  expect(bytes.readUInt16LE(12)).toBe(0x21)
  expect(readPandocZip(bytes)).toEqual(files)
  for (const name of ['../bad.tex', '/absolute', 'media/../bad', 'C:/bad', 'media\\bad', 'a\0b'])
    expect(() => writePandocZip(new Map([[name, Buffer.from('x')]]))).toThrow()
})
it('rejects plausible ZIPs that do not contain the requested document or required images', async () => {
  const signal = new AbortController().signal
  await expect(inspectPandocOutput('', 'docx', fixture, new Set(), signal)).rejects.toMatchObject({
    code: 'pandoc-failed',
  })
  const plausible = writePandocZip(
    new Map([
      ['[Content_Types].xml', Buffer.from('<Types/>')],
      ['word/document.xml', Buffer.from('<w:document/>')],
    ]),
  )
  await expect(
    inspectPandocOutput('', 'docx', plausible, new Set(['missing media digest']), signal),
  ).rejects.toMatchObject({ code: 'pandoc-failed' })
  await expect(inspectPandocOutput('', 'epub', plausible, new Set(), signal)).rejects.toMatchObject(
    { code: 'pandoc-failed' },
  )
})
