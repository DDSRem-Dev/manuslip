import { type EditorState, isolateHistory, type TransactionSpec } from '@manuslip/editor'
import { createStore } from 'zustand/vanilla'
import {
  readTableAt,
  serializeTable,
  type TableDraft,
  type TableTarget,
  validateTableDraft,
} from './table-model'

interface TableAccess {
  state(): EditorState
  revision(): number
  canApply(): boolean
  synchronizeInput(): Promise<void>
  capture(revision: number, signal: AbortSignal): Promise<Root | null>
  dispatch(spec: TransactionSpec): void
}
interface TableStatus {
  open: boolean
  loading: boolean
  applying: boolean
  stale: boolean
  target: TableTarget | null
  draft: TableDraft | null
  row: number
  column: number
  focus: number
  error: string | null
}
const initial: TableStatus = {
  open: false,
  loading: false,
  applying: false,
  stale: false,
  target: null,
  draft: null,
  row: 0,
  column: 0,
  focus: 0,
  error: null,
}
type RowAction = 'above' | 'below' | 'remove' | 'up' | 'down'
type ColumnAction = 'before' | 'after' | 'remove' | 'left' | 'right'

/** A bounded draft is staged separately; the authoritative editor changes only on Apply. */
export class DocumentTable {
  readonly store = createStore<TableStatus>(() => initial)
  private request: AbortController | null = null
  private revision = -1
  private source: EditorState['doc'] | null = null
  constructor(private readonly document: TableAccess) {}

  async open(at?: number): Promise<void> {
    if (this.request || this.store.getState().open) return
    const controller = new AbortController(),
      requestedRevision = this.document.revision()
    this.request = controller
    this.store.setState({ ...initial, loading: true })
    try {
      // Showing a modal must not interrupt a pending source composition.
      await this.document.synchronizeInput()
      if (controller.signal.aborted) return
      this.store.setState({ open: true })
      if (!this.document.canApply()) throw new Error('table-unavailable')
      if (at !== undefined && requestedRevision !== this.document.revision())
        throw new Error('table-changed')
      const state = this.document.state()
      this.revision = this.document.revision()
      this.source = state.doc
      const captured = await this.document.capture(this.revision, controller.signal)
      if (controller.signal.aborted) return
      if (this.revision !== this.document.revision() || this.source !== this.document.state().doc)
        throw new Error('table-changed')
      if (!captured) throw new Error('table-unsupported')
      const target = readTableAt(captured, state.doc.toString(), at ?? state.selection.main.head)
      this.store.setState({ target, draft: structuredClone(target.draft), loading: false })
    } catch (error) {
      if (!controller.signal.aborted) {
        const code =
          error instanceof Error &&
          /^table-(?:limit|unsupported|changed|unavailable|not-found)$/.test(error.message)
            ? error.message
            : 'table-unavailable'
        this.store.setState({
          open: true,
          loading: false,
          error: code,
          stale: code === 'table-changed',
        })
      }
    }
  }

  close(): void {
    this.request?.abort()
    this.request = null
    this.source = null
    this.revision = -1
    this.store.setState(initial)
  }
  changed(): void {
    const status = this.store.getState()
    if (
      this.request &&
      !status.applying &&
      this.revision >= 0 &&
      this.revision !== this.document.revision()
    ) {
      this.request.abort()
      this.store.setState({ loading: false, stale: true, error: 'table-changed' })
    }
  }
  select(row: number, column: number, focus = false): void {
    const current = this.store.getState(),
      draft = current.draft
    if (!draft) return
    this.store.setState({
      row: Math.max(0, Math.min(draft.rows.length - 1, row)),
      column: Math.max(0, Math.min(draft.align.length - 1, column)),
      focus: current.focus + Number(focus),
    })
  }
  private update(draft: TableDraft, row: number, column: number, focus = true): void {
    const status = this.store.getState()
    if (status.stale || status.applying) return
    try {
      validateTableDraft(draft)
      this.store.setState({ draft, row, column, error: null, focus: status.focus + Number(focus) })
    } catch {
      this.store.setState({ error: 'table-limit' })
    }
  }
  cell(row: number, column: number, value: string): void {
    const draft = this.store.getState().draft
    if (!draft?.rows[row] || column < 0 || column >= draft.align.length) return
    this.update(
      {
        ...draft,
        rows: draft.rows.map((cells, index) =>
          index === row ? cells.map((cell, at) => (at === column ? value : cell)) : cells,
        ),
      },
      row,
      column,
      false,
    )
  }
  align(value: TableDraft['align'][number]): void {
    const { draft, row, column } = this.store.getState()
    if (draft)
      this.update(
        {
          ...draft,
          align: draft.align.map((alignment, index) => (index === column ? value : alignment)),
        },
        row,
        column,
        false,
      )
  }
  row(action: RowAction): void {
    const { draft, row, column } = this.store.getState()
    if (!draft) return
    const rows = [...draft.rows]
    let next = row
    if (action === 'above' || action === 'below') {
      if (action === 'above' && row === 0) return
      next = action === 'below' ? row + 1 : row
      rows.splice(
        next,
        0,
        Array.from({ length: draft.align.length }, () => ''),
      )
    } else if (action === 'remove') {
      if (row === 0) return
      rows.splice(row, 1)
      next = Math.min(row, rows.length - 1)
    } else {
      next = row + (action === 'up' ? -1 : 1)
      if (row === 0 || next < 1 || next >= rows.length) return
      const moving = rows.splice(row, 1)[0]
      if (!moving) return
      rows.splice(next, 0, moving)
    }
    this.update({ ...draft, rows }, next, column)
  }
  column(action: ColumnAction): void {
    const { draft, row, column } = this.store.getState()
    if (!draft) return
    const rows = draft.rows.map((cells) => [...cells]),
      align = [...draft.align]
    let next = column
    if (action === 'before' || action === 'after') {
      next = column + Number(action === 'after')
      for (const cells of rows) cells.splice(next, 0, '')
      align.splice(next, 0, null)
    } else if (action === 'remove') {
      if (align.length === 1) return
      for (const cells of rows) cells.splice(column, 1)
      align.splice(column, 1)
      next = Math.min(column, align.length - 1)
    } else {
      next = column + (action === 'left' ? -1 : 1)
      if (next < 0 || next >= align.length) return
      for (const cells of rows) {
        const moving = cells.splice(column, 1)[0]
        if (moving === undefined) return
        cells.splice(next, 0, moving)
      }
      const moving = align.splice(column, 1)[0]
      if (moving === undefined) return
      align.splice(next, 0, moving)
    }
    this.update({ rows, align }, row, next)
  }
  async apply(): Promise<boolean> {
    const request = this.request
    const { target, draft, stale, applying } = this.store.getState()
    if (!request || request.signal.aborted || !target || !draft || stale || applying) return false
    this.store.setState({ applying: true, error: null })
    try {
      const insert = serializeTable(target, draft)
      await this.document.synchronizeInput()
      if (this.request !== request || request.signal.aborted) return false
      if (this.revision !== this.document.revision() || this.source !== this.document.state().doc)
        throw new Error('table-changed')
      if (!this.document.canApply() || this.document.state().readOnly)
        throw new Error('table-unavailable')
      if (insert !== target.source) {
        const before = this.document.state().doc
        this.document.dispatch({
          changes: { from: target.from, to: target.to, insert },
          annotations: isolateHistory.of('full'),
          userEvent: 'input.table',
          scrollIntoView: true,
        })
        if (this.document.state().doc === before) throw new Error('table-source-limit')
      }
      this.close()
      return true
    } catch (error) {
      const code =
        error instanceof Error &&
        /^table-(?:limit|changed|unavailable|source-limit)$/.test(error.message)
          ? error.message
          : 'table-unsupported'
      if (this.request === request && !request.signal.aborted)
        this.store.setState({ error: code, stale: code === 'table-changed' })
      return false
    } finally {
      if (this.request === request) this.store.setState({ applying: false })
    }
  }
}

import type { Root } from '@manuslip/core'
