import { useEffect, useId, useState } from 'react'
import { useStore } from 'zustand'
import type { WorkspaceNode, WorkspacePage } from '../../shared/workspace-contracts'
import { Icon } from './Icons'
import { i18next } from './i18n'
import type { WorkspaceController } from './workspace'

function Directory({
  node,
  controller,
  busy,
  path,
  activePath,
  root = false,
  closeFolder,
}: {
  node: WorkspaceNode
  controller: WorkspaceController
  busy: boolean
  path: string
  activePath: string | null
  root?: boolean
  closeFolder?: () => void
}): React.JSX.Element {
  const contentId = useId()
  const [expanded, setExpanded] = useState(root)
  const [page, setPage] = useState<WorkspacePage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [pages, setPages] = useState(1)
  useEffect(
    () => controller.onDirectoryChanged(node.id, () => setRevision((value) => value + 1)),
    [controller, node.id],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: Filesystem notifications and retries explicitly invalidate this listing.
  useEffect(() => {
    if (!expanded) return
    let cancelled = false
    const load = async (): Promise<void> => {
      setLoading(true)
      setError('')
      try {
        const nodes: WorkspaceNode[] = []
        let offset = 0
        let loaded = 0
        while (!cancelled) {
          const result = await controller.list(node.id, offset)
          if (cancelled) return
          if (!result.ok) throw new Error(result.code || 'workspace-session')
          nodes.push(...result.value.nodes)
          if (result.value.next === null || ++loaded >= pages) {
            setPage({ ...result.value, nodes })
            break
          }
          offset = result.value.next
        }
      } catch (error) {
        if (!cancelled) setError(error instanceof Error ? error.message : 'workspace-session')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [expanded, node.id, controller, revision, pages])
  const t = i18next.t.bind(i18next)
  const label = (
    <>
      <Icon name={expanded ? 'chevron' : 'chevronRight'} size={12} />
      <Icon name={expanded ? 'open' : 'folder'} size={16} />
      <bdi>{node.name}</bdi>
    </>
  )
  const content = expanded && (
    <div id={contentId} className="directory-content" aria-busy={loading}>
      {root && (
        <p className="workspace-path" title={path} dir="auto">
          {path}
        </p>
      )}
      {loading && !page && <p role="status">{t('loadingFiles')}</p>}
      {error && (
        <p role="alert">
          {t(error)}{' '}
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            {t('retry')}
          </button>
        </p>
      )}
      {page && !page.nodes.length && !loading && <p>{t('emptyFolder')}</p>}
      <ul>
        {page?.nodes.map((child) => (
          <li key={child.id}>
            {child.kind === 'directory' ? (
              <Directory
                node={child}
                controller={controller}
                busy={busy}
                path={childPath(path, child.name)}
                activePath={activePath}
              />
            ) : (
              <button
                className="file-entry"
                type="button"
                disabled={busy}
                title={childPath(path, child.name)}
                aria-current={activePath === childPath(path, child.name) ? 'page' : undefined}
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
        <button type="button" disabled={loading} onClick={() => setPages((value) => value + 1)}>
          {t('moreFiles')}
        </button>
      )}
      {page?.truncated && <p>{t('folderTruncated')}</p>}
      {page?.skippedLinks && <p>{t('folderLinks')}</p>}
    </div>
  )
  if (!root)
    return (
      <details
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
        className="file-directory"
      >
        <summary title={path}>{label}</summary>
        {content}
      </details>
    )
  return (
    <div className="file-directory workspace-root">
      <div className="workspace-folder-heading">
        <button
          className="workspace-folder-toggle"
          type="button"
          title={node.name}
          aria-expanded={expanded}
          aria-controls={expanded ? contentId : undefined}
          onClick={() => setExpanded((value) => !value)}
        >
          {label}
        </button>
        <button
          className="icon-button workspace-folder-close"
          type="button"
          disabled={busy}
          aria-label={t('closeFolder')}
          title={t('closeFolder')}
          onClick={closeFolder}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      {content}
    </div>
  )
}

function childPath(parent: string, name: string): string {
  return `${parent.replace(/[\\/]$/, '')}${parent.includes('\\') ? '\\' : '/'}${name}`
}

export function WorkspaceSidebar({
  controller,
  busy,
  activePath,
  closeFolder,
}: {
  controller: WorkspaceController
  busy: boolean
  activePath: string | null
  closeFolder: () => void
}): React.JSX.Element {
  const state = useStore(controller.store)
  const t = i18next.t.bind(i18next)
  return (
    <section className="workspace-browser" aria-label={t('files')}>
      <div className="workspace-browser-content">
        {state.value?.root ? (
          <nav aria-label={t('workspaceFiles')}>
            <Directory
              key={state.value.root.id}
              node={state.value.root}
              controller={controller}
              busy={busy}
              path={state.value.root.displayPath}
              activePath={activePath}
              root
              closeFolder={closeFolder}
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
    </section>
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
