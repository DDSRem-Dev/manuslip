import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { DocumentExport } from './export'
import { Icon } from './Icons'
import { i18next } from './i18n'
import { PandocDialog } from './PandocDialog'
import { pandocCopy } from './pandoc-copy'
import { ToolbarDisclosure } from './ToolbarDisclosure'
import { readingCopy } from './translation/copy'

export function ExportControls({
  exporter,
  composing,
  revision,
  reading = false,
  readingReady = false,
  children,
  options,
  toolbar,
}: {
  exporter: DocumentExport
  composing: boolean
  revision: number
  reading?: boolean
  readingReady?: boolean
  children: ReactNode
  options: ReactNode
  toolbar(controls: ReactNode): ReactNode
}): React.JSX.Element {
  const status = useStore(exporter.store)
  const [pandoc, setPandoc] = useState(false)
  const controls = useRef<HTMLDivElement>(null)
  const first = useRef<HTMLButtonElement>(null)
  const hadPandoc = useRef(false)
  useLayoutEffect(() => {
    if (!pandoc && hadPandoc.current) first.current?.focus()
    hadPandoc.current = pandoc
  }, [pandoc])
  const wasRunning = useRef(false)
  const hadFocus = useRef(false)
  const confirmation = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(false)
  useLayoutEffect(() => {
    if (status.confirmation) confirmation.current?.focus()
    else if (wasConfirming.current && !status.running) first.current?.focus()
    wasConfirming.current = Boolean(status.confirmation)
  }, [status.confirmation, status.running])
  useLayoutEffect(() => {
    if (
      wasRunning.current &&
      !status.running &&
      hadFocus.current &&
      (document.activeElement === document.body ||
        controls.current?.contains(document.activeElement))
    )
      first.current?.focus()
    wasRunning.current = status.running
  }, [status.running])
  const t = i18next.t.bind(i18next)
  const copy = readingCopy[i18next.language === 'zh-CN' ? 'zh-CN' : 'en']
  const prompt = status.format === 'present' ? t('presentReadingPrompt') : copy.exportPrompt
  return (
    <div
      className="export-controls"
      onBlurCapture={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget))
          hadFocus.current = false
      }}
    >
      {toolbar(
        <div
          ref={controls}
          className="export-actions"
          onFocusCapture={() => {
            hadFocus.current = true
          }}
        >
          <ToolbarDisclosure label={t('documentCommands')} triggerRef={first} icon="more" iconOnly>
            {children}
            <fieldset className="toolbar-command-group">
              <legend>{t('exportActions')}</legend>
              <button
                type="button"
                disabled={status.running || composing || Boolean(status.confirmation)}
                onClick={() => void exporter.start('html')}
              >
                <Icon name="fileCode" />
                {reading ? copy.exportHtml : t('exportHtml')}
              </button>
              <button
                type="button"
                disabled={status.running || composing || Boolean(status.confirmation)}
                onClick={() => void exporter.start('pdf')}
              >
                <Icon name="filePdf" />
                {reading ? copy.exportPdf : t('exportPdf')}
              </button>
              {(['png', 'jpeg'] as const).map((format) => (
                <button
                  key={format}
                  type="button"
                  disabled={status.running || composing || Boolean(status.confirmation)}
                  onClick={() => void exporter.start(format)}
                >
                  <Icon name="image" />
                  {t(
                    reading
                      ? format === 'png'
                        ? 'exportReadingPng'
                        : 'exportReadingJpeg'
                      : format === 'png'
                        ? 'exportPng'
                        : 'exportJpeg',
                  )}
                </button>
              ))}
              <button
                type="button"
                disabled={status.running || composing || Boolean(status.confirmation)}
                onClick={() => setPandoc(true)}
              >
                <Icon name="export" />
                {
                  pandocCopy[i18next.language === 'zh-CN' ? 'zh-CN' : 'en'][
                    reading ? 'readingAction' : 'action'
                  ]
                }
              </button>
            </fieldset>
            <button
              type="button"
              disabled={status.running || composing || Boolean(status.confirmation)}
              onClick={() => void exporter.start('present')}
            >
              <Icon name="present" />
              {t(reading ? 'presentReading' : 'presentDocument')}
            </button>
            {options}
          </ToolbarDisclosure>
        </div>,
      )}
      {status.confirmation && (
        <fieldset aria-label={prompt} className="export-confirmation">
          <p>
            {prompt} {status.confirmation.target} ·{' '}
            {copy[status.confirmation.layout as 'replace' | 'side-by-side' | 'interlinear']} ·{' '}
            {t('exportRevision', { revision: status.confirmation.revision })}
          </p>
          {status.confirmation.stale && <p>{copy.exportStale}</p>}
          {status.confirmation.missing > 0 && (
            <p>{copy.exportMissing(status.confirmation.missing)}</p>
          )}
          <div className="action-row">
            <button
              ref={confirmation}
              type="button"
              onClick={() => {
                hadFocus.current = true
                void exporter.confirm()
              }}
            >
              {status.format === 'present' ? t('presentReadingConfirm') : copy.exportConfirm}
            </button>
            <button type="button" onClick={() => exporter.cancelConfirmation()}>
              {copy.exportCancel}
            </button>
          </div>
        </fieldset>
      )}
      {pandoc && (
        <PandocDialog
          onClose={() => {
            setPandoc(false)
          }}
          onExport={(options) => {
            setPandoc(false)
            void exporter.start('pandoc', options)
          }}
        />
      )}
      {status.running && (
        <div
          className="export-running"
          onFocusCapture={() => {
            hadFocus.current = true
          }}
        >
          <p role="status">
            {t(status.format === 'present' ? 'presentationRunning' : 'exportRunning', {
              revision: status.revision,
            })}
          </p>
          <button type="button" onClick={() => exporter.cancel()}>
            {t(status.format === 'present' ? 'closePresentation' : 'cancelExport')}
          </button>
        </div>
      )}
      {status.error && !(status.error === 'export-reading-empty' && readingReady) && (
        <p role="alert">{t(status.error, { defaultValue: t('export-render') })}</p>
      )}
      {status.cancelled && (
        <p role="status">
          {t(status.format === 'present' ? 'presentationClosed' : 'exportCancelled')}
        </p>
      )}
      {status.presented && <p role="status">{t('presentationClosed')}</p>}
      {status.path && (
        <p role="status">
          {t(status.revision === revision ? 'exportSaved' : 'exportSavedEarlier', {
            path: status.path,
            revision: status.revision,
          })}
        </p>
      )}
    </div>
  )
}
