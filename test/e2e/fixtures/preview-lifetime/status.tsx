import { createElement, StrictMode, Suspense } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { createStore } from 'zustand/vanilla'
import { initialPreviewStatus } from '../../../../apps/desktop/src/renderer/src/preview/controller'
import type { OwnedPackedPreview } from '../../../../apps/desktop/src/renderer/src/preview/packed-preparation'
import {
  PreviewStatusPublication,
  previewStatusLimits,
} from '../../../../apps/desktop/src/renderer/src/preview/status-publication'
import { useDocumentStatus } from '../../../../apps/desktop/src/renderer/src/use-document-status'
import type { PackedSession } from '../../../../packages/core/src/packing-session'

/** Real React readers with a controlled delayed store notification and abandoned render. */
export function statusFixture(owner: PackedSession, current: () => OwnedPackedPreview | undefined) {
  const previewStatuses = new PreviewStatusPublication(),
    store = createStore(() => initialPreviewStatus)
  const primary = { store, previewStatuses }
  let paused = false
  const delayed = new Set<() => void>()
  const secondary = {
    previewStatuses,
    store: {
      ...store,
      subscribe(listener: Parameters<typeof store.subscribe>[0]) {
        const notify = () => listener(store.getState(), store.getState())
        const unsubscribe = store.subscribe((...args) => {
          if (paused) delayed.add(notify)
          else listener(...args)
        })
        return () => {
          delayed.delete(notify)
          unsubscribe()
        }
      },
    },
  }
  const roots = new Map<string, { root: Root; host: HTMLElement }>()
  const suspended = new Promise<void>(() => {})
  function Consumer({ name }: { name: string }) {
    const source = name === 'secondary' ? secondary : primary
    useDocumentStatus(source)
    const outline = source.store.getState().outline
    if (name === 'abandoned') throw suspended
    return (
      <p data-status-reader={name}>
        {outline.map((heading) => heading.text).join(', ') || 'Empty'}
      </p>
    )
  }
  const mount = (name: string) => {
    const host = document.createElement('div'),
      root = createRoot(host)
    document.body.append(host)
    roots.set(name, { root, host })
    flushSync(() =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(
            Suspense,
            { fallback: createElement('p', null, 'Waiting') },
            createElement(Consumer, { name }),
          ),
        ),
      ),
    )
  }
  const unmount = (name: string) => {
    const value = roots.get(name)
    if (!value) return
    flushSync(() => value.root.unmount())
    value.host.remove()
    roots.delete(name)
  }
  return {
    mount() {
      mount('primary')
      mount('secondary')
    },
    abandon() {
      mount('abandoned')
      unmount('abandoned')
    },
    pause() {
      paused = true
    },
    resume() {
      paused = false
      for (const notify of [...delayed]) notify()
      delayed.clear()
    },
    publish() {
      const value = current()
      if (!value) throw new Error('Missing packed model')
      const reservation = previewStatuses.prepare(() => {
        const lease = value.retain()
        try {
          const key = {}
          const hold = owner.retain({
            resources: () => [{ key, bytes: previewStatusLimits.metadataBytes }],
          })
          return {
            release() {
              lease.release()
              hold.release()
            },
          }
        } catch (error) {
          lease.release()
          throw error
        }
      })
      try {
        store.setState({
          ...value.status,
          semantic: 'ready',
          previewPublication: reservation.publish(),
        })
      } finally {
        reservation.release()
      }
    },
    counts() {
      return previewStatuses.stats
    },
    close() {
      const previewPublication = previewStatuses.close()
      store.setState({ ...initialPreviewStatus, previewPublication })
    },
    unmountSecondary() {
      unmount('secondary')
    },
    dispose() {
      this.close()
      for (const name of [...roots.keys()]) unmount(name)
    },
  }
}
