import { Icon } from './Icons'
import { requiresTranslationKey } from './translation/availability'
import type { ReadingStatus } from './translation/controller'
import { readingCopy } from './translation/copy'
import type { TranslationSettingsTarget } from './translation/settings-navigation'

export function ReadingPlaceholder({
  status,
  locale,
  composing,
  configure,
  reload,
  loadCached,
}: {
  status: ReadingStatus
  locale: string
  composing: boolean
  configure(target?: TranslationSettingsTarget): void
  reload(): void
  loadCached(): void
}): React.JSX.Element | null {
  const copy = readingCopy[locale === 'zh-CN' ? 'zh-CN' : 'en']
  if (status.configurationLoading)
    return (
      <div className="reading-placeholder">
        <p role="status">{copy.loadingSettings}</p>
      </div>
    )
  if (status.configurationError)
    return (
      <div className="reading-placeholder">
        <h2>{copy.settingsError}</h2>
        <p role="alert">{copy.settingsRecovery}</p>
        <button className="primary" type="button" onClick={reload}>
          {copy.reload}
        </button>
      </div>
    )
  const configuration = status.configuration
  if (!configuration?.settings) {
    const readOnly = configuration?.configuration === 'read-only'
    return (
      <div className="reading-placeholder">
        <Icon name="translate" size={32} />
        <h2>{readOnly ? copy.readOnlyTitle : copy.setupTitle}</h2>
        <p>{readOnly ? copy.readOnlyHint : copy.setupHint}</p>
        <button className="primary" type="button" onClick={() => configure()}>
          <Icon name="settings" size={16} />
          {readOnly ? copy.configure : copy.setup}
        </button>
        <p className="muted reading-privacy">{copy.privacy}</p>
      </div>
    )
  }
  if (status.phase === 'preparing' || status.phase === 'translating') return null
  const needsKey =
    requiresTranslationKey(configuration.settings) && configuration.credential === 'none'
  return (
    <div className="reading-placeholder">
      <h2>
        {needsKey
          ? configuration.settings.provider.adapter === 'deepl'
            ? copy.deepLKeyTitle
            : copy.keyTitle
          : copy.readingTitle}
      </h2>
      <p>{needsKey ? copy.keyOffline : copy.empty}</p>
      <div className="action-row">
        {needsKey && (
          <button className="primary" type="button" onClick={() => configure('key')}>
            {copy.addKey}
          </button>
        )}
        <button type="button" disabled={composing} onClick={loadCached}>
          {copy.offline}
        </button>
      </div>
      <p className="muted reading-privacy">{copy.privacy}</p>
    </div>
  )
}
