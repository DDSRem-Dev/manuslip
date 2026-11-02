import { parseMarkdown } from '@manuslip/core'
import { describe, expect, it } from 'vitest'
import { frontmatterEnd } from '../../src/frontmatter'
import { createSourceState, EditorSelection, selectionInCode } from '../../src/index'
import { editorSyntax, maxEditorInlineLength } from '../../src/syntax'

describe('bounded editor inline syntax', () => {
  it('keeps closed frontmatter literal and recognizes edits that close or remove it', () => {
    for (const fence of ['---', '+++']) {
      const source = `${fence}\ntitle: **literal**\n${fence}\n\n# Actual heading`
      let state = createSourceState(source)
      const end = source.indexOf('\n\n')
      expect(state.field(frontmatterEnd)).toBe(end)
      state = state.update({ changes: { from: state.doc.length, insert: '\nAfter' } }).state
      expect(state.field(frontmatterEnd)).toBe(end)
      state = state.update({ changes: { from: end - 3, to: end } }).state
      expect(state.field(frontmatterEnd)).toBe(0)
      state = state.update({ changes: { from: end - 3, insert: fence } }).state
      expect(state.field(frontmatterEnd)).toBe(end)
    }
    expect(createSourceState('---\nUnclosed **Markdown**').field(frontmatterEnd)).toBe(0)
    expect(
      createSourceState('Paragraph\n\n---\ntitle: **Markdown**\n---').field(frontmatterEnd),
    ).toBe(0)
  })
  it('retains ordinary inline parsing and surrounding block structure', () => {
    const source = `# Heading\n\n${'x'.repeat(maxEditorInlineLength)} **large**\n\n**ordinary** and \`code\`\n`
    const tree = editorSyntax.language.parser.parse(source)
    const paragraph = tree.topNode.getChildren('Paragraph')
    expect(tree.topNode.getChild('ATXHeading1')).not.toBeNull()
    expect(paragraph).toHaveLength(2)
    expect(paragraph[0]?.getChild('UnparsedInline')?.to).toBe(source.indexOf('\n\n**ordinary**'))
    expect(paragraph[0]?.getChild('StrongEmphasis')).toBeNull()
    expect(paragraph[1]?.getChild('StrongEmphasis')).not.toBeNull()
    expect(paragraph[1]?.getChild('InlineCode')).not.toBeNull()
  })

  it('treats unknown inline context conservatively for image paste and preserves edits', () => {
    const source = `${'x'.repeat(maxEditorInlineLength)} \`image paste must stay text\``
    let state = createSourceState(source)
    state = state.update({ selection: EditorSelection.cursor(source.length - 2) }).state
    expect(selectionInCode(state)).toBe(true)
    state = state.update({ changes: { from: source.length, insert: ' appended' } }).state
    expect(state.doc.toString()).toBe(`${source} appended`)
    const small = createSourceState('ordinary paragraph')
    expect(selectionInCode(small)).toBe(false)
  })

  it('retains full semantic inline structure beyond the editor syntax limit', () => {
    const source = `${'x'.repeat(maxEditorInlineLength)} **strong** and \`code\` and [link][r]\n\n[r]: https://example.invalid/`
    const document = parseMarkdown(source)
    const paragraph = document.root.children[0]
    if (paragraph?.type !== 'paragraph') throw new Error('Missing semantic paragraph')
    expect(paragraph.children.map((node) => node.type)).toEqual([
      'text',
      'strong',
      'text',
      'inlineCode',
      'text',
      'linkReference',
    ])
    expect(document.root.children[1]?.type).toBe('definition')
    expect(document.counts.characters).toBe([...source].length)
  })
})
