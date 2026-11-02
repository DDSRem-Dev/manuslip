import type { EditorSelection, SelectionRange } from '@codemirror/state'

/** Only non-empty, half-open text selections reveal Markdown source. */
export function rangeTouches(selection: SelectionRange, from: number, to: number): boolean {
  return !selection.empty && from < to && selection.from < to && selection.to > from
}

export function selectionTouches(selection: EditorSelection, from: number, to: number): boolean {
  // CodeMirror keeps ranges sorted. Avoid scanning every cursor for each syntax node.
  const ranges = selection.ranges
  let low = 0,
    high = ranges.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((ranges[middle]?.to ?? Infinity) < from) low = middle + 1
    else high = middle
  }
  for (let index = low; index < ranges.length; index++) {
    const range = ranges[index]
    if (!range || range.from > to) break
    if (rangeTouches(range, from, to)) return true
  }
  return false
}
