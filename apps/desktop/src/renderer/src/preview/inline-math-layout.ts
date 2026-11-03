import { inlineMathBaseline } from '@manuslip/renderer/math-layout'

/** Ordinary inline math must let accents and deliberately smashed TeX escape
 * the SVG box. Only expressions wider than the line become scroll containers.
 */
export function mountInlineMathLayout(
  container: HTMLElement,
  signal: AbortSignal,
  measure: () => void,
): void {
  const image = container.querySelector('svg')
  if (!image || signal.aborted) return
  const baseline = inlineMathBaseline(image.getAttribute('height'), image.getAttribute('viewBox'))
  container.style.verticalAlign = baseline ?? ''
  const observer = new ResizeObserver(() => {
    if (signal.aborted || !container.isConnected) return
    const scrolls = image.getBoundingClientRect().width > container.clientWidth + 0.5
    const changed = container.hasAttribute('data-math-scroll') !== scrolls
    container.toggleAttribute('data-math-scroll', scrolls)
    // A horizontal scrollbar also lies below the image's baseline. Compensate
    // its actual height so the glyphs keep their position when the line narrows.
    const gutter = scrolls ? Math.max(0, container.offsetHeight - container.clientHeight) : 0
    const alignment = baseline && gutter ? `calc(${baseline} - ${gutter}px)` : (baseline ?? '')
    if (container.style.verticalAlign !== alignment || changed) {
      container.style.verticalAlign = alignment
      measure()
    }
  })
  observer.observe(container, { box: 'border-box' })
  observer.observe(image)
  signal.addEventListener('abort', () => observer.disconnect(), { once: true })
}
