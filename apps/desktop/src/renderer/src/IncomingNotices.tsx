import { useStore } from 'zustand'
import { i18next } from './i18n'
import type { IncomingController } from './incoming'

const failureMessages: Readonly<Record<string, string>> = {
  'file-missing': 'incomingMissing',
  'file-tabs': 'file-tabs',
  'file-large': 'file-large',
  'file-incoming-busy': 'file-incoming-busy',
}

export function IncomingNotices({
  controller,
  busy,
}: {
  controller: IncomingController
  busy: boolean
}): React.JSX.Element {
  const state = useStore(controller.store)
  const t = i18next.t.bind(i18next)
  return (
    <>
      <p className="incoming-announcement" role="status">
        {state.opening
          ? t('openingFiles')
          : state.failures.length
            ? t('incomingFailed', { count: state.failures.length })
            : ''}
      </p>
      {(state.opening || state.error || state.issue || state.failures.length > 0) && (
        <section className="incoming-notices" aria-label={t('incomingFiles')}>
          {state.opening && <p>{t('openingFiles')}</p>}
          {state.error && (
            <div role="alert">
              <p>{t(state.error)}</p>
              <button
                type="button"
                disabled={busy || state.opening}
                onClick={() => controller.refresh()}
              >
                {t('retry')}
              </button>
            </div>
          )}
          {state.issue && (
            <div role="alert">
              <p>{t(state.issue)}</p>
              <button
                type="button"
                disabled={busy || state.opening}
                onClick={() => void controller.dismiss(null)}
              >
                {t('dismiss')}
              </button>
            </div>
          )}
          {state.failures.map((entry) => (
            <div className="incoming-failure" key={entry.id}>
              <p>
                <bdi>{entry.displayPath}</bdi>
              </p>
              <p>{t(failureMessages[entry.code] || 'incomingRead')}</p>
              <div className="action-row">
                <button
                  type="button"
                  disabled={busy || state.opening}
                  aria-label={t('retryIncoming', { name: entry.name })}
                  onClick={() => controller.retry(entry.id)}
                >
                  {t('retry')}
                </button>
                <button
                  type="button"
                  disabled={busy || state.opening}
                  aria-label={t('dismissIncoming', { name: entry.name })}
                  onClick={() => void controller.dismiss(entry.id)}
                >
                  {t('dismiss')}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  )
}
