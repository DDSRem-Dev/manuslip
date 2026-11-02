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
      <span>{t('cursorPosition', { line: status.line, column: status.column })}</span>
      <ToolbarDisclosure label={t('documentDetails')} summary={words ?? characters ?? undefined}>
        <div className="document-details">
          {(words || characters) && (
            <dl className="document-statistics">
              {words && (
                <div>
                  <dt>{t('documentWords')}</dt>
                  <dd>{status.wordCount?.toLocaleString(i18next.language)}</dd>
                </div>
              )}
              {characters && (
                <div>
                  <dt>{t('documentCharacters')}</dt>
                  <dd>{status.characterCount?.toLocaleString(i18next.language)}</dd>
                </div>
              )}
            </dl>
          )}
          {!words && !characters && (
            <p className="document-counts-unavailable">{t('documentCountsUnavailable')}</p>
          )}
          <dl className="document-file-details">
            <dt>{t('fileEncoding')}</dt>
            <dd>
              {status.info.encoding.toUpperCase()}
              {status.info.bom ? ' · BOM' : ''}
            </dd>
            <dt>{t('documentLineEndings')}</dt>
            <dd>{status.info.newline.toUpperCase()}</dd>
            <dt>{t('documentSize')}</dt>
            <dd>{t('documentBytes', { bytes: status.bytes.toLocaleString(i18next.language) })}</dd>
          </dl>
          <p className="document-size-basis">{t('documentSizeBasis')}</p>
          <dl className="document-location">
            <dt>{t('documentLocation')}</dt>
            <dd dir="auto">{status.info.displayPath || t('untitled')}</dd>
          </dl>
        </div>
      </ToolbarDisclosure>
    </div>
  )
}
