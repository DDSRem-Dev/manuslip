import { useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import type { DocumentExport } from './export'
import { Icon } from './Icons'
import { i18next } from './i18n'

export function ExportFeedback({
  exporter,
  revision,
  readingReady,
}: {
  exporter: DocumentExport
  revision: number
  readingReady: boolean
}): React.JSX.Element {
  const status = useStore(exporter.store)
  const feedback = useRef<HTMLDivElement>(null)
  const t = i18next.t.bind(i18next)
  const error = status.error === 'export-reading-empty' && readingReady ? null : status.error
  const message = error
    ? t(error, { defaultValue: t('export-render') })
    : status.cancelled || status.presented
      ? t(
          status.format === 'present' || status.presented
            ? 'presentationClosed'
            : 'exportCancelled',
        )
      : status.path
        ? t(status.revision === revision ? 'exportSaved' : 'exportSavedEarlier', {
            path: status.path,
            revision: status.revision,
          })
        : status.running
          ? t(status.format === 'present' ? 'presentationRunning' : 'exportRunning')
          : ''
  useEffect(() => {
    const element = feedback.current
    if (!element) return
    const remaining = status.feedbackAt === null ? 0 : status.feedbackAt + 5_000 - Date.now()
    if (!message || remaining <= 0) {
      element.hidePopover()
      return
    }
    element.showPopover()
    const timer = window.setTimeout(() => element.hidePopover(), remaining)
    return () => window.clearTimeout(timer)
  }, [message, status.feedbackAt])
  return (
    <div ref={feedback} className="export-feedback" popover="manual">
      <Icon name={status.path ? 'check' : 'export'} />
      <p role={error ? 'alert' : 'status'} aria-atomic="true">
        {message}
      </p>
    </div>
  )
}
