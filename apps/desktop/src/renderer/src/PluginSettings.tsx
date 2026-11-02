import { useCallback, useEffect, useRef, useState } from 'react'
import type { Result } from '../../shared/contracts'
import type {
  InstalledPlugin,
  PluginCandidate,
  PluginPermission,
  PluginState,
} from '../../shared/plugin-contracts'
import { i18next } from './i18n'
import { PluginPermissions } from './PluginPermissions'
import { publishPluginState } from './plugin-catalog'
import { pluginCopy } from './plugin-copy'

function PluginInstallation({
  plugin,
  busy,
  readOnly,
  locale,
  change,
}: {
  plugin: InstalledPlugin
  busy: boolean
  readOnly: boolean
  locale: string
  change(operation: () => Promise<Result<PluginState>>): void
}): React.JSX.Element {
  const copy = pluginCopy[locale === 'zh-CN' ? 'zh-CN' : 'en']
  const [grants, setGrants] = useState(plugin.grants),
    [removing, setRemoving] = useState(false)
  useEffect(() => setGrants(plugin.grants), [plugin.grants])
  return (
    <article className="plugin-installation" aria-label={`${plugin.name} ${plugin.version}`}>
      <div className="plugin-heading">
        <h4>
          {plugin.name} <span className="muted">{plugin.version}</span>
        </h4>
        <span>{plugin.enabled ? copy.enabled : copy.disabled}</span>
      </div>
      <p>{plugin.description}</p>
      <div className="plugin-actions">
        <button
          type="button"
          disabled={busy || readOnly}
          onClick={() => change(() => window.manuslip.enablePlugin(plugin.id, !plugin.enabled))}
        >
          {plugin.enabled ? copy.disable : copy.enable}
        </button>
        <button type="button" disabled={busy || readOnly} onClick={() => setRemoving(true)}>
          {copy.remove}
        </button>
      </div>
      {removing && (
        <fieldset className="plugin-remove">
          <legend>{copy.removePrompt}</legend>
          <div className="plugin-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => change(() => window.manuslip.removePlugin(plugin.id))}
            >
              {copy.confirmRemove}
            </button>
            <button type="button" disabled={busy} onClick={() => setRemoving(false)}>
              {copy.cancel}
            </button>
          </div>
        </fieldset>
      )}
      <details>
        <summary>{copy.permissions}</summary>
        <PluginPermissions
          plugin={plugin}
          grants={grants}
          change={setGrants}
          disabled={busy || readOnly}
          locale={locale}
        />
        <button
          type="button"
          disabled={
            busy || readOnly || [...grants].sort().join() === [...plugin.grants].sort().join()
          }
          onClick={() => change(() => window.manuslip.grantPlugin(plugin.id, grants))}
        >
          {copy.save}
        </button>
      </details>
    </article>
  )
}
export function PluginSettings({ locale }: { locale: string }): React.JSX.Element {
  const copy = pluginCopy[locale === 'zh-CN' ? 'zh-CN' : 'en']
  const review = useRef<HTMLElement>(null)
  const [state, setState] = useState<PluginState | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null)
  const [candidate, setCandidate] = useState<PluginCandidate | null>(null),
    [grants, setGrants] = useState<PluginPermission[]>([])
  useEffect(() => {
    if (!candidate) return
    review.current?.scrollIntoView({ block: 'nearest' })
    review.current?.focus({ preventScroll: true })
  }, [candidate])
  const run = useCallback(async (operation: () => Promise<Result<PluginState>>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await operation()
      if (!result.ok) setError(result.code || 'plugin-failed')
      else {
        setState(result.value)
        publishPluginState(result.value)
        setCandidate(null)
      }
    } catch {
      setError('plugin-failed')
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    void run(() => window.manuslip.plugins())
  }, [run])
  const choose = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.manuslip.choosePlugin()
      if (!result.ok) setError(result.code || 'plugin-invalid')
      else if (result.value) {
        setCandidate(result.value)
        setGrants([])
      }
    } catch {
      setError('plugin-invalid')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="plugin-settings" aria-label={copy.title}>
      <h3>{copy.title}</h3>
      <p className="muted">{copy.hint}</p>
      {state?.recovered && <p role="status">{copy.recovered}</p>}
      {state?.readOnly && <p role="status">{copy.readOnly}</p>}
      <button
        type="button"
        disabled={busy || !state || state.readOnly}
        onClick={() => void choose()}
      >
        {copy.install}
      </button>
      {busy && <p role="status">{copy.loading}</p>}
      {error && (
        <div role="alert">
          <p>{i18next.t(error)}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => window.manuslip.plugins())}
          >
            {copy.retry}
          </button>
        </div>
      )}
      {candidate && (
        <section ref={review} tabIndex={-1} className="plugin-review" aria-label={copy.review}>
          <h4>
            {candidate.plugin.name} <span className="muted">{candidate.plugin.version}</span>
          </h4>
          <p>{candidate.plugin.description}</p>
          {state?.plugins.some((plugin) => plugin.id === candidate.plugin.id) && (
            <p>{copy.update}</p>
          )}
          <PluginPermissions
            plugin={candidate.plugin}
            grants={grants}
            change={setGrants}
            disabled={busy}
            locale={locale}
          />
          <div className="plugin-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => window.manuslip.installPlugin(candidate.token, grants))}
            >
              {copy.allow}
            </button>
            <button type="button" disabled={busy} onClick={() => setCandidate(null)}>
              {copy.cancel}
            </button>
          </div>
        </section>
      )}
      {state && !state.plugins.length && <p>{copy.empty}</p>}
      {state?.plugins.map((plugin) => (
        <PluginInstallation
          key={`${plugin.id}-${plugin.fingerprint}`}
          plugin={plugin}
          busy={busy}
          readOnly={state.readOnly}
          locale={locale}
          change={(operation) => void run(operation)}
        />
      ))}
    </section>
  )
}
