const sourceToken = '[data-source-from][data-source-to]'

/** Resolve against the displayed SVG before opening source changes its geometry.
 * Only renderer-verified literal spans are eligible; stale/ambiguous output
 * falls back to the block's normal entry point.
 */
export function diagramPositionAtPoint(
  root: HTMLElement,
  value: string,
  event: MouseEvent,
): number | undefined {
  if (!(event.target instanceof Element)) return
  if (!root.querySelector('svg')) {
    const source = root.querySelector('pre')
    return source ? literalPositionAtPoint(source, value, event) : undefined
  }
  let token = event.target.closest(sourceToken)
  if (!token || !root.contains(token)) {
    token = null
    let distance = Infinity
    const labels = root.querySelectorAll(`text${sourceToken}`)
    for (let at = 0; at < Math.min(labels.length, 8192); at++) {
      const text = labels[at]
      if (!text) continue
      const box = text.getBoundingClientRect()
      if (box.width <= 0 || box.height <= 0) continue
      const dx = Math.max(box.left - event.clientX, event.clientX - box.right, 0)
      const dy = Math.max(box.top - event.clientY, event.clientY - box.bottom, 0)
      const next = dx * dx + dy * dy
      if (next < distance) {
        distance = next
        token = text
      }
    }
  }
  if (!token) return
  const from = Number(token.getAttribute('data-source-from')),
    to = Number(token.getAttribute('data-source-to'))
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    from >= to ||
    to > value.length
  )
    return
  const text = token.matches('text') ? token : token.querySelector('text')
  if (text instanceof SVGTextContentElement && text.textContent === value.slice(from, to)) {
    const matrix = text.getScreenCTM()
    const count = text.getNumberOfChars()
    if (matrix && count === to - from && count <= 4096) {
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
      let index = text.getCharNumAtPosition(point)
      if (index < 0) {
        let nearest = Infinity
        for (let at = 0; at < count; at++) {
          const bounds = text.getExtentOfChar(at)
          const dx = Math.max(bounds.x - point.x, point.x - bounds.x - bounds.width, 0)
          const dy = Math.max(bounds.y - point.y, point.y - bounds.y - bounds.height, 0)
          const distance = dx * dx + dy * dy
          if (distance < nearest) {
            nearest = distance
            index = at
          }
        }
      }
      if (index >= 0 && index < count) {
        const before = text.getStartPositionOfChar(index),
          after = text.getEndPositionOfChar(index)
        const at =
          from +
          index +
          Number(
            Math.hypot(point.x - after.x, point.y - after.y) <
              Math.hypot(point.x - before.x, point.y - before.y),
          )
        // SVG character APIs use UTF-16 offsets. Never split an emoji surrogate.
        return /[\uDC00-\uDFFF]/.test(value[at] ?? '') ? at + (at > from + index ? 1 : -1) : at
      }
    }
  }
  const box = token.getBoundingClientRect()
  return event.clientX < box.left + box.width / 2 ? from : to
}

import { literalPositionAtPoint } from './live-source-position'
