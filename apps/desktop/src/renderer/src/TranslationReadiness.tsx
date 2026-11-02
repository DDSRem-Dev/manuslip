import type { Locale } from '../../shared/contracts'
import type { TranslationState } from '../../shared/translation-contracts'
import { Icon } from './Icons'
import { translationAvailability } from './translation/availability'
import { translationCopy } from './translation-copy'

export function TranslationReadiness({
  state,
  locale,
  onKey,
  connectionChanged,
}: {
  state: TranslationState
  locale: Locale
  onKey(): void
  connectionChanged: boolean
}): React.JSX.Element {
  const copy = translationCopy[locale]
  const availability = translationAvailability(state)
  const label = {
    setup: 'setupTitle',
    key: 'needsKey',
    configured: 'configured',
    readOnly: 'readOnlyTitle',
  } as const
  const hint = {
    setup: 'setupHint',
    key: 'needsKeyHint',
    configured: 'configuredHint',
    readOnly: 'readOnly',
  } as const
  return (
    <div className="translation-readiness" role="status">
      <Icon name={availability === 'configured' ? 'check' : 'translate'} size={20} />
      <div>
        <strong>{connectionChanged ? copy.unsavedConnection : copy[label[availability]]}</strong>
        <p className="preference-hint">
          {connectionChanged ? copy.saveFirst : copy[hint[availability]]}
        </p>
      </div>
      {availability === 'key' && !connectionChanged && (
        <button type="button" onClick={onKey}>
          {copy.addKey}
        </button>
      )}
    </div>
  )
}
