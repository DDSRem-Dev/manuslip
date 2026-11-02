import { StateField, type Text } from '@codemirror/state'

function metadataEnd(doc: Text): number {
  const fence = doc.line(1).text.match(/^(---|\+\+\+)[\t ]*$/)?.[1]
  if (!fence) return 0
  let offset = doc.line(1).to + 1
  for (const line of doc.iterLines(2)) {
    if (line.trimEnd() === fence) return offset + line.length
    offset += line.length + 1
  }
  // An unclosed opening fence is ordinary Markdown, matching the semantic parser.
  return 0
}

/** Keep metadata literal in live mode without copying the document or styling its contents. */
export const frontmatterEnd = StateField.define<number>({
  create: (state) => metadataEnd(state.doc),
  update: (end, transaction) => {
    if (!transaction.docChanged) return end
    if (end && !transaction.changes.touchesRange(0, end)) return end
    return metadataEnd(transaction.newDoc)
  },
})
