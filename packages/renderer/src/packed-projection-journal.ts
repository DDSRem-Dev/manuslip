import type { PackedCapture } from '../../core/src/packing-capture'
import { packedArrayPause } from '../../core/src/packing-input-array'
import type { PackedCaptureInput } from '../../core/src/packing-input-capture'
import type { RenderedBlock } from './index'
import { PackedWidgetRanges } from './packed-widget-ranges'

const pageSize = 1024
const pageBytes = pageSize * 4 + 256
const syntaxes = ['', 'mermaid', 'sequence', 'flowchart'] as const
const kinds = [
  'table',
  'code',
  'diagram',
  'math',
  'inlineMath',
  'image',
  'html',
  'subscript',
  'superscript',
  'emoji',
  'defList',
  'link',
  'paragraph',
  'heading',
  'blockquote',
  'list',
  'footnoteReference',
  'footnoteDefinition',
] as const

/** Fixed pages need no growing typed-array copy. One append visits at most eight
 * numbers; each new page and its reference metadata is admitted before allocation.
 */
class JournalNumbers {
  #pages: Uint32Array[] = []
  length = 0
  constructor(readonly admit: (bytes: number) => void) {}
  get bytes(): number {
    return this.#pages.length * pageBytes
  }
  get(index: number): number {
    if (index < 0 || index >= this.length) throw new Error('Invalid projection journal index')
    return this.#pages[Math.floor(index / pageSize)]?.[index % pageSize] ?? 0
  }
  set(index: number, value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
      throw new Error('Invalid projection journal number')
    const page = this.#pages[Math.floor(index / pageSize)]
    if (!page || index < 0 || index >= this.length)
      throw new Error('Invalid projection journal index')
    page[index % pageSize] = value
  }
  append(...values: number[]): void {
    for (const value of values) {
      const index = this.length
      if (index % pageSize === 0) {
        this.admit(this.bytes + pageBytes)
        this.#pages.push(new Uint32Array(pageSize))
      }
      this.length++
      this.set(index, value)
    }
  }
  clear(): void {
    this.#pages = []
    this.length = 0
  }
}

/** Admitted native chunks and numeric metadata replace the private encoded event
 * packet. Bounded exact string keys share repeated pieces. No full HTML, widget
 * array or MDAST is joined/copied. Range indexing waits until render state closes.
 * These logical construction weights do not establish physical heap admission.
 */
export class PackedProjectionJournal {
  #pool = new Map<string, number>()
  #strings: string[] = []
  #poolBytes = 0
  #dataBytes = 0
  #rangeBytes = 0
  #open = true
  readonly #columnBytes = [0, 0, 0, 0, 0]
  readonly #workspace: ReturnType<PackedCapture['reserveWorkspace']>
  readonly #html: JournalNumbers
  readonly #widgets: JournalNumbers
  readonly #values: JournalNumbers
  readonly #widgetHtml: JournalNumbers
  readonly #spans: JournalNumbers
  #ranges: PackedWidgetRanges | undefined
  constructor(
    capture: PackedCapture,
    readonly limit: number,
  ) {
    if (4096 > limit) throw new Error('Packed projection journal exceeds workspace limit')
    this.#workspace = capture.reserveWorkspace(4096, 0)
    const column = (index: number) =>
      new JournalNumbers((bytes) => {
        this.#resize(this.#poolBytes, this.#dataBytes + bytes - (this.#columnBytes[index] ?? 0))
        this.#columnBytes[index] = bytes
      })
    this.#html = column(0)
    this.#widgets = column(1)
    this.#values = column(2)
    this.#widgetHtml = column(3)
    this.#spans = column(4)
  }
  #resize(pool: number, data: number, ranges = this.#rangeBytes): void {
    if (!this.#open) throw new Error('Packed projection journal closed')
    const bytes = 4096 + pool + data + ranges
    if (bytes > this.limit) throw new Error('Packed projection journal exceeds workspace limit')
    this.#workspace.resize(bytes, 0)
    this.#poolBytes = pool
    this.#dataBytes = data
    this.#rangeBytes = ranges
  }
  #string(value: string): number {
    if (value.length > 4097) throw new Error('Projection journal chunk exceeds limit')
    const known = this.#pool.get(value)
    if (known !== undefined) return known
    this.#resize(this.#poolBytes + 256 + value.length * 2, this.#dataBytes)
    const index = this.#strings.length
    this.#strings.push(value)
    this.#pool.set(value, index)
    return index
  }
  #text(numbers: JournalNumbers, first = 0, last = numbers.length): Generator<string> {
    const journal = this
    return (function* () {
      for (let index = first; index < last; index++) {
        if (!journal.#open) throw new Error('Packed projection journal closed')
        const value = journal.#strings[numbers.get(index)]
        if (value === undefined) throw new Error('Missing projection journal chunk')
        yield value
      }
    })()
  }
  html(value: string): void {
    this.#html.append(this.#string(value))
  }
  *widget(block: Omit<RenderedBlock, 'html'>): Generator<undefined, number, undefined> {
    const index = this.#widgets.length
    const kind = kinds.indexOf(block.kind)
    const syntax = block.syntax ? syntaxes.indexOf(block.syntax) : 0
    if (kind < 0 || syntax < 0 || (syntax && block.kind !== 'diagram'))
      throw new Error('Invalid projection journal widget')
    this.#widgets.append(
      kind,
      block.from,
      block.to,
      this.#values.length,
      0,
      this.#widgetHtml.length,
      0,
      syntax,
    )
    for (let from = 0; from < block.value.length; from += 4096) {
      this.#values.append(this.#string(block.value.slice(from, from + 4096)))
      yield
    }
    this.#widgets.set(index + 4, this.#values.length)
    return index
  }
  widgetHtml(value: string): void {
    this.#widgetHtml.append(this.#string(value))
  }
  endWidget(index: number): void {
    this.#widgets.set(index + 6, this.#widgetHtml.length)
  }
  span(from: number, to: number, visible: boolean): void {
    this.#spans.append(from, to, visible ? 1 : 0)
  }
  text(): Generator<string> {
    return this.#text(this.#html)
  }
  *blocks(input: PackedCaptureInput, sourceLength: number): Generator<unknown> {
    const ranges = new PackedWidgetRanges(sourceLength, (bytes) => {
      this.#resize(this.#poolBytes, this.#dataBytes, bytes)
    })
    this.#ranges = ranges
    for (let index = 0; index < this.#widgets.length; index += 8) {
      for (const _pause of ranges.setSteps({
        from: this.#widgets.get(index + 1),
        to: this.#widgets.get(index + 2),
        first: index,
        last: index,
      }))
        yield packedArrayPause
      yield packedArrayPause
    }
    for (const range of ranges.values()) {
      if (!range) {
        yield packedArrayPause
        continue
      }
      const index = range.first
      const syntax = syntaxes[this.#widgets.get(index + 7)]
      const valueFirst = this.#widgets.get(index + 3),
        valueLast = this.#widgets.get(index + 4),
        htmlFirst = this.#widgets.get(index + 5),
        htmlLast = this.#widgets.get(index + 6)
      yield {
        kind: kinds[this.#widgets.get(index)],
        ...(syntax ? { syntax } : {}),
        value: input.text(() => this.#text(this.#values, valueFirst, valueLast)),
        from: range.from,
        to: range.to,
        html: input.text(() => this.#text(this.#widgetHtml, htmlFirst, htmlLast)),
      }
    }
  }
  *spans(): Generator<{ from: number; to: number; visible: boolean }> {
    for (let index = 0; index < this.#spans.length; index += 3)
      yield {
        from: this.#spans.get(index),
        to: this.#spans.get(index + 1),
        visible: this.#spans.get(index + 2) === 1,
      }
  }
  releaseText(): void {
    this.#pool.clear()
    this.#strings = []
    for (const column of [this.#html, this.#widgets, this.#values, this.#widgetHtml]) column.clear()
    this.#columnBytes.fill(0, 0, 4)
    this.#ranges?.clear(false)
    this.#ranges = undefined
    this.#resize(0, this.#spans.bytes, 0)
  }
  releaseSpans(): void {
    const bytes = this.#spans.bytes
    this.#spans.clear()
    this.#columnBytes[4] = 0
    this.#resize(this.#poolBytes, this.#dataBytes - bytes)
  }
  close(): void {
    this.#open = false
    this.#pool.clear()
    this.#strings = []
    for (const column of [this.#html, this.#widgets, this.#values, this.#widgetHtml, this.#spans])
      column.clear()
    this.#ranges?.clear(false)
    this.#ranges = undefined
    this.#workspace.release()
  }
}
