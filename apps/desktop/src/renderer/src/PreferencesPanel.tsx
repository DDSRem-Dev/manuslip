import type { RefObject } from 'react'
import type { Bootstrap, Locale, Settings, Theme } from '../../shared/contracts'
import { Icon } from './Icons'
import { i18next } from './i18n'
import { PluginSettings } from './PluginSettings'
import { TranslationSettings } from './TranslationSettings'
import type { TranslationSettingsHandle } from './translation/settings-navigation'

export type PreferencesPage = 'general' | 'translation' | 'plugins'

export function PreferencesPanel({
  bootstrap,
  pendingSettings,
  failedSettings,
  busy,
  status,
  preferencePage,
  setPreferencePage,
  retryPreferences,
  translationSettings,
  update,
  onClose,
}: {
  bootstrap: Bootstrap
  pendingSettings: Settings | null
  failedSettings: Settings | null
  busy: boolean
  status: string
  preferencePage: PreferencesPage
  setPreferencePage(page: PreferencesPage): void
  retryPreferences: RefObject<HTMLButtonElement | null>
  translationSettings: RefObject<TranslationSettingsHandle | null>
  update(patch: Partial<Settings>): Promise<void>
  onClose(): void
}): React.JSX.Element {
  const t = i18next.t.bind(i18next)
  return (
    <section className="preferences" aria-labelledby="preferences-heading">
      <header className="preferences-header">
        <h2 id="preferences-heading">{t('settings')}</h2>
        <button
          className="icon-button"
          type="button"
          aria-label={t('closePreferences')}
          title={t('closePreferences')}
          onClick={() => onClose()}
        >
          <Icon name="close" />
        </button>
      </header>
      <nav className="preferences-navigation" aria-label={t('settings')}>
        <button
          type="button"
          aria-pressed={preferencePage === 'general'}
          onClick={() => setPreferencePage('general')}
        >
          <Icon name="sliders" />
          {t('generalSettings')}
        </button>
        <button
          type="button"
          aria-pressed={preferencePage === 'translation'}
          onClick={() => {
            setPreferencePage('translation')
            requestAnimationFrame(() => translationSettings.current?.reveal('provider'))
          }}
        >
          <Icon name="translate" />
          {t('translationSettingsPage')}
        </button>
        <button
          type="button"
          aria-pressed={preferencePage === 'plugins'}
          onClick={() => setPreferencePage('plugins')}
        >
          <Icon name="plugins" />
          {t('pluginsSettingsPage')}
        </button>
      </nav>
      <div className="preferences-content">
        <div hidden={preferencePage !== 'general'}>
          {bootstrap.settingsRecovered && <p role="status">{t('recovered')}</p>}
          {bootstrap.settingsReadOnly && <p role="status">{t('readOnly')}</p>}
          <div className="preference-row">
            <label htmlFor="theme">{t('appearance')}</label>
            <select
              id="theme"
              disabled={busy || bootstrap.settingsReadOnly}
              value={(pendingSettings || bootstrap.settings).theme}
              onChange={(event) => void update({ theme: event.target.value as Theme })}
            >
              <option value="system">{t('system')}</option>
              <option value="light">{t('light')}</option>
              <option value="dark">{t('dark')}</option>
            </select>
          </div>
          <div className="preference-row">
            <label htmlFor="locale">{t('language')}</label>
            <select
              id="locale"
              disabled={busy || bootstrap.settingsReadOnly}
              value={(pendingSettings || bootstrap.settings).locale}
              onChange={(event) => void update({ locale: event.target.value as Locale })}
            >
              <option value="en">English</option>
              <option value="zh-CN">简体中文</option>
            </select>
          </div>
          <p className="feedback" role="status">
            {status ? t(status) : ''}
          </p>
          {failedSettings && (
            <div className="preference-error">
              <p role="alert">{t('saveError')}</p>
              <button
                ref={retryPreferences}
                type="button"
                disabled={busy || bootstrap.settingsReadOnly}
                onClick={() => void update(failedSettings)}
              >
                {t('retryPreferences')}
              </button>
            </div>
          )}
          <label className="spellcheck-preference">
            <input
              type="checkbox"
              aria-describedby="spellcheck-hint"
              checked={Boolean((pendingSettings || bootstrap.settings).spellcheck)}
              disabled={busy || bootstrap.settingsReadOnly || !bootstrap.spellcheckAvailable}
              onChange={(event) => void update({ spellcheck: event.target.checked })}
            />
            {t('spellcheck')}
          </label>
          <p className="muted" id="spellcheck-hint">
            {t(bootstrap.spellcheckAvailable ? 'spellcheckHint' : 'spellcheckUnavailable')}
          </p>
        </div>
        <div hidden={preferencePage !== 'translation'}>
          <TranslationSettings ref={translationSettings} locale={bootstrap.settings.locale} />
        </div>
        <div hidden={preferencePage !== 'plugins'}>
          <PluginSettings locale={bootstrap.settings.locale} />
        </div>
      </div>
    </section>
  )
}
