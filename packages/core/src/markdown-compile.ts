import type { Root, RootContent } from 'mdast'
import { type Extension, fromMarkdown, type Transform } from 'mdast-util-from-markdown'
import remarkGfm from 'remark-gfm'
import { unified } from 'unified'
import { createMarkdownResolverSteps } from './markdown-inline-resolve-steps'
import { markdownPostprocessSteps } from './markdown-postprocess-steps'
import type { MarkdownGrammar } from './parse'

// Only the pinned GFM autolink transform is block-local. Derive its function identity
// from a separate, GFM-only processor; new application transforms fail the compiler guard.
const blockTransforms: Transform[] = []
function collectTransforms(extensions: (Extension | Extension[])[]): void {
  for (const extension of extensions)
    if (Array.isArray(extension)) collectTransforms(extension)
    else blockTransforms.push(...(extension.transforms ?? []))
}
collectTransforms(unified().use(remarkGfm).freeze().data('fromMarkdownExtensions') ?? [])
if (blockTransforms.length !== 1) throw new Error('Unsupported GFM block transform configuration')

/** One compiler configuration for streamed and complete application roots. Native
 * tokenization, global references, positions and audited block-local transforms remain.
 */
export function markdownCompileSteps(source: string, { processor, gfm }: MarkdownGrammar) {
  const options = {
    extensions: processor.data('micromarkExtensions') ?? [],
    mdastExtensions: processor.data('fromMarkdownExtensions') ?? [],
    _manuslipEventSpans: true,
    _manuslipBlockStream: true,
    _manuslipBlockTokenSteps: true,
    _manuslipBlockPreprocessSteps: true,
    _manuslipBlockCompileSteps: true,
    _manuslipBlockPostprocessSteps: markdownPostprocessSteps,
    _manuslipBlockTextResolveSteps: createMarkdownResolverSteps(
      processor.data('micromarkExtensions') ?? [],
      gfm,
    ),
    _manuslipBlockTransforms: gfm ? blockTransforms : [],
  }
  const iterator = fromMarkdown(source, options) as unknown as Generator<
    RootContent | undefined,
    Root | undefined
  >
  if (typeof iterator.next !== 'function') throw new Error('Missing private block-stream parser')
  return iterator
}

/** Synchronous whole-root API. Retain every handed-off child; publish only the complete
 * root. Gap-buffer inline resolution avoids repeatedly shifting the remaining events.
 */
export function compileMarkdownRoot(source: string, grammar: MarkdownGrammar): Root {
  const iterator = markdownCompileSteps(source, grammar)
  const children: RootContent[] = []
  let complete = false
  try {
    while (true) {
      const step = iterator.next()
      if (step.done) {
        const root = step.value
        if (!root || root.children.length) throw new Error('Incomplete private block stream')
        root.children = children
        complete = true
        return root
      }
      if (step.value !== undefined) children.push(step.value)
    }
  } finally {
    iterator.return(undefined)
    if (!complete) children.length = 0
  }
}
