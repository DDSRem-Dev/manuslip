import { Icon } from './Icons'
import { i18next } from './i18n'

export interface WritingModes {
  focus: boolean
  typewriter: boolean
  onFocus(value: boolean): void
  onTypewriter(value: boolean): void
}

function TypewriterOption({ writing }: { writing: WritingModes }): React.JSX.Element {
  return (
    <label className="writing-checkbox">
      <input
        type="checkbox"
        checked={writing.typewriter}
        onChange={(event) => writing.onTypewriter(event.target.checked)}
      />
      {i18next.t('typewriterMode')}
    </label>
  )
}

export function WritingOptions({ writing }: { writing: WritingModes }): React.JSX.Element {
  return (
    <fieldset className="toolbar-command-group writing-options">
      <legend>{i18next.t('writingTools')}</legend>
      <button type="button" onClick={() => writing.onFocus(true)}>
        <Icon name="focus" />
        {i18next.t('focusMode')}
      </button>
      <TypewriterOption writing={writing} />
    </fieldset>
  )
}

export function FocusWritingBar({
  writing,
  title,
  path,
  stateLabel,
  busy,
  save,
}: {
  writing: WritingModes
  title: string
  path: string | null
  stateLabel: string
  busy: boolean
  save(): void
}): React.JSX.Element {
  return (
    <fieldset className="focus-writing-toolbar" aria-label={i18next.t('writingTools')}>
      <div className="focus-writing-identity">
        <div className="focus-writing-title">
          <h1 title={path || title} dir="auto">
            {title}
          </h1>
          <span role="status">{stateLabel}</span>
        </div>
        {path && (
          <p title={path} dir="auto">
            {path}
          </p>
        )}
      </div>
      <TypewriterOption writing={writing} />
      <button className="primary" type="button" disabled={busy} onClick={save}>
        <Icon name="save" />
        {i18next.t('saveDocument')}
      </button>
      <button
        className="focus-writing-exit"
        type="button"
        aria-keyshortcuts="Escape"
        title={i18next.t('exitFocusHint')}
        onClick={() => writing.onFocus(false)}
      >
        <Icon name="unfocus" />
        {i18next.t('exitFocusMode')}
      </button>
    </fieldset>
  )
}
