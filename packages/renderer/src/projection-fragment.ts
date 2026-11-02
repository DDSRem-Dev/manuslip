import { semanticLimits } from '../../core/src/contracts'
import type { MarkdownFragment } from '../../core/src/markdown-fragment'
import type { PackedArena } from '../../core/src/packing-arena'
import type { PackedCapture } from '../../core/src/packing-capture'
import type { PackedResource } from '../../core/src/packing-resources'
import type { PackedOperation } from '../../core/src/packing-revision'
import type { PackedSource } from '../../core/src/packing-source'
import type { PackedPath } from '../../core/src/packing-view'
import type { SemanticDependencies } from '../../core/src/semantic-dependencies'
import type { ProjectionLimits } from './fragment-projection-context'
import { type RenderOptions, rendererVersion } from './index'
import { planProjectionBlocks } from './projection-block-plan'
import { renderFragmentProjection } from './render-fragment'

export interface FragmentProjectionPatch {
  readonly source: PackedSource
  readonly fields: Readonly<Record<string, unknown>>
  readonly retainedBytes: number
  readonly stagingBytes: number
  readonly renderMs: number
  resources(): Generator<PackedResource>
}
interface Proof {
  readonly token: object
  readonly projection: PackedPath
  readonly layout: PackedPath
  readonly body: { start: number; remove: number }
  readonly footer: { start: number; remove: number }
  readonly layoutDelta: number
  readonly shiftStart: number
  readonly edits: readonly { start: number; remove: number; field: string }[]
}
const fragments = new WeakMap<object, object>()
const patches = new WeakMap<object, Proof>()
function footprint(source: PackedSource) {
  return function* (this: FragmentProjectionPatch): Generator<PackedResource> {
    yield { key: source, bytes: source.retainedBytes }
    yield { key: this, bytes: this.retainedBytes - source.retainedBytes }
  }
}
/** Internal projection transaction. The accepted initial layout comes from the full renderer. */
export function projectMarkdownFragment(
  request: {
    capture: PackedCapture
    dependencies: SemanticDependencies
    fragment: MarkdownFragment
    root: PackedPath
    projection: PackedPath
    layout: PackedPath
    options: RenderOptions
  },
  limits: ProjectionLimits,
): FragmentProjectionPatch {
  const started = performance.now()
  for (const key of ['retained', 'staging', 'nodes', 'depth'] as const)
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0)
      throw new Error('Invalid fragment projection limits')
  if (
    limits.retained > semanticLimits.workerCacheBytes ||
    limits.staging > semanticLimits.messageBytes ||
    limits.nodes > semanticLimits.blocks * 16 ||
    limits.depth > 64
  )
    throw new Error('Invalid fragment projection limits')
  const { capture, dependencies: index, fragment, root, projection, layout, options } = request
  for (const path of [root, projection, layout])
    if (
      path.length > 64 ||
      path.some((part) =>
        typeof part === 'number'
          ? !Number.isSafeInteger(part) || part < 0
          : typeof part !== 'string' || part.length > 256,
      )
    )
      throw new Error('Invalid projection path')
  if (
    capture.reader.scalar([...projection, 'rendererVersion'], { retained: 1024, staging: 1024 }) !==
    rendererVersion
  )
    throw new Error('Stale renderer projection; full resync required')
  const scalar = (field: string) => {
    const value = capture.reader.scalar([...layout, field], { retained: 16, staging: 0 })
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
      throw new Error('Invalid projection layout')
    return value
  }
  const bodyEnd = scalar('bodyEnd')
  const htmlLength = scalar('htmlLength')
  if (
    bodyEnd > htmlLength ||
    htmlLength !== capture.reader.textLength([...projection, 'html']) ||
    capture.reader.length([...layout, 'blocks']) !== index.blocks.length
  )
    throw new Error('Projection layout mismatch; full resync required')
  let prefixEnd = 0
  let suffixStart = bodyEnd
  let prefixVisible = false
  let suffixVisible = false
  let cursor = 0
  let previous = 0
  for (const item of capture.reader.elements([...layout, 'blocks'])) {
    const from = item.scalar(['from'], { retained: 16, staging: 0 })
    const to = item.scalar(['to'], { retained: 16, staging: 0 })
    const visible = item.scalar(['visible'], { retained: 16, staging: 0 })
    if (
      typeof from !== 'number' ||
      typeof to !== 'number' ||
      typeof visible !== 'boolean' ||
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from < previous ||
      to < from ||
      to > bodyEnd ||
      (!visible && from !== to)
    )
      throw new Error('Invalid projection layout range')
    previous = to
    if (visible && cursor < fragment.start) {
      prefixEnd = to
      prefixVisible = true
    }
    if (visible && cursor >= fragment.start + fragment.remove && !suffixVisible) {
      suffixStart = from
      suffixVisible = true
    }
    cursor++
  }
  const local = renderFragmentProjection(capture, index, fragment, root, options, limits)
  const body = local.projection.html.slice(0, local.layout.bodyEnd)
  const footer = local.projection.html.slice(local.layout.bodyEnd)
  const leading = prefixVisible && body.length ? '\n' : ''
  const insertion = `${leading}${body}${(prefixVisible || body.length) && suffixVisible ? '\n' : ''}`
  const delta = insertion.length - (suffixStart - prefixEnd)
  let anchor = prefixEnd
  const replacement = local.layout.blocks.map((block) => {
    if (!block.visible) return Object.freeze({ from: anchor, to: anchor, visible: false })
    const value = Object.freeze({
      from: prefixEnd + leading.length + block.from,
      to: prefixEnd + leading.length + block.to,
      visible: true,
    })
    anchor = value.to
    return value
  })
  const plan = planProjectionBlocks(
    capture,
    projection,
    index,
    fragment,
    local.projection.blocks,
    limits.staging,
  )
  const fields: Record<string, unknown> = {
    projectionBody: insertion,
    projectionFooter: footer,
    projectionLayoutBlocks: Object.freeze(replacement),
    projectionBodyEnd: bodyEnd + delta,
    projectionHtmlLength: bodyEnd + delta + footer.length,
    projectionRendererVersion: rendererVersion,
  }
  const edits = plan.edits.map((edit, index) => {
    const field = `projectionRendered${index}`
    fields[field] = Object.freeze(edit.values)
    return Object.freeze({ start: edit.start, remove: edit.remove, field })
  })
  const renderMs = performance.now() - started
  fields.projectionRenderMs = renderMs
  const retainedBytes =
    fragment.source.retainedBytes +
    local.retainedBytes +
    4096 +
    (insertion.length + footer.length) * 2 +
    replacement.length * 192 +
    edits.length * 256
  const stagingBytes = Math.max(local.stagingBytes, plan.stagingBytes)
  if (retainedBytes > limits.retained) throw new Error('Fragment projection exceeds retained limit')
  let token = fragments.get(fragment)
  if (!token) {
    token = Object.freeze({})
    fragments.set(fragment, token)
  }
  const result: FragmentProjectionPatch = Object.freeze({
    source: fragment.source,
    fields: Object.freeze(fields),
    retainedBytes,
    stagingBytes,
    renderMs,
    resources: footprint(fragment.source),
  })
  patches.set(
    result,
    Object.freeze({
      token,
      projection: Object.freeze([...projection]),
      layout: Object.freeze([...layout]),
      body: Object.freeze({ start: prefixEnd, remove: suffixStart - prefixEnd }),
      footer: Object.freeze({ start: bodyEnd, remove: htmlLength - bodyEnd }),
      layoutDelta: delta,
      shiftStart: plan.shiftStart,
      edits: Object.freeze(edits),
    }),
  )
  return result
}

/** The payload fields are trusted builder output; receiver/schema validation remains separate. */
export function projectionFragmentOperations(
  fragment: MarkdownFragment,
  patch: FragmentProjectionPatch,
  payload: PackedArena,
): PackedOperation[] {
  const proof = patches.get(patch)
  if (!proof || proof.token !== fragments.get(fragment) || patch.source !== fragment.source)
    throw new Error('Fragment projection provenance mismatch')
  const record = (key: string) => {
    const reference = payload.field(payload.root, key)
    if (reference === undefined) throw new Error('Missing fragment projection payload field')
    return reference
  }
  const operations: PackedOperation[] = [
    {
      kind: 'text',
      path: [...proof.projection, 'html'],
      ...proof.footer,
      record: record('projectionFooter'),
    },
    {
      kind: 'text',
      path: [...proof.projection, 'html'],
      ...proof.body,
      record: record('projectionBody'),
    },
    {
      kind: 'splice',
      path: [...proof.layout, 'blocks'],
      start: fragment.start,
      remove: fragment.remove,
      record: record('projectionLayoutBlocks'),
    },
    {
      kind: 'range',
      path: [...proof.layout, 'blocks'],
      start: fragment.start + fragment.children.length,
      offset: proof.layoutDelta,
    },
    { kind: 'replace', path: [...proof.layout, 'bodyEnd'], record: record('projectionBodyEnd') },
    {
      kind: 'replace',
      path: [...proof.layout, 'htmlLength'],
      record: record('projectionHtmlLength'),
    },
    {
      kind: 'range',
      path: [...proof.projection, 'blocks'],
      start: proof.shiftStart,
      offset: fragment.suffixOffset,
    },
  ]
  for (const edit of proof.edits)
    operations.push({
      kind: 'splice',
      path: [...proof.projection, 'blocks'],
      start: edit.start,
      remove: edit.remove,
      record: record(edit.field),
    })
  for (const [field, key] of [
    ['rendererVersion', 'projectionRendererVersion'],
    ['renderMs', 'projectionRenderMs'],
  ])
    operations.push({
      kind: 'replace',
      path: [...proof.projection, field as string],
      record: record(key as string),
    })
  return operations
}
