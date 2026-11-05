import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve } from 'node:path'
import { record } from '../../shared/file-contracts'
import type { SearchAnchor, SearchEntry } from '../../shared/search-contracts'
import { searchLimits } from '../../shared/search-contracts'

export interface StoredEntry {
  entry: SearchEntry
  anchor: SearchAnchor | null
  relative: string
}
// U+FEFF inside a searched line is source content, including at a slice boundary.
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
export function relativeFile(root: string, input: string): string | null {
  if (!input.length || input.length > 32768 || input.includes('\0') || isAbsolute(input))
    return null
  const tail = relative(root, resolve(root, input))
  if (
    !tail ||
    tail === '..' ||
    tail.startsWith('../') ||
    tail.startsWith('..\\') ||
    isAbsolute(tail) ||
    !/\.(md|markdown|mdown|txt)$/i.test(tail)
  )
    return null
  return tail
}
function text(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  if ('text' in value && typeof value.text === 'string') return value.text
  if ('bytes' in value && typeof value.bytes === 'string') {
    try {
      return decoder.decode(Buffer.from(value.bytes, 'base64'))
    } catch {
      return null
    }
  }
  return null
}
export function filenameEntry(path: string): StoredEntry {
  return {
    relative: path,
    anchor: null,
    entry: { id: randomUUID(), path: path.replaceAll('\\', '/'), line: 0, excerpt: '' },
  }
}
interface Submatch {
  start: number
  end: number
}
function validSubmatches(input: unknown, bytes: Buffer): input is Submatch[] {
  if (!Array.isArray(input)) return false
  let previous = 0
  for (const value of input) {
    const match = record(value)
    if (
      typeof match.start !== 'number' ||
      typeof match.end !== 'number' ||
      !Number.isSafeInteger(match.start) ||
      !Number.isSafeInteger(match.end) ||
      match.start < previous ||
      match.end < match.start ||
      match.end > bytes.length ||
      ((bytes[match.start] ?? 0) & 0xc0) === 0x80 ||
      ((bytes[match.end] ?? 0) & 0xc0) === 0x80
    )
      return false
    previous = match.end
  }
  return true
}
/** ripgrep offsets refer to UTF-8 bytes after BOM transcoding, not CodeMirror UTF-16 offsets. */
export function matchEntries(
  root: string,
  input: Buffer,
  accept: (entry: StoredEntry) => boolean,
): { keep: boolean; skipped: number } {
  try {
    const value = record(JSON.parse(decoder.decode(input)))
    if (value.type !== 'match') return { keep: true, skipped: 0 }
    const data = record(value.data),
      path = text(data.path),
      lineText = text(data.lines)
    const pathWithinRoot = path && relativeFile(root, path)
    if (
      !pathWithinRoot ||
      lineText === null ||
      typeof data.line_number !== 'number' ||
      !Number.isSafeInteger(data.line_number) ||
      data.line_number < 1
    )
      return { keep: true, skipped: 1 }
    const line = lineText.replace(/\r?\n$/, '')
    if (line.length > searchLimits.line || line.includes('\0')) return { keep: true, skipped: 1 }
    const bytes = Buffer.from(line, 'utf8')
    // Validate the complete record before publishing any results from it.
    if (!validSubmatches(data.submatches, bytes)) return { keep: true, skipped: 1 }
    let byteOffset = 0,
      textOffset = 0
    for (const match of data.submatches) {
      // ripgrep emits ordered, nonoverlapping matches. Decode each intervening byte once.
      const from = textOffset + decoder.decode(bytes.subarray(byteOffset, match.start)).length,
        to = from + decoder.decode(bytes.subarray(match.start, match.end)).length
      byteOffset = match.end
      textOffset = to
      const start = Math.max(0, from - 80)
      const excerpt = `${start ? '…' : ''}${line.slice(start, start + 2047)}`
      if (
        !accept({
          relative: pathWithinRoot,
          anchor: { line: data.line_number, from, to, text: line },
          entry: {
            id: randomUUID(),
            path: pathWithinRoot.replaceAll('\\', '/'),
            line: data.line_number,
            excerpt,
          },
        })
      )
        return { keep: false, skipped: 0 }
    }
    return { keep: true, skipped: 0 }
  } catch {
    return { keep: true, skipped: 1 }
  }
}
