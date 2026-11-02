import type { LiveOptions } from '@manuslip/editor'
import type { DiagramRequest } from '@manuslip/renderer/diagram'
import type { DiagramBridge } from '../../../shared/diagram-contracts'
import { i18next } from '../i18n'
import { diagramConsumers } from './diagrams'
import type { WidgetBorrow } from './widget-borrow'

export function renderDiagramWidget(
  container: HTMLElement,
  block: Parameters<LiveOptions['render']>[1],
  signal: AbortSignal,
  measure: () => void,
  install: (html: string, kind?: 'math' | 'diagram') => boolean,
  bridge: DiagramBridge,
  documentId: string,
  borrow?: WidgetBorrow,
): void {
  let current: AbortController | null = null
  let theme: 'light' | 'dark' = 'light'
  const dark = window.matchMedia('(prefers-color-scheme: dark)')
  const themeValue = (): 'light' | 'dark' =>
    document.documentElement.dataset.theme === 'dark' ||
    (document.documentElement.dataset.theme === 'system' && dark.matches)
      ? 'dark'
      : 'light'
  const render = (retry = false): void => {
    if (signal.aborted) return
    const restoreFocus = container.contains(document.activeElement)
    current?.abort()
    const controller = new AbortController()
    current = controller
    container.removeAttribute('role')
    container.removeAttribute('aria-label')
    theme = themeValue()
    const source = document.createElement('pre')
    source.textContent = block.value
    const status = document.createElement('span')
    status.className = 'cm-live-render-error'
    status.setAttribute('role', 'status')
    status.tabIndex = -1
    status.textContent = i18next.t('diagramLoading')
    container.replaceChildren(source, status)
    container.setAttribute('aria-busy', 'true')
    if (restoreFocus) status.focus({ preventScroll: true })
    const bounds = container.getBoundingClientRect()
    const request: DiagramRequest = {
      jobId: crypto.randomUUID(),
      documentId,
      occurrenceId: block.id,
      source: block.value,
      ...(block.syntax ? { syntax: block.syntax } : {}),
      theme,
      priority: bounds.bottom > 0 && bounds.top < innerHeight ? 'visible' : 'nearby',
      retry,
    }
    let lease: WidgetBorrow | undefined
    const pending = async (): Promise<string> => {
      lease = borrow?.retain()
      return diagramConsumers.render(bridge, request, controller.signal, borrow)
    }
    void pending()
      .then((svg) => {
        if (signal.aborted || current !== controller || controller.signal.aborted) return
        const restoreFocus = document.activeElement === status
        container.removeAttribute('aria-busy')
        if (!install(svg, 'diagram')) return
        container.setAttribute('role', 'img')
        container.setAttribute('aria-label', i18next.t('diagramLabel'))
        if (restoreFocus) {
          const target =
            container.parentElement?.querySelector<HTMLElement>('.cm-live-source-button') ??
            container.closest<HTMLElement>('.reading-article')
          target?.focus({ preventScroll: true })
        }
        measure()
      })
      .catch((error: unknown) => {
        if (signal.aborted || current !== controller || controller.signal.aborted) return
        const restoreFocus = document.activeElement === status
        container.removeAttribute('aria-busy')
        const code = error instanceof Error ? error.message : 'diagram-render'
        status.textContent = i18next.exists(code) ? i18next.t(code) : i18next.t('diagram-render')
        const retry = document.createElement('button')
        retry.type = 'button'
        retry.className = 'cm-live-diagram-retry'
        retry.textContent = i18next.t('retryDiagram')
        retry.addEventListener(
          'click',
          (event) => {
            event.stopPropagation()
            render(true)
          },
          { signal: controller.signal },
        )
        container.replaceChildren(source, status, retry)
        if (restoreFocus) retry.focus({ preventScroll: true })
        measure()
      })
      .finally(() => lease?.release())
    measure()
  }
  const refresh = (): void => {
    if (theme !== themeValue()) render()
  }
  const observer = new MutationObserver(refresh)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  dark.addEventListener('change', refresh)
  signal.addEventListener(
    'abort',
    () => {
      current?.abort()
      observer.disconnect()
      dark.removeEventListener('change', refresh)
    },
    { once: true },
  )
  render()
}
