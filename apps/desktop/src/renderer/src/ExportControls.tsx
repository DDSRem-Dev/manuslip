import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { DocumentExport } from './export'
import { ExportFeedback } from './ExportFeedback'
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
  toolbar,
}: {
  exporter: DocumentExport
  composing: boolean
  revision: number
  reading?: boolean
  readingReady?: boolean
  children: ReactNode
  toolbar(controls: ReactNode): ReactNode
}): React.JSX.Element {
  const status = useStore(exporter.store)
  const [pandoc, setPandoc] = useState(false)
  const first = useRef<HTMLButtonElement>(null)
  const hadPandoc = useRef(false)
  useLayoutEffect(() => {
    if (!pandoc && hadPandoc.current) first.current?.focus()
    hadPandoc.current = pandoc
  }, [pandoc])
  const confirmation = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(false)
  useLayoutEffect(() => {
    if (status.confirmation) confirmation.current?.focus()
    else if (wasConfirming.current) first.current?.focus()
    wasConfirming.current = Boolean(status.confirmation)
  }, [status.confirmation])
  const t = i18next.t.bind(i18next)
  const copy = readingCopy[i18next.language === 'zh-CN' ? 'zh-CN' : 'en']
  const prompt = status.format === 'present' ? t('presentReadingPrompt') : copy.exportPrompt
  const presenting = status.running && status.format === 'present'
  return (
    <div className="export-controls">
      {toolbar(
        <div className="export-actions">
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
              disabled={
                (status.running && !presenting) || composing || Boolean(status.confirmation)
              }
              onClick={() => {
                if (presenting) exporter.cancel()
                else void exporter.start('present')
              }}
            >
              <Icon name="present" />
              {t(presenting ? 'closePresentation' : reading ? 'presentReading' : 'presentDocument')}
            </button>
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
      <ExportFeedback exporter={exporter} revision={revision} readingReady={readingReady} />
    </div>
  )
}
