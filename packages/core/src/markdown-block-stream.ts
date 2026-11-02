import type { Root, RootContent } from 'mdast'
import {
  parserVersion,
  type SemanticBlock,
  type SemanticDocument,
  SemanticLimitError,
  semanticLimits,
  utf8Bytes,
} from './contracts'
import { markdownDescriptionSteps } from './markdown-description-steps'
import { markdownCompileSteps } from './markdown-compile'
import { packedArrayPause } from './packing-input-array'
import { isPackedSource, type PackedSource, packedSourceCharacters } from './packing-source'
import { PackedWork } from './packing-work'
import { type MarkdownGrammar, markdownGrammarSteps } from './parse'

export interface MarkdownBlockSummary extends Omit<SemanticDocument, 'root'> {
  /** Complete root metadata. Children were handed to the consumer in source order. */
  root: Omit<Root, 'children'>
}

/** A scheduling checkpoint, with no completed native block to consume. */
export { packedArrayPause as markdownBlockPause } from './packing-input-array'

/** Internal construction stream for the experimental packed producer. Each advance compiles
 * one complete top-level block from resolved/list-prepared spans. Global definitions and
 * compiler state survive handoffs; only audited block-local transforms run. Handed-off nodes
 * and consumed private events are dropped before advancing. Consumers must keep their output
 * private until the final summary succeeds. The private document tokenizer pauses between
 * bounded groups of source scans and input-code dispatches. Grammar selection yields
 * between bounded slices whose native regex inputs are at most 4,096 UTF-16 units;
 * Resolved span/serialization/list preparation yields between at most 256 cursor advances;
 * compiler dispatch yields between at most 16 events, including within a complete block.
 * Subtokenization walks/copies/gap edits share a 256-advance quota; private child tokenizers
 * yield between writes and after at most 4,096 input-code dispatches. Private EOF attention,
 * strikethrough and nested inside-span/text resolution share one 256-advance quota for
 * dispatch, marker reads, event scans/copies and gap edits. Successful private link/image
 * label resolution parks input and shares this quota with its nested resolvers; EOF
 * unmatched-label cleanup also cooperates. Other EOF/construct resolution,
 * label tokenization/normalization, individual handlers/transforms, prose/heading joining and native
 * segmentation/allocation calls remain atomic and are not memory-admitted. The final whole-prose count
 * yields between groups of at most 16 native iterator calls. Prepared sources reuse their
 * completed local character count and hash; string inputs share a final scan that yields
 * after at most 4,096 UTF-16 units. Block metadata
 * yields between at most 4,096 range-hash reads or 256 child-cursor advances, with a
 * separate checkpoint between native block construction and metadata work.
 */
export function markdownBlockSteps(
  source: string,
  syntax: 'manuslip' | 'commonmark' = 'manuslip',
): PackedWork<MarkdownBlockSummary, RootContent | typeof packedArrayPause> {
  if (utf8Bytes(source) > semanticLimits.previewBytes)
    throw new SemanticLimitError('Document exceeds Live Preview size limit')
  return blockSteps(source, syntax)
}

/** Internal capability entry: the immutable source already passed the exact byte guard. */
export function markdownPreparedBlockSteps(
  source: PackedSource,
  syntax: 'manuslip' | 'commonmark' = 'manuslip',
): PackedWork<MarkdownBlockSummary, RootContent | typeof packedArrayPause> {
  if (!isPackedSource(source)) throw new Error('Invalid prepared packed source')
  return blockSteps(source.text, syntax, source)
}

function blockSteps(
  source: string,
  syntax: 'manuslip' | 'commonmark',
  prepared?: PackedSource,
): PackedWork<MarkdownBlockSummary, RootContent | typeof packedArrayPause> {
  return new PackedWork(
    (function* () {
      // Resolve the native receiver once; every clock read keeps its original boundary.
      const now = performance.now.bind(performance)
      const beforeGrammar = now()
      const grammar = markdownGrammarSteps(source, syntax)
      let parse = now() - beforeGrammar
      let selected: MarkdownGrammar | undefined
      try {
        while (true) {
          const before = now()
          const next = grammar.next()
          parse += now() - before
          if (next.done) {
            selected = next.value
            break
          }
          yield packedArrayPause
        }
      } finally {
        grammar.return()
      }
      if (!selected) throw new Error('Incomplete Markdown grammar selection')
      yield packedArrayPause
      const started = now()
      const { gfm } = selected
      const iterator = markdownCompileSteps(source, selected)
      parse += now() - started
      let describe = 0
      const blocks: SemanticBlock[] = []
      const outline: SemanticDocument['outline'] = []
      const text: string[] = []
      // The whole-tree visitor includes the root in its existing traversal limit.
      const descriptions = { blocks, outline, text, nodes: 1 }
      try {
        while (true) {
          const beforeParse = now()
          const step = iterator.next()
          parse += now() - beforeParse
          const beforeDescribe = now()
          if (step.done) {
            if (!step.value) throw new Error('Incomplete private block stream')
            const { children, ...root } = step.value
            if (children.length) throw new Error('Incomplete private block stream')
            describe += now() - beforeDescribe
            yield packedArrayPause
            let beforeCount = now()
            const prose = text.join(' ')
            text.length = 0
            const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
            let words = 0
            let wordBatch = 0
            for (const segment of segmenter.segment(prose)) {
              if (segment.isWordLike) words++
              if (++wordBatch === 16) {
                describe += now() - beforeCount
                wordBatch = 0
                yield packedArrayPause
                beforeCount = now()
              }
            }
            describe += now() - beforeCount
            yield packedArrayPause
            beforeCount = now()
            let characters: number
            let hash: string
            if (prepared) {
              characters = packedSourceCharacters(prepared)
              hash = prepared.identity.sourceHash
            } else {
              characters = source.length
              let previousHigh = false
              let a = 0x811c9dc5
              let b = 0x9e3779b9
              let sourceBatch = 0
              for (let index = 0; index < source.length; index++) {
                const unit = source.charCodeAt(index)
                if (previousHigh && unit >= 0xdc00 && unit <= 0xdfff) characters--
                previousHigh = unit >= 0xd800 && unit <= 0xdbff
                a = Math.imul(a ^ unit, 0x01000193)
                b = Math.imul(b ^ unit, 0x85ebca6b)
                if (++sourceBatch === 4096) {
                  describe += now() - beforeCount
                  sourceBatch = 0
                  yield packedArrayPause
                  beforeCount = now()
                }
              }
              hash = `${source.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`
            }
            const counts = { words, characters }
            describe += now() - beforeCount
            return {
              root,
              blocks,
              outline,
              counts,
              sourceHash: hash,
              timings: { parse, describe },
              parserVersion: `${parserVersion}/${syntax}`,
            }
          }
          if (step.value === undefined) {
            yield packedArrayPause
            continue
          }
          const description = markdownDescriptionSteps(
            step.value,
            source,
            syntax === 'manuslip' && !gfm,
            descriptions,
          )
          describe += now() - beforeDescribe
          try {
            yield packedArrayPause
            while (true) {
              const before = now()
              const next = description.next()
              describe += now() - before
              if (next.done) {
                if (next.value !== true) throw new Error('Incomplete Markdown block descriptions')
                break
              }
              yield packedArrayPause
            }
          } finally {
            description.return()
          }
          yield step.value
        }
      } finally {
        try {
          iterator.return(undefined)
        } finally {
          text.length = 0
        }
      }
    })(),
    () => {},
  )
}
