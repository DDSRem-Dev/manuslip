import type { ProviderLanguage, TranslationSettings } from '@manuslip/translate'
import type { Locale } from '../../shared/contracts'
import type { TranslationState } from '../../shared/translation-contracts'
import type { TranslationSettingsAction } from './TranslationStorageSettings'
import { translationEndpoints as endpoints } from './translation/settings-draft'
import { translationCopy } from './translation-copy'

export function TranslationConnectionFields({
  id,
  locale,
  draft,
  state,
  connectionChanged,
  languages,
  onProvider,
  onChange,
  run,
}: {
  id: string
  locale: Locale
  draft: TranslationSettings
  state: TranslationState
  connectionChanged: boolean
  languages?: ProviderLanguage[]
  onProvider(adapter: string): void
  onChange(settings: TranslationSettings): void
  run: TranslationSettingsAction
}): React.JSX.Element {
  const copy = translationCopy[locale]
  const deepl = draft.provider.adapter === 'deepl'
  return (
    <>
      <label htmlFor={`${id}-provider`}>{copy.provider}</label>
      <select
        id={`${id}-provider`}
        value={draft.provider.adapter}
        onChange={(event) => onProvider(event.target.value)}
      >
        <option value="openai-compatible">OpenAI-compatible</option>
        <option value="ollama">Ollama</option>
        <option value="deepl">DeepL</option>
      </select>
      <p className="preference-hint">
        {
          copy[
            draft.provider.adapter === 'ollama'
              ? 'ollamaHint'
              : deepl
                ? 'deeplProviderHint'
                : 'compatibleHint'
          ]
        }
      </p>
      <label htmlFor={`${id}-endpoint`}>{deepl ? copy.translationEndpoint : copy.endpoint}</label>
      <input
        id={`${id}-endpoint`}
        name="endpoint"
        type="url"
        required
        maxLength={8192}
        value={draft.provider.baseUrl}
        aria-describedby={`${id}-endpoint-hint`}
        autoComplete="off"
        spellCheck={false}
        dir="ltr"
        onChange={(event) => {
          event.target.setCustomValidity('')
          event.target.removeAttribute('aria-invalid')
          onChange({
            ...draft,
            provider: { ...draft.provider, baseUrl: event.target.value },
          })
        }}
      />
      <p className="muted" id={`${id}-endpoint-hint`}>
        {copy.endpointHint}
      </p>
      {deepl && (
        <div className="action-row translation-endpoint-presets">
          <button
            type="button"
            onClick={() =>
              onChange({
                ...draft,
                provider: { ...draft.provider, baseUrl: endpoints.deepl },
              })
            }
          >
            {copy.deeplFree}
          </button>
          <button
            type="button"
            onClick={() =>
              onChange({
                ...draft,
                provider: {
                  ...draft.provider,
                  baseUrl: 'https://api.deepl.com/v2/translate',
                },
              })
            }
          >
            {copy.deeplPro}
          </button>
        </div>
      )}
      {!deepl && (
        <>
          <label htmlFor={`${id}-model`}>{copy.model}</label>
          <input
            id={`${id}-model`}
            required
            maxLength={256}
            value={draft.provider.model ?? ''}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) =>
              onChange({
                ...draft,
                provider: { ...draft.provider, model: event.target.value },
              })
            }
          />
        </>
      )}
      {deepl && (
        <>
          <p className="muted">{copy.deeplHint}</p>
          <button
            type="button"
            disabled={
              Boolean(connectionChanged) ||
              !state.settings ||
              state.credential === 'none' ||
              !window.manuslip.loadTranslationLanguages
            }
            onClick={() =>
              void run(async () => {
                const loadLanguages = window.manuslip.loadTranslationLanguages
                if (!loadLanguages) throw new Error('Language discovery unavailable')
                return loadLanguages()
              }, 'languagesLoaded')
            }
          >
            {copy.loadLanguages}
          </button>
          <p className="muted">{languages ? copy.languagesLoaded : copy.languagesHint}</p>
        </>
      )}
    </>
  )
}
