import type { Root as HastRoot } from 'hast'
import { toHtml } from 'hast-util-to-html'
import type { Nodes, RootContent } from 'mdast'
import { type ExportSlot, exportSlotSink } from './export'
import type { RenderOptions } from './index'
import { projectHast } from './projection-engine'
import {
  type ProjectionAdmission,
  type ProjectionConversion,
  type ProjectionDefinition,
  ProjectionSequence,
} from './projection-sequence'
import type { ReadingOptions, ReadingProjection } from './reading'
import { readingJsonBytes } from './reading-bytes'
import { ReadingDecoration } from './reading-decoration'
import {
  expandReadingIndex,
  type ReadingIndex,
  readingBlockAttribute,
  readingProjectionBytes,
  readingRowHtml,
} from './reading-index'

/** Native construction, policy/widget scratch and decorated-row serialization are
 * separate phases. Hooks run before each corresponding native allocation path.
 */
export interface ReadingSequenceAdmission extends ProjectionAdmission {
  converted?(converted: ProjectionConversion): void
  project(converted: ProjectionConversion): void
  decorate(tree: HastRoot): void
  serialize(tree: HastRoot): void
  finalize?(): void
}

interface SequenceData {
  options: RenderOptions
  reading: ReadingOptions
  decoration: ReadingDecoration
  source: ProjectionSequence | null
  target: ProjectionSequence
  sourceSlots: ExportSlot[]
  targetSlots: ExportSlot[]
  sourceSink: ReturnType<typeof exportSlotSink>
  targetSink: ReturnType<typeof exportSlotSink>
  rows: ReadingIndex
  dictionary: Map<string, number>
  byId: Map<string, number>
  raw: boolean
  wrapper: string
  bytes: number
  admission?: ReadingSequenceAdmission
  reserve(bytes: number, scratch?: number): void
}

function replacementValue(data: SequenceData, row: number): string {
  const value = data.rows.values[data.rows.order[row] ?? -1]
  if (value === undefined) throw new Error('Invalid replacement row')
  return value
}
const replacementPrefix = '<div data-reading-block="'
const replacementAttributes = '" class="reading-translation" dir="auto">'
const plainReplacementAnchor = /^[a-zA-Z0-9_.:-]+$/
function replacementAnchor(data: SequenceData, row: number): string | undefined {
  if (!data.rows.pairs[row]) return
  const block = data.reading.blocks[data.rows.anchors[row] ?? -1]
  if (!block) throw new Error('Missing replacement anchor')
  return readingBlockAttribute(block.id)
}

function hasRaw(nodes: readonly Nodes[]): boolean {
  for (const node of nodes) {
    if (node.type === 'html') return true
    if ('children' in node && hasRaw(node.children)) return true
  }
  return false
}

/** Reading from separately admitted native blocks, without retaining a complete mdast or
 * HAST. Global definition/footnote state and export-slot numbering span the whole sequence.
 * The caller admits context, each conversion and serialization scratch before native calls.
 * reserve admits persistent row/slot output before retention; it may reject by throwing.
 * Closing releases callbacks/context even if a caller keeps the closed sequence handle.
 */
export class ReadingSequence {
  #data: SequenceData | undefined
  constructor(
    context: readonly ProjectionDefinition[],
    options: RenderOptions,
    reading: ReadingOptions,
    reserve: (bytes: number, scratch?: number) => void,
  ) {
    const bytes = 4096 + reading.blocks.length * 768 + reading.units.length * 128
    reserve(bytes)
    const sourceSlots: ExportSlot[] = [],
      targetSlots: ExportSlot[] = []
    const namespace = crypto.randomUUID()
    const data: SequenceData = {
      options: { ...options },
      reading,
      decoration: new ReadingDecoration(reading),
      source: reading.layout === 'replace' ? null : new ProjectionSequence(context, options),
      target: new ProjectionSequence(context, options, reading.children),
      sourceSlots,
      targetSlots,
      sourceSink: exportSlotSink(`original-${namespace}`, sourceSlots),
      targetSink: exportSlotSink(`translated-${namespace}`, targetSlots),
      rows: { values: [], order: [], pairs: [], anchors: [] },
      dictionary: new Map(),
      byId: new Map(reading.blocks.map((block, index) => [block.id, index])),
      raw: options.rawHtml && hasRaw(context),
      wrapper: '',
      bytes,
      reserve,
    }
    this.#data = data
  }
  #current(): SequenceData {
    if (!this.#data) throw new Error('Reading sequence closed')
    return this.#data
  }
  admit(admission: ReadingSequenceAdmission): void {
    const data = this.#current()
    if (data.admission) throw new Error('Reading admission already installed')
    data.source?.admit(admission)
    data.target.admit(admission)
    data.admission = admission
  }
  /** Source-order complete root children, including definitions that produce no body row. */
  append(node: RootContent): void {
    const data = this.#current()
    try {
      if (data.options.rawHtml && hasRaw([node])) data.raw = true
      const source = data.source?.convert(node) ?? null
      if (source) data.admission?.converted?.(source)
      const target = data.target.convert(node)
      data.admission?.converted?.(target)
      this.#append(data, source, target)
    } catch (error) {
      this.close()
      throw error
    }
  }
  #append(
    data: SequenceData,
    source: ProjectionConversion | null,
    target: ProjectionConversion,
  ): void {
    let original: HastRoot | null = null
    const sink =
      (source: boolean): ReturnType<typeof exportSlotSink> =>
      (element, description) => {
        if (
          ['math', 'inlineMath', 'diagram'].includes(description.kind) &&
          (description.kind !== 'diagram' || element.tagName === 'pre')
        ) {
          const bytes = data.bytes + 768 + description.value.length * 4
          data.reserve(bytes)
          data.bytes = bytes
        }
        ;(source ? data.sourceSink : data.targetSink)(element, description)
      }
    if (source) {
      data.admission?.project(source)
      projectHast(
        source.root,
        source.hast,
        data.options,
        sink(true),
        (tree) => {
          data.admission?.decorate(tree)
          data.decoration.wrap(tree, true)
          original = tree
        },
        source.started,
        () => '',
      )
    }
    data.admission?.project(target)
    projectHast(
      target.root,
      target.hast,
      data.options,
      sink(false),
      (tree) => {
        data.admission?.decorate(tree)
        data.decoration.wrap(tree, false)
        data.decoration.compose(tree, original)
      },
      target.started,
      (tree) => {
        data.admission?.serialize(tree)
        const container = tree.children[0]
        if (container?.type !== 'element' || container.tagName !== 'div')
          throw new Error('Invalid reading container')
        const wrapper = toHtml({ ...container, children: [] })
        if (data.wrapper && data.wrapper !== wrapper) throw new Error('Reading wrapper changed')
        data.wrapper = wrapper
        for (const node of container.children) {
          const pair =
            node.type === 'element' &&
            Array.isArray(node.properties.className) &&
            node.properties.className.includes('reading-pair')
          const id = node.type === 'element' ? node.properties.dataReadingBlock : undefined
          // Share replacement row contents; preserve occurrence IDs in separate anchors.
          // These internal flags never leave the sequence as a bilingual ReadingIndex.
          const replacement = data.reading.layout === 'replace' && typeof id === 'string'
          const html = toHtml(
            (pair || replacement) && node.type === 'element' ? node.children : node,
            {
              allowDangerousHtml: data.options.rawHtml,
            },
          )
          let index = data.dictionary.get(html)
          const bytes = data.bytes + 64 + (index === undefined ? 128 + html.length * 4 : 0)
          data.reserve(bytes)
          data.bytes = bytes
          if (index === undefined) {
            index = data.rows.values.length
            data.rows.values.push(html)
            data.dictionary.set(html, index)
          }
          data.rows.order.push(index)
          data.rows.pairs.push(pair || replacement)
          data.rows.anchors.push(typeof id === 'string' ? (data.byId.get(id) ?? -1) : -1)
        }
        return ''
      },
    )
  }
  finish(): ReadingProjection {
    const data = this.#current()
    try {
      const source = data.source?.finishConversion() ?? null
      if (source) data.admission?.converted?.(source)
      const target = data.target.finishConversion()
      data.admission?.converted?.(target)
      this.#append(data, source, target)
      data.admission?.finalize?.()
      const result: ReadingProjection = {
        html: '',
        slots: [...data.sourceSlots, ...data.targetSlots],
        layout: data.reading.layout,
        blocks: [...data.reading.blocks],
      }
      if (data.reading.layout !== 'replace') {
        result.indexed = data.rows
        const overhead = readingJsonBytes({ ...result, indexed: undefined }) * 2
        let expanded = overhead + data.wrapper.length * 2
        for (let row = 0; row < data.rows.order.length; row++)
          expanded += (readingJsonBytes(readingRowHtml(result, row)) - 2) * 2
        const indexed =
          !data.raw &&
          data.reading.indexAboveBytes !== undefined &&
          expanded > data.reading.indexAboveBytes
        if (!indexed) {
          data.reserve(
            data.bytes + expanded * 2 + data.rows.order.length * 8,
            expanded + data.rows.order.length * 8,
          )
          result.html = expandReadingIndex(result)
          delete result.indexed
        }
      } else {
        let length = data.wrapper.length
        let anchorUnits = 0,
          wrapped = 0,
          fragments = 2
        for (let row = 0; row < data.rows.order.length; row++) {
          const anchor = replacementAnchor(data, row)
          length += replacementValue(data, row).length
          if (anchor !== undefined) {
            length += replacementPrefix.length + anchor.length + replacementAttributes.length + 6
            const id = data.reading.blocks[data.rows.anchors[row] ?? -1]?.id
            if (id === undefined || !plainReplacementAnchor.test(id))
              anchorUnits += anchor.length + replacementPrefix.length + 8
            wrapped++
            fragments += 5
          } else fragments++
        }
        // Join borrowed dictionary values directly. Complete row strings would coexist
        // with the final flattened HTML. UUID anchors and markup fragments can also be
        // borrowed. Include escaped-anchor backing strings, array entries and the bounded
        // temporary wrapper serializer used for non-ASCII or special-character anchors.
        const scratch = 65536 + length * 2 + anchorUnits * 4 + wrapped * 96 + fragments * 16
        data.reserve(data.bytes + scratch, scratch)
        const rows = [data.wrapper.slice(0, -6)]
        for (let row = 0; row < data.rows.order.length; row++) {
          const anchor = replacementAnchor(data, row)
          if (anchor !== undefined)
            rows.push(
              replacementPrefix,
              anchor,
              replacementAttributes,
              replacementValue(data, row),
              '</div>',
            )
          else rows.push(replacementValue(data, row))
        }
        rows.push('</div>')
        result.html = rows.join('')
      }
      if (readingProjectionBytes(result) > 8 * 1024 * 1024)
        throw new Error('translation-view-limit')
      return result
    } finally {
      this.close()
    }
  }
  close(): void {
    const data = this.#data
    this.#data = undefined
    data?.source?.close()
    data?.target.close()
  }
}
