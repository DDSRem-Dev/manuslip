import { defaultEditorPreferences, type EditorPreferences } from '@manuslip/editor/preferences'
import type { Locale, Settings } from '../../shared/contracts'
import { preferencesCopy } from './preferences-copy'

export function EditorSettings({
  settings,
  locale,
  disabled,
  update,
}: {
  settings: Settings
  locale: Locale
  disabled: boolean
  update(patch: Partial<Settings>): Promise<void>
}): React.JSX.Element {
  const copy = preferencesCopy[locale]
  const editor = settings.editor ?? defaultEditorPreferences
  const change = (patch: Partial<EditorPreferences>) =>
    void update({ editor: { ...editor, ...patch } })
  return (
    <>
      <h3 className="preferences-page-title">{copy.editor}</h3>
      <p className="preferences-page-hint">{copy.editorHint}</p>
      <fieldset className="preference-group" disabled={disabled}>
        <legend>{copy.source}</legend>
        <label className="spellcheck-preference">
          <input
            type="checkbox"
            checked={editor.lineNumbers}
            onChange={(event) => change({ lineNumbers: event.target.checked })}
          />
          {copy.lineNumbers}
        </label>
        <label className="spellcheck-preference">
          <input
            type="checkbox"
            checked={editor.wrapLines}
            onChange={(event) => change({ wrapLines: event.target.checked })}
          />
          {copy.wrapLines}
        </label>
        <div className="preference-row">
          <label htmlFor="editor-tab-size">{copy.tabSize}</label>
          <select
            id="editor-tab-size"
            value={editor.tabSize}
            onChange={(event) =>
              change({ tabSize: Number(event.target.value) as EditorPreferences['tabSize'] })
            }
          >
            {[2, 4, 8].map((size) => (
              <option key={size} value={size}>
                {copy.spaces(size)}
              </option>
            ))}
          </select>
        </div>
        <p className="preference-hint">{copy.sourceHint}</p>
      </fieldset>
      <button
        type="button"
        disabled={disabled}
        onClick={() => void update({ editor: { ...defaultEditorPreferences } })}
      >
        {copy.resetEditor}
      </button>
    </>
  )
}
