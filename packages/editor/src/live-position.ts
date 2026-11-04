import type { SyntaxNode } from '@lezer/common'
import { parser as htmlParser } from '@lezer/html'
import { decodeString } from 'micromark-util-decode-string'
import { mathPositionAtPoint } from './live-math-position'
import { editorSyntax } from './syntax'

export interface RenderedTextHit {
  text: string
  offset: number
  side: -1 | 1
  math?: readonly string[]
}

/** Read the browser's text hit before replacing a preview or changing focus. */
export function renderedTextHit(
  root: HTMLElement,
  event: MouseEvent,
  source?: string,
): RenderedTextHit | undefined {
  const document = root.ownerDocument
  const math =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-render-kind="inlineMath"][aria-label]')
      : null
  const caret =
    math && root.contains(math)
      ? undefined
      : document.caretPositionFromPoint?.(event.clientX, event.clientY)
  const range =
    (math && root.contains(math)) || caret
      ? document.createRange()
      : document.caretRangeFromPoint?.(event.clientX, event.clientY)
  if (math && root.contains(math)) range?.setStart(math, 0)
  else if (caret) range?.setStart(caret.offsetNode, caret.offset)
  if (!range || !root.contains(range.startContainer)) return undefined
  const prefix = document.createRange()
  prefix.selectNodeContents(root)
  prefix.setEnd(range.startContainer, range.startOffset)
  const text = root.textContent ?? ''
  const originalOffset = prefix.toString().length
  let offset = originalOffset
  let side: -1 | 1 = range.startOffset === 0 ? 1 : -1
  // Nested previews have authored text that differs from their glyphs. Restore
  // that spelling in the temporary hit, including its effect on following text.
  const replacements = new Set(
    root.querySelectorAll<HTMLElement>(
      '.md-emoji[title], [data-render-kind="inlineMath"][aria-label], br[data-source-break]',
    ),
  )
  if (!replacements.size) return { text, offset, side }
  const parts: string[] = []
  const expressions: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  let at = 0,
    previous = 0,
    shift = 0,
    sourceAt = 0,
    inside: number | undefined
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      at += node.textContent?.length ?? 0
      continue
    }
    if (!(node instanceof HTMLElement) || !replacements.has(node)) continue
    if (node.matches('br[data-source-break]')) {
      parts.push(text.slice(previous, at), '\n')
      const boundary = document.createRange()
      boundary.setStartAfter(node)
      if (range.compareBoundaryPoints(Range.START_TO_START, boundary) >= 0) offset++
      previous = at
      shift++
      continue
    }
    const emoji = node.matches('.md-emoji')
    const value = node.getAttribute('aria-label') ?? ''
    let spelling = emoji ? node.title : `$${value}$`
    if (!emoji && source) {
      let first = Infinity
      for (const candidate of [`$${value}$`, `$$${value}$$`, `\\(${value}\\)`, `\\[${value}\\]`]) {
        const at = source.indexOf(candidate, sourceAt)
        if (at >= 0 && at < first) {
          first = at
          spelling = candidate
        }
      }
      if (first < Infinity) sourceAt = first + spelling.length
    }
    if (!emoji) expressions.push(spelling)
    const length = node.textContent?.length ?? 0
    parts.push(text.slice(previous, at), spelling)
    if (event.target instanceof Node && node.contains(event.target)) {
      inside =
        at +
        shift +
        (emoji ? 1 : spelling.startsWith('$') ? (/^\$+/.exec(spelling)?.[0].length ?? 1) : 2) +
        (node === math
          ? (mathPositionAtPoint(node, node.getAttribute('aria-label') ?? '', event) ?? 0)
          : 0)
      side = 1
    } else if (originalOffset >= at + length) offset += spelling.length - length
    previous = at + length
    shift += spelling.length - length
    at += length
    // Skip this projection's descendants. Each text node is visited once even
    // when a paragraph contains many emoji or equations.
    while (node.lastChild) node = node.lastChild
    walker.currentNode = node
  }
  parts.push(text.slice(previous))
  return { text: parts.join(''), offset: inside ?? offset, side, math: expressions }
}

const hiddenSyntax = new Set([
  'EmphasisMark',
  'StrikethroughMark',
  'HeaderMark',
  'QuoteMark',
  'ListMark',
  'TaskMarker',
  'CodeMark',
  'CodeInfo',
  'HTMLTag',
  'LinkReference',
])

const hiddenHtmlContents = new Set([
  'head',
  'iframe',
  'noembed',
  'noframes',
  'noscript',
  'plaintext',
  'script',
  'style',
  'template',
  'title',
  'xmp',
])

export const maxPositionUnits = 65_536

/** Build an ephemeral map for just the clicked cell/block, never the document.
 * Keep both sides of a boundary: the end of <strong> belongs before its closing
 * markers, while the following text starts after those markers.
 */
export function sourcePositionAtText(
  source: string,
  hit: RenderedTextHit,
  kind?: 'table' | 'defList',
): number | undefined {
  if (source.length > maxPositionUnits || hit.text.length > maxPositionUnits) return undefined
  if (source === hit.text) return Math.max(0, Math.min(source.length, hit.offset))
  const tableCell = kind === 'table'
  const prefix = tableCell ? 2 : 0
  // A cell has inline Markdown, even when it begins with a heading/list marker.
  if (tableCell) source = `x ${source}`
  // TeX has its own escapes, brackets and underscores. A rendered equation is
  // already a verified semantic projection; Markdown must not reinterpret its
  // authored spelling as emphasis, links or character escapes during hit mapping.
  const math: { from: number; to: number }[] = []
  for (const spelling of new Set(hit.math)) {
    if (!spelling) continue
    for (
      let at = source.indexOf(spelling);
      at >= 0;
      at = source.indexOf(spelling, at + spelling.length)
    ) {
      let slashes = 0
      while (source[at - slashes - 1] === '\\') slashes++
      if (!(slashes % 2)) math.push({ from: at, to: at + spelling.length })
    }
  }
  math.sort((a, b) => a.from - b.from)
  const inMath = (from: number, to: number): boolean => {
    let low = 0,
      high = math.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if ((math[middle]?.from ?? Infinity) <= from) low = middle + 1
      else high = middle
    }
    const expression = math[low - 1]
    return Boolean(expression && from >= expression.from && to <= expression.to)
  }
  const characters: string[] = []
  const starts: number[] = []
  const ends: number[] = []
  let depth = 0,
    tooDeep = false
  const append = (text: string, from: number, to: number, literal = false): void => {
    for (let at = 0; at < text.length; at++) {
      const start = (literal ? from + at : from) - prefix
      const end = (literal ? from + at + 1 : to) - prefix
      characters.push(text[at] ?? '')
      starts.push(start)
      ends.push(end)
    }
  }
  const raw = (from: number, to: number): void => {
    if (kind === 'defList') {
      let start = from
      for (let at = from; at < to; at++) {
        if (source[at] !== ':' || (at > 0 && source[at - 1] !== '\n')) continue
        const marker = /^:[\t ]+/.exec(source.slice(at, to))
        if (!marker) continue
        append(source.slice(start, at), start, at, true)
        start = at + marker[0].length
        at = start - 1
      }
      from = start
    }
    append(source.slice(from, to), from, to, true)
  }
  const visit = (node: SyntaxNode): void => {
    if (inMath(node.from, node.to)) {
      raw(node.from, node.to)
      return
    }
    if (hiddenSyntax.has(node.name) || node.name === 'Image') return
    if (node.name === 'HTMLBlock') {
      const html = source.slice(node.from, node.to)
      // HTML blocks are literal HTML, not Markdown. Parse text leaves with
      // authored offsets so tags, comments and repeated attributes cannot become
      // caret destinations. Nothing is inserted into the DOM or executed.
      htmlParser.parse(html).iterate({
        enter(child) {
          if (child.name === 'Element') {
            const name = child.node.getChild('OpenTag')?.getChild('TagName')
            if (name && hiddenHtmlContents.has(html.slice(name.from, name.to).toLowerCase()))
              return false
          }
          const from = node.from + child.from,
            to = node.from + child.to
          if (child.name === 'Text') {
            let start = from
            for (let at = from; at < to; at++) {
              if (source[at] !== '\r') continue
              raw(start, at)
              const end = at + (source[at + 1] === '\n' ? 2 : 1)
              append('\n', at, end)
              start = end
              at = end - 1
            }
            raw(start, to)
          } else if (child.name === 'EntityReference' || child.name === 'CharacterReference')
            append(decodeString(source.slice(from, to)), from, to)
        },
      })
      return
    }
    if (node.name === 'Entity' || node.name === 'Escape') {
      append(decodeString(source.slice(node.from, node.to)), node.from, node.to)
      return
    }
    if (node.name === 'Link') {
      const marks = node.getChildren('LinkMark')
      const opening = marks[0],
        closing = marks[1]
      if (opening && closing) contents(node, opening.to, closing.from)
      return
    }
    if (node.name === 'InlineCode') {
      const marks = node.getChildren('CodeMark')
      let from = marks[0]?.to ?? node.from,
        to = marks.at(-1)?.from ?? node.to
      const text = source.slice(from, to).replace(/\n/g, ' ')
      if (text.startsWith(' ') && text.endsWith(' ') && /[^ ]/.test(text)) {
        from++
        to--
      }
      for (let at = from; at < to; at++) {
        if (tableCell && source[at] === '\\' && source[at + 1] === '|') {
          append('|', at, at + 2)
          at++
        } else if (source[at] === '\n') append(' ', at, at + 1)
        else raw(at, at + 1)
      }
      return
    }
    contents(node, node.from, node.to)
  }
  const contents = (node: SyntaxNode, from: number, to: number): void => {
    if (depth >= 128) {
      tooDeep = true
      return
    }
    depth++
    let at = from
    for (let child = node.firstChild; child && child.from < to; child = child.nextSibling) {
      if (child.to <= from) continue
      raw(at, Math.max(at, child.from))
      visit(child)
      at = child.to
    }
    raw(at, to)
    depth--
  }
  const tree = editorSyntax.language.parser.parse(source).topNode
  if (tableCell) contents(tree.firstChild ?? tree, prefix, source.length)
  else visit(tree)
  if (tooDeep) return undefined
  let offset = Math.max(0, Math.min(hit.text.length, hit.offset))
  if (characters.join('') === hit.text)
    return hit.side < 0 && offset > 0 ? ends[offset - 1] : (starts[offset] ?? ends.at(-1))
  // DOM text preserves authored whitespace even when HTML collapses it. Prefer
  // that exact match above, including code spaces and non-breaking spaces.
  let length = 0
  for (let at = 0; at < characters.length; at++) {
    const character = /^[\t\n\r\f ]$/.test(characters[at] ?? '') ? ' ' : (characters[at] ?? '')
    if (character === ' ' && length > 0 && characters[length - 1] === ' ') {
      ends[length - 1] = ends[at] ?? 0
    } else {
      characters[length] = character
      starts[length] = starts[at] ?? 0
      ends[length++] = ends[at] ?? 0
    }
  }
  characters.length = starts.length = ends.length = length
  if (characters[0] === ' ') {
    characters.shift()
    starts.shift()
    ends.shift()
  }
  if (characters.at(-1) === ' ') {
    characters.pop()
    starts.pop()
    ends.pop()
  }
  const projected = characters.join('')
  const rendered = hit.text.replace(/[\t\n\r\f ]+/g, ' ').replace(/^ | $/g, '')
  offset = Math.min(
    rendered.length,
    hit.text
      .slice(0, hit.offset)
      .replace(/[\t\n\r\f ]+/g, ' ')
      .replace(/^ /, '').length,
  )
  if (!projected || !rendered) return undefined
  if (projected !== rendered) {
    // Unrepresented extensions may change one part of a block. Only accept an
    // unambiguous local match, rather than guessing among repeated words.
    const from = Math.max(0, offset - 32),
      to = Math.min(rendered.length, offset + 32)
    const context = rendered.slice(from, to)
    const found = projected.indexOf(context)
    if (found < 0 || projected.indexOf(context, found + 1) >= 0) return undefined
    offset = found + offset - from
  }
  return hit.side < 0 && offset > 0 ? ends[offset - 1] : (starts[offset] ?? ends.at(-1))
}
