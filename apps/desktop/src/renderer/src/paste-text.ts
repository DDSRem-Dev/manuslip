import { maxDocumentBytes, Text } from '@manuslip/editor'

/** Normalize clipboard line breaks without splitting CRLF or surrogate pairs between slices. */
export function* preparePasteText(source: string): Generator<void, Text> {
  let result = Text.empty
  let bytes = 0
  const encoder = new TextEncoder()
  for (let from = 0; from < source.length; ) {
    let to = Math.min(source.length, from + 64 * 1024)
    const last = source.charCodeAt(to - 1)
    if (to < source.length && (last === 13 || (last >= 0xd800 && last <= 0xdbff))) to--
    const chunk = source.slice(from, to).replace(/\r\n?/g, '\n')
    bytes += encoder.encode(chunk).byteLength
    if (bytes > maxDocumentBytes) throw new Error('file-large')
    result = result.append(Text.of(chunk.split('\n')))
    from = to
    yield
  }
  return result
}
