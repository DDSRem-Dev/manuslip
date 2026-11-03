import { yamlLanguage } from '@codemirror/lang-yaml'
import { Language, type LanguageSupport, language, languageDataProp } from '@codemirror/language'
import { type EditorState, type Extension, StateField } from '@codemirror/state'
import {
  type Input,
  NodeType,
  Parser,
  type PartialParse,
  parseMixed,
  Tree,
  type TreeFragment,
} from '@lezer/common'
import { frontmatterEnd } from './frontmatter'

const metadataType = NodeType.define({ id: 1, name: 'FrontmatterContent' })
const bodyType = NodeType.define({ id: 2, name: 'Body' })

interface MetadataSyntax {
  from: number
  to: number
  end: number
  language: Language
}

// Use the same fence boundaries as the editor's metadata field. The stock YAML
// frontmatter grammar requires exact --- lines and rejects valid trailing spaces.
class MetadataParser extends Parser {
  constructor(
    private readonly root: NodeType,
    private readonly metadata: Omit<MetadataSyntax, 'language'>,
    private readonly content: Parser,
  ) {
    super()
  }

  createParse(
    input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[],
  ): PartialParse {
    const { from, to, end } = this.metadata
    const bodyFrom = Math.min(end + 1, input.length)
    const tree = new Tree(
      this.root,
      [
        new Tree(metadataType, [], [], to - from),
        new Tree(bodyType, [], [], input.length - bodyFrom),
      ],
      [from, bodyFrom],
      input.length,
    )
    let stoppedAt: number | null = null
    const outer: PartialParse = {
      parsedPos: input.length,
      get stoppedAt() {
        return stoppedAt
      },
      stopAt(position) {
        stoppedAt = position
      },
      advance: () => tree,
    }
    return parseMixed((node) =>
      node.type === metadataType
        ? { parser: yamlLanguage.parser }
        : node.type === bodyType
          ? { parser: this.content }
          : null,
    )(outer, input, fragments, ranges)
  }
}

export function frontmatterSyntax(content: LanguageSupport): Extension {
  const root = NodeType.define({
    id: 0,
    name: 'Document',
    top: true,
    props: [[languageDataProp, content.language.data]],
  })
  const configure = (state: EditorState, previous?: MetadataSyntax): MetadataSyntax => {
    const end = state.doc.sliceString(0, 3) === '---' ? state.field(frontmatterEnd) : 0
    const from = end ? state.doc.line(1).to + 1 : 0
    const to = end ? state.doc.lineAt(end).from : 0
    if (previous && previous.from === from && previous.to === to && previous.end === end)
      return previous
    return {
      from,
      to,
      end,
      language: end
        ? new Language(
            content.language.data,
            new MetadataParser(root, { from, to, end }, content.language.parser),
          )
        : content.language,
    }
  }
  const syntax = StateField.define<MetadataSyntax>({
    create: (state) => configure(state),
    update: (previous, transaction) => configure(transaction.state, previous),
    provide: (field) => language.from(field, (value) => value.language),
  })
  return [syntax, content]
}
