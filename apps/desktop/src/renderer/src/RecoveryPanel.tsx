import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { i18next } from './i18n'
import type { RecoveryController } from './recovery'

type Focus = { action: 'cancel' | 'discard' | 'restore' | 'reload'; id?: string; index?: number }

export function RecoveryPanel({
  controller,
  busy: fileBusy,
}: {
  controller: RecoveryController
  busy: boolean
}): React.JSX.Element {
  const state = useStore(controller.store)
  const [confirm, setConfirm] = useState<string | null>(null)
  const panel = useRef<HTMLElement>(null)
  const focus = useRef<Focus | null>(null)
  const busy = fileBusy || state.busy
  const t = i18next.t.bind(i18next)
  useEffect(() => {
    if (!busy) return
    const cancelFocus = (): void => {
      focus.current = null
    }
    document.addEventListener('pointerdown', cancelFocus, true)
    document.addEventListener('keydown', cancelFocus, true)
    return () => {
      document.removeEventListener('pointerdown', cancelFocus, true)
      document.removeEventListener('keydown', cancelFocus, true)
    }
  }, [busy])
  useLayoutEffect(() => {
    if (busy || !focus.current) return
    const request = focus.current
    focus.current = null
    if (
      document.activeElement !== document.body &&
      !panel.current?.contains(document.activeElement)
    )
      return
    let target: HTMLElement | null = null
    const rows = Array.from(
      panel.current?.querySelectorAll<HTMLElement>('[data-recovery-id]') ?? [],
    )
    const row = rows.find((row) => row.dataset.recoveryId === request.id)
    if (request.action === 'reload' && state.error)
      target = panel.current?.querySelector('[data-recovery-action="reload"]') ?? null
    else if (request.action === 'cancel')
      target = row?.querySelector('[data-recovery-action="cancel"]') ?? null
    else if (row) target = row.querySelector(`[data-recovery-action="${request.action}"]`)
    else if (request.action === 'restore' && state.error?.action !== 'restore')
      target = document.querySelector<HTMLElement>('.cm-content[contenteditable="true"]')
    else
      target =
        rows[Math.min(request.index ?? 0, rows.length - 1)]?.querySelector(
          '[data-recovery-action="restore"]',
        ) ?? null
    const next =
      target ??
      panel.current?.querySelector<HTMLElement>('[data-recovery-action="reload"]') ??
      document.getElementById('content')
    next?.focus()
  })
  const requestFocus = (button: HTMLButtonElement, request: Focus): void => {
    if (document.activeElement === button) focus.current = request
  }
  const loading = state.busy && !state.pending
  const visible = !state.loaded || state.entries.length > 0 || state.error !== null
  return (
    <>
      <p className="incoming-announcement" role="status">
        {loading
          ? t('loadingRecoveries')
          : state.pending
            ? t(state.pending.action === 'restore' ? 'restoringDraft' : 'discardingDraft')
            : ''}
      </p>
      {visible && (
        <section className="recovery-panel" aria-labelledby="recovery-heading" ref={panel}>
          <h2 id="recovery-heading">{t('recoverWriting')}</h2>
          <p>{t('recoveryIntro')}</p>
          {loading && <p>{t('loadingRecoveries')}</p>}
          {state.error && (
            <div>
              {state.error.action === 'load' && <p role="alert">{t('recoveryLoadError')}</p>}
              <button
                type="button"
                disabled={busy}
                data-recovery-action="reload"
                onClick={(event) => {
                  requestFocus(event.currentTarget, { action: 'reload' })
                  void controller.reload()
                }}
              >
                {t('reloadRecoveries')}
              </button>
            </div>
          )}
          <ul aria-busy={state.busy}>
            {state.entries.map((entry, index) => {
              const name = entry.displayPath ? entry.name : t('untitled')
              const error = state.error?.id === entry.id ? state.error.action : null
              return (
                <li key={entry.id} data-recovery-id={entry.id}>
                  <div>
                    <h3>
                      <bdi>{name}</bdi>
                    </h3>
                    {entry.displayPath && (
                      <p>
                        <bdi>{entry.displayPath}</bdi>
                      </p>
                    )}
                    <span>
                      {new Date(entry.savedAt).toLocaleString(i18next.language)} ·{' '}
                      {t('documentBytes', { bytes: entry.bytes.toLocaleString(i18next.language) })}
                    </span>
                  </div>
                  {error && (
                    <p role="alert">
                      {t(error === 'restore' ? 'recoveryRestoreError' : 'recoveryDiscardError')}
                    </p>
                  )}
                  {confirm === entry.id ? (
                    <fieldset
                      className="recovery-confirmation"
                      onKeyDown={(event) => {
                        if (event.key !== 'Escape' || busy) return
                        event.preventDefault()
                        focus.current = { action: 'discard', id: entry.id }
                        setConfirm(null)
                      }}
                    >
                      <legend id={`recovery-confirm-${entry.id}`}>
                        {t('discardRecoveryPrompt')}
                      </legend>
                      <div className="action-row">
                        <button
                          key="confirm"
                          type="button"
                          disabled={busy}
                          data-recovery-action="discard"
                          aria-label={t('discardRecovery', { name })}
                          aria-describedby={`recovery-confirm-${entry.id}`}
                          onClick={(event) => {
                            requestFocus(event.currentTarget, {
                              action: 'discard',
                              id: entry.id,
                              index,
                            })
                            void controller.act(entry.id, 'discard')
                          }}
                        >
                          {t('discardDraft')}
                        </button>
                        <button
                          key="cancel"
                          type="button"
                          disabled={busy}
                          data-recovery-action="cancel"
                          onClick={(event) => {
                            requestFocus(event.currentTarget, { action: 'discard', id: entry.id })
                            setConfirm(null)
                          }}
                        >
                          {t('cancel')}
                        </button>
                      </div>
                    </fieldset>
                  ) : (
                    <div className="action-row">
                      <button
                        key="restore"
                        type="button"
                        disabled={busy}
                        data-recovery-action="restore"
                        aria-label={t('restoreRecovery', { name })}
                        onClick={(event) => {
                          requestFocus(event.currentTarget, {
                            action: 'restore',
                            id: entry.id,
                            index,
                          })
                          void controller.act(entry.id, 'restore')
                        }}
                      >
                        {t('restoreDraft')}
                      </button>
                      <button
                        key="discard"
                        type="button"
                        disabled={busy}
                        data-recovery-action="discard"
                        aria-label={t('discardRecovery', { name })}
                        onClick={(event) => {
                          requestFocus(event.currentTarget, { action: 'cancel', id: entry.id })
                          setConfirm(entry.id)
                        }}
                      >
                        {t('discardDraft')}
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </>
  )
}
