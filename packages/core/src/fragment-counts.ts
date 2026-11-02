import type { Nodes } from 'mdast'
import type { MarkdownFragment } from './markdown-fragment'
import type { PackedCapture, PackedItems, PackedReadScope } from './packing-capture'
import type { PackedPath } from './packing-view'
import type { PackedWordBaseline } from './packing-word-baseline'
import { finishPackedSteps } from './packing-work'
import { countCodePoints } from './text-count'

type CountPatch = Pick<MarkdownFragment, 'children' | 'start' | 'remove' | 'source'>

export interface CountLimits {
  staging: number
  nodes: number
  depth: number
}

/** Internal to the attested metadata builder; it supplies verified identity/root and limits.
 * Exact whole-document prose spelling and bounded scratch, without a full native root.
 * Optional cached subtree chunks already have independent admission in the same owner.
 */
export function countFragmentDocument(
  capture: PackedCapture,
  root: PackedPath,
  patch: CountPatch,
  limits: CountLimits,
  baseline?: PackedWordBaseline,
) {
  if (!baseline?.matchesBase(capture)) return countDocument(capture, root, patch, limits)
  let result: ReturnType<typeof countDocument> | undefined
  const inspection = baseline.inspect(function* () {
    yield
    result = countDocument(capture, root, patch, limits, baseline)
  })
  try {
    const complete = finishPackedSteps(inspection)
    capture.identity
    if (complete !== true || !result) throw new Error('Word baseline closed during fragment counts')
    return result
  } finally {
    inspection.return()
  }
}

function countDocument(
  capture: PackedCapture,
  root: PackedPath,
  patch: CountPatch,
  limits: CountLimits,
  baseline?: PackedWordBaseline,
) {
  const chunks: string[] = []
  let pieces: string[] = []
  let pieceLength = 0
  let units = 0
  let values = 0
  let nodes = 0
  let staging = 0
  const frames: PackedItems[] = []
  const stage = (extra = 0) => {
    // Stored chunks + final join + largest transient Intl segment, plus readers/short pieces.
    const needed =
      8192 + units * 6 + chunks.length * 96 + pieces.length * 96 + frames.length * 1024 + extra
    if (needed > limits.staging) throw new Error('Fragment counts exceed staging limit')
    staging = Math.max(staging, needed)
  }
  const appendPiece = (value: string) => {
    stage(value.length * 2 + 256)
    pieces.push(value)
    pieceLength += value.length
    if (pieceLength >= 4096 || pieces.length >= 256) {
      chunks.push(pieces.join(''))
      pieces = []
      pieceLength = 0
    }
  }
  const append = (value: string) => {
    units += value.length + Number(values++ > 0)
    if (values > 1) appendPiece(' ')
    appendPiece(value)
  }
  const visit = (scope: PackedReadScope) => {
    if (++nodes > limits.nodes) throw new Error('Fragment counts node limit')
    if (frames.length + 1 > limits.depth) throw new Error('Fragment counts depth limit')
    stage(8192)
    const type = scope.scalar(['type'], { retained: 1024, staging: 1024 })
    if (type === 'text') {
      // Borrow existing short strings. Stream long/overlaid text so counting a small
      // edit never needs a second complete scalar spelling of an unchanged paragraph.
      const cached = scope.cachedText(['value'])
      if (cached !== undefined) {
        stage(32 + cached.length * 10)
        append(cached)
      } else {
        const length = scope.textLength(['value'])
        const separator = values++ > 0
        units += length + Number(separator)
        const cost = scope.textStepCost(['value'])
        stage(cost.retained + cost.workspace + 4098 * 2 + 256)
        if (separator) appendPiece(' ')
        const text = scope.textSteps(['value'], {
          retained: limits.staging,
          staging: limits.staging,
        })
        let read = 0
        try {
          for (const chunk of text) {
            if (chunk !== undefined) {
              read += chunk.length
              appendPiece(chunk)
            }
          }
          if (read !== length) throw new Error('Invalid fragment count text length')
        } finally {
          text.return()
        }
      }
    } else if (scope.hasField('children')) {
      if (frames.length >= limits.depth) throw new Error('Fragment counts depth limit')
      stage(1024)
      frames.push(scope.elements(['children']))
    }
  }
  const packed = (scope: PackedReadScope) => {
    const cached = baseline?.find(scope)
    if (cached) {
      nodes += cached.nodes
      if (nodes > limits.nodes) throw new Error('Fragment counts node limit')
      if (cached.depth > limits.depth) throw new Error('Fragment counts depth limit')
      if (cached.maximum > patch.source.text.length)
        throw new Error('Fragment count text exceeds source length')
      const separator = values > 0 && cached.texts > 0
      units += cached.units + Number(separator)
      stage(4098 * 2 + 256)
      if (separator) appendPiece(' ')
      values += cached.texts
      for (const chunk of cached.chunks)
        for (let at = 0; at < chunk.length; at += 4098) {
          appendPiece(chunk.slice(at, at + 4098))
          baseline?.assertOpen()
          capture.identity
        }
      return
    }
    try {
      visit(scope)
      while (frames.length) {
        const iterator = frames.at(-1)
        if (!iterator) throw new Error('Missing fragment count frame')
        const item = iterator.next()
        if (item.done) frames.pop()
        else visit(item.value)
      }
    } finally {
      for (const frame of frames) frame.return()
      frames.length = 0
    }
  }
  const native = () => {
    const pending: { node: Nodes; depth: number }[] = []
    for (let index = patch.children.length - 1; index >= 0; index--) {
      const node = patch.children[index]
      if (node) pending.push({ node, depth: 1 })
    }
    while (pending.length) {
      stage(pending.length * 128)
      const item = pending.pop()
      if (!item) break
      if (++nodes > limits.nodes) throw new Error('Fragment counts node limit')
      if (item.depth > limits.depth) throw new Error('Fragment counts depth limit')
      if (item.node.type === 'text') append(item.node.value)
      if ('children' in item.node) {
        stage((pending.length + item.node.children.length) * 128)
        for (let index = item.node.children.length - 1; index >= 0; index--) {
          const child = item.node.children[index]
          if (child) pending.push({ node: child, depth: item.depth + 1 })
        }
      }
    }
  }
  stage()
  let index = 0
  for (const item of capture.reader.elements([...root, 'children'])) {
    if (index === patch.start) native()
    if (index < patch.start || index >= patch.start + patch.remove) packed(item)
    index++
  }
  if (index === patch.start) native()
  if (pieces.length) chunks.push(pieces.join(''))
  stage()
  const prose = chunks.join('')
  // The six-byte-per-unit reservation covers prose + ICU input + the largest segment.
  // Collection chunks must stop retaining a fourth complete spelling before Intl starts.
  chunks.length = 0
  pieces.length = 0
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
  let words = 0
  for (const segment of segmenter.segment(prose)) if (segment.isWordLike) words++
  return { words, characters: countCodePoints(patch.source.text), stagingBytes: staging }
}
