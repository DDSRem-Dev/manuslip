import { Icon } from './Icons'
import { requiresTranslationKey } from './translation/availability'
import type { ReadingStatus } from './translation/controller'
import { readingCopy } from './translation/copy'
import type { TranslationSettingsTarget } from './translation/settings-navigation'

export function ReadingPlaceholder({
  status,
  locale,
  configure,
  reload,
}: {
  status: ReadingStatus
  locale: string
  configure(target?: TranslationSettingsTarget): void
  reload(): void
}): React.JSX.Element | null {
  const copy = readingCopy[locale === 'zh-CN' ? 'zh-CN' : 'en']
  if (status.configurationLoading)
    return (
      <div className="reading-progress">
        <p role="status">{copy.loadingSettings}</p>
      </div>
    )
  if (status.configurationError)
    return (
      <div className="reading-recovery">
        <p role="alert">
          <strong>{copy.settingsError}</strong> {copy.settingsRecovery}
        </p>
        <button className="primary" type="button" onClick={reload}>
          {copy.reload}
        </button>
      </div>
    )
  const configuration = status.configuration
  if (!configuration?.settings) {
    const readOnly = configuration?.configuration === 'read-only'
    return (
      <div className="reading-recovery">
        <p>
          {readOnly && <strong>{copy.readOnlyTitle} </strong>}
          {readOnly ? copy.readOnlyHint : copy.setupHint}
        </p>
        <button className="primary" type="button" onClick={() => configure()}>
          <Icon name="settings" size={16} />
          {readOnly ? copy.configure : copy.setup}
        </button>
      </div>
    )
  }
  if (status.phase === 'preparing' || status.phase === 'translating') return null
  const needsKey =
    requiresTranslationKey(configuration.settings) && configuration.credential === 'none'
  if (!needsKey) return null
  return (
    <div className="reading-recovery">
      <p>{copy.keyOffline}</p>
      <button className="primary" type="button" onClick={() => configure('key')}>
        {copy.addKey}
      </button>
    </div>
  )
}
