import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type {
  WorkspaceBridge,
  WorkspaceNode,
  WorkspacePage,
} from '../../shared/workspace-contracts'
import { Icon } from './Icons'
import { i18next } from './i18n'
import type { WorkspaceController } from './workspace'

function Directory({
  node,
  bridge,
  controller,
  busy,
  initial = false,
}: {
  node: WorkspaceNode
  bridge: WorkspaceBridge
  controller: WorkspaceController
  busy: boolean
  initial?: boolean
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(initial)
  const [page, setPage] = useState<WorkspacePage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  const inFlight = useRef(false)
  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )
  const load = useCallback(
    async (offset = 0): Promise<void> => {
      if (inFlight.current) return
      inFlight.current = true
      setLoading(true)
      setError('')
      try {
        const result = await bridge.listWorkspace(node.id, offset)
        if (!alive.current) return
        if (!result.ok) {
          setError(result.code || 'workspace-session')
          return
        }
        setPage((previous) => ({
          ...result.value,
          nodes: offset ? [...(previous?.nodes || []), ...result.value.nodes] : result.value.nodes,
        }))
      } catch {
        if (alive.current) setError('workspace-session')
      } finally {
        inFlight.current = false
        if (alive.current) setLoading(false)
      }
    },
    [bridge, node.id],
  )
  useEffect(() => {
    if (expanded && !page && !loading && !error) void load()
  }, [expanded, page, loading, error, load])
  const t = i18next.t.bind(i18next)
  return (
    <details
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      className="file-directory"
    >
      <summary>
        <Icon name="folder" size={16} />
        <bdi>{node.name}</bdi>
      </summary>
      {expanded && (
        <div className="directory-content">
          {loading && <p role="status">{t('loadingFiles')}</p>}
          {error && (
            <p role="alert">
              {t(error)}{' '}
              <button type="button" onClick={() => void load(page?.nodes.length || 0)}>
                {t('retry')}
              </button>
            </p>
          )}
          {page && !page.nodes.length && !loading && <p>{t('emptyFolder')}</p>}
          <ul>
            {page?.nodes.map((child) => (
              <li key={child.id}>
                {child.kind === 'directory' ? (
                  <Directory node={child} bridge={bridge} controller={controller} busy={busy} />
                ) : (
                  <button
                    className="file-entry"
                    type="button"
                    disabled={busy}
                    onClick={() => void controller.open(child.id)}
                  >
                    <Icon name="document" size={16} />
                    <bdi>{child.name}</bdi>
                  </button>
                )}
              </li>
            ))}
          </ul>
          {page?.next !== null && page?.next !== undefined && (
            <button type="button" disabled={loading} onClick={() => void load(page.next || 0)}>
              {t('moreFiles')}
            </button>
          )}
          {page?.truncated && <p>{t('folderTruncated')}</p>}
          {page?.skippedLinks && <p>{t('folderLinks')}</p>}
        </div>
      )}
    </details>
  )
}

export function WorkspaceSidebar({
  controller,
  bridge,
  busy,
  panel = false,
}: {
  controller: WorkspaceController
  bridge: WorkspaceBridge
  busy: boolean
  panel?: boolean
}): React.JSX.Element {
  const state = useStore(controller.store)
  const [expanded, setExpanded] = useState(() => !window.matchMedia('(max-width: 44rem)').matches)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 44rem)')
    const changed = (): void => setExpanded(!query.matches)
    query.addEventListener('change', changed)
    return () => query.removeEventListener('change', changed)
  }, [])
  const t = i18next.t.bind(i18next)
  return (
    <details
      className="workspace-browser"
      open={panel || expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary hidden={panel}>
        <Icon name="folder" size={16} />
        {t('files')}
        <Icon name="chevron" size={12} />
      </summary>
      <div className="workspace-browser-content">
        <div className="workspace-actions">
          <button type="button" disabled={busy} onClick={() => void controller.choose()}>
            <Icon name="open" size={16} />
            {t('openFolder')}
          </button>
          {state.value?.root && (
            <button
              className="icon-button"
              type="button"
              aria-label={t('refreshFiles')}
              title={t('refreshFiles')}
              disabled={state.busy}
              onClick={() => void controller.refresh()}
            >
              <Icon name="refresh" size={16} />
            </button>
          )}
        </div>
        {state.value?.root ? (
          <nav aria-label={t('workspaceFiles')}>
            <p className="workspace-path" title={state.value.root.displayPath}>
              {state.value.root.displayPath}
            </p>
            <Directory
              key={state.value.root.id}
              node={state.value.root}
              bridge={bridge}
              controller={controller}
              busy={busy}
              initial
            />
          </nav>
        ) : (
          <p className="workspace-hint">{t('chooseFolder')}</p>
        )}
        {!!state.value?.recents.length && (
          <details className="recent-workspaces">
            <summary>{t('recentFolders')}</summary>
            <ul>
              {state.value.recents.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void controller.recent(entry.id)}
                  >
                    <bdi>{entry.name}</bdi>
                    <span>{entry.displayPath}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </details>
  )
}

export function WorkspaceNotices({
  controller,
  busy,
}: {
  controller: WorkspaceController
  busy: boolean
}): React.JSX.Element | null {
  const state = useStore(controller.store)
  const t = i18next.t.bind(i18next)
  if (
    !state.error &&
    !state.restoring &&
    !state.persistenceError &&
    !state.failures.length &&
    !state.value?.missingRoot &&
    !state.value?.recovered &&
    !state.value?.readOnly &&
    !state.value?.persistenceError
  )
    return null
  return (
    <div className="workspace-notices document-notice">
      {state.restoring && <p role="status">{t('restoringSession')}</p>}
      {state.error && (
        <p role="alert">
          {t(state.error)}{' '}
          <button type="button" disabled={busy} onClick={() => void controller.retry()}>
            {t('retry')}
          </button>
        </p>
      )}
      {state.value?.missingRoot && <p>{t('missingFolder')}</p>}
      {state.value?.recovered && <p role="status">{t('workspaceRecovered')}</p>}
      {state.value?.readOnly && <p role="status">{t('workspace-readonly')}</p>}
      {(state.persistenceError || state.value?.persistenceError) && (
        <p role="alert">
          {t(state.persistenceError || 'workspace-persist')}{' '}
          <button type="button" disabled={busy} onClick={() => void controller.flush()}>
            {t('retry')}
          </button>
        </p>
      )}
      {state.failures.map((entry) => (
        <div key={entry.id} className="restore-failure">
          <p>
            <bdi>{entry.displayPath}</bdi> — {t(entry.code)}
          </p>
          <button type="button" disabled={busy} onClick={() => void controller.retryFile(entry)}>
            {t('retry')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void controller.forgetFile(entry.id)}
          >
            {t('forgetFile')}
          </button>
        </div>
      ))}
    </div>
  )
}
