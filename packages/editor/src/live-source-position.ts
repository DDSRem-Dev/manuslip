/** Convert a rendered value offset to its authored Markdown position. Delimiters
 * and indentation belong to Markdown, not to the rendered expression or diagram.
 */
export function delimitedSourcePosition(
  source: string,
  value: string,
  offset: number,
): number | undefined {
  if (!Number.isInteger(offset) || offset < 0 || offset > value.length) return
  let from = 0,
    to = source.length
  const delimiter = /^\$+/.exec(source)?.[0]
  if (delimiter) {
    if (source.length < delimiter.length * 2 || !source.endsWith(delimiter)) return
    from = delimiter.length
    to -= delimiter.length
  } else if (source.startsWith('\\(') || source.startsWith('\\[')) {
    if (!source.endsWith(source[1] === '(' ? '\\)' : '\\]')) return
    from = 2
    to -= 2
  } else {
    const fence = /^[\t ]*(`{3,}|~{3,})[^\n]*\n/.exec(source)
    if (!fence) return
    from = fence[0].length
    const last = source.lastIndexOf('\n') + 1
    const closing = /^[\t ]*(`{3,}|~{3,})[\t ]*$/.exec(source.slice(last))?.[1]
    if (closing && closing[0] === fence[1]?.[0] && closing.length >= (fence[1]?.length ?? 3))
      to = last
  }
  const body = source.slice(from, to)
  const exact = body.indexOf(value)
  if (exact >= 0) return from + exact + offset
  const lines = body.split('\n')
  const values = value.split('\n')
  let line = body.startsWith('\n') ? 1 : 0,
    position = from + (line ? 1 : 0),
    at = 0
  for (const text of values) {
    const authored = lines[line++]
    if (authored === undefined || !authored.endsWith(text)) return
    const indent = authored.length - text.length
    if (!/^[\t >]*$/.test(authored.slice(0, indent))) return
    if (offset <= at + text.length) return position + indent + offset - at
    position += authored.length + 1
    at += text.length + 1
  }
}

/** Loading/error previews show the literal value. Read that text node directly
 * so a first click doesn't need to wait for a worker or jump to the block start.
 * Status messages and retry controls are never part of the authored value.
 */
export function literalPositionAtPoint(
  root: HTMLElement,
  value: string,
  event: MouseEvent,
): number | undefined {
  const text = root.firstChild
  if (!text || text.nodeType !== Node.TEXT_NODE || text.textContent !== value) return
  const document = root.ownerDocument
  const caret = document.caretPositionFromPoint?.(event.clientX, event.clientY)
  if (caret) return caret.offsetNode === text ? Math.min(value.length, caret.offset) : undefined
  const range = document.caretRangeFromPoint?.(event.clientX, event.clientY)
  if (range?.startContainer === text) return Math.min(value.length, range.startOffset)
}
