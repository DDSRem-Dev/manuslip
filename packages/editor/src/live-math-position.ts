const sourceToken = '[data-source-from][data-source-to]'

interface MathHit {
  token: Element
  from: number
  to: number
  box: DOMRect
}

function tokenHit(token: Element, length: number): MathHit | undefined {
  const from = Number(token.getAttribute('data-source-from'))
  const to = Number(token.getAttribute('data-source-to'))
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= to || to > length)
    return
  const box = token.getBoundingClientRect()
  if (box.width > 0 && box.height > 0) return { token, from, to, box }
}

/** SVG groups can receive clicks in the gaps between rows or symbols. Their
 * ranges include structural TeX such as begin/end, so only visible leaf tokens
 * are caret destinations. A painted token takes the direct path; a gap resolves
 * to the closest token in both axes before revealing source changes the layout.
 */
function tokenAtPoint(root: HTMLElement, length: number, event: MouseEvent): MathHit | undefined {
  const direct = event.target instanceof Element ? event.target.closest(sourceToken) : null
  if (direct && root.contains(direct) && !direct.querySelector(sourceToken)) {
    const hit = tokenHit(direct, length)
    if (hit) return hit
  }
  const tokens = root.querySelectorAll(sourceToken)
  let nearest: MathHit | undefined,
    vertical = Infinity,
    horizontal = Infinity
  for (let index = 0; index < Math.min(tokens.length, 8192); index++) {
    const token = tokens[index]
    // In document order, a group containing any mapped descendant necessarily
    // contains the next mapped token. No subtree scan or retained geometry cache.
    if (!token || (tokens[index + 1] && token.contains(tokens[index + 1] ?? null))) continue
    const hit = tokenHit(token, length)
    if (!hit) continue
    const x = Math.max(hit.box.left - event.clientX, event.clientX - hit.box.right, 0)
    const y = Math.max(hit.box.top - event.clientY, event.clientY - hit.box.bottom, 0)
    // Choose the row under the pointer before its horizontal insertion point.
    // Far into the padding, a slightly shorter row must not pull the caret onto
    // a different row just because its first symbol is a few pixels farther left.
    if (y < vertical || (y === vertical && x < horizontal)) {
      nearest = hit
      vertical = y
      horizontal = x
    }
  }
  return nearest
}

/** Source positions are supplied by the math renderer, before SVG transforms. */
export function mathPositionAtPoint(
  root: HTMLElement,
  value: string,
  event: MouseEvent,
): number | undefined {
  if (root.getAttribute('aria-label') !== value || !(event.target instanceof Element)) return
  if (!root.querySelector('svg')) return literalPositionAtPoint(root, value, event)
  const hit = tokenAtPoint(root, value.length, event)
  if (!hit) return
  const { token, from, to } = hit
  let start = from,
    end = to,
    box = hit.box
  const text = value.slice(from, to)
  // Literal multi-digit numbers/text may share one MathML node. SVG paths retain
  // each glyph's actual width, so proportional fonts and zoom need no estimates.
  if (!/[\\{}_^]/.test(text)) {
    const glyphs = token.querySelectorAll('path, use, text')
    const characters = Array.from(text)
    if (glyphs.length === characters.length) {
      let at = from,
        nearest = Infinity
      for (let index = 0; index < characters.length; index++) {
        const character = characters[index]
        const glyph = glyphs[index]
        if (!character || !glyph) continue
        const bounds = glyph.getBoundingClientRect()
        const distance = Math.max(bounds.left - event.clientX, event.clientX - bounds.right, 0)
        if (distance < nearest) {
          nearest = distance
          start = at
          end = at + character.length
          box = bounds
        }
        at += character.length
      }
    }
  }
  return event.clientX < (box.left + box.right) / 2 ? start : end
}

import { literalPositionAtPoint } from './live-source-position'
