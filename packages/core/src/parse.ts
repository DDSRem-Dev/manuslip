import type { Nodes, Root, RootContent } from 'mdast'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import {
  parserVersion,
  type SemanticBlock,
  type SemanticDocument,
  SemanticLimitError,
  semanticLimits,
  sourceHash,
  utf8Bytes,
} from './contracts'
import { remarkDefinitionList } from './definition-list'
import { remarkExtendedInline } from './extended-markdown'
import { compileMarkdownRoot } from './markdown-compile'
import { PackedWork } from './packing-work'
import { describeBlock, describeHeading } from './semantic-description'
import { countCodePoints } from './text-count'

export { plainText } from './semantic-description'

declare module 'unified' {
  interface Settings {
    /** Pinned private mdast path; review when changing the application extensions. */
    _manuslipEventSpans?: boolean
  }
}

const commonmark = unified()
  .data('settings', { _manuslipEventSpans: true })
  .use(remarkParse)
  .freeze()
const withoutGfm = commonmark()
  .use(remarkFrontmatter, ['yaml', 'toml'])
  .use(remarkMath)
  .use(remarkExtendedInline)
  .use(remarkDefinitionList)
  .freeze()
function gfmProcessor(ignoredConstructs: readonly string[] = []) {
  const result = commonmark()
    .use(remarkGfm, { singleTilde: false })
    .use(remarkFrontmatter, ['yaml', 'toml'])
    .use(remarkMath)
    .use(remarkExtendedInline)
    .use(remarkDefinitionList)
  if (ignoredConstructs.length)
    result.use(function () {
      const data = this.data()
      // Public micromark extension records. Clone the records rather than modifying
      // remark-gfm's shared constructs or the independently configured full processor.
      data.micromarkExtensions = data.micromarkExtensions?.map((extension) => {
        const copy = { ...extension }
        for (const hook of ['text', 'flow'] as const) {
          const constructs = extension[hook]
          if (constructs)
            copy[hook] = Object.fromEntries(
              Object.entries(constructs).map(([code, value]) => [
                code,
                (Array.isArray(value) ? value : value ? [value] : []).filter(
                  (construct) => !ignoredConstructs.includes(construct.name ?? ''),
                ),
              ]),
            )
        }
        return copy
      })
    })
  return result.freeze()
}
const processor = gfmProcessor()
const guardedConstructs = ['emailAutolink', 'table', 'wwwAutolink', 'protocolAutolink'] as const
const guardedProcessors = Array.from({ length: 16 }, (_, mask) =>
  mask ? gfmProcessor(guardedConstructs.filter((_, index) => mask & (1 << index))) : processor,
)

// GFM's email tokenizer attempts almost every word, even in a document with no
// possible GFM construct. Any marker, escape/entity or literal-www candidate
// conservatively selects a GFM-capable processor. Math/frontmatter stay enabled.
export function needsGfm(source: string): boolean {
  return /[|~@:[\]&\\]/.test(source) || /www\./i.test(source)
}

export interface MarkdownGrammar {
  readonly gfm: boolean
  readonly processor: ReturnType<typeof markdownProcessor>
}

const grammarMarkers = /[|~@:[\]&\\]/
const grammarWww = /www\./i
const grammarCandidates = [/[@&\\]/, /[|&\\]|:-|-:/, /[&\\]|www\./i, /[&\\]|https?:\/\//i]
// The longest literal is eight units (https://). Keep seven units of overlap while
// bounding each native regex input, including that context, to 4,096 UTF-16 units.
const grammarOverlapUnits = 7
const grammarChunkUnits = 4096 - grammarOverlapUnits

/** Internal cooperative equivalent of needsGfm + markdownProcessor. Classification
 * alone uses bounded slices; the parser still receives the original complete source.
 * Regexes are stateless and preserve the ordinary guards' exact ignore-case behavior.
 */
export function markdownGrammarSteps(
  source: string,
  syntax: 'manuslip' | 'commonmark',
): PackedWork<MarkdownGrammar> {
  const work = new PackedWork<MarkdownGrammar>(
    (function* () {
      if (syntax !== 'manuslip')
        return { gfm: false, processor: syntax === 'commonmark' ? commonmark : withoutGfm }
      let gfm = false
      let mask = 15
      for (let at = 0; at < source.length; at += grammarChunkUnits) {
        const end = Math.min(at + grammarChunkUnits, source.length)
        const chunk = source.slice(Math.max(0, at - grammarOverlapUnits), end)
        if (!gfm) gfm = grammarMarkers.test(chunk) || grammarWww.test(chunk)
        for (let index = 0; index < grammarCandidates.length; index++)
          if (mask & (1 << index) && grammarCandidates[index]?.test(chunk)) mask &= ~(1 << index)
        if (end - at === grammarChunkUnits) yield
        // All guards are already enabled. Later source cannot narrow this selection.
        if (gfm && mask === 0) break
      }
      return { gfm, processor: gfm ? (guardedProcessors[mask] ?? processor) : withoutGfm }
    })(),
    () => {},
  )
  return work
}

export function parseMarkdown(
  source: string,
  syntax: 'manuslip' | 'commonmark' = 'manuslip',
): SemanticDocument {
  return parseMarkdownWithGrammar(source, syntax, syntax === 'manuslip' && needsGfm(source))
}

/** Independent original whole-root construction for differential tests and diagnostics. */
export function parseMarkdownNative(
  source: string,
  syntax: 'manuslip' | 'commonmark' = 'manuslip',
): SemanticDocument {
  return parseMarkdownWithGrammar(source, syntax, syntax === 'manuslip' && needsGfm(source), true)
}

/** Internal fragment entry: use the verified whole document's grammar, not the slice's markers. */
export function parseMarkdownWithGrammar(
  source: string,
  syntax: 'manuslip' | 'commonmark',
  fullGfm: boolean,
  native = false,
): SemanticDocument {
  if (utf8Bytes(source) > semanticLimits.previewBytes)
    throw new SemanticLimitError('Document exceeds Live Preview size limit')
  const started = performance.now()
  const gfm = syntax === 'manuslip' && fullGfm
  const processor = markdownProcessor(source, syntax, fullGfm)
  const root = native
    ? (processor.parse(source) as Root)
    : compileMarkdownRoot(source, { processor, gfm })
  const parsed = performance.now()
  const blocks: SemanticBlock[] = []
  const outline: SemanticDocument['outline'] = []
  const text: string[] = []
  let nodes = 0
  const visit = (node: Nodes): void => {
    // The task-list mdast extension initializes this even for ordinary list items.
    if (syntax === 'manuslip' && !gfm && node.type === 'listItem') node.checked = null
    // Bound traversal even for deeply nested container input; no recursive user-controlled stack.
    if (++nodes > semanticLimits.blocks * 16)
      throw new SemanticLimitError('Document syntax exceeds semantic limits')
    const block = describeBlock(node, source)
    if (block) {
      if (blocks.length >= semanticLimits.blocks)
        throw new SemanticLimitError('Document exceeds Live Preview block limit')
      blocks.push(block)
    }
    const heading = describeHeading(node)
    if (heading) outline.push(heading)
    if (node.type === 'text') text.push(node.value)
  }
  const pending: Nodes[] = [root]
  while (pending.length) {
    const node = pending.pop()
    if (!node) break
    visit(node)
    if ('children' in node)
      for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index]
        if (child) pending.push(child)
      }
  }
  const prose = text.join(' ')
  // Intl segmentation counts CJK words as words rather than treating each paragraph as one.
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
  let words = 0
  for (const segment of segmenter.segment(prose)) if (segment.isWordLike) words++
  return {
    root,
    blocks,
    outline,
    counts: { words, characters: countCodePoints(source) },
    sourceHash: sourceHash(source),
    timings: { parse: parsed - started, describe: performance.now() - parsed },
    parserVersion: `${parserVersion}/${syntax}`,
  }
}

export function nodeRange(node: RootContent): { from: number; to: number } | null {
  const from = node.position?.start.offset
  const to = node.position?.end.offset
  return from === undefined || to === undefined ? null : { from, to }
}

/** Internal frozen application grammar shared by whole-tree and block consumers. */
export function markdownProcessor(
  source: string,
  syntax: 'manuslip' | 'commonmark',
  fullGfm: boolean,
) {
  const gfm = syntax === 'manuslip' && fullGfm
  // Email literals require @. Entities/escapes can produce it during mdast transforms,
  // so conservatively keep the original full grammar whenever either spelling occurs.
  const skipEmail = gfm && !/[@&\\]/.test(source)
  // A successful GFM table requires a literal pipe or an aligned single-column
  // delimiter (:- or -:). Pipe-free unaligned delimiters are setext headings or
  // thematic breaks. Keep entities/escapes conservatively, as with email literals.
  const skipTable = gfm && !/[|&\\]|:-|-:/.test(source)
  // Literal autolinks require their complete prefix. Preserve entities/escapes
  // conservatively and keep every mdast transform, including decoded autolinks.
  const skipWww = gfm && !/[&\\]|www\./i.test(source)
  const skipProtocol = gfm && !/[&\\]|https?:\/\//i.test(source)
  // Keep all mdast transforms and every construct that could succeed for this source.
  const selectedGfm =
    guardedProcessors[
      Number(skipEmail) + 2 * Number(skipTable) + 4 * Number(skipWww) + 8 * Number(skipProtocol)
    ] ?? processor
  return syntax === 'commonmark' ? commonmark : gfm ? selectedGfm : withoutGfm
}
