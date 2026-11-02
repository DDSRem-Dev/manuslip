import {
  deepLLanguage,
  type Formality,
  normalizeEndpoint,
  type TranslationSettings as Settings,
} from '@manuslip/translate'
import { type Ref, useCallback, useEffect, useId, useRef, useState } from 'react'
import type { Locale, Result } from '../../shared/contracts'
import type { TranslationState } from '../../shared/translation-contracts'
import { DeepLFields, TranslationLanguageFields } from './TranslationProviderFields'
import {
  type TranslationSettingsHandle,
  useTranslationSettingsNavigation,
} from './translation/settings-navigation'
import { translationCopy } from './translation-copy'

const endpoints = {
  'openai-compatible': 'https://api.openai.com/v1/chat/completions',
  ollama: 'http://localhost:11434/api/chat',
  deepl: 'https://api-free.deepl.com/v2/translate',
}
const empty: Settings = {
  provider: {
    adapter: 'openai-compatible',
    version: '1',
    baseUrl: endpoints['openai-compatible'],
    model: '',
    profile: null,
    options: {},
  },
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  glossary: [],
  formality: 'default',
  promptVersion: 'prose-translation/v1',
}
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
}: {
  locale: Locale
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
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<keyof typeof copy | null>(null)
  const [status, setStatus] = useState<keyof typeof copy | null>(null)
  const keyInput = useRef<HTMLInputElement>(null)
  const persistence = useRef<HTMLInputElement>(null)
  const clearButton = useRef<HTMLButtonElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const confirmed = useRef(false)
  const mounted = useRef(true)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const dirty = useRef(false)
  const observedRevision = useRef<number | null>(null)
  const details = useTranslationSettingsNavigation(ref, id, open, Boolean(state) && !busy, setOpen)
  const editDraft = (value: Settings): void => {
    dirty.current = true
    setDraft(value)
  }
  const editGlossary = (value: string): void => {
    dirty.current = true
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
    if (document.activeElement === document.body || !previous.isConnected)
      (previous.isConnected ? previous : keyInput.current)?.focus()
  }, [busy])
  useEffect(() => {
    if (confirm) {
      confirmed.current = true
      confirmButton.current?.focus()
    } else if (confirmed.current) {
      confirmed.current = false
      clearButton.current?.focus()
    }
  }, [confirm])
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
  ): Promise<void> {
    restoreFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const result = await operation()
      if (!mounted.current) return
      if (!result.ok) {
        setError(describe(result.code))
        return
      }
      applyState(result.value, success === 'saved')
      setStatus(success)
    } catch {
      if (mounted.current) setError('generic')
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
    for (const name of ['sourceLanguage', 'targetLanguage'] as const) {
      const field = form.elements.namedItem(name)
      if (!(field instanceof HTMLInputElement)) continue
      try {
        if (name === 'targetLanguage' && draft[name] === 'auto') throw new Error('Invalid target')
        if (!(name === 'sourceLanguage' && draft[name] === 'auto'))
          Intl.getCanonicalLocales(draft[name])
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
      if (at < 1 || !line.slice(at + 2).trim() || entries.length >= 1000) {
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
    await run(() => window.manuslip.configureTranslation({ ...draft, glossary: entries }), 'saved')
  }
  const disabled = busy || state?.configuration === 'read-only'
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
        if (!event.currentTarget.open && keyInput.current) keyInput.current.value = ''
      }}
    >
      <summary>{copy.title}</summary>
      {open && (
        <div className="translation-settings-body">
          <p className="muted">{copy.intro}</p>
          {!state ? (
            <>
              <p role="status">{error ? copy[error] : copy.load}</p>
              <button type="button" onClick={() => void load()}>
                {copy.reload}
              </button>
            </>
          ) : (
            <>
              {state.configuration !== 'ready' && (
                <p role="status">
                  {copy[state.configuration === 'recovered' ? 'recoveredConfig' : 'readOnly']}
                </p>
              )}
              {draftChanged && <p role="status">{copy.draftChanged}</p>}
              <form onSubmit={(event) => void save(event)}>
                <fieldset disabled={disabled}>
                  <legend>{copy.connection}</legend>
                  <label htmlFor={`${id}-provider`}>{copy.provider}</label>
                  <select
                    id={`${id}-provider`}
                    value={draft.provider.adapter}
                    onChange={(event) => changedProvider(event.target.value)}
                  >
                    <option value="openai-compatible">OpenAI-compatible</option>
                    <option value="ollama">Ollama</option>
                    <option value="deepl">DeepL</option>
                  </select>
                  <label htmlFor={`${id}-endpoint`}>
                    {deepl ? copy.translationEndpoint : copy.endpoint}
                  </label>
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
                      editDraft({
                        ...draft,
                        provider: { ...draft.provider, baseUrl: event.target.value },
                      })
                    }}
                  />
                  <p className="muted" id={`${id}-endpoint-hint`}>
                    {copy.endpointHint}
                  </p>
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
                          editDraft({
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
                      <p className="muted">
                        {languages ? copy.languagesLoaded : copy.languagesHint}
                      </p>
                    </>
                  )}
                  <TranslationLanguageFields
                    id={id}
                    locale={locale}
                    draft={draft}
                    languages={languages}
                    sourceTag={selected(true)?.tag}
                    targetTag={selected(false)?.tag}
                    onChange={languageChanged}
                  />
                  <details className="translation-options">
                    <summary>{copy.advanced}</summary>
                    {(!deepl || nativeFormality || draft.formality !== 'default') && (
                      <>
                        <label htmlFor={`${id}-formality`}>{copy.formality}</label>
                        <select
                          id={`${id}-formality`}
                          value={draft.formality}
                          onChange={(event) =>
                            editDraft({ ...draft, formality: event.target.value as Formality })
                          }
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
                        onChange={(options) =>
                          editDraft({ ...draft, provider: { ...draft.provider, options } })
                        }
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
                            editGlossary(event.target.value)
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
                                (draft.provider.options[name] as number) ??
                                (name === 'temperature' ? 0 : 8192)
                              }
                              onChange={(event) =>
                                editDraft({
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
                  <button type="submit">{busy ? copy.busy : copy.save}</button>
                </fieldset>
              </form>
              {state.settings && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    const field = keyInput.current
                    if (!field?.value) return
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
                  <fieldset disabled={busy || Boolean(connectionChanged)}>
                    <legend>{copy.key}</legend>
                    <p>{copy[state.credential]}</p>
                    {connectionChanged && <p>{copy.saveFirst}</p>}
                    <label htmlFor={`${id}-key`}>{copy.key}</label>
                    <input
                      id={`${id}-key`}
                      ref={keyInput}
                      type="password"
                      required
                      maxLength={4096}
                      autoComplete="new-password"
                      spellCheck={false}
                      aria-describedby={`${id}-key-hint`}
                    />
                    <p className="muted" id={`${id}-key-hint`}>
                      {copy.keyHint}
                    </p>
                    <label className="spellcheck-preference">
                      <input
                        ref={persistence}
                        type="checkbox"
                        aria-describedby={`${id}-persist-hint`}
                      />
                      {copy.persist}
                    </label>
                    <p className="muted" id={`${id}-persist-hint`}>
                      {copy.persistHint}
                    </p>
                    {error === 'keyError' && <p role="alert">{copy.keyError}</p>}
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
                            )
                          }
                        >
                          {copy.removeKey}
                        </button>
                      )}
                    </div>
                  </fieldset>
                </form>
              )}
              <section className="translation-cache" aria-labelledby={`${id}-cache-heading`}>
                <h3 id={`${id}-cache-heading`}>{copy.cache}</h3>
                <p className="muted">{copy[state.cache]}</p>
                {confirm ? (
                  <>
                    <p>{copy.confirm}</p>
                    <div className="action-row">
                      <button
                        ref={confirmButton}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(() => window.manuslip.clearTranslationCache(), 'cleared').then(
                            () => {
                              setConfirm(false)
                            },
                          )
                        }
                      >
                        {copy.confirmClear}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setConfirm(false)
                        }}
                      >
                        {copy.cancel}
                      </button>
                    </div>
                  </>
                ) : null}
                <button
                  ref={clearButton}
                  type="button"
                  disabled={busy || confirm || state.cache === 'future'}
                  onClick={() => setConfirm(true)}
                >
                  {copy.clear}
                </button>
              </section>
              <p className="feedback" role="status">
                {status ? copy[status] : ''}
              </p>
              <p role={error === 'keyError' ? undefined : 'alert'}>
                {error && error !== 'keyError' ? copy[error] : ''}
              </p>
            </>
          )}
        </div>
      )}
    </details>
  )
}
