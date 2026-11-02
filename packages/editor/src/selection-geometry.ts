import { Direction, type EditorView, RectangleMarker } from '@codemirror/view'

interface Row {
  top: number
  bottom: number
  spans: { left: number; right: number }[]
}

/** Measure only mounted selection fragments, after CodeMirror has updated the DOM. */
export function selectedTextMarkers(view: EditorView): RectangleMarker[] {
  const lines = new Map<HTMLElement, DOMRect[]>()
  for (const span of view.contentDOM.querySelectorAll('.cm-selectedText')) {
    const line = span.closest<HTMLElement>('.cm-line')
    if (!line) continue
    let rects = lines.get(line)
    if (!rects) {
      rects = []
      lines.set(line, rects)
    }
    for (const rect of span.getClientRects())
      if (rect.width > 0 && rect.height > 0) rects.push(rect)
  }
  const scroll = view.scrollDOM.getBoundingClientRect()
  const scrollLeft =
    view.textDirection === Direction.LTR
      ? scroll.left
      : scroll.right - view.scrollDOM.clientWidth * view.scaleX
  const baseLeft = scrollLeft - view.scrollDOM.scrollLeft * view.scaleX
  const baseTop = scroll.top - view.scrollDOM.scrollTop * view.scaleY
  const markers: RectangleMarker[] = []
  for (const [line, rects] of lines) {
    const style = getComputedStyle(line)
    const bounds = line.getBoundingClientRect()
    const lineTop =
      bounds.top + (parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth)) * view.scaleY
    const lineBottom =
      bounds.bottom -
      (parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth)) * view.scaleY
    const lineHeight = (parseFloat(style.lineHeight) || view.defaultLineHeight) * view.scaleY
    const rows: Row[] = []
    // Fonts and syntax fragments can have different ink boxes on the same baseline.
    rects.sort((a, b) => a.top - b.top || a.left - b.left)
    for (const rect of rects) {
      let row = rows.at(-1)
      const overlap = row && Math.min(row.bottom, rect.bottom) - Math.max(row.top, rect.top)
      if (!row || (overlap ?? 0) < Math.min(row.bottom - row.top, rect.height) / 2) {
        row = { top: rect.top, bottom: rect.bottom, spans: [] }
        rows.push(row)
      }
      row.top = Math.min(row.top, rect.top)
      row.bottom = Math.max(row.bottom, rect.bottom)
      row.spans.push({ left: rect.left, right: rect.right })
    }
    for (const row of rows) {
      const leading = Math.max(0, lineHeight - (row.bottom - row.top)) / 2
      row.top = Math.max(lineTop, row.top - leading)
      row.bottom = Math.min(lineBottom, row.bottom + leading)
      // Snap the outer edges to the actual line box, including fractional font metrics.
      if (row.top - lineTop < 2 * view.scaleY) row.top = lineTop
      if (lineBottom - row.bottom < 2 * view.scaleY) row.bottom = lineBottom
    }
    for (let index = 1; index < rows.length; index++) {
      const previous = rows[index - 1],
        next = rows[index]
      if (previous && next && Math.abs(next.top - previous.bottom) < 2 * view.scaleY)
        previous.bottom = next.top = (previous.bottom + next.top) / 2
    }
    for (const row of rows) {
      const merged: Row['spans'] = []
      for (const span of row.spans.sort((a, b) => a.left - b.left)) {
        const previous = merged.at(-1)
        if (previous && span.left - previous.right <= 0.5 * view.scaleX)
          previous.right = Math.max(previous.right, span.right)
        else merged.push({ ...span })
      }
      for (const span of merged)
        markers.push(
          new RectangleMarker(
            'cm-textSelectionBackground',
            span.left - baseLeft,
            row.top - baseTop,
            span.right - span.left,
            row.bottom - row.top,
          ),
        )
    }
  }
  return markers
}
