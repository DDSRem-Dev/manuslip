import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { SearchEntry } from '../../shared/search-contracts'
import { Icon } from './Icons'
import { i18next } from './i18n'
import type { SearchController } from './search'

export function WorkspaceSearch({
  controller,
  busy,
  panel = false,
}: {
  controller: SearchController
  busy: boolean
  panel?: boolean
}): React.JSX.Element {
  const state = useStore(controller.store),
    t = i18next.t.bind(i18next)
  const [visible, setVisible] = useState(50)
  const input = useRef<HTMLInputElement>(null)
  const summary = useRef<HTMLElement>(null)
  const focusedRequest = useRef(0)
  const results = useRef<HTMLOListElement>(null)
  const pendingResult = useRef<SearchEntry | null>(null)
  useEffect(() => {
    const entry = pendingResult.current
    if (!entry) return
    pendingResult.current = null
    const index = state.entries.indexOf(entry)
    if (!state.expanded || index < 0 || index >= visible) return
    const row = results.current?.children.item(index)
    const button = row?.querySelector('button')
    if (button && !button.disabled) button.focus()
    else if (row instanceof HTMLElement) row.focus()
  }, [state.entries, state.expanded, visible])
  useEffect(() => {
    if (!state.focusRequest) return
    if (focusedRequest.current === state.focusRequest && document.activeElement !== summary.current)
      return
    let observer: IntersectionObserver | null = null
    const timer = setTimeout(() => {
      focusedRequest.current = state.focusRequest
      const target = state.rootId ? input.current : summary.current
      target?.focus()
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      input.current?.select()
      if (target) {
        observer = new IntersectionObserver(
          (entries) => {
            if (
              document.activeElement === target &&
              entries.some((entry) => entry.intersectionRatio < 1)
            )
              target.scrollIntoView({ block: 'center', inline: 'nearest' })
          },
          { threshold: 1 },
        )
        observer.observe(target)
      }
    }, 0)
    return () => {
      clearTimeout(timer)
      observer?.disconnect()
    }
  }, [state.focusRequest, state.rootId])
  return (
    <details
      className="workspace-search"
      open={panel || state.expanded}
      onToggle={(event) => controller.expand(event.currentTarget.open)}
    >
      <summary ref={summary} hidden={panel && Boolean(state.rootId)}>
        <Icon name="search" size={16} />
        {t('workspaceSearch')}
        <Icon name="chevron" size={12} />
      </summary>
      {!state.rootId ? (
        <p>{t('chooseFolder')}</p>
      ) : (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void controller.run()
            }}
          >
            <label htmlFor="workspace-search-mode">{t('searchFor')}</label>
            <select
              id="workspace-search-mode"
              value={state.mode}
              onChange={(event) => {
                setVisible(50)
                controller.mode(event.target.value as 'text' | 'filename')
              }}
            >
              <option value="filename">{t('findFilenames')}</option>
              <option value="text">{t('findSavedText')}</option>
            </select>
            <label htmlFor="workspace-query">
              {t(state.mode === 'filename' ? 'filenameQuery' : 'textQuery')}
            </label>
            <input
              ref={input}
              id="workspace-query"
              type="search"
              maxLength={256}
              value={state.query}
              onChange={(event) => {
                setVisible(50)
                controller.query(event.target.value)
              }}
            />
            {state.mode === 'text' && (
              <label className="search-case">
                <input
                  type="checkbox"
                  checked={state.matchCase}
                  onChange={(event) => controller.matchCase(event.target.checked)}
                />
                {t('matchCase')}
              </label>
            )}
            <div className="action-row">
              <button type="submit" disabled={!state.query.length}>
                <Icon name="search" size={16} />
                {t('searchNow')}
              </button>
              {state.state === 'running' && (
                <button
                  type="button"
                  onClick={() => {
                    controller.cancel()
                    input.current?.focus()
                  }}
                >
                  {t('cancelSearch')}
                </button>
              )}
            </div>
          </form>
          <p className="search-hint">{t('searchPolicy')}</p>
          <p role="status">
            {state.state === 'running'
              ? t('searchRunning')
              : state.state === 'cancelled'
                ? t(state.entries.length ? 'searchCancelled' : 'searchCancelledEmpty')
                : state.state === 'done'
                  ? state.total === 0
                    ? t('searchEmpty', { query: state.query })
                    : t('searchResults', { count: state.total })
                  : ''}
          </p>
          {state.error && (
            <p role="alert">
              {t(state.error, { defaultValue: t('search-io') })}{' '}
              <button
                type="button"
                onClick={() => {
                  void controller.run()
                  input.current?.focus()
                }}
              >
                {t('retry')}
              </button>
            </p>
          )}
          {state.truncated && <p>{t('searchTruncated')}</p>}
          {state.skipped > 0 && <p>{t('searchSkipped', { count: state.skipped })}</p>}
          <ol ref={results} className="search-results">
            {state.entries.slice(0, visible).map((entry) => (
              <li key={entry.id} tabIndex={-1}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void controller.open(entry)}
                  title={entry.excerpt || entry.path}
                >
                  <bdi>{entry.path}</bdi>
                  {entry.line > 0 && <small>{t('searchLine', { line: entry.line })}</small>}
                  {entry.excerpt && <span>{entry.excerpt}</span>}
                </button>
              </li>
            ))}
          </ol>
          {state.entries.length > visible && (
            <button
              type="button"
              onClick={() => {
                pendingResult.current = state.entries[visible] ?? null
                setVisible((count) => count + 50)
              }}
            >
              {t('moreSearchResults')}
            </button>
          )}
        </>
      )}
    </details>
  )
}
