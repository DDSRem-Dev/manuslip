import type { Nodes, RootContent } from 'mdast'
import type { PackedReadScope } from './packing-capture'
import type { PackedPath } from './packing-view'

export interface FragmentTreeLimits {
  retained: number
  nodes: number
  depth: number
  staging: number
}
export class FragmentLimitError extends Error {}

/** Anchor parser positions and freeze the small independent result; never clone the old root. */
export function anchorFragment(
  children: RootContent[],
  offset: number,
  line: number,
  limits: FragmentTreeLimits,
): number {
  const pending: { value: unknown; depth: number }[] = [{ value: children, depth: 0 }]
  let retained = 0
  let nodes = 0
  while (pending.length) {
    const item = pending.pop()
    if (!item) throw new Error('Missing fragment tree item')
    const { value, depth } = item
    if (++nodes > limits.nodes || depth > limits.depth)
      throw new FragmentLimitError('Fragment tree node/depth limit')
    if (typeof value === 'string') retained += 32 + value.length * 2
    else if (!value || typeof value !== 'object') retained += 16
    else {
      const keys = Object.keys(value)
      retained += 64 + keys.reduce((sum, key) => sum + 48 + key.length * 2, 0)
      if (!Array.isArray(value) && 'position' in value) {
        const position = (value as Nodes).position
        if (position) {
          for (const point of [position.start, position.end]) {
            if (point.offset === undefined) throw new Error('Missing fragment offset')
            point.offset += offset
            point.line += line - 1
          }
        }
      }
      for (const key of keys) pending.push({ value: Reflect.get(value, key), depth: depth + 1 })
      if (1024 + pending.length * 64 > limits.staging)
        throw new FragmentLimitError('Fragment tree staging limit')
      Object.freeze(value)
    }
    if (retained > limits.retained) throw new FragmentLimitError('Fragment tree retained limit')
  }
  return retained
}

/** Compare the complete selected subtree, including every extension property and position. */
export function sameFragment(
  reader: PackedReadScope,
  path: PackedPath,
  expected: unknown,
  limits: FragmentTreeLimits,
): boolean {
  const kind = reader.kind(path)
  if (kind === 'scalar')
    return Object.is(
      reader.scalar(path, { retained: limits.staging, staging: limits.staging }),
      expected,
    )
  if (!expected || typeof expected !== 'object') return false
  if (kind === 'position') {
    const actual = reader.position(path, { retained: 512, staging: 0 })
    return JSON.stringify(actual) === JSON.stringify(expected)
  }
  if (kind === 'array') {
    if (!Array.isArray(expected) || reader.length(path) !== expected.length) return false
    let index = 0
    for (const child of reader.elements(path))
      if (!sameFragment(child, [], expected[index++], limits)) return false
    return true
  }
  if (Array.isArray(expected)) return false
  const keys = reader.keys(path, { retained: 8192, staging: 0 })
  const expectedKeys = Object.keys(expected)
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index]))
    return false
  return keys.every((key) =>
    sameFragment(reader, [...path, key], Reflect.get(expected, key), limits),
  )
}

export function containsText(children: readonly RootContent[], from: number, to: number): boolean {
  const pending: Nodes[] = [...children]
  while (pending.length) {
    const node = pending.pop()
    if (!node) break
    if (
      node.type === 'text' &&
      (node.position?.start.offset ?? Infinity) <= from &&
      (node.position?.end.offset ?? -1) >= to
    )
      return true
    if ('children' in node) pending.push(...node.children)
  }
  return false
}

/** Complete dependency spelling/order inside the slice must survive a prose-only edit. */
export function fragmentContext(children: readonly RootContent[], source: string): string {
  const records: unknown[] = []
  const pending: Nodes[] = [...children].reverse()
  while (pending.length) {
    const node = pending.pop()
    if (!node) break
    if (node.type === 'definition' || node.type === 'footnoteDefinition')
      records.push([
        node.type,
        node.identifier,
        source.slice(node.position?.start.offset, node.position?.end.offset),
      ])
    else if (
      node.type === 'linkReference' ||
      node.type === 'imageReference' ||
      node.type === 'footnoteReference'
    )
      records.push([
        node.type,
        node.identifier,
        'referenceType' in node ? node.referenceType : null,
      ])
    if ('children' in node)
      for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index]
        if (child) pending.push(child)
      }
  }
  return JSON.stringify(records)
}
