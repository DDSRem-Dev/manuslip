import { type EditorState, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import {
  inlineProjection,
  isComposing,
  type LiveBlock,
  type LiveOptions,
  liveModel,
  proseProjection,
  revealSource,
} from './live-model'
import { mountTaskControls } from './live-tasks'

// CodeMirror can hand the same DOM to a newer equivalent widget object. Its lifetime
// belongs to that DOM, so whichever widget finally destroys it must close the renderer.
const widgetLifetimes = new WeakMap<HTMLElement, AbortController>()

export class RenderedWidget extends WidgetType {
  constructor(
    readonly block: LiveBlock,
    private readonly options: LiveOptions,
    readonly inline = false,
  ) {
    super()
  }
  override eq(other: RenderedWidget): boolean {
    return (
      this.block.id === other.block.id &&
      this.block.kind === other.block.kind &&
      this.block.html === other.block.html &&
      this.block.syntax === other.block.syntax &&
      this.block.value === other.block.value &&
      this.inline === other.inline &&
      this.options === other.options
    )
  }
  override toDOM(view: EditorView): HTMLElement {
    const container = document.createElement(this.inline ? 'span' : 'div')
    container.className = this.inline
      ? 'cm-live-inline-widget'
      : `cm-live-block cm-live-${this.block.kind}`
    container.dataset.occurrence = this.block.id
    container.dataset.kind = this.block.kind
    container.setAttribute('contenteditable', 'false')
    const lifetime = new AbortController()
    widgetLifetimes.set(container, lifetime)
    const content = document.createElement(
      this.inline ? 'span' : this.block.kind === 'footnoteDefinition' ? 'ol' : 'div',
    )
    content.className = 'cm-live-rendered'
    container.append(content)
    if (!this.inline) {
      if (this.block.kind === 'table' && this.options.editTable && this.options.editTableLabel) {
        const table = document.createElement('button')
        table.type = 'button'
        table.className = 'cm-live-source-button cm-live-table-button'
        table.textContent = this.options.editTableLabel()
        table.addEventListener(
          'click',
          (event) => {
            event.stopPropagation()
            this.options.editTable?.(this.block)
          },
          { signal: lifetime.signal },
        )
        container.append(table)
      }
      const source = document.createElement('button')
      source.type = 'button'
      source.className = 'cm-live-source-button'
      source.textContent = this.options.sourceLabel()
      source.addEventListener('click', () => revealSource(view, container), {
        signal: lifetime.signal,
      })
      container.append(source)
    }
    const openLink = this.options.openLink
    container.addEventListener(
      'click',
      (event) => {
        event.preventDefault()
        const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
        if (anchor && event instanceof MouseEvent && (event.ctrlKey || event.metaKey))
          openLink(anchor.getAttribute('href') || '')
        else revealSource(view, container)
      },
      { signal: lifetime.signal },
    )
    try {
      this.options.render(content, this.block, lifetime.signal, () => {
        if (!lifetime.signal.aborted) view.requestMeasure()
      })
      if (proseProjection(this.block.kind))
        mountTaskControls(content, this.block, view, this.options.taskLabel(), lifetime.signal)
    } catch (error) {
      widgetLifetimes.delete(container)
      lifetime.abort()
      throw error
    }
    return container
  }
  override get estimatedHeight(): number {
    return this.inline ? -1 : Math.max(48, Math.min(720, this.block.lines * 24 + 24))
  }
  override destroy(dom: HTMLElement): void {
    const lifetime = widgetLifetimes.get(dom)
    widgetLifetimes.delete(dom)
    lifetime?.abort()
  }
}

interface BlockState {
  all: DecorationSet
  visible: DecorationSet
  byId: ReadonlyMap<string, Range<Decoration>>
  selected: ReadonlySet<string>
}

function active(state: EditorState, all: DecorationSet): Set<string> {
  const selected = new Set<string>()
  const collect = (from: number, to: number): void => {
    all.between(from, to, (start, end, decoration) => {
      if (start <= to && end >= from) selected.add(decoration.spec.occurrence as string)
    })
  }
  for (const selection of state.selection.ranges) collect(selection.from, selection.to)
  return selected
}

function build(state: EditorState, options: LiveOptions): BlockState {
  const ranges: Range<Decoration>[] = []
  const byId = new Map<string, Range<Decoration>>()
  let renderedEnd = 0
  for (const block of state.field(liveModel)?.blocks || []) {
    // Outer widgets own their descendants, including links inside tables and definitions.
    if (
      block.from < renderedEnd ||
      block.from < 0 ||
      block.from >= block.to ||
      block.to > state.doc.length
    )
      continue
    const startLine = state.doc.lineAt(block.from)
    const endLine = state.doc.lineAt(block.to)
    // Replacing line breaks requires a state field, even for an inline widget.
    const inline = inlineProjection(block.kind) && startLine.number !== endLine.number
    if (
      !inline &&
      ((!proseProjection(block.kind) &&
        !['table', 'code', 'diagram', 'math', 'html'].includes(block.kind)) ||
        startLine.from !== block.from ||
        (endLine.to !== block.to && !(block.kind === 'defList' && endLine.from === block.to)))
    )
      continue
    const range = Decoration.replace({
      block: !inline,
      widget: new RenderedWidget(block, options, inline),
      occurrence: block.id,
    }).range(block.from, block.to)
    ranges.push(range)
    renderedEnd = block.to
    byId.set(block.id, range)
  }
  const all = Decoration.set(ranges, true)
  const selected = active(state, all)
  return {
    all,
    visible: state.field(isComposing)
      ? Decoration.none
      : all.update({
          filter: (_from, _to, decoration) => !selected.has(decoration.spec.occurrence as string),
        }),
    byId,
    selected,
  }
}

export function blockDecorations(options: LiveOptions): StateField<BlockState> {
  return StateField.define<BlockState>({
    create: (state) => build(state, options),
    update: (previous, transaction) => {
      if (
        transaction.startState.field(liveModel) !== transaction.state.field(liveModel) ||
        transaction.startState.field(isComposing) !== transaction.state.field(isComposing)
      )
        return build(transaction.state, options)
      if (!transaction.selection || transaction.state.field(isComposing)) return previous
      const selected = active(transaction.state, previous.all)
      let visible = previous.visible
      for (const id of previous.selected)
        if (!selected.has(id)) {
          const range = previous.byId.get(id)
          if (range) visible = visible.update({ add: [range] })
        }
      for (const id of selected)
        if (!previous.selected.has(id)) {
          const range = previous.byId.get(id)
          if (range)
            visible = visible.update({
              filterFrom: range.from,
              filterTo: range.to,
              filter: (_from, _to, decoration) => decoration.spec.occurrence !== id,
            })
        }
      return { ...previous, selected, visible }
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.visible),
  })
}
