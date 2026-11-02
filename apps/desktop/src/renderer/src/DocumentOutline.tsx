import { useEffect, useState } from 'react'
import type { DocumentController } from './document'
import { Icon } from './Icons'
import { i18next } from './i18n'
import { useDocumentStatus } from './use-document-status'

function revealHeading(document: DocumentController, from: number): () => void {
  return () => document.revealRange(from)
}

export function DocumentOutline({
  document,
  busy,
  panel = false,
}: {
  document: DocumentController
  busy: boolean
  panel?: boolean
}): React.JSX.Element {
  const status = useDocumentStatus(document)
  const outline = document.store.getState().outline
  const [expanded, setExpanded] = useState(false)
  const [visible, setVisible] = useState(200)
  const t = i18next.t.bind(i18next)
  useEffect(() => {
    document.preview.setNavigation(true)
    return () => document.preview.setNavigation(false)
  }, [document])
  const current = status.semanticRevision === status.revision && status.semantic === 'ready'
  return (
    <details
      className="document-outline"
      open={panel || expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary hidden={panel}>
        <Icon name="outline" size={16} />
        {t('outline')}
        <Icon name="chevron" size={12} />
      </summary>
      {(panel || expanded) && (
        <nav aria-label={t('documentHeadings')}>
          {!current && (
            <p role="status">
              {t(
                status.semantic === 'error' || status.semantic === 'limit'
                  ? 'outlineUnavailable'
                  : 'outlineUpdating',
              )}
            </p>
          )}
          {current && !outline.length && <p>{t('noHeadings')}</p>}
          <ol>
            {outline.slice(0, visible).map((heading) => (
              <li key={`${heading.from}:${heading.to}`}>
                <button
                  type="button"
                  disabled={busy || !current || status.composing}
                  style={{ paddingInlineStart: 12 + (heading.depth - 1) * 10 }}
                  onClick={revealHeading(document, heading.from)}
                >
                  <bdi>{heading.text || t('emptyHeading')}</bdi>
                </button>
              </li>
            ))}
          </ol>
          {outline.length > visible && (
            <button type="button" onClick={() => setVisible((count) => count + 200)}>
              {t('moreHeadings')}
            </button>
          )}
        </nav>
      )}
    </details>
  )
}
