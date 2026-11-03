import { defaultKeymap, redo, undo } from '@codemirror/commands'
import { syntaxHighlighting } from '@codemirror/language'
import {
  type ChangeDesc,
  Compartment,
  EditorSelection,
  EditorState,
  Transaction,
} from '@codemirror/state'
import { drawSelection, EditorView, keymap, runScopeHandlers, ViewPlugin } from '@codemirror/view'
import { registerEmbeddedEditor } from './embedded-editor'
import { cellHighlightStyle, codeHighlightStyle } from './highlight'
import { SourceInputSynchronization } from './input-synchronization'
import { activateLiveBlock, editingBlock, editLiveBlock } from './live-editing'
import { isComposing, type LiveBlock, type LiveOptions } from './live-model'
import { type LiveCell, tableCellInput, tableSourceCells } from './live-table-source'
import { sourceSyntax } from './syntax'

const activeTables = new WeakMap<EditorView, LiveTable>()

export const tableEditing = ViewPlugin.define(() => ({
  update(update) {
    const active = activeTables.get(update.view)
    if (update.docChanged) active?.map(update.changes)
    if (
      update.docChanged ||
      update.selectionSet ||
      update.transactions.some((tr) => tr.effects.length)
    )
      queueMicrotask(() => active?.synchronize())
  },
}))

/** A table keeps its semantic layout. Only the focused cell owns a small editor;
 * every change is committed immediately to the authoritative document's history.
 */
export class LiveTable {
  private editor: EditorView | null = null
  private cell: LiveCell | null = null
  private renderLifetime = new AbortController()
  private unregister: (() => void) | undefined
  private syncing = false
  private pendingRender = false
  private readonly editable = new Compartment()

  constructor(
    private readonly container: HTMLElement,
    private readonly content: HTMLElement,
    private readonly view: EditorView,
    private block: LiveBlock,
    private readonly options: LiveOptions,
    private readonly signal: AbortSignal,
  ) {
    this.render()
    container.addEventListener(
      'mousedown',
      (event) => {
        if (
          event.button !== 0 ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          this.view.state.readOnly
        )
          return
        const cell =
          event.target instanceof Element ? event.target.closest<HTMLElement>('th, td') : null
        if (
          !cell ||
          !container.contains(cell) ||
          (event.target instanceof Element &&
            event.target.closest(
              '.cm-live-cell-active .cm-editor, button, input, a[data-footnote-ref], a[data-footnote-backref]',
            ))
        )
          return
        event.preventDefault()
        event.stopPropagation()
        this.open(Number(cell.dataset.row), Number(cell.dataset.column), event)
      },
      { signal },
    )
    signal.addEventListener('abort', () => this.destroy(), { once: true })
  }

  update(block: LiveBlock): void {
    const changed = this.block.html !== block.html
    this.block = block
    queueMicrotask(() => {
      if (this.signal.aborted) return
      if (changed) this.pendingRender = true
      this.synchronize()
    })
  }

  private render(): void {
    this.pendingRender = false
    const focused = this.editor?.hasFocus
    const dom = this.editor?.dom
    if (dom) dom.remove()
    this.renderLifetime.abort()
    this.renderLifetime = new AbortController()
    this.options.render(this.content, this.block, this.renderLifetime.signal, () =>
      this.view.requestMeasure(),
    )
    for (const [row, element] of [...this.content.querySelectorAll('tr')].entries())
      for (const [column, cell] of [...element.querySelectorAll<HTMLElement>('th, td')].entries()) {
        cell.dataset.row = String(row)
        cell.dataset.column = String(column)
        cell.tabIndex = 0
      }
    if (dom && this.cell) {
      this.element(this.cell.row, this.cell.column)?.replaceChildren(dom)
      this.element(this.cell.row, this.cell.column)?.classList.add('cm-live-cell-active')
      if (focused) queueMicrotask(() => !this.signal.aborted && this.editor?.focus())
    }
    this.container.addEventListener('keydown', this.keydown, { signal: this.signal })
  }

  private readonly keydown = (event: KeyboardEvent): void => {
    if (
      !(event.target instanceof HTMLElement) ||
      this.view.state.readOnly ||
      this.view.composing ||
      this.view.state.field(isComposing)
    )
      return
    if (event.target === this.container) {
      if (event.key === 'F2' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
        this.focusFirstCell()
      }
      return
    }
    if (!event.target.matches('th, td')) return
    if (event.key !== 'Enter' && event.key !== 'F2') return
    event.preventDefault()
    event.stopPropagation()
    this.open(Number(event.target.dataset.row), Number(event.target.dataset.column))
  }

  private element(row: number, column: number): HTMLElement | null {
    return this.content.querySelector(`[data-row="${row}"][data-column="${column}"]`)
  }

  focusFirstCell(): void {
    if (!this.view.state.readOnly) this.open(0, 0)
  }

  private cells(): LiveCell[][] {
    const block = editingBlock(this.view.state)?.block
    return tableSourceCells(
      this.view.state,
      block?.kind === 'table' && block.from === this.block.from ? block : this.block,
    )
  }

  private open(row: number, column: number, event?: MouseEvent): void {
    const cell = this.cells()[row]?.[column]
    if (!cell) return
    const current = editingBlock(this.view.state)?.block
    activateLiveBlock(
      this.view,
      current?.kind === 'table' && current.from === this.block.from ? current : this.block,
      cell.from,
    )
    if (this.editor && this.cell?.row === row && this.cell.column === column) {
      this.editor.focus()
      return
    }
    this.editor?.destroy()
    this.unregister?.()
    this.editor = null
    this.cell = cell
    this.render()
    const target = this.element(row, column)
    if (!target) return
    const table = target.closest('table')
    if (table) {
      const columns = document.createElement('colgroup')
      for (const header of table.rows[0]?.cells ?? []) {
        const column = document.createElement('col')
        column.style.width = `${header.getBoundingClientRect().width}px`
        columns.append(column)
      }
      table.style.width = `${table.getBoundingClientRect().width}px`
      table.style.tableLayout = 'fixed'
      table.prepend(columns)
    }
    target.replaceChildren()
    target.classList.add('cm-live-cell-active')
    activeTables.set(this.view, this)
    const label = `${this.options.sourceLabel()} · ${row + 1}:${column + 1}`
    const inner = new EditorView({
      parent: target,
      state: EditorState.create({
        doc: this.view.state.doc.sliceString(cell.from, cell.to),
        extensions: [
          sourceSyntax,
          syntaxHighlighting(codeHighlightStyle),
          syntaxHighlighting(cellHighlightStyle),
          drawSelection(),
          EditorView.lineWrapping,
          this.editable.of(EditorState.readOnly.of(this.view.state.readOnly)),
          EditorView.contentAttributes.of({
            'aria-label': label,
            spellcheck: 'false',
            'data-table-cell-editor': 'true',
          }),
          EditorState.transactionFilter.of(tableCellInput),
          keymap.of([
            { key: 'Mod-z', run: () => undo(this.view) },
            { key: 'Mod-Shift-z', run: () => redo(this.view) },
            { key: 'Mod-y', run: () => redo(this.view) },
            { key: 'Tab', run: () => this.move(1) },
            { key: 'Shift-Tab', run: () => this.move(-1) },
            { key: 'Enter', run: () => this.move(this.cells()[0]?.length ?? 1) },
            { key: 'Shift-Enter', run: () => this.move(-(this.cells()[0]?.length ?? 1)) },
            {
              key: 'Escape',
              run: () => {
                this.finish()
                return true
              },
            },
            ...defaultKeymap,
          ]),
          EditorView.domEventHandlers({
            compositionend: () => {
              this.view.requestMeasure({
                read: () => undefined,
                write: () => queueMicrotask(() => this.synchronize()),
              })
              return false
            },
            keydown: (event) => {
              // Document shortcuts keep their existing handlers and save barriers.
              if (
                (event.ctrlKey || event.metaKey) &&
                ['s', '1', '2', 'f'].includes(event.key.toLowerCase())
              )
                return runScopeHandlers(this.view, event, 'editor')
              return false
            },
          }),
          EditorView.updateListener.of((update) => {
            if (this.syncing || !this.cell || (!update.docChanged && !update.selectionSet)) return
            const current = this.cell
            if (this.view.state.readOnly) return
            const changes: { from: number; to: number; insert: string }[] = []
            update.changes.iterChanges((from, to, _nextFrom, _nextTo, inserted) => {
              changes.push({
                from: current.from + from,
                to: current.from + to,
                insert: inserted.toString(),
              })
            })
            const selection = update.state.selection.main
            const padding = update.docChanged && current.prefix ? current.prefix.length : 0
            this.view.dispatch({
              ...(changes.length
                ? {
                    changes: current.prefix
                      ? {
                          from: current.from,
                          to: current.to,
                          insert:
                            current.prefix + update.state.doc.toString() + (current.suffix ?? ''),
                        }
                      : changes,
                  }
                : {}),
              selection: {
                anchor: current.from + padding + selection.anchor,
                head: current.from + padding + selection.head,
              },
              // Only the cell owns the native pointer selection. Forwarding
              // select.pointer makes CodeMirror move DOM focus into the parent.
              userEvent: update.docChanged
                ? (update.transactions
                    .find((tr) => tr.annotation(Transaction.userEvent))
                    ?.annotation(Transaction.userEvent) ?? 'input')
                : 'select',
            })
            if (padding)
              this.cell = {
                row: current.row,
                column: current.column,
                from: current.from + padding,
                to: current.from + padding + update.state.doc.length,
              }
          }),
        ],
      }),
    })
    this.editor = inner
    this.unregister = registerEmbeddedEditor(
      this.view,
      inner,
      new SourceInputSynchronization(inner),
    )
    if (event) {
      const position = inner.posAtCoords({ x: event.clientX, y: event.clientY })
      inner.dispatch({ selection: { anchor: position ?? inner.state.doc.length } })
    }
    inner.focus()
  }

  map(changes: ChangeDesc): void {
    if (this.cell)
      this.cell = {
        ...this.cell,
        from: changes.mapPos(this.cell.from, -1),
        to: changes.mapPos(this.cell.to, 1),
      }
  }

  synchronize(): void {
    if (this.signal.aborted) return
    if (this.editor?.compositionStarted) return
    if (this.pendingRender) {
      this.pendingRender = false
      this.render()
    }
    if (!this.editor || !this.cell) return
    const editing = editingBlock(this.view.state)
    if (editing?.block.kind !== 'table' || editing.block.from !== this.block.from) {
      this.closeCell()
      this.render()
      return
    }
    if (this.editor.compositionStarted) return
    const parsed = this.cells()[this.cell.row]?.[this.cell.column]
    if (!parsed) {
      this.finish()
      return
    }
    if (this.cell.prefix || parsed.prefix) this.cell = parsed
    const cell = this.cell
    const text = this.view.state.doc.sliceString(cell.from, cell.to)
    const selection = this.view.state.selection.main
    this.syncing = true
    try {
      this.editor.dispatch({
        ...(text === this.editor.state.doc.toString()
          ? {}
          : { changes: { from: 0, to: this.editor.state.doc.length, insert: text } }),
        selection: EditorSelection.single(
          Math.max(0, Math.min(text.length, selection.anchor - cell.from)),
          Math.max(0, Math.min(text.length, selection.head - cell.from)),
        ),
        effects: this.editable.reconfigure(EditorState.readOnly.of(this.view.state.readOnly)),
      })
    } finally {
      this.syncing = false
    }
  }

  private move(delta: number): boolean {
    if (!this.cell || this.editor?.composing) return false
    const cells = this.cells().flat()
    const at = cells.findIndex(
      (cell) => cell.row === this.cell?.row && cell.column === this.cell.column,
    )
    const next = cells[at + delta]
    if (next) this.open(next.row, next.column)
    else this.finish()
    return true
  }

  private finish(): void {
    const to = editingBlock(this.view.state)?.to ?? this.block.to
    this.view.dispatch({ effects: editLiveBlock.of(null), selection: { anchor: to } })
    this.view.focus()
  }

  private destroy(): void {
    this.renderLifetime.abort()
    this.closeCell()
  }

  private closeCell(): void {
    this.editor?.destroy()
    this.unregister?.()
    this.editor = null
    this.cell = null
    if (activeTables.get(this.view) === this) activeTables.delete(this.view)
  }
}
