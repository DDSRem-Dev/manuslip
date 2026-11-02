import type { Nodes } from '@manuslip/core'
import {
  extractionVersion,
  type TokenBinding,
  type TokenRole,
  TranslationError,
  type TranslationPayload,
  type TranslationToken,
  translationLimits,
  type UnitKind,
} from './contracts'
import type { ExtractionMemory } from './extraction-memory'

const containers = new Set([
  'emphasis',
  'strong',
  'delete',
  'link',
  'linkReference',
  'subscript',
  'superscript',
])
const protectedRoles = new Map<string, TokenRole>([
  ['inlineCode', 'code'],
  ['inlineMath', 'math'],
  ['image', 'image'],
  ['imageReference', 'image'],
  ['html', 'html'],
  ['footnoteReference', 'reference'],
  ['break', 'break'],
  ['emoji', 'emoji'],
])
const marker = (id: string): string => `⟪${id}⟫`
// URI-looking prose and literal marker delimiters are local bindings, never provider text.
const protectedText = /[a-z][a-z0-9+.-]{0,31}:[^\s<>⟪⟫]+|www\.[^\s<>⟪⟫]+|⟪[^⟪⟫]*⟫|[⟪⟫]/gi

export function projectTranslationUnit(
  node: Nodes,
  kind: UnitKind,
  source: string,
  baseDepth: number,
  memory?: ExtractionMemory,
): { payload: TranslationPayload; bindings: TokenBinding[]; prose: boolean; large: boolean } {
  const tokens: TranslationToken[] = []
  const bindings: TokenBinding[] = []
  const parts: string[] = []
  let prose = false
  let large = false
  let parent: string | null = null
  let textLength = 0
  const append = (value: string): void => {
    textLength += value.length
    if (textLength > translationLimits.payload) {
      large = true
      parts.length = 0
    }
    if (!large) parts.push(value)
  }
  const token = (
    type: TranslationToken['type'],
    role: TokenRole,
    value: Nodes | Nodes[] | null,
    pair: string | null = null,
  ): string => {
    if (tokens.length >= translationLimits.tokens) throw new TranslationError('translation-limit')
    const id = `M${tokens.length}`
    const description = { id, type, role, parent, pair }
    tokens.push(description)
    bindings.push({ token: description, node: value })
    append(marker(id))
    return id
  }
  const text = (value: string): void => {
    let start = 0
    for (const match of value.matchAll(protectedText)) {
      const before = value.slice(start, match.index)
      append(before)
      prose ||= /\S/.test(before)
      memory?.charge(160 + match[0].length * 2)
      const literal: Nodes = { type: 'text', value: match[0] }
      token('atom', 'literal', memory?.compactBindings ? Object.freeze(literal) : literal)
      start = match.index + match[0].length
    }
    const tail = value.slice(start)
    append(tail)
    prose ||= /\S/.test(tail)
  }
  const visit = (child: Nodes, depth: number): void => {
    if (depth > translationLimits.depth) throw new TranslationError('translation-limit')
    if (child.type === 'text') {
      text(child.value)
      return
    }
    const from = child.position?.start.offset || 0,
      to = child.position?.end.offset || 0
    const bracket = to > from && source.charAt(from) === '['
    // CommonMark/GFM automatic links expose their destination as their visible label.
    if (child.type === 'link' && !bracket) {
      token('atom', 'link', child)
      return
    }
    if (containers.has(child.type) && 'children' in child) {
      const role = child.type === 'linkReference' ? 'link' : (child.type as TokenRole)
      const outer = parent
      const id = token('open', role, child)
      parent = id
      children(child.children, depth + 1)
      token('close', role, null, id)
      parent = outer
      return
    }
    token('atom', protectedRoles.get(child.type) || 'protected', child)
  }
  const children = (items: readonly Nodes[], depth: number): void => {
    for (let index = 0; index < items.length; index++) {
      const child = items[index]
      if (!child) continue
      const open =
        child.type === 'html' ? /^<([a-z][a-z0-9-]*)(?:\s[^<>]*?)?\s*>$/i.exec(child.value) : null
      const tag = open?.[1]?.toLowerCase()
      if (
        tag &&
        ![
          'area',
          'base',
          'br',
          'col',
          'embed',
          'hr',
          'img',
          'input',
          'link',
          'meta',
          'param',
          'source',
          'track',
          'wbr',
        ].includes(tag)
      ) {
        let balance = 1
        let end = index + 1
        for (; end < items.length; end++) {
          const inner = items[end]
          if (inner?.type !== 'html') continue
          if (new RegExp(`^<${tag}(?:\\s[^<>]*?)?\\s*>$`, 'i').test(inner.value)) balance++
          if (new RegExp(`^</${tag}\\s*>$`, 'i').test(inner.value) && --balance === 0) break
        }
        memory?.charge(64 + (Math.min(end + 1, items.length) - index) * 8)
        token('atom', 'html', items.slice(index, end + 1))
        index = end
      } else visit(child, depth)
    }
  }
  if ('children' in node) children(node.children, baseDepth + 1)
  return {
    payload: { schema: extractionVersion, kind, text: parts.join(''), tokens },
    bindings,
    prose,
    large,
  }
}
