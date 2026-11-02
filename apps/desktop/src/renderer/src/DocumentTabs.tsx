import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from 'zustand'
import type { DocumentController } from './document'
import { type DocumentTabLabel, documentTabLabels } from './document-tab-labels'
import type { DocumentsController } from './documents'
import { Icon } from './Icons'
import { i18next } from './i18n'
import { useDocumentStatus } from './use-document-status'

function useTabLabels(
  controller: DocumentsController,
  documents: readonly DocumentController[],
  locale: string,
) {
  const cached = useRef<{
    inputs: readonly { id: string; title: string; path: string | null }[]
    labels: ReadonlyMap<string, DocumentTabLabel>
    locale: string
  } | null>(null)
  const subscribe = useCallback(
    (notify: () => void) => {
      const subscriptions = documents.map((document) =>
        document.store.subscribe((state, previous) => {
          if (
            state.info.name !== previous.info.name ||
            state.info.displayPath !== previous.info.displayPath
          )
            notify()
        }),
      )
      return () => {
        for (const unsubscribe of subscriptions) unsubscribe()
      }
    },
    [documents],
  )
  const snapshot = useCallback(() => {
    const inputs = documents.map((document) => {
      const info = document.store.getState().info
      return { id: info.id, title: controller.title(document), path: info.displayPath }
    })
    const before = cached.current
    if (
      before?.locale === locale &&
      before.inputs.length === inputs.length &&
      inputs.every((input, index) => {
        const old = before.inputs[index]
        return old?.id === input.id && old.title === input.title && old.path === input.path
      })
    )
      return before.labels
    const labels = documentTabLabels(inputs)
    cached.current = { inputs, labels, locale }
    return labels
  }, [controller, documents, locale])
  return useSyncExternalStore(subscribe, snapshot)
}

function Tab({
  document,
  controller,
  selected,
  busy,
  index,
  label,
  closeTarget,
  close,
}: {
  document: DocumentController
  controller: DocumentsController
  selected: boolean
  busy: boolean
  index: number
  label: DocumentTabLabel | undefined
  closeTarget: HTMLDivElement | null
  close: (id: string, button: HTMLButtonElement) => void
}): React.JSX.Element {
  const status = useDocumentStatus(document)
  const ref = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const title = label?.label ?? controller.title(document)
  const id = status.info.id
  useEffect(() => {
    const tab = ref.current
    if (!selected || !tab) return
    const reveal = (): void => tab.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    // Save As, the dirty indicator and viewport changes can resize the active pair.
    const observer = new ResizeObserver(reveal)
    observer.observe(tab)
    const strip = tab.closest('.document-tabs')
    if (strip) observer.observe(strip)
    // A peer's folder context can move this tab without resizing it.
    const labels = new MutationObserver(reveal)
    if (strip) labels.observe(strip, { childList: true, characterData: true, subtree: true })
    reveal()
    return () => {
      observer.disconnect()
      labels.disconnect()
    }
  }, [selected])
  return (
    <>
      <button
        className={`document-tab${selected ? ' selected' : ''}`}
        style={{ gridColumn: index * 2 + 1 }}
        ref={ref}
        id={`tab-${id}`}
        type="button"
        role="tab"
        aria-selected={selected}
        aria-controls="document-panel"
        tabIndex={selected ? 0 : -1}
        disabled={busy}
        title={status.info.displayPath || title}
        onClick={() => void controller.activate(id)}
        onKeyDown={(event) => {
          // Selection waits for pending input. Keep the focused tab's close control
          // reachable even if Tab arrives before that selection has settled.
          if (
            event.key === 'Tab' &&
            !event.shiftKey &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.metaKey &&
            closeRef.current &&
            !busy
          ) {
            event.preventDefault()
            closeRef.current.focus()
          }
        }}
      >
        <span className="tab-label">
          <bdi className="tab-title">{label?.title ?? title}</bdi>
          {label?.context && (
            <span className="tab-context">
              {' '}
              — <bdi>{label.context}</bdi>
            </span>
          )}
        </span>
        {status.dirty && (
          <span className="tab-dirty" role="img" aria-label={i18next.t('unsavedDocument')}>
            ●
          </span>
        )}
      </button>
      {closeTarget &&
        createPortal(
          <button
            className={`document-tab tab-close${selected ? ' selected' : ''}`}
            ref={closeRef}
            style={{ gridColumn: index * 2 + 2 }}
            type="button"
            tabIndex={selected ? 0 : -1}
            disabled={busy}
            aria-label={i18next.t('closeDocument', { name: title })}
            onFocus={() => ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
            onKeyDown={(event) => {
              if (
                event.key === 'Tab' &&
                event.shiftKey &&
                !event.ctrlKey &&
                !event.altKey &&
                !event.metaKey &&
                ref.current &&
                !busy
              ) {
                event.preventDefault()
                ref.current.focus()
              }
            }}
            onClick={(event) => close(id, event.currentTarget)}
          >
            <Icon name="close" size={14} />
          </button>,
          closeTarget,
        )}
    </>
  )
}

export function DocumentTabs({
  controller,
  locale,
}: {
  controller: DocumentsController
  locale: string
}): React.JSX.Element | null {
  const state = useStore(controller.store)
  const labels = useTabLabels(controller, state.documents, locale)
  const [closeTarget, setCloseTarget] = useState<HTMLDivElement | null>(null)
  const closeFocus = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    const document = window.document
    if (state.busy) {
      // Keep later user input in charge while a close waits for a native decision or I/O.
      const cancelRestore = (): void => {
        closeFocus.current = null
      }
      document.addEventListener('pointerdown', cancelRestore, true)
      document.addEventListener('keydown', cancelRestore, true)
      return () => {
        document.removeEventListener('pointerdown', cancelRestore, true)
        document.removeEventListener('keydown', cancelRestore, true)
      }
    }
    const trigger = closeFocus.current
    if (!trigger) return
    closeFocus.current = null
    const target = trigger.isConnected
      ? trigger
      : document.getElementById(`tab-${state.activeId}`) || document.getElementById('content')
    target?.focus()
  }, [state.busy, state.activeId])
  // Locale changes must update accessible labels even when document metadata is unchanged.
  const label = i18next.t('openDocuments', { lng: locale })
  if (!state.documents.length) return null
  return (
    <nav className="document-tabs" aria-label={label}>
      <div
        className="document-tablist"
        role="tablist"
        aria-label={label}
        onKeyDown={(event) => {
          if (state.busy || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          const tabs = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
          )
          const index = tabs.indexOf(event.target as HTMLButtonElement)
          if (index < 0) return
          event.preventDefault()
          const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
          const offset = (event.key === 'ArrowLeft' ? -1 : 1) * (rtl ? -1 : 1)
          const target =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? tabs.length - 1
                : (index + offset + tabs.length) % tabs.length
          const document = state.documents[target]
          if (document) {
            void controller.activate(document.store.getState().info.id)
            tabs[target]?.focus()
          }
        }}
      >
        {state.documents.map((document, index) => (
          <Tab
            key={document.store.getState().info.id}
            document={document}
            controller={controller}
            selected={document.store.getState().info.id === state.activeId}
            busy={state.busy}
            index={index}
            label={labels.get(document.store.getState().info.id)}
            closeTarget={closeTarget}
            close={(id, button) => {
              if (window.document.activeElement === button) closeFocus.current = button
              void controller.closeTab(id)
            }}
          />
        ))}
      </div>
      <div className="document-tab-closes" ref={setCloseTarget} />
    </nav>
  )
}
