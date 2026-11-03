import { exportStyle } from '@manuslip/renderer/export-style'
import { inlineMathBaseline } from '@manuslip/renderer/math-layout'
import { createSanitizer, scopeReadingReferences } from '@manuslip/renderer/sanitize'
import type { PrintPayload } from '../../shared/export-contracts'
import '../fonts.css'
import { presentDocument } from './presentation'
import { presentationStyle } from './presentation-style'

declare global {
  interface Window {
    manuslipPrintHost: {
      ready(): void
      onJob(listener: (payload: PrintPayload) => void): void
      asset(jobId: string, reference: string): Promise<string>
      result(jobId: string, value: { html: string } | { error: string }): void
    }
  }
}
const style = document.createElement('style')
style.textContent = exportStyle + presentationStyle
document.head.append(style)
const sanitizer = createSanitizer(window)
function deadline<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('export-timeout')), 15_000)
    void promise.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}
window.manuslipPrintHost.onJob((payload) => {
  void (async () => {
    try {
      document.documentElement.lang = payload.language ?? payload.locale
      document.title = payload.title
      const article = document.querySelector<HTMLElement>('#document')
      if (!article) throw new Error('export-render')
      const appearanceCss = payload.appearanceCss ?? ''
      if (
        appearanceCss.length > 129 * 1024 ||
        appearanceCss.includes('<') ||
        appearanceCss.includes('\0')
      )
        throw new Error('export-render')
      article.dataset.documentStyle = 'export'
      if (appearanceCss) {
        const appearanceStyle = document.createElement('style')
        appearanceStyle.textContent = appearanceCss
        document.head.append(appearanceStyle)
      }
      const fragment = sanitizer.markdown(payload.html, true)
      scopeReadingReferences(fragment)
      for (const slot of payload.slots) {
        const matches = [...fragment.querySelectorAll('[data-export-slot]')].filter(
          (element) => element.getAttribute('data-export-slot') === slot.id,
        )
        const element = matches[0]
        if (!element || matches.length !== 1) throw new Error('export-render')
        const svg = slot.kind === 'diagram' ? sanitizer.diagram(slot.svg) : sanitizer.svg(slot.svg)
        if (!svg.querySelector('svg')) throw new Error('export-render')
        element.replaceChildren(svg)
        const image = element.querySelector('svg')
        if (slot.kind === 'math' && !slot.display && image)
          (element as HTMLElement).style.verticalAlign =
            inlineMathBaseline(image.getAttribute('height'), image.getAttribute('viewBox')) ?? ''
        element.removeAttribute('data-export-slot')
        element.setAttribute(
          'data-export-kind',
          slot.kind === 'diagram' ? 'diagram' : slot.display ? 'display-math' : 'math',
        )
        element.setAttribute('role', slot.kind === 'diagram' ? 'img' : 'math')
        element.setAttribute(
          'aria-label',
          slot.kind === 'diagram' ? (payload.locale === 'zh-CN' ? '图表' : 'Diagram') : slot.source,
        )
        for (const image of element.querySelectorAll('svg')) {
          image.setAttribute('aria-hidden', 'true')
          image.setAttribute('focusable', 'false')
        }
      }
      if (fragment.querySelector('[data-export-slot]')) throw new Error('export-render')
      const images = [...fragment.querySelectorAll('img')]
      if (images.length > 500) throw new Error('export-limit')
      const references = images.map((image) => {
        const reference =
          image.getAttribute('src') ||
          image.getAttribute('data-local-image') ||
          image.getAttribute('data-remote-image')
        image.removeAttribute('src')
        image.removeAttribute('data-local-image')
        image.removeAttribute('data-remote-image')
        image.loading = 'eager'
        if (!reference) throw new Error('export-asset')
        return reference
      })
      for (let i = 0; i < images.length; i++) {
        const image = images[i]
        const reference = references[i]
        if (!image || !reference) throw new Error('export-asset')
        image.src = await deadline(
          window.manuslipPrintHost.asset(payload.jobId, reference).catch(() => {
            throw new Error('export-asset')
          }),
        )
      }
      article.replaceChildren(fragment)
      await deadline(document.fonts.ready)
      await deadline(Promise.all(images.map((image) => image.decode())))
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
      if (payload.mode === 'presentation') {
        presentDocument(article, payload.locale, Boolean(payload.reading))
        await deadline(document.fonts.ready)
      }
      window.manuslipPrintHost.result(payload.jobId, {
        html: payload.mode === 'presentation' ? '' : article.innerHTML,
      })
    } catch (error) {
      const code = error instanceof Error ? error.message : 'export-render'
      window.manuslipPrintHost.result(payload.jobId, {
        error: [
          'export-limit',
          'export-asset',
          'export-timeout',
          'presentation-limit',
          'presentation-empty',
        ].includes(code)
          ? code
          : 'export-render',
      })
    }
  })()
})
window.manuslipPrintHost.ready()
