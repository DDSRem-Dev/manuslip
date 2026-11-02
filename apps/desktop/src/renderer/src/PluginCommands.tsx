import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { PluginState } from '../../shared/plugin-contracts'
import type { DocumentController } from './document'
import { i18next } from './i18n'
import { pluginCopy } from './plugin-copy'
import type { DocumentPlugins } from './plugins'

export function PluginCommands({
  controller,
  document,
  locale,
  onClose,
}: {
  controller: DocumentPlugins
  document: DocumentController
  locale: string
  onClose(): void
}): React.JSX.Element {
  const copy = pluginCopy[locale === 'zh-CN' ? 'zh-CN' : 'en'],
    dialog = useRef<HTMLDialogElement>(null),
    id = useId()
  const status = useStore(controller.store),
    revision = useStore(document.store, (state) => state.revision)
  const [state, setState] = useState<PluginState | null>(null),
    [error, setError] = useState<string | null>(null)
  useLayoutEffect(() => {
    dialog.current?.showModal()
  }, [])
  useEffect(() => {
    let mounted = true
    void window.manuslip
      .plugins()
      .then((result) => {
        if (!mounted) return
        if (result.ok) setState(result.value)
        else setError(result.code || 'plugin-failed')
      })
      .catch(() => {
        if (mounted) setError('plugin-failed')
      })
    return () => {
      mounted = false
    }
  }, [])
  const enabled = state?.plugins.filter((plugin) => plugin.enabled) || []
  const changed = status.result && revision !== status.result.revision
  return (
    <dialog
      ref={dialog}
      className="appearance-dialog plugin-command-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-hint`}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <header>
        <h2 id={`${id}-title`}>{copy.commands}</h2>
        <p id={`${id}-hint`}>{copy.commandHint}</p>
      </header>
      {error && <p role="alert">{i18next.t(error)}</p>}
      {!state && !error && <p role="status">{copy.loading}</p>}
      {state && !enabled.length && <p>{copy.noCommands}</p>}
      {enabled.map((plugin) => (
        <section className="plugin-command-group" key={plugin.id} aria-label={plugin.name}>
          <h3>{plugin.name}</h3>
          <div className="plugin-actions">
            {plugin.commands.map((command) => {
              const denied =
                command.kind === 'transform' && !plugin.grants.includes('document.write')
              return (
                <button
                  key={command.id}
                  type="button"
                  disabled={status.running || Boolean(status.result) || denied}
                  title={denied ? copy.missingGrant : undefined}
                  onClick={() => void controller.run(plugin.id, command.id)}
                >
                  {command.title}
                </button>
              )
            })}
          </div>
          {plugin.commands.some((command) => command.kind === 'transform') &&
            !plugin.grants.includes('document.write') && (
              <p className="muted">{copy.missingGrant}</p>
            )}
        </section>
      ))}
      {status.running && (
        <div role="status">
          <p>{copy.running}</p>
          <button type="button" onClick={() => controller.cancel()}>
            {copy.stop}
          </button>
        </div>
      )}
      {status.error && <p role="alert">{i18next.t(status.error)}</p>}
      {status.result && (
        <section className="plugin-result" aria-label={copy.result}>
          <label htmlFor={`${id}-result`}>
            {status.result.kind === 'transform' ? copy.proposal : copy.result}
          </label>
          <textarea
            id={`${id}-result`}
            value={status.result.text}
            readOnly
            rows={10}
            spellCheck={false}
          />
          {changed && <p role="status">{copy.changed}</p>}
          <div className="plugin-actions">
            {status.result.kind === 'transform' && (
              <button
                type="button"
                className="button-primary"
                disabled={Boolean(changed)}
                onClick={() =>
                  void controller.apply().then((applied) => {
                    if (applied) onClose()
                  })
                }
              >
                {copy.apply}
              </button>
            )}
            <button type="button" onClick={() => controller.discard()}>
              {copy.discard}
            </button>
          </div>
        </section>
      )}
      <footer className="appearance-actions">
        <button type="button" onClick={onClose}>
          {copy.close}
        </button>
      </footer>
    </dialog>
  )
}
