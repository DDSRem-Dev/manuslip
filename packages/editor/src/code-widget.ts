import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { classHighlighter, highlightTree } from '@lezer/highlight'
import { semanticLimits, utf8Bytes } from '@manuslip/core'

/** Called only for mounted widgets; long code retains its already escaped plain text. */
export async function highlightCode(
  container: HTMLElement,
  name: string,
  signal: AbortSignal,
): Promise<void> {
  const text = container.textContent || ''
  if (utf8Bytes(text) > semanticLimits.codeBytes || signal.aborted) return
  const description = LanguageDescription.matchLanguageName(languages, name, true)
  if (!description) return
  const support = await description.load()
  if (signal.aborted) return
  const fragment = document.createDocumentFragment()
  let position = 0
  highlightTree(support.language.parser.parse(text), classHighlighter, (from, to, classes) => {
    if (from > position) fragment.append(document.createTextNode(text.slice(position, from)))
    const token = document.createElement('span')
    token.className = classes
    token.textContent = text.slice(from, to)
    fragment.append(token)
    position = to
  })
  if (position < text.length) fragment.append(document.createTextNode(text.slice(position)))
  if (!signal.aborted) container.replaceChildren(fragment)
}
