import { semanticLimits } from '../../core/src/contracts'
import type {
  PackedCapture,
  PackedItemSteps,
  PackedReadScope,
} from '../../core/src/packing-capture'
import { type PackedSource, sameIdentity } from '../../core/src/packing-source'
import { packedTextStepCost } from '../../core/src/packing-text-stream'
import {
  invalidPackedSemantic,
  packedInteger,
  packedKeys,
  packedSmall,
  packedString,
  validationStreamLimits,
} from '../../core/src/packing-validation-read'
import type { PackedPath } from '../../core/src/packing-view'
import type { PackedWork } from '../../core/src/packing-work'
import type { ProjectionLimits } from './fragment-projection-context'
import { type RenderOptions, rendererVersion } from './index'
import { PackedHtmlCursor } from './packed-html-cursor'
import { validateProjectionWidgets } from './packing-projection-widgets'

export interface PackedProjectionPaths {
  root: PackedPath
  projection: PackedPath
  layout: PackedPath
}
// The pinned mdast-to-hast handlers ignore these top-level nodes. Our HTML override
// emits positioned raw/text nodes in both policy modes, so HTML remains visible.
const invisibleKinds = new Set(['definition', 'footnoteDefinition', 'yaml', 'toml'])
function* nextItem(items: PackedItemSteps): Generator<void, PackedReadScope | undefined> {
  while (true) {
    const step = items.next()
    if (step.done) return undefined
    if (step.value !== undefined) return step.value
    yield
  }
}
function finiteTime(scope: PackedReadScope, field: string) {
  const value = packedSmall(scope, [field])
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalidPackedSemantic()
}

/** Strict projection/layout schema and geometry, bound to source, renderer and options.
 * Supplied widget kinds/ranges/values must match mdast. Compose with document/root validation.
 * This does not re-render HTML, prove widget completeness, resolve footnotes, sanitize HTML
 * or authorize a DOM sink.
 */
export function validatePackedProjection(
  capture: PackedCapture,
  source: PackedSource,
  paths: PackedProjectionPaths,
  options: RenderOptions,
  limits: ProjectionLimits,
): PackedWork<void> {
  return capture.work(projectionValidation(capture, source, paths, options, limits, true))
}

/** Schema, identity, logical limits and supplied widget/source checks only. The exact
 * output validator composes these with its own complete HTML/layout comparison so that
 * the same HTML and spans need not be traversed twice. This alone proves no geometry.
 */
export function validatePackedProjectionSchema(
  capture: PackedCapture,
  source: PackedSource,
  paths: PackedProjectionPaths,
  options: RenderOptions,
  limits: ProjectionLimits,
): PackedWork<void> {
  return capture.work(packedProjectionSchemaSteps(capture, source, paths, options, limits))
}

/** Internal schema validation under an enclosing capture-owned task. */
export function packedProjectionSchemaSteps(
  capture: PackedCapture,
  source: PackedSource,
  paths: PackedProjectionPaths,
  options: RenderOptions,
  limits: ProjectionLimits,
): Generator<void> {
  return projectionValidation(capture, source, paths, options, limits, false)
}

function projectionValidation(
  capture: PackedCapture,
  source: PackedSource,
  paths: PackedProjectionPaths,
  options: RenderOptions,
  limits: ProjectionLimits,
  geometry: boolean,
): Generator<void> {
  for (const path of [paths.root, paths.projection, paths.layout]) {
    capture.reader.at(path)
    if (path.length > 64) throw new Error('Invalid packed projection path')
  }
  if (
    !options ||
    Object.keys(options).length !== 3 ||
    Object.keys(options).some(
      (key) => !['rawHtml', 'footnotesLabel', 'footnoteBackLabel'].includes(key),
    ) ||
    typeof options.rawHtml !== 'boolean' ||
    typeof options.footnotesLabel !== 'string' ||
    options.footnotesLabel.length > 200 ||
    typeof options.footnoteBackLabel !== 'string' ||
    options.footnoteBackLabel.length > 200
  )
    throw new Error('Invalid packed projection options')
  return validateProjectionSteps(
    capture,
    source,
    {
      root: [...paths.root],
      projection: [...paths.projection],
      layout: [...paths.layout],
    },
    { ...options },
    { ...limits },
    geometry,
  )
}

function* validateProjectionSteps(
  capture: PackedCapture,
  source: PackedSource,
  paths: PackedProjectionPaths,
  options: RenderOptions,
  limits: ProjectionLimits,
  geometry: boolean,
): Generator<void> {
  for (const field of ['retained', 'staging', 'nodes', 'depth'] as const)
    if (!Number.isSafeInteger(limits[field]) || limits[field] < 0)
      throw new Error('Invalid packed projection limits')
  if (
    limits.retained > semanticLimits.rendererBytes ||
    limits.staging > semanticLimits.messageBytes ||
    limits.nodes > semanticLimits.blocks * 16 ||
    limits.depth < 1 ||
    limits.depth > 128
  )
    throw new Error('Invalid packed projection limits')
  if (
    capture.sourceResource !== source ||
    !sameIdentity(capture.identity, source.identity) ||
    source.identity.rendererVersion !== rendererVersion ||
    source.identity.options !== JSON.stringify(options)
  )
    invalidPackedSemantic()
  const bytes =
    32768 +
    (limits.depth + paths.root.length + paths.projection.length + paths.layout.length) * 1024
  if (
    bytes + packedTextStepCost.retained + packedTextStepCost.workspace + 6 * 512 >
      limits.retained ||
    bytes + packedTextStepCost.workspace > limits.staging
  )
    throw new Error('Packed projection validation exceeds workspace limit')
  const workspace = capture.workspace(bytes, bytes)
  let children: PackedItemSteps | undefined
  let spans: PackedItemSteps | undefined
  let html: PackedHtmlCursor | undefined
  try {
    const root = capture.reader.at(paths.root)
    const projection = capture.reader.at(paths.projection)
    const layout = capture.reader.at(paths.layout)
    if (packedSmall(root, ['type']) !== 'root') invalidPackedSemantic()
    packedKeys(projection, [], ['html', 'blocks', 'renderMs', 'rendererVersion'])
    packedKeys(layout, [], ['blocks', 'bodyEnd', 'htmlLength'])
    packedString(projection, ['html'], semanticLimits.messageBytes)
    const length = projection.textLength(['html'])
    const bodyEnd = packedInteger(layout, ['bodyEnd'], length)
    if (
      packedInteger(layout, ['htmlLength'], length) !== length ||
      packedSmall(projection, ['rendererVersion']) !== rendererVersion
    )
      invalidPackedSemantic()
    finiteTime(projection, 'renderMs')
    for (const [scope, field] of [
      [root, 'children'],
      [layout, 'blocks'],
      [projection, 'blocks'],
    ] as const)
      if (scope.kind([field]) !== 'array' || scope.length([field]) > semanticLimits.blocks)
        invalidPackedSemantic()
    if (layout.length(['blocks']) !== root.length(['children'])) invalidPackedSemantic()
    if (root.length(['children']) + projection.length(['blocks']) + 1 > limits.nodes)
      throw new Error('Packed projection validation node limit')
    if (root.length(['children']) && limits.depth < 2)
      throw new Error('Packed projection validation depth limit')
    if (geometry) {
      children = root.elementSteps(['children'])
      spans = layout.elementSteps(['blocks'])
      html = new PackedHtmlCursor(projection.textSteps(['html'], validationStreamLimits))
      let previous = 0
      let visible = false
      while (true) {
        const child = yield* nextItem(children)
        const span = yield* nextItem(spans)
        if (!child || !span) {
          if (child || span) invalidPackedSemantic()
          break
        }
        if (child.kind() !== 'object' || child.keyCount() > 10) invalidPackedSemantic()
        const type = packedSmall(child, ['type'])
        if (typeof type !== 'string') invalidPackedSemantic()
        packedKeys(span, [], ['from', 'to', 'visible'])
        const from = packedInteger(span, ['from'], bodyEnd)
        const to = packedInteger(span, ['to'], bodyEnd)
        const shown = packedSmall(span, ['visible'])
        if (typeof shown !== 'boolean' || shown === invisibleKinds.has(type))
          invalidPackedSemantic()
        if (shown) {
          if (from !== previous + Number(visible) || to < from) invalidPackedSemantic()
          if (visible) yield* html.newline(previous)
          yield* html.skip(to)
          previous = to
          visible = true
        } else if (from !== previous || to !== previous) invalidPackedSemantic()
        yield
      }
      if (previous !== bodyEnd) invalidPackedSemantic()
      if (bodyEnd < length) yield* html.newline(bodyEnd)
      yield* html.finish(length)
      html.close()
      html = undefined
      children.return()
      children = undefined
      spans.return()
      spans = undefined
    }
    const sourceLength = source.text.length - Number(source.text.charCodeAt(0) === 0xfeff)
    yield* validateProjectionWidgets(capture, root, projection, sourceLength, length, {
      ...limits,
      retained: limits.retained - bytes,
      staging: limits.staging - bytes,
    })
  } finally {
    html?.close()
    children?.return()
    spans?.return()
    workspace.release()
  }
}
