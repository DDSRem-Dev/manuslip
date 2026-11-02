import type { Formality, TranslationSettings } from '@manuslip/translate'
import type { Locale } from '../../shared/contracts'
import { DeepLFields } from './TranslationProviderFields'
import { translationCopy } from './translation-copy'

export function TranslationOptions({
  id,
  locale,
  draft,
  glossary,
  nativeFormality,
  nativeGlossary,
  onChange,
  onGlossaryChange,
}: {
  id: string
  locale: Locale
  draft: TranslationSettings
  glossary: string
  nativeFormality: boolean
  nativeGlossary: boolean
  onChange(settings: TranslationSettings): void
  onGlossaryChange(value: string): void
}): React.JSX.Element {
  const copy = translationCopy[locale]
  const deepl = draft.provider.adapter === 'deepl'
  return (
    <details className="translation-options">
      <summary>{copy.advanced}</summary>
      {(!deepl || nativeFormality || draft.formality !== 'default') && (
        <>
          <label htmlFor={`${id}-formality`}>{copy.formality}</label>
          <select
            id={`${id}-formality`}
            value={draft.formality}
            onChange={(event) => onChange({ ...draft, formality: event.target.value as Formality })}
          >
            <option value="default">{copy.default}</option>
            <option value="formal" disabled={deepl && !nativeFormality}>
              {copy.formal}
            </option>
            <option value="informal" disabled={deepl && !nativeFormality}>
              {copy.informal}
            </option>
          </select>
        </>
      )}
      {deepl && (
        <DeepLFields
          id={id}
          locale={locale}
          options={draft.provider.options}
          allowGlossary={nativeGlossary}
          onChange={(options) => onChange({ ...draft, provider: { ...draft.provider, options } })}
        />
      )}
      {!deepl && (
        <>
          <label htmlFor={`${id}-glossary`}>{copy.glossary}</label>
          <textarea
            id={`${id}-glossary`}
            name="glossary"
            rows={4}
            maxLength={65536}
            value={glossary}
            aria-describedby={`${id}-glossary-hint`}
            onChange={(event) => {
              event.target.setCustomValidity('')
              event.target.removeAttribute('aria-invalid')
              onGlossaryChange(event.target.value)
            }}
          />
          <p className="muted" id={`${id}-glossary-hint`}>
            {copy.glossaryHint}
          </p>
          {(['temperature', 'maxOutputTokens'] as const).map((name) => (
            <label key={name}>
              {copy[name === 'temperature' ? 'temperature' : 'tokens']}
              <input
                type="number"
                min={name === 'temperature' ? 0 : 1}
                max={name === 'temperature' ? 2 : 16384}
                step={name === 'temperature' ? 0.1 : 1}
                required
                value={
                  (draft.provider.options[name] as number) ?? (name === 'temperature' ? 0 : 8192)
                }
                onChange={(event) =>
                  onChange({
                    ...draft,
                    provider: {
                      ...draft.provider,
                      options: {
                        ...draft.provider.options,
                        [name]: event.target.valueAsNumber,
                      },
                    },
                  })
                }
              />
            </label>
          ))}
        </>
      )}
    </details>
  )
}
