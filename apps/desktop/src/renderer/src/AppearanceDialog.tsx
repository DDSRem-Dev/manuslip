import {
  type WritingTypography,
  writingLeading,
  writingMeasures,
  writingSizes,
} from '@manuslip/renderer/typography'
import { useId, useLayoutEffect, useRef } from 'react'
import { useStore } from 'zustand'
import type { DocumentAppearance } from './appearance'
import { appearanceCopy } from './appearance-copy'
import type { DocumentController } from './document'
import { Icon } from './Icons'

export function AppearanceDialog({
  controller,
  document,
  locale,
}: {
  controller: DocumentAppearance
  document: DocumentController
  locale: string
}): React.JSX.Element {
  const status = useStore(controller.store),
    dialog = useRef<HTMLDialogElement>(null)
  const id = useId(),
    copy = appearanceCopy[locale === 'zh-CN' ? 'zh-CN' : 'en']
  const typography = status.style.typography
  useLayoutEffect(() => {
    const element = dialog.current
    if (status.open && element && !element.open) element.showModal()
    else if (!status.open && element?.open) {
      element.close()
      document.focus()
    }
  }, [status.open, document])
  function change(key: keyof WritingTypography, value: string): void {
    void controller.typography({ ...typography, [key]: key === 'font' ? value : Number(value) })
  }
  return (
    <dialog
      ref={dialog}
      className="appearance-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-hint`}
      onCancel={(event) => {
        event.preventDefault()
        controller.close()
      }}
    >
      <header>
        <h2 id={`${id}-title`}>{copy.title}</h2>
        <p id={`${id}-hint`}>{copy.hint}</p>
      </header>
      <fieldset className="appearance-fields" disabled={status.busy}>
        <legend className="visually-hidden">{copy.title}</legend>
        <div className="appearance-field">
          <label htmlFor={`${id}-font`}>{copy.font}</label>
          <select
            id={`${id}-font`}
            value={typography.font}
            onChange={(event) => change('font', event.target.value)}
          >
            {(['default', 'serif', 'sans', 'mono'] as const).map((font) => (
              <option key={font} value={font}>
                {copy[font]}
              </option>
            ))}
          </select>
        </div>
        <div className="appearance-field">
          <label htmlFor={`${id}-size`}>{copy.size}</label>
          <select
            id={`${id}-size`}
            value={typography.size}
            onChange={(event) => change('size', event.target.value)}
          >
            {writingSizes.map((size) => (
              <option key={size} value={size}>
                {size ? `${size} px` : copy.default}
              </option>
            ))}
          </select>
        </div>
        <div className="appearance-field">
          <label htmlFor={`${id}-leading`}>{copy.leading}</label>
          <select
            id={`${id}-leading`}
            value={typography.leading}
            onChange={(event) => change('leading', event.target.value)}
          >
            {writingLeading.map((leading) => (
              <option key={leading} value={leading}>
                {leading || copy.default}
              </option>
            ))}
          </select>
        </div>
        <div className="appearance-field">
          <label htmlFor={`${id}-measure`}>{copy.measure}</label>
          <select
            id={`${id}-measure`}
            value={typography.measure}
            onChange={(event) => change('measure', event.target.value)}
          >
            {writingMeasures.map((measure) => (
              <option key={measure} value={measure}>
                {measure ? `${measure} px` : copy.default}
              </option>
            ))}
          </select>
        </div>
      </fieldset>
      <section className="appearance-stylesheet" aria-label={copy.guide}>
        <p className="appearance-stylesheet-name" dir="auto">
          {status.style.name ?? copy.none}
        </p>
        <div className="action-row">
          <button type="button" disabled={status.busy} onClick={() => void controller.import()}>
            <Icon name="fileCode" size={16} />
            {copy.import}
          </button>
          {status.style.name && (
            <button
              type="button"
              disabled={status.busy}
              onClick={() => void controller.reset(true)}
            >
              {copy.remove}
            </button>
          )}
        </div>
        <details>
          <summary>{copy.guide}</summary>
          <p>{copy.guideText}</p>
          <pre>
            {
              'h1 { color: #406144; font-size: 28px; }\nblockquote { padding-inline-start: 16px;\n  border-left-width: 2px; border-style: solid; }'
            }
          </pre>
        </details>
      </section>
      {status.error && (
        <p role="alert">
          {copy[status.error as keyof typeof copy] ?? copy['appearance-unavailable']}
        </p>
      )}
      <p className="appearance-state" role="status">
        {status.busy
          ? copy.loading
          : status.style.storage === 'saved'
            ? copy.saved
            : status.style.storage === 'recovered'
              ? copy.recovered
              : status.style.storage === 'session'
                ? copy.session
                : ''}
      </p>
      <footer className="appearance-actions">
        <div className="action-row">
          <button type="button" disabled={status.busy} onClick={() => void controller.reset()}>
            {copy.reset}
          </button>
          {status.style.error && (
            <button type="button" disabled={status.busy} onClick={() => void controller.retry()}>
              {copy.retry}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              controller.close()
              void document.changeMode('source').then(() => document.focus())
            }}
          >
            {copy.source}
          </button>
        </div>
        <button type="button" className="primary" onClick={() => controller.close()}>
          {copy.close}
        </button>
      </footer>
    </dialog>
  )
}
