import type { LiveOptions } from '@manuslip/editor'
import { i18next } from '../i18n'
import { mountInlineMathLayout } from './inline-math-layout'
import { mathRenderer } from './math'
import type { WidgetBorrow } from './widget-borrow'
import { setWidgetState } from './widget-state'

export function renderMathWidget(
  container: HTMLElement,
  block: Parameters<LiveOptions['render']>[1],
  signal: AbortSignal,
  measure: () => void,
  install: (html: string, kind?: 'math' | 'diagram') => boolean,
  borrow?: WidgetBorrow,
): void {
  let rendering = false
  const render = (retry = false): void => {
    if (signal.aborted || rendering) return
    rendering = true
    const restoreFocus = container.contains(document.activeElement)
    container.style.removeProperty('vertical-align')
    container.removeAttribute('data-math-scroll')
    container.textContent = block.value
    container.removeAttribute('role')
    container.removeAttribute('aria-label')
    setWidgetState(container, 'loading')
    if (restoreFocus) {
      container.tabIndex = -1
      container.focus({ preventScroll: true })
    }
    measure()
    let lease: WidgetBorrow | undefined
    const pending = async (): Promise<string> => {
      lease = borrow?.retain()
      return mathRenderer.render(block.value, block.kind === 'math', signal, retry)
    }
    void pending()
      .then((svg) => {
        if (signal.aborted || !install(svg, 'math')) return
        setWidgetState(container, 'ready')
        if (block.kind === 'inlineMath') mountInlineMathLayout(container, signal, measure)
        container.setAttribute('role', 'math')
        container.setAttribute('aria-label', block.value)
        container.tabIndex = 0
        // The labelled math container owns the accessible expression.
        for (const svg of container.querySelectorAll('svg')) {
          svg.setAttribute('aria-hidden', 'true')
          svg.setAttribute('focusable', 'false')
        }
        measure()
      })
      .catch((error: unknown) => {
        if (signal.aborted) return
        const limited = error instanceof Error && error.message === 'math-limit'
        setWidgetState(container, limited ? 'limited' : 'error')
        const label = document.createElement('span')
        label.className = 'cm-live-render-error'
        label.setAttribute('role', 'status')
        label.textContent = i18next.t(limited ? 'mathLimit' : 'mathError')
        const retry = document.createElement('button')
        retry.type = 'button'
        retry.className = 'cm-live-math-retry'
        retry.textContent = i18next.t('retry')
        retry.addEventListener(
          'click',
          (event) => {
            event.stopPropagation()
            render(true)
          },
          { signal },
        )
        container.replaceChildren(document.createTextNode(block.value), label, retry)
        if (document.activeElement === container) retry.focus({ preventScroll: true })
        measure()
      })
      .finally(() => {
        rendering = false
        lease?.release()
      })
  }
  render()
}
