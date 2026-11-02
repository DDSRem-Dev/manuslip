import type { Definition, FootnoteDefinition, Nodes, Root } from 'mdast'
import { defaultHandlers, type Handlers } from 'mdast-util-to-hast'
import type { MarkdownFragment } from '../../core/src/markdown-fragment'
import type { PackedCapture } from '../../core/src/packing-capture'
import { readPackedNative } from '../../core/src/packing-native'
import type { PackedPath } from '../../core/src/packing-view'
import type { SemanticDependencies } from '../../core/src/semantic-dependencies'

export interface ProjectionLimits {
  retained: number
  staging: number
  nodes: number
  depth: number
}

/** Public renderer state/handlers preserve global first-definition and footnote semantics. */
export function fragmentProjectionContext(
  capture: PackedCapture,
  root: PackedPath,
  index: SemanticDependencies,
  fragment: MarkdownFragment,
  limits: ProjectionLimits,
) {
  const definitions = new Map<string, Definition>()
  const footnotes = new Map<string, FootnoteDefinition>()
  const blocks = new Map<number, Nodes>()
  const contextNodes: (Definition | FootnoteDefinition)[] = []
  let retainedBytes = 2048
  let nodes = 0
  let stagingBytes = 2048
  const charge = (bytes: number) => {
    if (retainedBytes + bytes > limits.retained)
      throw new Error('Projection context exceeds retained limit')
    retainedBytes += bytes
  }
  const stage = (bytes: number) => {
    stagingBytes = Math.max(stagingBytes, bytes)
    if (stagingBytes > limits.staging) throw new Error('Projection context exceeds staging limit')
  }
  charge(0)
  for (const definition of index.definitions) {
    if (!definition.selected) continue
    charge(256 + definition.key.length * 4)
    const local =
      definition.block >= fragment.start && definition.block < fragment.start + fragment.remove
    let candidates: readonly Nodes[]
    if (local) candidates = fragment.children
    else {
      let block = blocks.get(definition.block)
      if (!block) {
        const copy = readPackedNative(
          capture.reader,
          [...root, 'children', definition.block],
          { ...limits, retained: limits.retained - retainedBytes, nodes: limits.nodes - nodes },
          definition.block >= fragment.start + fragment.remove ? fragment.suffixOffset : 0,
        )
        charge(copy.retainedBytes)
        stage(copy.stagingBytes)
        nodes += copy.nodes
        block = copy.value as Nodes
        blocks.set(definition.block, block)
      }
      candidates = [block]
    }
    const pending: Nodes[] = [...candidates].reverse()
    let found: Definition | FootnoteDefinition | undefined
    while (pending.length) {
      stage(2048 + pending.length * 128)
      if (++nodes > limits.nodes) throw new Error('Projection context node limit')
      const node = pending.pop()
      if (!node) break
      if (
        (node.type === 'definition' || node.type === 'footnoteDefinition') &&
        (node.type === 'definition' ? 'link' : 'footnote') === definition.kind &&
        node.identifier.toUpperCase() === definition.key
      ) {
        // Definitions remain in source order; choose the selected global occurrence by range.
        const expected =
          definition.from +
          (definition.block >= fragment.start + fragment.remove ? fragment.suffixOffset : 0)
        if (local || node.position?.start.offset === expected) {
          found = node
          break
        }
      }
      if ('children' in node)
        for (let cursor = node.children.length - 1; cursor >= 0; cursor--) {
          const child = node.children[cursor]
          if (child) pending.push(child)
        }
    }
    if (!found) throw new Error('Projection definition context mismatch; full rendering required')
    if (found.type === 'definition') definitions.set(definition.key, found)
    else footnotes.set(definition.key, found)
    if (!local) contextNodes.push(found)
  }
  const order: string[] = []
  const prefix = new Map<string, number>()
  const body = new Map<string, number>()
  for (const definition of index.footnoteOrder) {
    const value = index.definitions.at(definition)
    if (!value) throw new Error('Missing footnote projection context')
    charge(192 + value.key.length * 2)
    order.push(value.key)
  }
  for (const call of index.calls) {
    const reference = index.references.at(call.reference)
    if (!reference) throw new Error('Missing projection reference')
    if (reference.host === null) {
      body.set(reference.key, call.occurrence)
      if (reference.block < fragment.start) prefix.set(reference.key, call.occurrence)
    }
  }
  const handlers: Handlers = {
    root(state, node: Root) {
      state.definitionById.clear()
      state.footnoteById.clear()
      for (const [key, value] of definitions) state.definitionById.set(key, value)
      for (const [key, value] of footnotes) state.footnoteById.set(key, value)
      state.footnoteOrder.push(...order)
      for (const key of order) state.footnoteCounts.set(key, prefix.get(key) ?? 0)
      const result = defaultHandlers.root(state, node)
      // The footer follows the complete body's calls, including ones outside this fragment.
      for (const key of order) state.footnoteCounts.set(key, body.get(key) ?? 0)
      return result.children.map((child) => {
        if (child.type === 'doctype') throw new Error('Unsupported local projection node')
        return child
      })
    },
  }
  return { handlers, contextNodes, retainedBytes, stagingBytes }
}
