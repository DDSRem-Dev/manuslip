import { semanticLimits } from './contracts'
import type { PackedCapture, PackedItemSteps, PackedReadScope } from './packing-capture'
import { finishPackedCleanup } from './packing-cleanup'
import { PackedDescriptionReuse } from './packing-description-reuse'
import type { PackedDocumentBaseline, PackedDocumentSubtree } from './packing-document-baseline'
import { packedPlainText } from './packing-plain-text'
import { type PackedSource, packedSourceCharacters } from './packing-source'
import { packedTextStepCost } from './packing-text-stream'
import {
  type PackedRootObserver,
  type PackedRootSubtree,
  type PackedRootValidationLimits,
  packedRootSteps,
  packedRootWorkspace,
} from './packing-validate-root'
import {
  admitValidationStreams,
  equalPackedChunks,
  invalidPackedSemantic,
  packedInteger,
  packedKeys,
  packedSmall,
  packedString,
  validationStreamLimits,
} from './packing-validation-read'
import type { PackedPath } from './packing-view'
import type { PackedWork } from './packing-work'
import { describesBlock } from './semantic-description'

/** A sealed text cache can accompany description reuse. Its complete logical shape
 * must agree with the independently proved subtree before any prose is borrowed.
 */
export interface PackedDescriptionTextReuse extends PackedRootSubtree {
  accept?(subtree: PackedDocumentSubtree): boolean
  collect(subtree: PackedDocumentSubtree): Generator<void> | void
}

/** Keep the arithmetic in an ordinary frame; only chunk boundaries enter generator state. */
function hashUnits(
  source: string,
  from: number,
  to: number,
  a: number,
  b: number,
): [number, number] {
  for (let at = from; at < to; at++) {
    const unit = source.charCodeAt(at)
    a = Math.imul(a ^ unit, 0x01000193)
    b = Math.imul(b ^ unit, 0x85ebca6b)
  }
  return [a, b]
}

/** Exact sourceHash(source.slice(from, to)), without allocating that source slice. */
function* hashRange(source: string, from: number, to: number): Generator<void, string, undefined> {
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  for (let at = from; at < to; at += 4096) {
    const end = Math.min(at + 4096, to)
    const next = hashUnits(source, at, end, a, b)
    a = next[0]
    b = next[1]
    if (end - at === 4096) yield
  }
  return `${to - from}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`
}
function* nextItem(
  iterator: PackedItemSteps,
): Generator<void, PackedReadScope | undefined, undefined> {
  while (true) {
    const step = iterator.next()
    if (step.done) return undefined
    if (step.value !== undefined) return step.value
    yield
  }
}

/** Validate the complete root and its block/outline descriptions, metadata schema and exact
 * Unicode character count. Words are type/bounds checked only. Parser equivalence, exact
 * word counts and projection validation must still be composed before production publication.
 * A sealed compatible baseline may prove shared subtree schema/source/position invariants;
 * every nested descriptor/heading must match its certified value and exact range shift.
 */
export function validatePackedDescriptions(
  capture: PackedCapture,
  source: PackedSource,
  document: PackedPath,
  limits: PackedRootValidationLimits,
  baseline?: PackedDocumentBaseline,
): PackedWork<void> {
  return capture.work(packedDescriptionSteps(capture, source, document, limits, baseline))
}

/** Internal validation steps; an enclosing capture-owned task must own and close them. */
export function packedDescriptionSteps(
  capture: PackedCapture,
  source: PackedSource,
  document: PackedPath,
  limits: PackedRootValidationLimits,
  baseline?: PackedDocumentBaseline,
  collectText?: (node: PackedReadScope) => Generator<void>,
  observeRoot?: PackedRootObserver,
  collectPruned?: (node: PackedReadScope) => PackedDescriptionTextReuse | undefined,
): Generator<void> {
  capture.reader.at(document)
  const path = [...document]
  const budget = { ...limits }
  return (function* () {
    if (baseline?.compatible(capture, source)) {
      const complete = yield* baseline.inspect(function* () {
        yield* validateDescriptionSteps(
          capture,
          source,
          path,
          budget,
          baseline,
          collectText,
          observeRoot,
          collectPruned,
        )
      })
      if (complete !== true) throw new Error('Document baseline closed during validation')
    } else
      yield* validateDescriptionSteps(
        capture,
        source,
        path,
        budget,
        undefined,
        collectText,
        observeRoot,
        collectPruned,
      )
  })()
}

function* validateDescriptionSteps(
  capture: PackedCapture,
  source: PackedSource,
  document: PackedPath,
  limits: PackedRootValidationLimits,
  baseline?: PackedDocumentBaseline,
  collectText?: (node: PackedReadScope) => Generator<void>,
  observeRoot?: PackedRootObserver,
  collectPruned?: (node: PackedReadScope) => PackedDescriptionTextReuse | undefined,
): Generator<void, void, undefined> {
  if (baseline && collectText && !collectPruned)
    throw new Error('Cannot collect pruned document text')
  const selected = capture.reader.at(document)
  const root = [...document, 'root']
  const bytes = 8192 + limits.depth * 1024 + (baseline ? 4096 : 0)
  const available = {
    ...limits,
    retained: limits.retained - bytes,
    staging: limits.staging - bytes,
  }
  packedRootWorkspace(source, root, available)
  const workspace = capture.workspace(bytes, bytes)
  let blocks: PackedItemSteps | undefined
  let outline: PackedItemSteps | undefined
  let reuse: PackedDescriptionReuse | undefined
  let failed = false
  try {
    if (baseline) reuse = new PackedDescriptionReuse(baseline, source)
    packedKeys(
      selected,
      [],
      ['root', 'blocks', 'outline', 'counts', 'sourceHash', 'timings', 'parserVersion'],
    )
    if (
      packedSmall(selected, ['sourceHash']) !== source.identity.sourceHash ||
      packedSmall(selected, ['parserVersion']) !== source.identity.parserVersion
    )
      invalidPackedSemantic()
    for (const field of ['blocks', 'outline'])
      if (selected.kind([field]) !== 'array' || selected.length([field]) > semanticLimits.blocks)
        invalidPackedSemantic()
    packedKeys(selected, ['counts'], ['words', 'characters'])
    packedInteger(selected, ['counts', 'words'], source.text.length)
    const expectedCharacters = packedInteger(selected, ['counts', 'characters'], source.text.length)
    packedKeys(selected, ['timings'], ['parse', 'describe'])
    for (const key of ['parse', 'describe']) {
      const value = packedSmall(selected, ['timings', key])
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalidPackedSemantic()
    }
    if (packedSourceCharacters(source) !== expectedCharacters) invalidPackedSemantic()
    blocks = selected.elementSteps(['blocks'])
    outline = selected.elementSteps(['outline'])
    yield* packedRootSteps(
      capture,
      source,
      root,
      available,
      function* (node, type, position, budget, depth) {
        // Collect only after the root validator has checked this complete text node.
        // Unpositioned GFM leaves and empty leaves still participate in prose order.
        if (type === 'text' && collectText) yield* collectText(node)
        if (observeRoot) {
          const work = observeRoot(node, type, position, budget, depth)
          if (work !== undefined) yield* work
        }
        if (!position) return
        const from = position.start.offset
        const to = position.end.offset
        if (describesBlock(type)) {
          if (!blocks) throw new Error('Missing packed block iterator')
          const block = yield* nextItem(blocks)
          if (!block) invalidPackedSemantic()
          packedKeys(block, [], ['kind', 'from', 'to', 'hash', 'lines'])
          if (
            packedSmall(block, ['kind']) !== type ||
            packedSmall(block, ['from']) !== from ||
            packedSmall(block, ['to']) !== to ||
            packedSmall(block, ['lines']) !== position.end.line - position.start.line + 1 ||
            packedSmall(block, ['hash']) !== (yield* hashRange(source.text, from, to))
          )
            invalidPackedSemantic()
          yield
        }
        if (type === 'heading') {
          if (!outline) throw new Error('Missing packed outline iterator')
          const heading = yield* nextItem(outline)
          if (!heading) invalidPackedSemantic()
          packedKeys(heading, [], ['from', 'to', 'depth', 'text'])
          if (
            packedSmall(heading, ['from']) !== from ||
            packedSmall(heading, ['to']) !== to ||
            packedSmall(heading, ['depth']) !== packedSmall(node, ['depth'])
          )
            invalidPackedSemantic()
          packedString(heading, ['text'], source.text.length)
          admitValidationStreams([heading.textStepCost(['text']), packedTextStepCost], budget)
          yield* equalPackedChunks(
            heading.textSteps(['text'], validationStreamLimits),
            packedPlainText(node, source.text.length, available),
          )
        }
      },
      reuse
        ? function* (node, position, budget) {
            if (!blocks || !outline || !reuse) throw new Error('Missing document reuse cursor')
            const text = collectPruned?.(node)
            // Without a matching word cache, visit every descendant and collect its
            // checked text leaves; the description cursors have not advanced yet.
            if (collectText && !text) return undefined
            const subtree = yield* reuse.prune(
              node,
              position,
              budget,
              blocks,
              outline,
              text?.accept,
            )
            if (subtree && text) {
              if (subtree.nodes !== text.nodes || subtree.depth !== text.depth)
                invalidPackedSemantic()
              const work = text.collect(subtree)
              if (work !== undefined) yield* work
            }
            return subtree
          }
        : undefined,
    )
    if ((yield* nextItem(blocks)) || (yield* nextItem(outline))) invalidPackedSemantic()
  } catch (error) {
    failed = true
    throw error
  } finally {
    finishPackedCleanup(
      [
        () => {
          blocks?.return()
        },
        () => {
          outline?.return()
        },
        () => reuse?.close(),
        () => workspace.release(),
      ],
      failed,
    )
  }
}
