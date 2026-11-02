import type { RootContent } from 'mdast'
import type { Position } from 'unist'
import { parserVersion, semanticLimits } from './contracts'
import { rememberFragment } from './fragment-proof'
import {
  anchorFragment,
  containsText,
  FragmentLimitError,
  fragmentContext,
  sameFragment,
} from './fragment-tree'
import type { PackedCapture } from './packing-capture'
import type { PackedResource } from './packing-resources'
import { identityKeys, type PackedIdentity, PackedSource } from './packing-source'
import type { PackedPath } from './packing-view'
import { needsGfm, parseMarkdownWithGrammar } from './parse'
import type { SemanticDependencies } from './semantic-dependencies'

export interface FragmentChange {
  from: number
  to: number
  insert: string
}
export interface FragmentLimits {
  bytes: number
  retained: number
  staging: number
  nodes: number
  depth: number
}
export interface FragmentRequest {
  capture: PackedCapture
  dependencies: SemanticDependencies
  baseSource: string
  source: PackedSource
  change: FragmentChange
  root: PackedPath
  syntax: 'manuslip' | 'commonmark'
}
export interface MarkdownFragment {
  readonly kind: 'fragment'
  readonly base: PackedIdentity
  readonly baseSource: string
  readonly source: PackedSource
  readonly start: number
  readonly remove: number
  readonly children: readonly RootContent[]
  /** All later top-level nodes keep their lines/columns and shift every offset by this amount. */
  readonly suffixOffset: number
  readonly position: Position
  readonly retainedBytes: number
  readonly stagingBytes: number
  readonly inputBytesUpperBound: number
  resources(): Generator<PackedResource>
}
export type FragmentResult =
  | MarkdownFragment
  | {
      readonly kind: 'full'
      readonly reason: 'grammar' | 'boundary' | 'syntax' | 'dependency' | 'context' | 'limit'
    }
const supported = new Set(['paragraph', 'heading', 'blockquote', 'list'])
const marker = 'ManuslipFragmentBoundary'
const full = (reason: Extract<FragmentResult, { kind: 'full' }>['reason']): FragmentResult =>
  Object.freeze({ kind: 'full', reason })
function fragmentResources(base: PackedSource, result: PackedSource) {
  // A separate closure factory avoids retaining the dependency index or request/capture.
  return function* (this: MarkdownFragment): Generator<PackedResource> {
    yield { key: base, bytes: base.retainedBytes }
    yield { key: result, bytes: result.retainedBytes }
    yield {
      key: this,
      bytes: this.retainedBytes - result.retainedBytes - base.text.length * 2,
    }
  }
}

function lineStart(source: string, offset: number): number {
  while (offset > 0 && source[offset - 1] !== '\n' && source[offset - 1] !== '\r') offset--
  return offset
}
function blankGap(source: string, from: number, to: number): boolean {
  let lines = 0
  for (let index = from; index < to; index++) {
    const char = source[index]
    if (char === '\r') {
      lines++
      if (source[index + 1] === '\n') index++
    } else if (char === '\n') lines++
    else if (char !== ' ' && char !== '\t') return false
  }
  return lines >= 2
}
function splitsPair(source: string, offset: number): boolean {
  const left = source.charCodeAt(offset - 1)
  const right = source.charCodeAt(offset)
  return left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff
}
function matchesChange(before: string, after: string, change: FragmentChange): boolean {
  const { from, to, insert } = change
  if (after.length !== before.length - to + from + insert.length) return false
  for (let index = 0; index < from; index++)
    if (before.charCodeAt(index) !== after.charCodeAt(index)) return false
  for (let index = 0; index < insert.length; index++)
    if (insert.charCodeAt(index) !== after.charCodeAt(from + index)) return false
  for (let index = to; index < before.length; index++)
    if (before.charCodeAt(index) !== after.charCodeAt(index - to + from + insert.length))
      return false
  return true
}
function mainChildren(
  source: string,
  context: string,
  syntax: FragmentRequest['syntax'],
  gfm: boolean,
) {
  const boundary = source.length + 2
  const input = `${source}\n\n${marker}\n\n${context}`
  const root = parseMarkdownWithGrammar(input, syntax, gfm).root
  const sentinel = root.children.find((node) => node.position?.start.offset === boundary)
  if (
    sentinel?.type !== 'paragraph' ||
    sentinel.children.length !== 1 ||
    sentinel.children[0]?.type !== 'text' ||
    sentinel.children[0].value !== marker
  )
    return null
  const children: RootContent[] = []
  for (const node of root.children) {
    const from = node.position?.start.offset
    const to = node.position?.end.offset
    if (from === undefined || to === undefined) return null
    if (from < source.length) {
      if (to > source.length) return null
      children.push(node)
    }
  }
  return children
}

/**
 * Experimental local parser. Returns a bounded block patch plus exact position instructions;
 * unsupported edits explicitly require a full parse. Does not publish a semantic snapshot,
 * update document counts/projections/indexes, or integrate the patch into packed revisions.
 */
export function reparseMarkdownFragment(
  request: FragmentRequest,
  limits: FragmentLimits,
): FragmentResult {
  for (const key of ['bytes', 'retained', 'staging', 'nodes', 'depth'] as const)
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0)
      throw new Error('Invalid Markdown fragment limits')
  if (
    limits.bytes > 64 * 1024 ||
    limits.retained > semanticLimits.workerCacheBytes ||
    limits.staging > semanticLimits.messageBytes ||
    limits.nodes > semanticLimits.blocks * 16 ||
    limits.depth > 64 ||
    request.root.length > 64
  )
    throw new Error('Invalid Markdown fragment limits')
  const { capture, dependencies, baseSource, source, change, root, syntax } = request
  dependencies.assertBase(capture.identity, baseSource)
  if (
    !(source instanceof PackedSource) ||
    source.identity.revision <= capture.identity.revision ||
    identityKeys.some((key) =>
      key === 'revision' || key === 'sourceHash'
        ? false
        : source.identity[key] !== capture.identity[key],
    ) ||
    source.identity.parserVersion !== `${parserVersion}/${syntax}`
  )
    throw new Error('Markdown fragment identity mismatch; full resync required')
  const { from, to, insert } = change
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to < from ||
    to > baseSource.length ||
    typeof insert !== 'string' ||
    !matchesChange(baseSource, source.text, change)
  )
    throw new Error('Markdown fragment source/change mismatch')
  if (syntax !== 'manuslip' && syntax !== 'commonmark') throw new Error('Invalid fragment syntax')
  const gfm = syntax === 'manuslip' && needsGfm(baseSource)
  if (gfm !== (syntax === 'manuslip' && needsGfm(source.text))) return full('grammar')
  if (!dependencies.disjointBlocks || splitsPair(baseSource, from) || splitsPair(baseSource, to))
    return full('boundary')
  if (to - from + insert.length > limits.bytes || (from === to && !insert.length))
    return full('limit')
  if (
    !/^[\p{L}\p{N}\p{M} ]*$/u.test(insert) ||
    !/^[\p{L}\p{N}\p{M} ]*$/u.test(baseSource.slice(from, to))
  )
    return full('syntax')
  const append = from === baseSource.length && from === to
  const index = append
    ? dependencies.blocks.length - 1
    : dependencies.blocks.findIndex((block) => block.from <= from && block.to >= to)
  const block = index < 0 ? undefined : dependencies.blocks.at(index)
  if (
    (!block && !append) ||
    (block &&
      !supported.has(block.type) &&
      !(append && (block.type === 'definition' || block.type === 'footnoteDefinition')))
  )
    return full('boundary')
  for (const spans of [dependencies.definitions, dependencies.references])
    for (const span of spans)
      if (from === to ? from >= span.from && from <= span.to : from < span.to && to > span.from)
        return full('dependency')
  const fragmentFrom = lineStart(baseSource, block?.from ?? baseSource.length)
  const next = dependencies.blocks.at(index + 1)
  const fragmentTo = next ? lineStart(baseSource, next.from) : baseSource.length
  const previous = index > 0 ? dependencies.blocks.at(index - 1) : undefined
  if (
    (previous && !blankGap(baseSource, previous.to, fragmentFrom)) ||
    (next && !blankGap(baseSource, block?.to ?? fragmentFrom, fragmentTo)) ||
    from < fragmentFrom ||
    to > fragmentTo
  )
    return full('boundary')
  const delta = insert.length - (to - from)
  let contextLength = 0
  for (const definition of dependencies.definitions)
    if (definition.selected) contextLength += definition.to - definition.from + 2
  const beforeLength = fragmentTo - fragmentFrom
  const afterLength = beforeLength + delta
  const inputLength = beforeLength + afterLength + 2 * (contextLength + marker.length + 4)
  // Two parser roots, JSON/source strings and proof scratch use a conservative development
  // reserve. It is an admission weight, not a calibrated portable parser heap bound.
  const stagingBytes = 8192 + inputLength * 256
  if (inputLength * 3 > limits.bytes || stagingBytes > limits.staging) return full('limit')
  const retainedBase = 1024 + baseSource.length * 2 + source.retainedBytes + inputLength * 16
  if (retainedBase > limits.retained) return full('limit')
  const context = dependencies.definitions
    .filter((definition) => definition.selected)
    .map((definition) => baseSource.slice(definition.from, definition.to))
    .join('\n\n')
  const before = baseSource.slice(fragmentFrom, fragmentTo)
  const after = source.text.slice(fragmentFrom, fragmentTo + delta)
  try {
    const oldChildren = mainChildren(before, context, syntax, gfm)
    if (!oldChildren || oldChildren.length !== (block ? 1 : 0)) return full('context')
    const oldContext = fragmentContext(oldChildren, before)
    const reader = capture.reader
    const position = reader.position([...root, 'position'], { retained: 512, staging: 0 })
    const selected = block
      ? reader.position([...root, 'children', index, 'position'], { retained: 512, staging: 0 })
      : null
    const anchorLine = selected?.start.line ?? position.end.line
    anchorFragment(oldChildren, fragmentFrom, anchorLine, { ...limits, retained: limits.staging })
    if (block && !sameFragment(reader, [...root, 'children', index], oldChildren[0], limits))
      return full('context')
    if (!append && !containsText(oldChildren, from, to)) return full('syntax')
    const children = mainChildren(after, context, syntax, gfm)
    if (!children) return full('context')
    if (
      !children.length ||
      children.length > (append ? 2 : 1) ||
      (block && children[0]?.type !== block.type) ||
      (!block && children[0]?.type !== 'paragraph') ||
      children.slice(1).some((node) => node.type !== 'paragraph')
    )
      return full('boundary')
    if (oldContext !== fragmentContext(children, after)) return full('dependency')
    const treeBytes = anchorFragment(children, fragmentFrom, anchorLine, {
      ...limits,
      retained: limits.retained - retainedBase,
    })
    let editLine = anchorLine
    for (let offset = fragmentFrom; offset < from; offset++) {
      if (baseSource[offset] === '\r') {
        editLine++
        if (baseSource[offset + 1] === '\n') offset++
      } else if (baseSource[offset] === '\n') editLine++
    }
    return rememberFragment(
      dependencies,
      Object.freeze({
        kind: 'fragment',
        base: capture.identity,
        baseSource,
        source,
        start: block ? index : 0,
        remove: block ? 1 : 0,
        children,
        suffixOffset: delta,
        position: Object.freeze({
          start: position.start,
          end: Object.freeze({
            ...position.end,
            offset: source.text.length,
            column: position.end.column + (position.end.line === editLine ? delta : 0),
          }),
        }),
        retainedBytes: retainedBase + treeBytes,
        stagingBytes,
        inputBytesUpperBound: inputLength * 3,
        resources: fragmentResources(dependencies.sourceResource, source),
      }),
    )
  } catch (error) {
    if (
      error instanceof FragmentLimitError ||
      error instanceof RangeError ||
      (error instanceof Error && /^Packed (reader scope|scalar exceeds)/.test(error.message))
    )
      return full('limit')
    throw error
  }
}
