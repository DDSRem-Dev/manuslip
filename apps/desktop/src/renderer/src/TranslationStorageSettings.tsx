import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import type { Locale, Result } from '../../shared/contracts'
import type { TranslationState } from '../../shared/translation-contracts'
import { translationCopy } from './translation-copy'

export type TranslationSettingsAction = (
  operation: () => Promise<Result<TranslationState>>,
  success: keyof typeof translationCopy.en,
) => Promise<boolean>

/** Credentials stay in the password field until a write-only bridge call takes ownership. */
export function TranslationCredentials({
  state,
  locale,
  busy,
  connectionChanged,
  active,
  run,
  feedback,
}: {
  state: TranslationState
  locale: Locale
  busy: boolean
  connectionChanged: boolean
  active: boolean
  run: TranslationSettingsAction
  feedback: ReactNode
}): React.JSX.Element {
  const copy = translationCopy[locale]
  const id = useId()
  const keyInput = useRef<HTMLInputElement>(null)
  const persistence = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if ((!active || connectionChanged) && keyInput.current) keyInput.current.value = ''
  }, [active, connectionChanged])
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const field = keyInput.current
        if (!field?.value || !state.settings) return
        const key = field.value
        field.value = ''
        void run(
          () =>
            window.manuslip.setTranslationCredential({
              settingsRevision: state.settingsRevision,
              key,
              persist: Boolean(persistence.current?.checked),
            }),
          'keySaved',
        )
      }}
    >
      <fieldset
        disabled={
          busy || connectionChanged || !state.settings || state.configuration === 'read-only'
        }
      >
        <legend>{copy.key}</legend>
        <p className="preference-hint">{copy[state.credential]}</p>
        {(!state.settings || connectionChanged) && (
          <p className="preference-notice">{copy.saveFirst}</p>
        )}
        <label htmlFor={`${id}-key`}>{copy.key}</label>
        <input
          id={`${id}-key`}
          name="translation-key"
          data-translation-key
          ref={keyInput}
          type="password"
          required
          maxLength={4096}
          pattern="[\x21-\x7e]+"
          autoComplete="new-password"
          spellCheck={false}
          dir="ltr"
          aria-describedby={`${id}-key-hint`}
        />
        <p className="muted" id={`${id}-key-hint`}>
          {copy.keyHint}
        </p>
        <label className="spellcheck-preference">
          <input ref={persistence} type="checkbox" aria-describedby={`${id}-persist-hint`} />
          {copy.persist}
        </label>
        <p className="muted" id={`${id}-persist-hint`}>
          {copy.persistHint}
        </p>
        <div className="action-row">
          <button type="submit">{copy.setKey}</button>
          {state.credential !== 'none' && (
            <button
              type="button"
              onClick={() =>
                void run(
                  () =>
                    window.manuslip.setTranslationCredential({
                      settingsRevision: state.settingsRevision,
                      key: null,
                      persist: false,
                    }),
                  'keySaved',
                ).then((success) => {
                  if (success) keyInput.current?.focus()
                })
              }
            >
              {copy.removeKey}
            </button>
          )}
        </div>
        {feedback}
      </fieldset>
    </form>
  )
}

export function TranslationCache({
  state,
  locale,
  busy,
  run,
  feedback,
}: {
  state: TranslationState
  locale: Locale
  busy: boolean
  run: TranslationSettingsAction
  feedback: ReactNode
}): React.JSX.Element {
  const copy = translationCopy[locale]
  const id = useId()
  const [confirm, setConfirm] = useState(false)
  const clearButton = useRef<HTMLButtonElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const confirmed = useRef(false)
  useEffect(() => {
    if (confirm) {
      confirmed.current = true
      confirmButton.current?.focus()
    } else if (confirmed.current) {
      confirmed.current = false
      clearButton.current?.focus()
    }
  }, [confirm])
  return (
    <section className="translation-cache" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`}>{copy.cache}</h3>
      <p className="muted">{copy[state.cache]}</p>
      <p className="preference-hint">{copy.offlineHint}</p>
      {confirm && (
        <>
          <p>{copy.confirm}</p>
          <div className="action-row">
            <button
              ref={confirmButton}
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() => window.manuslip.clearTranslationCache(), 'cleared').then(
                  (success) => {
                    if (success) setConfirm(false)
                  },
                )
              }
            >
              {copy.confirmClear}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirm(false)}>
              {copy.cancel}
            </button>
          </div>
        </>
      )}
      <button
        data-translation-cache
        ref={clearButton}
        type="button"
        disabled={busy || confirm || state.cache === 'future'}
        onClick={() => setConfirm(true)}
      >
        {copy.clear}
      </button>
      {feedback}
    </section>
  )
}
