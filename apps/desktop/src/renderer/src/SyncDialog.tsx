import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { DocumentController } from './document'
import { i18next } from './i18n'
import type { DocumentSync } from './sync'
import { syncCopy } from './sync-copy'
import { useDocumentStatus } from './use-document-status'

export function SyncDialog({
  controller,
  document,
  locale,
  onClose,
}: {
  controller: DocumentSync
  document: DocumentController
  locale: string
  onClose(): void
}): React.JSX.Element {
  const copy = syncCopy[locale === 'zh-CN' ? 'zh-CN' : 'en'],
    id = useId(),
    dialog = useRef<HTMLDialogElement>(null),
    closeButton = useRef<HTMLButtonElement>(null),
    versions = useRef<HTMLElement>(null),
    status = useDocumentStatus(document),
    sync = useStore(controller.store)
  const [kind, setKind] = useState<'folder' | 'webdav'>('folder'),
    [filename, setFilename] = useState(
      status.info.name === 'Untitled' ? 'document.md' : status.info.name,
    ),
    [url, setUrl] = useState(''),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [remember, setRemember] = useState(false),
    [disconnect, setDisconnect] = useState(false),
    [remove, setRemove] = useState<string | null>(null)
  const state = sync.state,
    connection = state?.connection,
    review = state?.review,
    occupied = sync.running || Boolean(state?.busy),
    needsSave =
      !status.info.displayPath ||
      status.dirty ||
      status.saving ||
      status.composing ||
      status.conflict
  useLayoutEffect(() => {
    dialog.current?.showModal()
    closeButton.current?.focus()
  }, [])
  const reviewId = review?.id,
    connectionId = connection?.id
  const previousReview = useRef<string | undefined>(undefined),
    previousConnection = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    if (reviewId && previousReview.current !== reviewId) {
      versions.current?.focus()
      versions.current?.scrollIntoView({ block: 'nearest' })
    } else if (
      (previousReview.current && !reviewId) ||
      (connectionId && previousConnection.current !== connectionId)
    ) {
      dialog.current?.querySelector<HTMLButtonElement>('[data-sync-review]')?.focus()
    }
    previousReview.current = reviewId
    previousConnection.current = connectionId
  }, [reviewId, connectionId])
  useEffect(() => {
    void controller.load()
    return () => controller.cancel()
  }, [controller])
  function close(): void {
    controller.cancel()
    onClose()
  }
  return (
    <dialog
      ref={dialog}
      className="appearance-dialog sync-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-hint`}
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || !dialog.current) return
        const targets = [
            ...dialog.current.querySelectorAll<HTMLElement>(
              'button,input:not([type="radio"]),input[type="radio"]:checked,textarea,select,summary',
            ),
          ].filter(
            (target) =>
              target.tabIndex >= 0 && !target.matches(':disabled') && target.checkVisibility(),
          ),
          first = targets[0],
          last = targets.at(-1)
        if (
          first &&
          last &&
          ((event.shiftKey && (event.target === first || event.target === dialog.current)) ||
            (!event.shiftKey && event.target === last))
        ) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <header>
        <h2 id={`${id}-title`}>{copy.title}</h2>
        <p id={`${id}-hint`}>{copy.hint}</p>
      </header>
      {sync.error && <p role="alert">{i18next.t(sync.error)}</p>}
      {!state && !sync.error && <p role="status">{copy.loading}</p>}
      {state?.recovered && <p role="status">{copy.recovered}</p>}
      {state?.readOnly && <p role="status">{copy.readonly}</p>}
      {needsSave && (
        <div className="sync-notice">
          <p>{copy.saveFirst}</p>
          <button
            type="button"
            disabled={status.saving || status.composing || occupied}
            onClick={() => void document.save()}
          >
            {copy.save}
          </button>
        </div>
      )}
      {state && !connection && (
        <form
          className="sync-connect"
          onSubmit={(event) => {
            event.preventDefault()
            void controller.connect(kind === 'folder' ? { kind, filename } : { kind, url })
          }}
        >
          <fieldset disabled={occupied || Boolean(state.readOnly) || needsSave}>
            <legend>{copy.destination}</legend>
            <div className="sync-kind">
              <label>
                <input
                  type="radio"
                  name={`${id}-kind`}
                  checked={kind === 'folder'}
                  onChange={() => setKind('folder')}
                />
                {copy.folder}
              </label>
              <label>
                <input
                  type="radio"
                  name={`${id}-kind`}
                  checked={kind === 'webdav'}
                  onChange={() => setKind('webdav')}
                />
                {copy.webdav}
              </label>
            </div>
            {kind === 'folder' ? (
              <label className="sync-field" htmlFor={`${id}-filename`}>
                {copy.filename}
                <input
                  id={`${id}-filename`}
                  value={filename}
                  required
                  maxLength={160}
                  onChange={(event) => setFilename(event.target.value)}
                  spellCheck={false}
                />
              </label>
            ) : (
              <div className="sync-field">
                <label htmlFor={`${id}-url`}>{copy.url}</label>
                <input
                  id={`${id}-url`}
                  type="url"
                  value={url}
                  required
                  maxLength={2048}
                  placeholder="https://example.org/writing/document.md"
                  aria-describedby={`${id}-url-hint`}
                  onChange={(event) => setUrl(event.target.value)}
                  spellCheck={false}
                  autoCapitalize="none"
                />
                <span className="muted" id={`${id}-url-hint`}>
                  {copy.urlHint}
                </span>
              </div>
            )}
            <button className="primary" type="submit">
              {kind === 'folder' ? copy.connectFolder : copy.connectWebdav}
            </button>
          </fieldset>
        </form>
      )}
      {connection && (
        <section className="sync-connection" aria-label={copy.scope}>
          <h3>{copy.scope}</h3>
          <p className="sync-scope">{connection.scope}</p>
          <p className="muted">
            {connection.syncedAt === null
              ? copy.never
              : `${copy.last} ${new Date(connection.syncedAt).toLocaleString(locale)}`}
          </p>
          {connection.interrupted && <p role="status">{copy.interrupted}</p>}
          {connection.kind === 'webdav' && (
            <details className="sync-credentials">
              <summary>
                {copy.credentials} · {copy.credential[connection.credential]}
              </summary>
              <p className="muted">{copy.credentialsHint}</p>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  const request = { username, password, persist: remember }
                  setPassword('')
                  void controller.credential(request)
                }}
              >
                <fieldset disabled={occupied || state?.readOnly}>
                  <legend className="visually-hidden">{copy.credentials}</legend>
                  <label className="sync-field" htmlFor={`${id}-username`}>
                    {copy.username}
                    <input
                      id={`${id}-username`}
                      value={username}
                      maxLength={512}
                      autoComplete="username"
                      onChange={(event) => setUsername(event.target.value)}
                    />
                  </label>
                  <label className="sync-field" htmlFor={`${id}-password`}>
                    {copy.password}
                    <input
                      id={`${id}-password`}
                      type="password"
                      value={password}
                      maxLength={4096}
                      autoComplete="current-password"
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </label>
                  <label className="sync-check">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(event) => setRemember(event.target.checked)}
                    />
                    {copy.remember}
                  </label>
                  <div className="sync-actions">
                    <button type="submit">{copy.setCredential}</button>
                    <button
                      type="button"
                      disabled={connection.credential === 'none'}
                      onClick={() => {
                        setPassword('')
                        void controller.credential({
                          username: null,
                          password: null,
                          persist: false,
                        })
                      }}
                    >
                      {copy.forgetCredential}
                    </button>
                  </div>
                </fieldset>
              </form>
            </details>
          )}
          <div className="sync-actions">
            <button
              type="button"
              className={review ? undefined : 'primary'}
              disabled={occupied || needsSave || state?.readOnly}
              data-sync-review
              onClick={() => void controller.review()}
            >
              {copy.review}
            </button>
            <button
              type="button"
              disabled={occupied || state?.readOnly}
              onClick={() => setDisconnect(true)}
            >
              {copy.disconnect}
            </button>
          </div>
          {disconnect && (
            <div className="sync-notice">
              <p>{copy.disconnectPrompt}</p>
              <div className="sync-actions">
                <button
                  type="button"
                  disabled={occupied}
                  onClick={() => {
                    setDisconnect(false)
                    void controller.disconnect()
                  }}
                >
                  {copy.confirmDisconnect}
                </button>
                <button type="button" onClick={() => setDisconnect(false)}>
                  {copy.cancel}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
      {review && (
        <section ref={versions} className="sync-review" aria-label={copy.versions} tabIndex={-1}>
          <h3>{copy.versions}</h3>
          <p>
            {review.reason
              ? copy.conflict[review.reason]
              : review.kind === 'download'
                ? copy.downloadHint
                : copy.uploadHint}
          </p>
          <div className="sync-versions">
            {[
              {
                label: copy.local,
                bytes: review.localBytes,
                preview: review.localPreview,
                key: 'local',
              },
              {
                label: copy.remote,
                bytes: review.remoteBytes,
                preview: review.remotePreview,
                key: 'remote',
              },
            ].map((version) => (
              <div key={version.key}>
                <h4>{version.label}</h4>
                <p className="muted">
                  {version.bytes === null
                    ? copy.missing
                    : `${version.bytes.toLocaleString(locale)} ${copy.bytes}`}
                </p>
                {version.preview !== null && (
                  <details>
                    <summary>{copy.preview}</summary>
                    <label className="visually-hidden" htmlFor={`${id}-${version.key}`}>
                      {version.label}
                    </label>
                    <textarea
                      id={`${id}-${version.key}`}
                      readOnly
                      value={version.preview}
                      rows={6}
                      spellCheck={false}
                    />
                  </details>
                )}
              </div>
            ))}
          </div>
          {!review.canUpload && <p role="status">{copy.validator}</p>}
          <div className="sync-actions">
            <button
              type="button"
              className={review.kind === 'upload' ? 'primary' : undefined}
              disabled={occupied || needsSave || !review.canUpload || state?.recoveryBlocked}
              onClick={() => void controller.resolve('upload')}
            >
              {copy.upload}
            </button>
            {review.remoteBytes !== null && (
              <>
                <button
                  type="button"
                  className={review.kind === 'download' ? 'primary' : undefined}
                  disabled={occupied || needsSave || state?.recoveryBlocked}
                  onClick={() => void controller.resolve('download')}
                >
                  {copy.download}
                </button>
                <button
                  type="button"
                  disabled={occupied || needsSave || !review.canUpload || state?.recoveryBlocked}
                  onClick={() => void controller.resolve('keep-both')}
                >
                  {copy.both}
                </button>
              </>
            )}
          </div>
        </section>
      )}
      {state && (
        <details className="sync-recoveries" open={state.recoveryBlocked || undefined}>
          <summary>
            {copy.recoveries} ({state.copies.length.toLocaleString(locale)})
          </summary>
          <p className="muted">{copy.recoveryHint}</p>
          {state.recoveryBlocked && <p role="status">{copy.blocked}</p>}
          {!state.copies.length && <p>{copy.empty}</p>}
          <ul>
            {state.copies.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.side === 'unknown' ? copy.sides.unknown : item.name}</strong>
                  <p className="muted">
                    {copy.sides[item.side]} · {new Date(item.savedAt).toLocaleString(locale)} ·{' '}
                    {item.bytes.toLocaleString(locale)} {copy.bytes}
                  </p>
                  <p className="muted">{copy.states[item.state]}</p>
                </div>
                <div className="sync-actions">
                  <button
                    type="button"
                    disabled={occupied}
                    onClick={() => void controller.export(item.id)}
                  >
                    {item.state === 'verified' ? copy.export : copy.artifact}
                  </button>
                  <button type="button" disabled={occupied} onClick={() => setRemove(item.id)}>
                    {copy.remove}
                  </button>
                </div>
                {remove === item.id && (
                  <div className="sync-notice">
                    <p>{copy.removePrompt}</p>
                    <div className="sync-actions">
                      <button
                        type="button"
                        disabled={occupied}
                        onClick={() => {
                          setRemove(null)
                          void controller.remove(item.id)
                        }}
                      >
                        {copy.confirmRemove}
                      </button>
                      <button type="button" onClick={() => setRemove(null)}>
                        {copy.cancel}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {sync.exported && <p role="status">{copy.exported}</p>}
      {occupied && (
        <div role="status" className="sync-actions">
          <p>{copy.busy}</p>
          <button type="button" onClick={() => controller.cancel()}>
            {copy.stop}
          </button>
        </div>
      )}
      <footer className="appearance-actions">
        <button type="button" disabled={sync.running} onClick={() => void controller.load()}>
          {copy.refresh}
        </button>
        <button ref={closeButton} type="button" onClick={close}>
          {copy.close}
        </button>
      </footer>
    </dialog>
  )
}
