import type { MmlNode } from '@mathjax/src/js/core/MmlTree/MmlNode.js'

interface Token {
  text: string
  from: number
  to: number
}

function argumentEnd(source: string, at: number): number | undefined {
  while (/\s/.test(source[at] ?? '')) at++
  if (source[at] !== '{') return
  let depth = 0
  for (; at < source.length; at++) {
    if (source[at] === '\\') at++
    else if (source[at] === '{') depth++
    else if (source[at] === '}' && !--depth) return at + 1
  }
}

function tokens(source: string): Token[] {
  const result: Token[] = []
  for (let at = 0; at < source.length; ) {
    const from = at
    const character = source[at]
    if (character === '%') {
      const end = source.indexOf('\n', at)
      at = end < 0 ? source.length : end + 1
      continue
    }
    if (/\s/.test(character ?? '')) {
      at++
      continue
    }
    if (character === '\\') {
      at++
      if (/[a-zA-Z]/.test(source[at] ?? '')) while (/[a-zA-Z]/.test(source[at] ?? '')) at++
      else if (at < source.length) at += (source.codePointAt(at) ?? 0) > 0xffff ? 2 : 1
      const command = source.slice(from, at)
      // Environment names, column specifications and color/label arguments are
      // not visible symbols. Keep them opaque to child-token matching.
      if (/^\\(?:begin|end|color|textcolor|label|definecolor)$/.test(command)) {
        const option = /^\s*\[[^\]]*\]/.exec(source.slice(at))
        if (option) at += option[0].length
        const start = at
        at = argumentEnd(source, at) ?? at
        const array =
          command === '\\begin' &&
          /^\s*\{(?:array|alignedat|alignat|alignat\*)\}$/.test(source.slice(start, at))
        if (array) {
          const align = /^\s*\[[^\]]*\]/.exec(source.slice(at))
          if (align) at += align[0].length
          at = argumentEnd(source, at) ?? at
        }
        if (command === '\\definecolor') {
          at = argumentEnd(source, at) ?? at
          at = argumentEnd(source, at) ?? at
        }
      }
    } else at += (source.codePointAt(at) ?? 0) > 0xffff ? 2 : 1
    result.push({ text: source.slice(from, at), from, to: at })
  }
  return result
}

/** Attach authored UTF-16 ranges before SVG layout changes the order of scripts.
 * Match complete TeX tokens within the containing expression, consuming siblings
 * in source order. Generated or expanded TeX that cannot be verified stays unmapped.
 * This work runs once in the math worker, never on pointer movement or keystrokes.
 */
export function markMathSource(root: MmlNode, source: string): void {
  const authored = tokens(source)
  // Expanded user macros can repeat/reorder their arguments. MathJax's snippets
  // describe the expansion, so they cannot establish an authored caret position.
  if (
    authored.some((token) =>
      /^\\(?:[egx]?def|(?:re)?newcommand|providecommand|(?:re)?newenvironment|let|Declare[A-Za-z]+)$/.test(
        token.text,
      ),
    )
  )
    return
  let remaining = 8192
  let work = Math.max(4096, source.length * 64)
  const match = (text: string, from: number, to: number): [number, number] | undefined => {
    work -= text.length
    if (work <= 0) return
    const needle = tokens(text)
    if (!needle.length) return
    for (let at = from; at + needle.length <= to; at++) {
      if (needle.every((token, index) => --work > 0 && token.text === authored[at + index]?.text))
        return [at, at + needle.length]
      if (work <= 0) return
    }
  }
  const mark = (node: MmlNode, from: number, to: number, depth: number): number => {
    if (--remaining < 0 || depth > 128 || node.kind === 'text') return from
    // Table row snippets may contain only the newline or the column preamble.
    // They describe layout rather than the row's authored expression.
    const latex = /^(?:mtr|mlabeledtr|mtd)$/.test(node.kind)
      ? undefined
      : node.attributes?.get('data-latex')
    const range =
      node === root ? [from, to] : typeof latex === 'string' ? match(latex, from, to) : undefined
    if (typeof latex === 'string' && !range) return from
    let start = range?.[0] ?? from
    const end = range?.[1] ?? to
    if (range && node !== root && start < end) {
      const first = authored[start],
        last = authored[end - 1]
      if (first && last) {
        node.attributes.set('data-source-from', first.from)
        node.attributes.set('data-source-to', last.to)
      }
    }
    const children = node.childNodes
    if (range && /^(?:msub|msup|msubsup|munder|mover|munderover)$/.test(node.kind)) {
      // MathML always stores subscript before superscript; TeX accepts either order.
      // Resolve their domains explicitly, including identical bases and scripts.
      let level = 0
      const scripts: { at: number; kind: string }[] = []
      for (let at = start; at < end; at++) {
        const text = authored[at]?.text
        if (text === '{') level++
        else if (text === '}') level--
        else if (!level && (text === '_' || text === '^')) scripts.push({ at, kind: text })
      }
      if (scripts.length) {
        if (children[0]) mark(children[0], start, scripts[0]?.at ?? end, depth + 1)
        for (let index = 0; index < scripts.length; index++) {
          const script = scripts[index]
          if (!script) continue
          const child =
            children[
              node.kind === 'msubsup' || node.kind === 'munderover'
                ? script.kind === '_'
                  ? 1
                  : 2
                : 1
            ]
          if (child) mark(child, script.at + 1, scripts[index + 1]?.at ?? end, depth + 1)
        }
        return end
      }
    }
    // A root's optional degree precedes its radicand in TeX, but follows it in MathML.
    if (range && node.kind === 'mroot' && children.length === 2) {
      const degree = children[1]
      if (degree) start = mark(degree, start, end, depth + 1)
      if (children[0]) mark(children[0], start, end, depth + 1)
    } else for (const child of children) start = mark(child, start, end, depth + 1)
    return range ? end : start
  }
  mark(root, 0, authored.length, 0)
}
