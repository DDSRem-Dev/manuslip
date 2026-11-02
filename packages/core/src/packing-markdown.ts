import { parserVersion, sourceHash } from './contracts'
import {
  type MarkdownBlockSummary,
  markdownBlockSteps,
  markdownPreparedBlockSteps,
} from './markdown-block-stream'
import { packStreamedValueSteps } from './packing'
import { finishPackedCleanup } from './packing-cleanup'
import type { PackedEncodingLimits } from './packing-encode-budget'
import { PackedArrayInput } from './packing-input-array'
import { isPackedSource, type PackedSource } from './packing-source'
import type { PackedWork } from './packing-work'

interface PackedMarkdownInput {
  value: unknown
  arrays: readonly PackedArrayInput[]
}

/** Internal parser/encoder composition. Full native children are handed directly into
 * one complete SemanticDocument packet, sharing the normal shape/string/position tables.
 * Only the current compiler span, active encoding subtree and semantic metadata need
 * native ownership. The parser's native allocations remain outside the encoder ledger.
 */
export function packMarkdownDocumentSteps(
  source: string,
  byteLimit: number,
  limits: PackedEncodingLimits,
  syntax: 'manuslip' | 'commonmark' = 'manuslip',
  admitOutput?: (bytes: number) => void,
): PackedWork<ArrayBuffer> {
  const parser = markdownBlockSteps(source, syntax)
  return encodeMarkdownDocument(parser, sourceHash(source), byteLimit, limits, syntax, admitOutput)
}

/** Reuse the validated immutable source's exact cap and hash; prototype forgery cannot
 * authorize this path. The existing string API keeps its immediate guards and failures.
 */
export function packPreparedMarkdownDocumentSteps(
  source: PackedSource,
  byteLimit: number,
  limits: PackedEncodingLimits,
  syntax: 'manuslip' | 'commonmark' = 'manuslip',
  admitOutput?: (bytes: number) => void,
): PackedWork<ArrayBuffer> {
  if (!isPackedSource(source)) throw new Error('Invalid prepared packed source')
  return encodeMarkdownDocument(
    markdownPreparedBlockSteps(source, syntax),
    source.identity.sourceHash,
    byteLimit,
    limits,
    syntax,
    admitOutput,
  )
}

function encodeMarkdownDocument(
  parser: ReturnType<typeof markdownBlockSteps>,
  hash: string,
  byteLimit: number,
  limits: PackedEncodingLimits,
  syntax: 'manuslip' | 'commonmark',
  admitOutput?: (bytes: number) => void,
): PackedWork<ArrayBuffer> {
  const prepared = markdownDocumentInput(parser, hash, syntax)
  const inputs = prepared.arrays ?? []
  try {
    return packStreamedValueSteps(prepared.value, byteLimit, limits, inputs, admitOutput)
  } catch (error) {
    finishPackedCleanup(
      inputs.map((input) => () => input.return()),
      true,
    )
    throw error
  }
}

/** Internal parser handoff. Its private metadata graph is reachable only from
 * the returned value and live one-shot array iterators, never a snapshot root getter.
 */
export function preparedMarkdownDocumentInput(
  source: PackedSource,
  syntax: 'manuslip' | 'commonmark' = 'manuslip',
): PackedMarkdownInput {
  if (!isPackedSource(source)) throw new Error('Invalid prepared packed source')
  return markdownDocumentInput(
    markdownPreparedBlockSteps(source, syntax),
    source.identity.sourceHash,
    syntax,
  )
}

function markdownDocumentInput(
  parser: ReturnType<typeof markdownBlockSteps>,
  hash: string,
  syntax: 'manuslip' | 'commonmark',
): PackedMarkdownInput {
  let summary: MarkdownBlockSummary | undefined
  const position = {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 1, offset: 0 },
  }
  const counts = { words: 0, characters: 0 }
  const timings = { parse: 0, describe: 0 }
  const completed = () => {
    if (!summary) throw new Error('Incomplete packed Markdown document')
    return summary
  }
  const children = new PackedArrayInput(parser, (value) => {
    summary = value as MarkdownBlockSummary | undefined
    const result = completed()
    if (!result.root.position) throw new Error('Incomplete packed Markdown root')
    // These containers are private and have not been visited yet. Their references
    // stay stable in the encoder's already captured root/document property lists.
    Object.assign(position, result.root.position)
    Object.assign(counts, result.counts)
    Object.assign(timings, result.timings)
  })
  const blocks = new PackedArrayInput(
    (function* () {
      yield* completed().blocks
    })(),
  )
  const outline = new PackedArrayInput(
    (function* () {
      yield* completed().outline
    })(),
  )
  return {
    value: {
      root: { type: 'root', children, position },
      blocks,
      outline,
      counts,
      sourceHash: hash,
      timings,
      parserVersion: `${parserVersion}/${syntax}`,
    },
    arrays: [children, blocks, outline],
  }
}
