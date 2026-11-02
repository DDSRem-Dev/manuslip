import {
  deepLLanguage,
  normalizeEndpoint,
  type TranslationSettings as Settings,
} from '@manuslip/translate'
import { type Ref, useCallback, useEffect, useId, useRef, useState } from 'react'
import type { Locale, Result } from '../../shared/contracts'
import type { TranslationState } from '../../shared/translation-contracts'
import { TranslationConnectionFields } from './TranslationConnectionFields'
import { TranslationOptions } from './TranslationOptions'
import { TranslationLanguageFields } from './TranslationProviderFields'
import { TranslationReadiness } from './TranslationReadiness'
import { TranslationCache, TranslationCredentials } from './TranslationStorageSettings'
import {
  emptyTranslationSettings as empty,
  translationEndpoints as endpoints,
} from './translation/settings-draft'
import {
  type TranslationSettingsHandle,
  useTranslationSettingsNavigation,
} from './translation/settings-navigation'
import { translationCopy } from './translation-copy'

const describe = (code?: string): keyof typeof translationCopy.en =>
  code === 'translation-key-store'
    ? 'keyError'
    : code === 'translation-stale'
      ? 'stale'
      : code === 'translation-key-required'
        ? 'keyRequired'
        : code === 'translation-auth'
          ? 'auth'
          : code === 'translation-quota'
            ? 'quota'
            : code === 'translation-settings'
              ? 'unsupported'
              : 'generic'

/** Keys are uncontrolled DOM values, cleared synchronously before the write-only bridge call. */
export function TranslationSettings({
  locale,
  ref,
  active = true,
}: {
  locale: Locale
  active?: boolean
  ref?: Ref<TranslationSettingsHandle>
}): React.JSX.Element {
  const copy = translationCopy[locale]
  const id = useId()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<TranslationState | null>(null)
  const [draft, setDraft] = useState<Settings>(() => structuredClone(empty))
  const [glossary, setGlossary] = useState('')
  const [draftChanged, setDraftChanged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<keyof typeof copy | null>(null)
  const [status, setStatus] = useState<keyof typeof copy | null>(null)
  const [feedbackArea, setFeedbackArea] = useState<'settings' | 'key' | 'cache'>('settings')
  const mounted = useRef(true)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const dirty = useRef(false)
  const observedRevision = useRef<number | null>(null)
  const providerDrafts = useRef(new Map<string, { settings: Settings; glossary: string }>())
  const details = useTranslationSettingsNavigation(ref, id, open, Boolean(state) && !busy, setOpen)
  const editDraft = (value: Settings): void => {
    dirty.current = true
    setStatus(null)
    setError(null)
    setDraft(value)
  }
  const editGlossary = (value: string): void => {
    dirty.current = true
    setStatus(null)
    setError(null)
    setGlossary(value)
  }
  const applyState = useCallback((value: TranslationState, replaceDraft = false): void => {
    if (
      dirty.current &&
      !replaceDraft &&
      observedRevision.current !== null &&
      observedRevision.current !== value.settingsRevision
    )
      setDraftChanged(true)
    observedRevision.current = value.settingsRevision
    setState(value)
    if (replaceDraft || !dirty.current) {
      dirty.current = false
      setDraftChanged(false)
      const settings = value.settings ?? structuredClone(empty)
      setDraft(settings)
      setGlossary(settings.glossary.map((entry) => `${entry.source} => ${entry.target}`).join('\n'))
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (busy || !restoreFocus.current) return
    const previous = restoreFocus.current
    restoreFocus.current = null
    if (
      document.activeElement === document.body ||
      document.activeElement === details.current?.closest('dialog')
    )
      (previous.isConnected
        ? previous
        : details.current?.querySelector<HTMLElement>('[data-translation-key]')
      )?.focus()
  }, [busy, details])
  const load = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const result = await window.manuslip.translationState()
      if (!mounted.current) return
      if (!result.ok) {
        setError(describe(result.code))
        return
      }
      applyState(result.value)
    } catch {
      if (mounted.current) setError('generic')
    }
  }, [applyState])
  useEffect(() => {
    if (!open) return
    void load()
    return window.manuslip.onTranslationChanged(() => {
      void window.manuslip
        .translationState()
        .then((result) => {
          if (mounted.current && result.ok) applyState(result.value)
        })
        .catch(() => {})
    })
  }, [open, load, applyState])
  async function run(
    operation: () => Promise<Result<TranslationState>>,
    success: keyof typeof copy,
  ): Promise<boolean> {
    restoreFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setBusy(true)
    setFeedbackArea(success === 'keySaved' ? 'key' : success === 'cleared' ? 'cache' : 'settings')
    setError(null)
    setStatus(null)
    try {
      const result = await operation()
      if (!mounted.current) return false
      if (!result.ok) {
        setError(describe(result.code))
        return false
      }
      applyState(result.value, success === 'saved')
      setStatus(success)
      return true
    } catch {
      if (mounted.current) setError('generic')
      return false
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const form = event.currentTarget
    try {
      normalizeEndpoint(draft.provider.baseUrl)
    } catch {
      const field = form.elements.namedItem('endpoint')
      if (field instanceof HTMLInputElement) {
        field.setCustomValidity(copy.endpointHint)
        field.setAttribute('aria-invalid', 'true')
        field.reportValidity()
        field.focus()
      }
      return
    }
    const normalized = { ...draft }
    for (const name of ['sourceLanguage', 'targetLanguage'] as const) {
      const field = form.elements.namedItem(name)
      if (!(field instanceof HTMLInputElement)) continue
      try {
        const language = draft[name].trim()
        if (name === 'sourceLanguage' && language === 'auto') normalized[name] = 'auto'
        else {
          const canonical = Intl.getCanonicalLocales(language)[0]
          if (!canonical || language === 'auto') throw new Error('Invalid language')
          normalized[name] = canonical
        }
      } catch {
        field.setCustomValidity(copy.invalidLanguage)
        field.setAttribute('aria-invalid', 'true')
        field.reportValidity()
        field.focus()
        return
      }
    }
    const entries: Settings['glossary'] = []
    for (const line of draft.provider.adapter === 'deepl'
      ? []
      : glossary.split('\n').filter((value) => value.trim())) {
      const at = line.indexOf('=>')
      if (
        at < 1 ||
        !line.slice(0, at).trim() ||
        !line.slice(at + 2).trim() ||
        entries.length >= 1000
      ) {
        const field = form.elements.namedItem('glossary')
        if (field instanceof HTMLTextAreaElement) {
          field.setCustomValidity(copy.invalidGlossary)
          field.setAttribute('aria-invalid', 'true')
          field.reportValidity()
          field.focus()
        }
        return
      }
      entries.push({ source: line.slice(0, at).trim(), target: line.slice(at + 2).trim() })
    }
    await run(
      () => window.manuslip.configureTranslation({ ...normalized, glossary: entries }),
      'saved',
    )
  }
  const disabled = busy || state?.configuration === 'read-only'
  const feedback = (
    <>
      <p className="feedback" role="status">
        {status ? copy[status] : ''}
      </p>
      {error && <p role="alert">{copy[error]}</p>}
    </>
  )
  const connectionChanged =
    state?.settings &&
    (state.settings.provider.adapter !== draft.provider.adapter ||
      state.settings.provider.baseUrl !== draft.provider.baseUrl ||
      state.settings.provider.options.languagesEndpoint !==
        draft.provider.options.languagesEndpoint)
  const deepl = draft.provider.adapter === 'deepl'
  const languages = !connectionChanged ? state?.languages : undefined
  const selected = (source: boolean) => {
    try {
      return deepLLanguage(
        draft[source ? 'sourceLanguage' : 'targetLanguage'],
        source,
        languages ?? [],
      )
    } catch {
      return null
    }
  }
  const nativeFormality = Boolean(selected(false)?.formality)
  const nativeGlossary = Boolean(selected(true)?.glossary && selected(false)?.glossary)
  const languageChanged = (name: 'sourceLanguage' | 'targetLanguage', value: string): void => {
    const next = { ...draft, [name]: value }
    if (deepl) {
      const options = { ...draft.provider.options }
      try {
        const target = deepLLanguage(next.targetLanguage, false, languages ?? [])
        if (!target.formality) next.formality = 'default'
        if (!target.glossary || !deepLLanguage(next.sourceLanguage, true, languages ?? []).glossary)
          delete options.glossaryId
      } catch {
        delete options.glossaryId
      }
      next.provider = { ...draft.provider, options }
    }
    editDraft(next)
  }
  const changedProvider = (value: string): void => {
    if (value !== 'ollama' && value !== 'openai-compatible' && value !== 'deepl') return
    const endpoint = document.getElementById(`${id}-endpoint`)
    if (endpoint instanceof HTMLInputElement) {
      endpoint.setCustomValidity('')
      endpoint.removeAttribute('aria-invalid')
    }
    providerDrafts.current.set(draft.provider.adapter, {
      settings: structuredClone(draft),
      glossary,
    })
    const previous = providerDrafts.current.get(value)
    if (previous) {
      editDraft({
        ...previous.settings,
        sourceLanguage: draft.sourceLanguage,
        targetLanguage: draft.targetLanguage,
      })
      editGlossary(previous.glossary)
      return
    }
    editDraft({
      ...draft,
      glossary: [],
      formality: 'default',
      provider: {
        ...draft.provider,
        adapter: value,
        baseUrl: endpoints[value],
        model: value === 'deepl' ? null : '',
        options: {},
      },
    })
    editGlossary('')
  }
  return (
    <details
      ref={details}
      className="translation-settings"
      onToggle={(event) => {
        setOpen(event.currentTarget.open)
      }}
    >
      <summary>{copy.title}</summary>
      {open && (
        <div className="translation-settings-body">
          <p className="preferences-page-hint">{copy.intro}</p>
          {state && (
            <nav className="translation-section-navigation" aria-label={copy.sections}>
              {(['connection', 'languages', 'key', 'cacheShort'] as const).map((section) => (
                <button
                  type="button"
                  key={section}
                  onClick={() => {
                    const selector =
                      section === 'key'
                        ? '[data-translation-key]'
                        : section === 'cacheShort'
                          ? '[data-translation-cache]'
                          : `#${CSS.escape(`${id}-${section === 'connection' ? 'provider' : 'targetLanguage'}`)}`
                    const field = details.current?.querySelector<HTMLElement>(selector)
                    if (field && !field.matches(':disabled')) field.focus()
                    field?.scrollIntoView({ block: 'nearest' })
                  }}
                >
                  {copy[section]}
                </button>
              ))}
            </nav>
          )}
          {!state ? (
            <>
              <p role="status">{error ? copy[error] : copy.load}</p>
              <button type="button" onClick={() => void load()}>
                {copy.reload}
              </button>
            </>
          ) : (
            <>
              {(state.settings || state.configuration === 'read-only') && (
                <TranslationReadiness
                  state={state}
                  locale={locale}
                  connectionChanged={Boolean(connectionChanged)}
                  onKey={() =>
                    details.current?.querySelector<HTMLElement>('[data-translation-key]')?.focus()
                  }
                />
              )}
              {state.configuration === 'recovered' && <p role="status">{copy.recoveredConfig}</p>}
              {draftChanged && (
                <p className="preference-notice" role="status">
                  {copy.draftChanged}
                </p>
              )}
              <form
                onSubmit={(event) => void save(event)}
                onInvalidCapture={(event) => {
                  if (event.target instanceof HTMLElement) {
                    const section = event.target.closest('details')
                    if (section) section.open = true
                  }
                }}
              >
                <fieldset disabled={disabled}>
                  <legend>{copy.connection}</legend>
                  <TranslationConnectionFields
                    id={id}
                    locale={locale}
                    draft={draft}
                    state={state}
                    connectionChanged={Boolean(connectionChanged)}
                    languages={languages}
                    onProvider={changedProvider}
                    onChange={editDraft}
                    run={run}
                  />
                  <div className="translation-language-section">
                    <h3>{copy.languages}</h3>
                    <TranslationLanguageFields
                      id={id}
                      locale={locale}
                      draft={draft}
                      languages={languages}
                      sourceTag={selected(true)?.tag}
                      targetTag={selected(false)?.tag}
                      onChange={languageChanged}
                    />
                  </div>
                  <TranslationOptions
                    id={id}
                    locale={locale}
                    draft={draft}
                    glossary={glossary}
                    nativeFormality={nativeFormality}
                    nativeGlossary={nativeGlossary}
                    onChange={editDraft}
                    onGlossaryChange={editGlossary}
                  />
                  <div className="translation-save-actions">
                    <div className="action-row">
                      <button type="submit" className="primary">
                        {busy ? copy.busy : copy.save}
                      </button>
                      {dirty.current && (
                        <button
                          type="button"
                          onClick={() => {
                            applyState(state, true)
                            providerDrafts.current.clear()
                            setError(null)
                            setStatus(null)
                            for (const field of details.current?.querySelectorAll<
                              HTMLInputElement | HTMLTextAreaElement
                            >('input, textarea') ?? []) {
                              field.setCustomValidity('')
                              field.removeAttribute('aria-invalid')
                            }
                          }}
                        >
                          {copy.discard}
                        </button>
                      )}
                    </div>
                    {dirty.current && (
                      <span className="preference-hint" role="status">
                        {copy.unsaved}
                      </span>
                    )}
                  </div>
                  {feedbackArea === 'settings' && feedback}
                </fieldset>
              </form>
              <TranslationCredentials
                state={state}
                locale={locale}
                busy={busy}
                connectionChanged={Boolean(connectionChanged)}
                active={active && open}
                run={run}
                feedback={feedbackArea === 'key' ? feedback : null}
              />
              <TranslationCache
                state={state}
                locale={locale}
                busy={busy}
                run={run}
                feedback={feedbackArea === 'cache' ? feedback : null}
              />
            </>
          )}
        </div>
      )}
    </details>
  )
}
