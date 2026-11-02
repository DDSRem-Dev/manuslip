import { type KeyboardEvent, useId, useLayoutEffect, useRef } from 'react'
import { useStore } from 'zustand'
import type { DocumentController } from './document'
import { ToolbarDisclosure } from './ToolbarDisclosure'
import { tableCopy } from './table-copy'
import { type TableAlignment, tableEditLimits } from './table-model'

export function TableEditor({
  document,
  locale,
}: {
  document: DocumentController
  locale: string
}): React.JSX.Element {
  const controller = document.table,
    status = useStore(controller.store)
  const dialog = useRef<HTMLDialogElement>(null),
    grid = useRef<HTMLElement>(null)
  const fulfilledFocus = useRef({ target: status.target, sequence: -1 })
  const id = useId(),
    copy = tableCopy[locale === 'zh-CN' ? 'zh-CN' : 'en']
  const { draft, row, column } = status
  const disabled = status.stale || status.applying
  useLayoutEffect(() => {
    const element = dialog.current
    if (!element) return
    if (status.open && !element.open) element.showModal()
    else if (!status.open && element.open) {
      element.close()
      document.focus()
    }
  }, [document, status.open])
  useLayoutEffect(() => {
    if (!status.open || !status.target) return
    if (
      fulfilledFocus.current.target === status.target &&
      fulfilledFocus.current.sequence === status.focus
    )
      return
    const input = grid.current?.querySelector<HTMLInputElement>(
      `input[data-row="${status.row}"][data-column="${status.column}"]`,
    )
    if (input) {
      fulfilledFocus.current = { target: status.target, sequence: status.focus }
      if (input.ownerDocument.activeElement !== input) input.focus()
    }
  }, [status.open, status.target, status.focus, status.row, status.column])
  function navigate(
    event: KeyboardEvent<HTMLInputElement>,
    fromRow: number,
    fromColumn: number,
  ): void {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey) return
    let nextRow = fromRow,
      nextColumn = fromColumn
    if (!event.altKey && event.key === 'Enter') nextRow += event.shiftKey ? -1 : 1
    else if (!event.altKey && !event.shiftKey && event.key === 'ArrowDown') nextRow++
    else if (!event.altKey && !event.shiftKey && event.key === 'ArrowUp') nextRow--
    else if (event.altKey && event.key === 'ArrowRight') nextColumn++
    else if (event.altKey && event.key === 'ArrowLeft') nextColumn--
    else return
    event.preventDefault()
    controller.select(nextRow, nextColumn, true)
  }
  function cell(value: string, atRow: number, atColumn: number): React.JSX.Element {
    return (
      <input
        value={value}
        maxLength={tableEditLimits.cellUnits}
        readOnly={disabled}
        aria-label={`${atRow === 0 ? copy.header : `${copy.row} ${atRow}`}, ${copy.column} ${atColumn + 1}`}
        data-row={atRow}
        data-column={atColumn}
        spellCheck={false}
        onFocus={() => controller.select(atRow, atColumn)}
        onChange={(event) => controller.cell(atRow, atColumn, event.target.value)}
        onKeyDown={(event) => navigate(event, atRow, atColumn)}
      />
    )
  }
  const canAddRow = Boolean(
    draft &&
      draft.rows.length < tableEditLimits.rows &&
      (draft.rows.length + 1) * draft.align.length <= tableEditLimits.cells,
  )
  const canAddColumn = Boolean(
    draft &&
      draft.align.length < tableEditLimits.columns &&
      draft.rows.length * (draft.align.length + 1) <= tableEditLimits.cells,
  )
  return (
    <dialog
      ref={dialog}
      className="table-editor-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-hint`}
      onCancel={(event) => {
        event.preventDefault()
        controller.close()
      }}
    >
      <header className="table-editor-heading">
        <h2 id={`${id}-title`}>{copy.title}</h2>
        <p id={`${id}-hint`}>{copy.hint}</p>
      </header>
      {status.loading && <p role="status">{copy.loading}</p>}
      {status.error && (
        <p className="table-editor-error" role="alert">
          {copy[status.error as keyof typeof copy] ?? copy['table-unavailable']}
        </p>
      )}
      {draft && (
        <>
          <div className="table-editor-toolbar">
            <span className="table-editor-context">
              {row === 0 ? copy.header : `${copy.row} ${row}`} · {copy.column} {column + 1}
            </span>
            <fieldset
              disabled={disabled}
              className="table-editor-operations"
              aria-label={copy.title}
            >
              <ToolbarDisclosure label={copy.rows}>
                <button
                  type="button"
                  disabled={!canAddRow || row === 0}
                  onClick={() => controller.row('above')}
                >
                  {copy.rowAbove}
                </button>
                <button type="button" disabled={!canAddRow} onClick={() => controller.row('below')}>
                  {copy.rowBelow}
                </button>
                <button type="button" disabled={row <= 1} onClick={() => controller.row('up')}>
                  {copy.rowUp}
                </button>
                <button
                  type="button"
                  disabled={row === 0 || row === draft.rows.length - 1}
                  onClick={() => controller.row('down')}
                >
                  {copy.rowDown}
                </button>
                <button type="button" disabled={row === 0} onClick={() => controller.row('remove')}>
                  {copy.rowRemove}
                </button>
              </ToolbarDisclosure>
              <ToolbarDisclosure label={copy.columns}>
                <button
                  type="button"
                  disabled={!canAddColumn}
                  onClick={() => controller.column('before')}
                >
                  {copy.columnBefore}
                </button>
                <button
                  type="button"
                  disabled={!canAddColumn}
                  onClick={() => controller.column('after')}
                >
                  {copy.columnAfter}
                </button>
                <button
                  type="button"
                  disabled={column === 0}
                  onClick={() => controller.column('left')}
                >
                  {copy.columnLeft}
                </button>
                <button
                  type="button"
                  disabled={column === draft.align.length - 1}
                  onClick={() => controller.column('right')}
                >
                  {copy.columnRight}
                </button>
                <button
                  type="button"
                  disabled={draft.align.length === 1}
                  onClick={() => controller.column('remove')}
                >
                  {copy.columnRemove}
                </button>
              </ToolbarDisclosure>
              <label>
                {copy.alignment}
                <select
                  value={draft.align[column] ?? 'none'}
                  onChange={(event) =>
                    controller.align(
                      event.target.value === 'none' ? null : (event.target.value as TableAlignment),
                    )
                  }
                >
                  <option value="none">{copy.none}</option>
                  <option value="left">{copy.left}</option>
                  <option value="center">{copy.center}</option>
                  <option value="right">{copy.right}</option>
                </select>
              </label>
            </fieldset>
          </div>
          <p className="table-editor-keyboard">{copy.keyboard}</p>
          <section ref={grid} className="table-editor-grid" aria-label={copy.cells}>
            <table>
              <caption>{copy.cells}</caption>
              <thead>
                <tr>
                  <th scope="col">{copy.row}</th>
                  {draft.rows[0]?.map((value, atColumn) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: Coordinates identify controlled grid inputs; structural actions explicitly restore focus.
                    <th scope="col" key={atColumn}>
                      {cell(value, 0, atColumn)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draft.rows.slice(1).map((cells, atRow) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Coordinates identify controlled grid inputs; structural actions explicitly restore focus.
                  <tr key={atRow}>
                    <th scope="row">{atRow + 1}</th>
                    {cells.map((value, atColumn) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: Coordinates identify controlled grid inputs; structural actions explicitly restore focus.
                      <td key={atColumn}>{cell(value, atRow + 1, atColumn)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
      <footer className="table-editor-footer">
        {status.applying && <span role="status">{copy.applying}</span>}
        {!draft && !status.loading && (
          <button
            type="button"
            onClick={() => {
              controller.close()
              void document.changeMode('source').then((changed) => {
                if (changed) document.focus()
              })
            }}
          >
            {copy.source}
          </button>
        )}
        <button type="button" onClick={() => controller.close()}>
          {draft || status.loading ? copy.cancel : copy.close}
        </button>
        {draft && (
          <button
            type="button"
            className="primary"
            disabled={disabled}
            onClick={() => {
              void controller.apply()
            }}
          >
            {copy.apply}
          </button>
        )}
      </footer>
    </dialog>
  )
}
