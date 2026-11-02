import type { Element, Nodes, Root } from 'hast'
import type { ReadingOptions } from './reading'

const range = (node: Nodes): string => `${node.position?.start.offset}:${node.position?.end.offset}`

/** Shared whole-document and sequenced reading markup. Input HAST is caller-owned. */
export class ReadingDecoration {
  readonly #byRange
  readonly #units
  constructor(private readonly reading: ReadingOptions) {
    this.#byRange = new Map(reading.blocks.map((block) => [`${block.from}:${block.to}`, block]))
    this.#units = new Set(reading.units.map((unit) => `${unit.from}:${unit.to}`))
  }
  wrap(tree: Root, source: boolean): void {
    const reading = this.reading
    const sourceLanguage = reading.sourceLanguage === 'auto' ? '' : reading.sourceLanguage
    const visit = (node: Nodes): void => {
      if (node.type === 'element' && !source && this.#units.has(range(node)))
        node.properties.lang = reading.translated.has(range(node))
          ? reading.targetLanguage
          : sourceLanguage
      if ('children' in node) for (const child of node.children) visit(child)
    }
    visit(tree)
    tree.children = tree.children.flatMap((node) => {
      if (node.type === 'text' && !node.value.trim()) return []
      const block =
        this.#byRange.get(range(node)) ??
        (node.type === 'element' && node.properties.dataFootnotes !== undefined
          ? reading.blocks.find((block) => block.kind === 'footnotes')
          : undefined)
      if (!block) return [node]
      return [
        {
          type: 'element',
          tagName: 'div',
          properties: {
            dataReadingBlock: block.id,
            className: [source ? 'reading-original' : 'reading-translation'],
            dir: 'auto',
            ...(reading.layout === 'replace'
              ? {}
              : {
                  lang: source ? sourceLanguage : reading.targetLanguage,
                  ariaLabel: source ? reading.labels.original : reading.labels.translation,
                  role: 'group',
                }),
          },
          children: [node],
        } as Element,
      ]
    })
  }
  compose(tree: Root, original: Root | null): void {
    const reading = this.reading
    if (!original) {
      tree.children = [
        {
          type: 'element',
          tagName: 'div',
          properties: {
            className: ['reading-replace'],
            lang: reading.targetLanguage,
            dir: 'auto',
            ariaLabel: reading.labels.translation,
            role: 'group',
          },
          children: tree.children.filter((node) => node.type !== 'doctype'),
        },
      ]
      return
    }
    const sources = new Map(
      original.children
        .filter((node): node is Element => node.type === 'element')
        .map((node) => [node.properties.dataReadingBlock, node]),
    )
    tree.children = tree.children.map((node) => {
      if (node.type !== 'element' || !node.properties.dataReadingBlock) return node
      const id = node.properties.dataReadingBlock
      const source = sources.get(id)
      if (!source) return node
      delete source.properties.dataReadingBlock
      delete node.properties.dataReadingBlock
      return {
        type: 'element',
        tagName: 'div',
        properties: { className: ['reading-pair'], dataReadingBlock: id },
        children: [source, node],
      } as Element
    })
    tree.children = [
      {
        type: 'element',
        tagName: 'div',
        properties: { className: ['reading-layout', `reading-${reading.layout}`] },
        children: tree.children.filter((node) => node.type !== 'doctype'),
      },
    ]
  }
}
