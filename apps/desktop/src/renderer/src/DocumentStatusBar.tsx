import type { DocumentStatus } from './document'
import { i18next } from './i18n'
import { ToolbarDisclosure } from './ToolbarDisclosure'

export function DocumentStatusBar({
  status,
}: {
  status: Pick<
    DocumentStatus,
    | 'info'
    | 'line'
    | 'column'
    | 'bytes'
    | 'wordCount'
    | 'characterCount'
    | 'revision'
    | 'semanticRevision'
  >
}): React.JSX.Element {
  const t = i18next.t.bind(i18next)
  const countsCurrent = status.semanticRevision === status.revision
  const words =
    countsCurrent && status.wordCount !== null ? t('wordCount', { count: status.wordCount }) : null
  const characters =
    countsCurrent && status.characterCount !== null
      ? t('characterCount', { count: status.characterCount })
      : null
  return (
    <div className="editor-status">
      <div className="editor-status-summary">
        <span>{t('cursorPosition', { line: status.line, column: status.column })}</span>
        {words && <span className="editor-status-count">{words}</span>}
        {characters && <span className="editor-status-count">{characters}</span>}
      </div>
      <ToolbarDisclosure label={t('documentDetails')} icon="document">
        <div className="document-details">
          <dl>
            <dt>{t('documentLocation')}</dt>
            <dd dir="auto">{status.info.displayPath || t('untitled')}</dd>
            <dt>{t('fileEncoding')}</dt>
            <dd>
              {status.info.encoding.toUpperCase()}
              {status.info.bom ? ' · BOM' : ''}
            </dd>
            <dt>{t('documentLineEndings')}</dt>
            <dd>{status.info.newline.toUpperCase()}</dd>
            <dt>{t('documentSize')}</dt>
            <dd>
              {t('documentBytes', { bytes: status.bytes.toLocaleString(i18next.language) })}
              <small className="document-size-basis">{t('documentSizeBasis')}</small>
            </dd>
            {words && (
              <>
                <dt>{t('documentWords')}</dt>
                <dd>{status.wordCount?.toLocaleString(i18next.language)}</dd>
              </>
            )}
            {characters && (
              <>
                <dt>{t('documentCharacters')}</dt>
                <dd>{status.characterCount?.toLocaleString(i18next.language)}</dd>
              </>
            )}
            {!words && !characters && (
              <>
                <dt>{t('documentStatistics')}</dt>
                <dd>{t('documentCountsUnavailable')}</dd>
              </>
            )}
          </dl>
          <p>{t('local')}</p>
        </div>
      </ToolbarDisclosure>
    </div>
  )
}
