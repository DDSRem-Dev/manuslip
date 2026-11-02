import type {
  PackedCapture,
  PackedItemSteps,
  PackedReadScope,
} from '../../core/src/packing-capture'
import { packedTextStepCost } from '../../core/src/packing-text-stream'
import {
  invalidPackedSemantic,
  packedInteger,
  packedKeys,
  packedSmall,
  packedString,
  validationStreamLimits,
} from '../../core/src/packing-validation-read'
import { type DiagramSyntax, diagramSyntax } from './diagram'
import type { ProjectionLimits } from './fragment-projection-context'

const renderedKinds = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'list',
  'footnoteReference',
  'footnoteDefinition',
  'defList',
  'table',
  'code',
  'diagram',
  'math',
  'inlineMath',
  'image',
  'link',
  'html',
  'subscript',
  'superscript',
  'emoji',
])
const sourceKinds = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'list',
  'footnoteReference',
  'footnoteDefinition',
  'defList',
  'table',
  'code',
  'math',
  'inlineMath',
  'image',
  'imageReference',
  'link',
  'linkReference',
  'html',
  'subscript',
  'superscript',
  'emoji',
])
const emptyValueKinds = new Set([
  'table',
  'image',
  'link',
  'defList',
  'subscript',
  'superscript',
  'paragraph',
  'heading',
  'blockquote',
  'list',
  'footnoteReference',
  'footnoteDefinition',
])
interface Widget {
  kind: string
  value: Uint16Array
  seen: boolean
  syntax?: DiagramSyntax
}
function widgetSyntax(block: PackedReadScope): DiagramSyntax | undefined {
  if (!block.keys([], { retained: 1024, staging: 2048 }).includes('syntax')) return undefined
  const value = packedSmall(block, ['syntax'])
  if (value !== 'mermaid' && value !== 'sequence' && value !== 'flowchart') invalidPackedSemantic()
  return value
}
function key(from: number, to: number) {
  return `${from}:${to}`
}

/** Check supplied widgets against exact source-root kinds/ranges/UTF-16 values. Missing
 * widgets, HTML serialization and reference/footnote resolution require renderer equivalence
 * checks. The full root schema is validated separately by the snapshot composition.
 */
export function* validateProjectionWidgets(
  capture: PackedCapture,
  root: PackedReadScope,
  projection: PackedReadScope,
  sourceLength: number,
  htmlLength: number,
  limits: ProjectionLimits,
): Generator<void> {
  const size = projection.length(['blocks'])
  let units = 0
  const footprint = () => 8192 + size * 512 + units * 2
  const admit = () => {
    if (
      footprint() +
        packedTextStepCost.retained +
        packedTextStepCost.workspace +
        (limits.depth + 8) * 512 >
        limits.retained ||
      footprint() + packedTextStepCost.workspace > limits.staging
    )
      throw new Error('Packed widget validation exceeds workspace limit')
  }
  admit()
  let previousFrom = -1
  let previousTo = -1
  for (const block of projection.elementSteps(['blocks'])) {
    if (block === undefined) {
      yield
      continue
    }
    packedKeys(block, [], ['kind', 'from', 'to', 'html', 'value'], ['syntax'])
    const kind = packedSmall(block, ['kind'])
    const from = packedInteger(block, ['from'], sourceLength)
    const to = packedInteger(block, ['to'], sourceLength)
    if (
      typeof kind !== 'string' ||
      !renderedKinds.has(kind) ||
      to < from ||
      from < previousFrom ||
      (from === previousFrom && to >= previousTo)
    )
      invalidPackedSemantic()
    packedString(block, ['html'], htmlLength)
    packedString(block, ['value'], sourceLength)
    if (widgetSyntax(block) && kind !== 'diagram') invalidPackedSemantic()
    if (
      !block.textLength(['html']) ||
      (emptyValueKinds.has(kind) && block.textLength(['value']) !== 0)
    )
      invalidPackedSemantic()
    units += block.textLength(['value'])
    admit()
    previousFrom = from
    previousTo = to
    yield
  }
  if (!size) return
  const workspace = capture.workspace(footprint(), footprint())
  const widgets = new Map<string, Widget>()
  const frames: PackedItemSteps[] = []
  try {
    for (const block of projection.elementSteps(['blocks'])) {
      if (block === undefined) {
        yield
        continue
      }
      const value = new Uint16Array(block.textLength(['value']))
      let at = 0
      if (value.length)
        for (const chunk of block.textSteps(['value'], validationStreamLimits)) {
          if (chunk !== undefined)
            for (let index = 0; index < chunk.length; index++) value[at++] = chunk.charCodeAt(index)
          yield
        }
      if (at !== value.length) invalidPackedSemantic()
      const kind = packedSmall(block, ['kind'])
      if (typeof kind !== 'string') invalidPackedSemantic()
      widgets.set(
        key(
          packedInteger(block, ['from'], sourceLength),
          packedInteger(block, ['to'], sourceLength),
        ),
        { kind, value, seen: false, syntax: widgetSyntax(block) },
      )
      yield
    }
    let nodes = 0
    const visit = function* (node: PackedReadScope): Generator<void> {
      if (++nodes > limits.nodes || frames.length + 1 > limits.depth)
        throw new Error('Packed widget traversal limit')
      if (node.kind() !== 'object' || node.keyCount() > 10) invalidPackedSemantic()
      const type = packedSmall(node, ['type'])
      if (typeof type !== 'string') invalidPackedSemantic()
      if (sourceKinds.has(type)) {
        if (node.kind(['position']) !== 'position') invalidPackedSemantic()
        const position = node.position(['position'], { retained: 512, staging: 0 })
        const widget = widgets.get(key(position.start.offset, position.end.offset))
        const sourceKind =
          type === 'imageReference' ? 'image' : type === 'linkReference' ? 'link' : type
        // A paragraph and its sole child may share the exact same range. Only the
        // matching source kind owns the widget; traversal must still visit its child.
        if (
          widget &&
          (widget.kind === sourceKind || (type === 'code' && widget.kind === 'diagram'))
        ) {
          let kind = type === 'imageReference' ? 'image' : type === 'linkReference' ? 'link' : type
          let syntax: DiagramSyntax | undefined
          const keys = node.keys([], { retained: 4096, staging: 8192 })
          if (
            type === 'code' &&
            keys.includes('lang') &&
            node.scalarType(['lang']) === 'string' &&
            node.textLength(['lang']) <= 9
          )
            syntax = diagramSyntax(String(packedSmall(node, ['lang'])))
          if (syntax) kind = 'diagram'
          if (
            widget.seen ||
            widget.kind !== kind ||
            (kind === 'diagram' && (widget.syntax ?? 'mermaid') !== syntax)
          )
            invalidPackedSemantic()
          if (emptyValueKinds.has(kind)) {
            if (widget.value.length) invalidPackedSemantic()
          } else {
            packedString(node, ['value'], sourceLength)
            if (node.textLength(['value']) !== widget.value.length) invalidPackedSemantic()
            let at = 0
            if (widget.value.length)
              for (const chunk of node.textSteps(['value'], validationStreamLimits)) {
                if (chunk !== undefined)
                  for (let index = 0; index < chunk.length; index++)
                    if (widget.value[at++] !== chunk.charCodeAt(index)) invalidPackedSemantic()
                yield
              }
            if (at !== widget.value.length) invalidPackedSemantic()
          }
          widget.seen = true
        }
      }
      if (node.keys([], { retained: 4096, staging: 8192 }).includes('children'))
        frames.push(node.elementSteps(['children']))
      yield
    }
    yield* visit(root)
    while (frames.length) {
      const frame = frames.at(-1)
      if (!frame) throw new Error('Missing packed widget frame')
      const step = frame.next()
      if (step.done) {
        frames.pop()
        yield
      } else if (step.value === undefined) yield
      else yield* visit(step.value)
    }
    for (const widget of widgets.values()) {
      if (!widget.seen) invalidPackedSemantic()
      yield
    }
  } finally {
    for (const frame of frames) frame.return()
    widgets.clear()
    workspace.release()
  }
}
