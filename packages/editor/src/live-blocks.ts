import { type EditorState, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { preserveProseLineBreaks } from './live-line-breaks'
import {
  inlineProjection,
  isComposing,
  type LiveBlock,
  type LiveOptions,
  liveModel,
  proseProjection,
  revealSource,
} from './live-model'
import { proseNavigation, revealProse } from './live-navigation'
import { rangeTouches } from './live-selection'
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
    if (!this.inline && !proseProjection(this.block.kind)) {
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
      source.addEventListener(
        'click',
        (event) => {
          event.stopPropagation()
          revealSource(view, container)
        },
        { signal: lifetime.signal },
      )
      container.append(source)
    }
    const openLink = this.options.openLink
    container.addEventListener(
      'click',
      (event) => {
        if (event.defaultPrevented || !view.dom.contains(container)) return
        event.preventDefault()
        const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
        if (anchor && event instanceof MouseEvent && (event.ctrlKey || event.metaKey))
          openLink(anchor.getAttribute('href') || '')
      },
      { signal: lifetime.signal },
    )
    try {
      this.options.render(content, this.block, lifetime.signal, () => {
        if (!lifetime.signal.aborted) view.requestMeasure()
      })
      if (proseProjection(this.block.kind)) preserveProseLineBreaks(content)
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
  override ignoreEvent(event: Event): boolean {
    if (!(event.target instanceof Element)) return false
    const control = event.target.closest('button, input, select, textarea, label, [tabindex]')
    // Native controls retain their own focus. Text and pointer selections belong to
    // CodeMirror, so a selected widget can reveal its original source range.
    return (
      Boolean(control?.closest('.cm-live-block, .cm-live-inline-widget')) ||
      (event instanceof MouseEvent &&
        (event.ctrlKey || event.metaKey) &&
        Boolean(event.target.closest('a[href]')))
    )
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
  for (const selection of state.selection.ranges)
    all.between(selection.from, selection.to, (start, end, decoration) => {
      if (rangeTouches(selection, start, end)) selected.add(decoration.spec.occurrence as string)
    })
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
      const reveal = transaction.effects.flatMap((effect) =>
        effect.is(revealProse) ? effect.value : [],
      )
      const hasReveal = transaction.effects.some((effect) => effect.is(revealProse))
      if ((!transaction.selection && !hasReveal) || transaction.state.field(isComposing))
        return previous
      const selected = active(transaction.state, previous.all)
      for (const id of reveal) selected.add(id)
      const add: Range<Decoration>[] = []
      const remove = new Set<string>()
      let from = Infinity,
        to = -Infinity
      for (const id of previous.selected)
        if (!selected.has(id)) {
          const range = previous.byId.get(id)
          if (range) add.push(range)
        }
      for (const id of selected)
        if (!previous.selected.has(id)) {
          const range = previous.byId.get(id)
          if (range) {
            remove.add(id)
            from = Math.min(from, range.from)
            to = Math.max(to, range.to)
          }
        }
      if (!add.length && !remove.size) return previous
      // Selecting many lines changes the range set once, regardless of block count.
      const visible = previous.visible.update({
        add,
        sort: true,
        ...(remove.size
          ? {
              filterFrom: from,
              filterTo: to,
              filter: (_from: number, _to: number, decoration: Decoration) =>
                !remove.has(decoration.spec.occurrence as string),
            }
          : {}),
      })
      return { ...previous, selected, visible }
    },
    provide: (field) => [
      EditorView.decorations.from(field, (value) => value.visible),
      EditorView.atomicRanges.of((view) => view.state.field(field).visible),
      proseNavigation(field),
    ],
  })
}
