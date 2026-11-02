import { parserVersion, semanticLimits } from './contracts'
import type { PackedCapture } from './packing-capture'
import { finishPackedCleanup } from './packing-cleanup'
import { type PackedSource, sameIdentity } from './packing-source'
import { packedTextStepCost } from './packing-text-stream'
import type { PackedRootValidationLimits } from './packing-validate-root'
import {
  invalidPackedSemantic,
  packedInteger,
  packedKeys,
  packedSmall,
  validationStreamLimits,
} from './packing-validation-read'
import type { PackedPath } from './packing-view'
import type { PackedWordBaseline } from './packing-word-baseline'
import { PackedWordBuffer } from './packing-word-buffer'
import { packedWordTexts } from './packing-word-texts'
import type { PackedWork } from './packing-work'
import type { PackedWorkspace } from './packing-workspace'

export type PackedWordPhase = 'scan' | 'read' | 'join' | 'segment' | 'count'

/** Shared logical bounds for independent and complete-document validation. */
export function checkPackedWordLimits(
  document: PackedPath,
  limits: PackedRootValidationLimits,
): void {
  for (const key of ['retained', 'staging', 'nodes', 'depth'] as const)
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0)
      throw new Error('Invalid packed word limits')
  if (
    limits.depth < 1 ||
    limits.depth > 128 ||
    limits.nodes > semanticLimits.blocks * 16 ||
    limits.retained > semanticLimits.rendererBytes ||
    limits.staging > semanticLimits.messageBytes ||
    document.length > 64
  )
    throw new Error('Invalid packed word limits')
}

/** Recognize complete, simple ASCII prose, with one letter/digit run per whitespace/
 * hyphen token. UAX29 WB5/8/9/10 keep each run together; WB999 breaks at hyphens.
 * Printable ASCII punctuation cannot contribute a word here; '_' is excluded
 * because WB13 can give ExtendNumLet runs word status. A second alphanumeric run
 * may bridge punctuation, so that case always uses Intl.
 * Unsupported characters also require the original complete-string Intl check.
 */
function* simpleWordCount(prose: string): Generator<void, number | undefined> {
  let words = 0
  let state = 0 // Before, within or after this token's one alphanumeric run.
  let batch = 0
  for (let index = 0; index < prose.length; index++) {
    const code = prose.charCodeAt(index)
    const letter = code | 32
    if ((letter >= 97 && letter <= 122) || (code >= 48 && code <= 57)) {
      if (state === 2) return undefined
      if (state === 0) words++
      state = 1
    } else if (code === 32 || code === 45 || (code >= 9 && code <= 13)) state = 0
    else if (code >= 33 && code <= 126 && code !== 95) {
      if (state === 1) state = 2
    } else return undefined
    if (++batch === 4096) {
      batch = 0
      yield
    }
  }
  return words
}

/** Exact complete admitted prose: at most 4096 ASCII units or 16 Intl calls per advance. */
export function* checkPackedWordCount(
  prose: string,
  expected: number,
  report: (phase: PackedWordPhase) => void,
): Generator<void> {
  report('segment')
  yield
  const segments = new Intl.Segmenter(undefined, { granularity: 'word' }).segment(prose)
  const simple = yield* simpleWordCount(prose)
  if (simple !== undefined) {
    report('count')
    yield
    if (simple !== expected) invalidPackedSemantic()
    return
  }
  const iterator = segments[Symbol.iterator]()
  report('count')
  yield
  let words = 0
  let batch = 0
  while (true) {
    const next = iterator.next()
    if (next.done) break
    if (next.value.isWordLike) words++
    if (++batch === 16) {
      batch = 0
      yield
    }
  }
  if (words !== expected) invalidPackedSemantic()
}

/** Exact whole-prose count matching Intl, the parser's text-node preorder and inserted
 * spaces. Construction/segmentation input stays charged; no native AST is expanded.
 * Each complete text leaf is admitted before collection in one traversal. Explicit phase
 * observers retain the separate sizing/read walks. Traversal and text decoding yield;
 * the simple scan reads at most 4096 units and native segment iteration makes at most 16 next calls
 * per advance. Final join and native Intl calls are synchronous and must be measured or
 * offloaded before a renderer timing gate can pass. Cached short text still owns its full
 * prose output reservation; long and overlaid values retain the decoder path.
 */
export function validatePackedWords(
  capture: PackedCapture,
  source: PackedSource,
  document: PackedPath,
  limits: PackedRootValidationLimits,
  phase?: (phase: PackedWordPhase) => void,
  baseline?: PackedWordBaseline,
): PackedWork<void> {
  return capture.work(packedWordSteps(capture, source, document, limits, phase, baseline))
}

/** Internal validation steps; an enclosing capture-owned task must own and close them. */
export function packedWordSteps(
  capture: PackedCapture,
  source: PackedSource,
  document: PackedPath,
  limits: PackedRootValidationLimits,
  phase?: (phase: PackedWordPhase) => void,
  baseline?: PackedWordBaseline,
): Generator<void> {
  capture.reader.at(document)
  if (phase !== undefined && typeof phase !== 'function')
    throw new Error('Invalid word phase observer')
  const path = [...document],
    budget = { ...limits }
  return (function* () {
    if (baseline?.compatible(capture, source)) {
      const complete = yield* baseline.inspect(function* () {
        yield* validateWordSteps(capture, source, path, budget, phase, baseline)
      })
      if (complete !== true) throw new Error('Word baseline closed during validation')
    } else yield* validateWordSteps(capture, source, path, budget, phase)
  })()
}

function* validateWordSteps(
  capture: PackedCapture,
  source: PackedSource,
  document: PackedPath,
  limits: PackedRootValidationLimits,
  phase?: (phase: PackedWordPhase) => void,
  baseline?: PackedWordBaseline,
): Generator<void, void, undefined> {
  checkPackedWordLimits(document, limits)
  if (
    capture.sourceResource !== source ||
    !sameIdentity(capture.identity, source.identity) ||
    ![`${parserVersion}/commonmark`, `${parserVersion}/manuslip`].includes(
      source.identity.parserVersion,
    )
  )
    invalidPackedSemantic()
  const selected = capture.reader.at(document)
  if (
    packedSmall(selected, ['sourceHash']) !== source.identity.sourceHash ||
    packedSmall(selected, ['parserVersion']) !== source.identity.parserVersion
  )
    invalidPackedSemantic()
  packedKeys(selected, ['counts'], ['words', 'characters'])
  const expected = packedInteger(selected, ['counts', 'words'], source.text.length)
  const root = selected.at(['root'])
  const reuse = baseline
    ? (node: Parameters<PackedWordBaseline['find']>[0]) => baseline.find(node)
    : undefined
  const report = (value: PackedWordPhase) => {
    phase?.(value)
    capture.identity
  }
  const admit = (units: number, texts: number, streaming: boolean) => {
    const buffer = PackedWordBuffer.bytes(units, texts, limits.depth)
    const stream = streaming ? packedTextStepCost : { retained: 0, workspace: 0 }
    if (
      buffer + stream.retained + stream.workspace + (limits.depth + 4) * 512 > limits.retained ||
      buffer + stream.workspace > limits.staging
    )
      throw new Error('Packed words exceed workspace limit')
    return buffer
  }
  let workspace: PackedWorkspace | undefined
  let buffer: PackedWordBuffer | undefined
  let failed = false
  try {
    workspace = capture.reserveWorkspace(
      admit(0, 0, false),
      PackedWordBuffer.bytes(0, 0, limits.depth),
    )
    let texts = 0
    let units = 0
    if (phase) {
      report('scan')
      for (const node of packedWordTexts(root, source.text.length, limits, reuse)) {
        if (node !== undefined) {
          if ('cached' in node) {
            units += node.units + Number(texts > 0 && node.texts > 0)
            texts += node.texts
          } else units += node.textLength(['value']) + Number(texts++ > 0)
          admit(units, texts, true)
        }
        yield
      }
      const bytes = admit(units, texts, true)
      workspace.resize(bytes, bytes)
    }
    buffer = PackedWordBuffer.create(units)
    if (phase) report('read')
    yield
    let readTexts = 0
    for (const node of packedWordTexts(root, source.text.length, limits, reuse)) {
      if (node !== undefined) {
        if (!phase) {
          if ('cached' in node) {
            units += node.units + Number(texts > 0 && node.texts > 0)
            texts += node.texts
          } else units += node.textLength(['value']) + Number(texts++ > 0)
          const bytes = admit(units, texts, true)
          // Admit the complete next leaf, separators, collector and eventual whole-string
          // Intl input before copying any of it. A failed resize keeps the old charge.
          workspace.resize(bytes, bytes)
          buffer.grow(units)
        }
        if ('cached' in node) {
          if (readTexts > 0 && node.texts > 0) buffer.append(' ')
          readTexts += node.texts
          for (const chunk of node.chunks) {
            for (let offset = 0; offset < chunk.length; offset += 4098) {
              buffer.append(chunk.slice(offset, offset + 4098))
              yield
            }
          }
          yield
          continue
        }
        if (readTexts++ > 0) buffer.append(' ')
        const cached = node.cachedText(['value'])
        if (cached !== undefined) buffer.append(cached)
        else
          for (const chunk of node.textSteps(['value'], validationStreamLimits)) {
            if (chunk !== undefined) buffer.append(chunk)
            yield
          }
      }
      yield
    }
    // Preserve the complete final admission check even when the document has no leaves.
    admit(units, texts, true)
    if (readTexts !== texts) invalidPackedSemantic()
    report('join')
    yield
    const prose = buffer.finish()
    yield* checkPackedWordCount(prose, expected, report)
  } catch (error) {
    failed = true
    throw error
  } finally {
    finishPackedCleanup([() => buffer?.close(), () => workspace?.release()], failed)
  }
}
