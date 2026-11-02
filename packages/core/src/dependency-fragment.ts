import type { Nodes } from 'mdast'
import type { MarkdownFragment } from './markdown-fragment'
import type {
  DependencyBlock,
  DependencyDefinition,
  DependencyLimits,
  DependencyReference,
} from './semantic-dependencies'

/** Read only the independently frozen, provenance-checked replacement tree. */
export function collectDependencyFragment(
  patch: MarkdownFragment,
  beforeDefinitions: readonly DependencyDefinition[],
  beforeReferences: readonly DependencyReference[],
  definitionStart: number,
  limits: DependencyLimits,
) {
  const blocks: DependencyBlock[] = []
  const definitions: DependencyDefinition[] = []
  const references: DependencyReference[] = []
  let retained = 0
  let staging = 1024
  let nodes = 0
  let maxDepth = 0
  const charge = (bytes: number) => {
    if (retained + bytes > limits.retained)
      throw new Error('Semantic dependencies exceed retained limit')
    retained += bytes
  }
  const workspace = (bytes: number) => {
    staging = Math.max(staging, bytes)
    if (staging > limits.staging) throw new Error('Semantic dependencies exceed staging limit')
  }
  for (const [index, child] of patch.children.entries()) {
    const block = patch.start + index
    const pending: { node: Nodes; host: number | null; depth: number }[] = [
      { node: child, host: null, depth: 1 },
    ]
    let count = 0
    while (pending.length) {
      workspace(1024 + pending.length * 128)
      const item = pending.pop()
      if (!item) throw new Error('Missing semantic dependency fragment node')
      const { node, depth } = item
      let { host } = item
      maxDepth = Math.max(maxDepth, depth)
      if (++nodes > limits.nodes) throw new Error('Semantic dependency node limit')
      if (depth > limits.depth) throw new Error('Semantic dependency depth limit')
      count++
      const from = node.position?.start.offset
      const to = node.position?.end.offset
      if (from === undefined || to === undefined)
        throw new Error('Missing fragment dependency range')
      if (node.type === 'definition' || node.type === 'footnoteDefinition') {
        const previous = beforeDefinitions[definitions.length]
        const kind = node.type === 'definition' ? 'link' : 'footnote'
        charge(384 + node.identifier.length * 6)
        workspace(1536 + pending.length * 128 + node.identifier.length * 8)
        const key = node.identifier.toUpperCase()
        if (!previous || previous.kind !== kind || previous.key !== key)
          throw new Error('Changed fragment definition context; full parse required')
        if (kind === 'footnote') host = definitionStart + definitions.length
        definitions.push(Object.freeze({ from, to, kind, key, block, selected: previous.selected }))
      } else if (
        node.type === 'linkReference' ||
        node.type === 'imageReference' ||
        node.type === 'footnoteReference'
      ) {
        const previous = beforeReferences[references.length]
        const kind =
          node.type === 'footnoteReference'
            ? 'footnote'
            : node.type === 'imageReference'
              ? 'image'
              : 'link'
        charge(224 + node.identifier.length * 6)
        workspace(1536 + pending.length * 128 + node.identifier.length * 8)
        const key = node.identifier.toUpperCase()
        if (!previous || previous.kind !== kind || previous.key !== key || previous.host !== host)
          throw new Error('Changed fragment reference context; full parse required')
        references.push(
          Object.freeze({ from, to, kind, key, block, host, definition: previous.definition }),
        )
      }
      if ('children' in node) {
        workspace(1024 + (pending.length + node.children.length) * 128)
        for (let index = node.children.length - 1; index >= 0; index--) {
          const child = node.children[index]
          if (child) pending.push({ node: child, host, depth: depth + 1 })
        }
      }
    }
    const from = child.position?.start.offset
    const to = child.position?.end.offset
    if (from === undefined || to === undefined) throw new Error('Missing fragment block range')
    let brackets = false
    for (let offset = from; offset < to; offset++)
      if (patch.source.text.charCodeAt(offset) === 91) {
        brackets = true
        break
      }
    charge(192 + child.type.length * 2)
    blocks.push(Object.freeze({ from, to, type: child.type, brackets, nodes: count }))
  }
  if (
    definitions.length !== beforeDefinitions.length ||
    references.length !== beforeReferences.length
  )
    throw new Error('Changed fragment dependency context; full parse required')
  return {
    blocks: Object.freeze(blocks),
    definitions: Object.freeze(definitions),
    references: Object.freeze(references),
    retained,
    staging,
    nodes,
    depth: maxDepth,
  }
}
