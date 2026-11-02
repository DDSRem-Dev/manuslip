import type { ProviderDescriptor, ProviderLanguage, TranslationSettings } from '@manuslip/translate'
import type { Locale } from '../../shared/contracts'
import { translationCopy } from './translation-copy'

export function TranslationLanguageFields({
  id,
  locale,
  draft,
  languages,
  sourceTag,
  targetTag,
  onChange,
}: {
  id: string
  locale: Locale
  draft: TranslationSettings
  languages?: ProviderLanguage[]
  sourceTag?: string
  targetTag?: string
  onChange(name: 'sourceLanguage' | 'targetLanguage', value: string): void
}): React.JSX.Element {
  const copy = translationCopy[locale]
  return (
    <>
      <div className="translation-language-fields">
        {(['sourceLanguage', 'targetLanguage'] as const).map((name) => {
          const source = name === 'sourceLanguage'
          const tag = source ? sourceTag : targetTag
          return (
            <div key={name}>
              <label htmlFor={`${id}-${name}`}>{copy[source ? 'source' : 'target']}</label>
              {draft.provider.adapter === 'deepl' && languages ? (
                <select
                  id={`${id}-${name}`}
                  name={name}
                  value={tag ?? draft[name]}
                  aria-describedby={`${id}-language-hint`}
                  onChange={(event) => onChange(name, event.target.value)}
                >
                  {source && <option value="auto">{copy.detect}</option>}
                  {!tag && draft[name] !== 'auto' && (
                    <option value={draft[name]}>{draft[name]}</option>
                  )}
                  {languages
                    .filter(
                      (language) => language.tags && (source ? language.source : language.target),
                    )
                    .map((language) => (
                      <option key={language.tag} value={language.tag}>
                        {new Intl.DisplayNames([locale], { type: 'language' }).of(language.tag) ??
                          language.tag}
                      </option>
                    ))}
                </select>
              ) : (
                <input
                  id={`${id}-${name}`}
                  name={name}
                  required
                  maxLength={64}
                  value={draft[name]}
                  aria-describedby={`${id}-language-hint`}
                  autoComplete="off"
                  spellCheck={false}
                  dir="ltr"
                  onChange={(event) => {
                    event.target.setCustomValidity('')
                    event.target.removeAttribute('aria-invalid')
                    onChange(name, event.target.value)
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
      <p className="muted" id={`${id}-language-hint`}>
        {copy.languageHint}
      </p>
    </>
  )
}

export function DeepLFields({
  id,
  locale,
  options,
  allowGlossary,
  onChange,
}: {
  id: string
  locale: Locale
  options: ProviderDescriptor['options']
  allowGlossary: boolean
  onChange(options: ProviderDescriptor['options']): void
}): React.JSX.Element {
  const copy = translationCopy[locale]
  const update = (key: 'languagesEndpoint' | 'glossaryId', value: string): void => {
    const next = { ...options }
    if (value) next[key] = value
    else delete next[key]
    onChange(next)
  }
  return (
    <>
      <label htmlFor={`${id}-languages-endpoint`}>{copy.languagesEndpoint}</label>
      <input
        id={`${id}-languages-endpoint`}
        type="url"
        maxLength={8192}
        value={String(options.languagesEndpoint ?? '')}
        placeholder="https://api-free.deepl.com/v3/languages?resource=translate_text"
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
        aria-describedby={`${id}-languages-endpoint-hint`}
        onChange={(event) => update('languagesEndpoint', event.target.value)}
      />
      <p className="muted" id={`${id}-languages-endpoint-hint`}>
        {copy.languagesEndpointHint}
      </p>
      {(allowGlossary || options.glossaryId) && (
        <>
          <label htmlFor={`${id}-glossary-id`}>{copy.glossaryId}</label>
          <input
            id={`${id}-glossary-id`}
            disabled={!allowGlossary}
            maxLength={36}
            pattern="[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}"
            value={String(options.glossaryId ?? '')}
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${id}-native-options-hint`}
            onChange={(event) => update('glossaryId', event.target.value)}
          />
          {!allowGlossary && (
            <button type="button" onClick={() => update('glossaryId', '')}>
              {copy.removeGlossary}
            </button>
          )}
        </>
      )}
      <p className="muted" id={`${id}-native-options-hint`}>
        {copy.nativeOptionsHint}
      </p>
    </>
  )
}
