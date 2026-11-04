export interface DiagramSourceRange {
  from: number
  to: number
}

/** Literal SVG labels can be mapped without retaining Mermaid's parser or SVG
 * IDs. Ambiguous labels stay unmapped unless their authored node ID resolves
 * them. The index lives for one bounded render in the isolated diagram worker.
 */
export function diagramSourceLocator(source: string) {
  const comments = new Uint8Array(source.length)
  const literals = new Uint8Array(source.length)
  let quote = ''
  let depth = 0
  for (let at = 0; at < source.length; at++) {
    const character = source[at]
    if (quote || depth) literals[at] = 1
    if (character === '\\' && quote) {
      at++
    } else if (quote) {
      if (character === quote) quote = ''
    } else if (character === '"' || character === '`') {
      quote = character
    } else if (source.startsWith('%%', at)) {
      const end = source.indexOf('\n', at)
      comments.fill(1, at, end < 0 ? source.length : end)
      at = end < 0 ? source.length : end
    } else if (character && '[({'.includes(character)) {
      depth++
    } else if (character && '])}'.includes(character)) {
      depth = Math.max(0, depth - 1)
    }
  }
  const word = /[\p{L}\p{N}_]/u
  const words = new Map<string, number[]>()
  for (const match of source.matchAll(/[\p{L}\p{N}_]+/gu)) {
    if (comments[match.index]) continue
    const positions = words.get(match[0])
    if (positions) positions.push(match.index)
    else words.set(match[0], [match.index])
  }
  const cache = new Map<string, number[]>()
  const header =
    /^\s*(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b[\t ]*;?/.exec(source)?.[0].length ?? 0
  let budget = Math.max(4096, source.length * 64)
  return (label: string, id?: string): DiagramSourceRange | undefined => {
    if (!label || label.length > 4096 || !label.trim()) return
    let positions = cache.get(label)
    if (!positions) {
      positions = []
      let anchor: number[] | undefined,
        offset = 0
      // Start with the rarest whole word. Numbered/repeated node labels then
      // need a handful of literal checks rather than one full source scan each.
      for (const match of label.matchAll(/[\p{L}\p{N}_]+/gu)) {
        const occurrences = words.get(match[0]) ?? []
        if (!anchor || occurrences.length < anchor.length) {
          anchor = occurrences
          offset = match.index
        }
      }
      if (!anchor) {
        budget -= source.length
        if (budget < 0) return
        anchor = []
        for (let at = source.indexOf(label); at >= 0; at = source.indexOf(label, at + 1))
          anchor.push(at)
      }
      for (const at of anchor) {
        budget -= label.length
        if (budget < 0) return
        const found = at - offset
        if (found < 0 || !source.startsWith(label, found)) continue
        if (
          comments[found] ||
          comments[found + label.length - 1] ||
          (word.test(label[0] ?? '') && word.test(source[found - 1] ?? '')) ||
          (word.test(label.at(-1) ?? '') && word.test(source[found + label.length] ?? ''))
        )
          continue
        positions.push(found)
      }
      cache.set(label, positions)
    }
    let candidates = positions
    if (id === label) candidates = positions.filter((at) => !literals[at] && at >= header)
    if (id && id !== label) {
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const declaration = new RegExp(
        `(?:^|[^\\p{L}\\p{N}_])${escaped}[\\t ]*[\\[({]+[\\t "\x60]*$`,
        'u',
      )
      const declared = positions.filter((at) =>
        declaration.test(source.slice(Math.max(0, at - id.length - 32), at)),
      )
      if (declared.length) candidates = declared
    }
    // A node without an explicit label is editable at its first reference.
    const from = candidates.length === 1 || id === label ? candidates[0] : undefined
    if (from !== undefined) return { from, to: from + label.length }
  }
}
