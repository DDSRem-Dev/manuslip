import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { Result } from '../../shared/contracts'
import type { PandocOptions, PandocToolState } from '../../shared/pandoc-contracts'
import { i18next } from './i18n'
import { pandocCopy } from './pandoc-copy'

export function PandocDialog({
  onClose,
  onExport,
}: {
  onClose(): void
  onExport(options: PandocOptions): void
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null),
    id = useId()
  const copy = pandocCopy[i18next.language === 'zh-CN' ? 'zh-CN' : 'en']
  const [state, setState] = useState<PandocToolState | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState<string | null>(null),
    [options, setOptions] = useState<PandocOptions>({ format: 'docx', profile: 'document' })
  const mounted = useRef(true)
  useLayoutEffect(() => {
    dialog.current?.showModal()
  }, [])
  const run = useCallback(
    async (operation: () => Promise<Result<PandocToolState | null>>): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
        const result = await operation()
        if (!mounted.current) return
        if (!result.ok) setError(result.code || 'pandoc-tool')
        else if (result.value) setState(result.value)
      } catch {
        if (mounted.current) setError('pandoc-tool')
      } finally {
        if (mounted.current) setBusy(false)
      }
    },
    [],
  )
  useEffect(() => {
    mounted.current = true
    void run(() => window.manuslip.pandocTool())
    return () => {
      mounted.current = false
    }
  }, [run])
  return (
    <dialog
      ref={dialog}
      className="appearance-dialog pandoc-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-hint`}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <header>
        <h2 id={`${id}-title`}>{copy.title}</h2>
        <p id={`${id}-hint`}>{copy.hint}</p>
      </header>
      <fieldset className="appearance-fields" disabled={busy}>
        <legend>{copy.title}</legend>
        <div className="appearance-field">
          <label htmlFor={`${id}-format`}>{copy.format}</label>
          <select
            id={`${id}-format`}
            value={options.format}
            onChange={(event) =>
              setOptions({ ...options, format: event.target.value as PandocOptions['format'] })
            }
          >
            {(['docx', 'epub', 'latex'] as const).map((format) => (
              <option key={format} value={format}>
                {copy[format]}
              </option>
            ))}
          </select>
        </div>
        <div className="appearance-field">
          <label htmlFor={`${id}-profile`}>{copy.profile}</label>
          <select
            id={`${id}-profile`}
            value={options.profile}
            onChange={(event) =>
              setOptions({ ...options, profile: event.target.value as PandocOptions['profile'] })
            }
          >
            {(['document', 'numbered'] as const).map((profile) => (
              <option key={profile} value={profile}>
                {copy[profile]}
              </option>
            ))}
          </select>
        </div>
      </fieldset>
      <p className="pandoc-fidelity">{copy.fidelity}</p>
      <section className="appearance-stylesheet" aria-labelledby={`${id}-tool`}>
        <h3 id={`${id}-tool`}>{copy.tool}</h3>
        <p className="appearance-stylesheet-name" dir="auto">
          {state?.tool ? `${state.tool.name} · ${state.tool.version}` : copy.none}
        </p>
        <p className="pandoc-trust">{copy.trust}</p>
        <div className="action-row">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => window.manuslip.selectPandocTool())}
          >
            {state?.tool ? copy.change : copy.choose}
          </button>
          {state?.tool && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => window.manuslip.forgetPandocTool())}
            >
              {copy.forget}
            </button>
          )}
        </div>
      </section>
      {error && <p role="alert">{i18next.t(error, { defaultValue: i18next.t('pandoc-tool') })}</p>}
      <div className="appearance-state" role="status">
        {busy
          ? copy.loading
          : state?.readOnly
            ? copy.readOnly
            : state && !state.persisted
              ? copy.session
              : state?.recovered && !state.tool
                ? copy.recovered
                : ''}
      </div>
      <footer className="appearance-actions">
        <div className="action-row">
          {state && !state.persisted && !state.readOnly && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => window.manuslip.retryPandocTool())}
            >
              {copy.retry}
            </button>
          )}
          <button type="button" onClick={onClose}>
            {copy.close}
          </button>
        </div>
        <button
          type="button"
          className="primary"
          disabled={busy || !state?.tool}
          onClick={() => onExport(options)}
        >
          {copy.export}
        </button>
      </footer>
    </dialog>
  )
}
