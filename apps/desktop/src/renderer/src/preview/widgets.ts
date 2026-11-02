import { semanticLimits } from '@manuslip/core'
import { highlightCode, type LiveOptions } from '@manuslip/editor'
import { diagramLimits, diagramSyntax } from '@manuslip/renderer/diagram'
import { createSanitizer } from '@manuslip/renderer/sanitize'
import type { Result } from '../../../shared/contracts'
import type { DiagramBridge } from '../../../shared/diagram-contracts'
import { i18next } from '../i18n'
import { renderDiagramWidget } from './diagram-widget'
import { renderMathWidget } from './math-widget'
import type { WidgetBorrow } from './widget-borrow'
import { setWidgetState } from './widget-state'

let sanitizer: ReturnType<typeof createSanitizer> | null = null
let widgetBytes = 0
let mountedMath = 0
let mountedDiagrams = 0
let codeRunning = 0
/** Charge non-markup viewport metadata against the same mounted-widget allowance. */
export function reserveWidgetBytes(bytes: number): () => void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || widgetBytes + bytes > semanticLimits.widgetBytes)
    throw new Error('translation-view-limit')
  widgetBytes += bytes
  let held = true
  return () => {
    if (held) {
      held = false
      widgetBytes -= bytes
    }
  }
}
const codeQueue: { run(): Promise<void>; signal: AbortSignal; release(): void }[] = []
function runCode(): void {
  while (codeRunning < 3 && codeQueue.length) {
    const job = codeQueue.shift()
    if (!job) continue
    if (job.signal.aborted) {
      job.release()
      continue
    }
    codeRunning++
    void job
      .run()
      .catch(() => {})
      .finally(() => {
        job.release()
        codeRunning--
        runCode()
      })
  }
}
function queueCode(
  code: HTMLElement,
  language: string,
  signal: AbortSignal,
  measure: () => void,
  borrow?: WidgetBorrow,
): void {
  const lease = borrow?.retain()
  const job = {
    signal,
    async run() {
      signal.removeEventListener('abort', cancel)
      await highlightCode(code, language, signal)
      if (!signal.aborted) measure()
    },
    release() {
      signal.removeEventListener('abort', cancel)
      lease?.release()
    },
  }
  const cancel = () => {
    const index = codeQueue.indexOf(job)
    if (index >= 0) {
      codeQueue.splice(index, 1)
      job.release()
    }
  }
  signal.addEventListener('abort', cancel, { once: true })
  codeQueue.push(job)
  runCode()
}
export function renderWidget(
  container: Parameters<LiveOptions['render']>[0],
  block: Parameters<LiveOptions['render']>[1],
  signal: AbortSignal,
  measure: () => void,
  loadImage?: (url: string) => Promise<Result<string>>,
  loadLocalImage?: (url: string) => Promise<Result<string>>,
  diagrams?: { bridge: DiagramBridge; documentId: string },
  preserveSlots = false,
  borrow?: WidgetBorrow,
): void {
  if (signal.aborted) {
    borrow?.release()
    return
  }
  container.dataset.renderKind = block.kind
  setWidgetState(container, 'ready')
  if (borrow) signal.addEventListener('abort', () => borrow.release(), { once: true })
  let weight = 0
  const install = (html: string, kind?: 'math' | 'diagram'): boolean => {
    // Account for UTF-16 markup and DOM overhead before creating nodes.
    const next = html.length * 4
    if (widgetBytes - weight + next > semanticLimits.widgetBytes) {
      container.textContent = i18next.t('widgetLimit')
      setWidgetState(container, 'limited')
      measure()
      return false
    }
    widgetBytes += next - weight
    weight = next
    sanitizer ??= createSanitizer(window)
    container.replaceChildren(
      kind === 'diagram'
        ? sanitizer.diagram(html)
        : kind === 'math'
          ? sanitizer.svg(html)
          : sanitizer.markdown(html, preserveSlots),
    )
    return true
  }
  signal.addEventListener(
    'abort',
    () => {
      widgetBytes -= weight
      weight = 0
    },
    { once: true },
  )
  sanitizer ??= createSanitizer(window)
  if (!install(block.html)) return
  for (const table of container.querySelectorAll('table')) {
    const scroll = document.createElement('div')
    scroll.className = 'render-table-scroll'
    scroll.tabIndex = 0
    table.before(scroll)
    scroll.append(table)
  }
  if (!preserveSlots && block.kind !== 'math' && block.kind !== 'inlineMath') {
    // Composite projections own all their descendants, including heavy widgets.
    // Mount through the same bounded, abortable renderers as standalone widgets.
    for (const code of container.querySelectorAll('code.math-inline, code.math-display')) {
      const display = code.classList.contains('math-display')
      const math = document.createElement(display ? 'div' : 'span')
      const value = display ? (code.textContent || '').replace(/\n$/, '') : code.textContent || ''
      const target = display && code.parentElement?.tagName === 'PRE' ? code.parentElement : code
      target.replaceWith(math)
      renderWidget(
        math,
        { ...block, kind: display ? 'math' : 'inlineMath', value, html: '' },
        signal,
        measure,
        undefined,
        undefined,
        undefined,
        false,
        borrow?.retain(),
      )
    }
  }
  if (block.kind === 'diagram' && diagrams) {
    if (mountedDiagrams >= diagramLimits.consumers) {
      container.textContent = `${block.value} (${i18next.t('diagram-limit')})`
      setWidgetState(container, 'limited')
      measure()
      return
    }
    mountedDiagrams++
    signal.addEventListener(
      'abort',
      () => {
        mountedDiagrams--
      },
      { once: true },
    )
    renderDiagramWidget(
      container,
      block,
      signal,
      measure,
      install,
      diagrams.bridge,
      diagrams.documentId,
      borrow,
    )
    return
  }
  if (block.kind !== 'math' && block.kind !== 'inlineMath') {
    for (const code of container.querySelectorAll('pre > code')) {
      const language = code?.className.match(/(?:^|\s)language-(\S+)/)?.[1]
      const syntax = diagramSyntax(language)
      if (block.kind !== 'diagram' && syntax && diagrams) {
        const diagram = document.createElement('div')
        diagram.className = 'cm-live-diagram'
        const value = (code.textContent || '').replace(/\n$/, '')
        code.parentElement?.replaceWith(diagram)
        renderWidget(
          diagram,
          { ...block, kind: 'diagram', value, syntax, html: '' },
          signal,
          measure,
          loadImage,
          loadLocalImage,
          diagrams,
          false,
          borrow?.retain(),
        )
        continue
      }
      if (
        code instanceof HTMLElement &&
        language &&
        codeQueue.length < semanticLimits.viewportMath
      ) {
        queueCode(code, language, signal, measure, borrow)
      }
    }
  }
  if (block.kind === 'footnoteReference') {
    for (const reference of container.querySelectorAll('[data-footnote-ref]'))
      reference.removeAttribute('aria-describedby')
  }
  if (block.kind === 'math' || block.kind === 'inlineMath') {
    if (mountedMath >= semanticLimits.viewportMath) {
      container.textContent = `${block.value} (${i18next.t('mathLimit')})`
      setWidgetState(container, 'limited')
      measure()
      return
    }
    mountedMath++
    signal.addEventListener(
      'abort',
      () => {
        mountedMath--
      },
      { once: true },
    )
    renderMathWidget(container, block, signal, measure, install, borrow)
    return
  }
  for (const image of container.querySelectorAll('img')) {
    image.addEventListener(
      'load',
      () => {
        setWidgetState(image, 'ready')
        measure()
      },
      { signal },
    )
    image.addEventListener(
      'error',
      () => {
        setWidgetState(image, 'error')
        measure()
      },
      { signal },
    )
    const local = image.getAttribute('data-local-image')
    const url = local || image.getAttribute('data-remote-image')
    const loader = local ? loadLocalImage : loadImage
    setWidgetState(
      image,
      url && !loader ? 'blocked' : image.complete && image.naturalWidth > 0 ? 'ready' : 'loading',
    )
    if (url && loader) {
      const originalAlt = image.alt
      const retry = document.createElement('button')
      retry.type = 'button'
      retry.className = 'cm-live-image-retry'
      retry.textContent = i18next.t('retryImage', { alt: image.alt || i18next.t('image') })
      retry.hidden = true
      const errorLabel = document.createElement('span')
      errorLabel.className = 'cm-live-render-error cm-live-image-error'
      errorLabel.hidden = true
      image.after(errorLabel, retry)
      const failed = (code?: string): void => {
        if (signal.aborted) return
        setWidgetState(image, 'error')
        retry.hidden = false
        retry.disabled = false
        errorLabel.hidden = false
        const key =
          code === 'file-missing'
            ? 'imageMissing'
            : code === 'file-permission'
              ? 'imageUnreadable'
              : code === 'workspace-link'
                ? 'imageLinked'
                : code
        errorLabel.textContent =
          key && i18next.exists(key) ? i18next.t(key) : i18next.t('imageLoadError')
        measure()
      }
      const load = (): void => {
        if (signal.aborted) return
        setWidgetState(image, 'loading')
        let lease: WidgetBorrow | undefined
        retry.disabled = true
        let work: Promise<Result<string>>
        try {
          lease = borrow?.retain()
          work = loader(url)
        } catch {
          lease?.release()
          failed()
          return
        }
        void work
          .then((result) => {
            if (signal.aborted) return
            if (result.ok) {
              image.alt = originalAlt
              retry.hidden = true
              errorLabel.hidden = true
              image.src = result.value
            } else failed(result.code)
            measure()
          })
          .catch(() => failed())
          .finally(() => lease?.release())
      }
      retry.addEventListener(
        'click',
        (event) => {
          event.stopPropagation()
          load()
        },
        { signal },
      )
      image.addEventListener('error', () => failed(), { signal })
      load()
    }
  }
  measure()
}
