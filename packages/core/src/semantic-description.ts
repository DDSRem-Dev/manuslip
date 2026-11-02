import type { Nodes } from 'mdast'
import { type Heading, type SemanticBlock, sourceHash } from './contracts'

const blockKinds = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'list',
  'listItem',
  'code',
  'math',
  'table',
  'thematicBreak',
  'html',
  'yaml',
  'toml',
  'definition',
  'footnoteDefinition',
  'footnoteReference',
  'inlineMath',
  'image',
  'imageReference',
  'link',
  'linkReference',
  'subscript',
  'superscript',
  'emoji',
  'defList',
  'defListTerm',
  'defListDescription',
])
export function describesBlock(type: string): boolean {
  return blockKinds.has(type)
}

export function plainText(node: Nodes): string {
  if ('children' in node) return node.children.map((child) => plainText(child)).join('')
  if ('value' in node) return node.value
  if (node.type === 'image' || node.type === 'imageReference') return node.alt || ''
  return ''
}

export function describeBlock(node: Nodes, source: string): SemanticBlock | undefined {
  const from = node.position?.start.offset
  const to = node.position?.end.offset
  if (from === undefined || to === undefined || !blockKinds.has(node.type)) return undefined
  return {
    kind: node.type,
    from,
    to,
    hash: sourceHash(source.slice(from, to)),
    lines: (node.position?.end.line || 1) - (node.position?.start.line || 1) + 1,
  }
}

export function describeHeading(node: Nodes): Heading | undefined {
  const from = node.position?.start.offset
  const to = node.position?.end.offset
  return node.type === 'heading' && from !== undefined && to !== undefined
    ? { from, to, depth: node.depth, text: plainText(node) }
    : undefined
}
