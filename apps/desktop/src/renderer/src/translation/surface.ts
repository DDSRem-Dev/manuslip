import type { LiveOptions } from '@manuslip/editor'
import type { ReadingProjection } from '@manuslip/renderer/reading'
import { scopeReadingReferences } from '@manuslip/renderer/sanitize'
import type { DesktopBridge } from '../../../shared/contracts'
import { renderWidget } from '../preview/widgets'
import { mountIndexedReading } from './indexed-surface'

/** A sanitized, non-editable projection. All resource access uses existing capabilities. */
export function mountReading(
  container: HTMLElement,
  projection: ReadingProjection,
  documentId: string,
  remoteImages: boolean,
  bridge: DesktopBridge,
  scope?: (container: HTMLElement) => void,
  navigate?: (href: string) => boolean,
): () => void {
  if (projection.indexed)
    return mountIndexedReading(container, projection, (element, row, scope, navigate) =>
      mountReading(element, row, documentId, remoteImages, bridge, scope, navigate),
    )
  const abort = new AbortController()
  const block = (
    html: string,
    kind: string,
    value = '',
    syntax?: Parameters<LiveOptions['render']>[1]['syntax'],
  ): Parameters<LiveOptions['render']>[1] => ({
    id: crypto.randomUUID(),
    from: 0,
    to: 0,
    lines: 1,
    kind,
    value,
    html,
    ...(syntax ? { syntax } : {}),
  })
  renderWidget(
    container,
    block(projection.html, 'html'),
    abort.signal,
    () => {},
    remoteImages ? (url) => bridge.loadRemoteImage(documentId, url) : undefined,
    (url) => bridge.loadLocalImage(documentId, url),
    undefined,
    true,
  )
  const anchors = new Set(projection.blocks?.map((block) => block.id) ?? [])
  if (scope) scope(container)
  else scopeReadingReferences(container)
  for (const element of container.querySelectorAll<HTMLElement>('[data-reading-block]'))
    if (!anchors.has(element.dataset.readingBlock ?? ''))
      element.removeAttribute('data-reading-block')
  const elements = new Map<string, HTMLElement[]>()
  for (const element of container.querySelectorAll<HTMLElement>('[data-export-slot]')) {
    const id = element.getAttribute('data-export-slot') ?? ''
    const matches = elements.get(id) ?? []
    matches.push(element)
    elements.set(id, matches)
    element.removeAttribute('data-export-slot')
  }
  for (const slot of projection.slots) {
    const matches = elements.get(slot.id)
    if (matches?.length !== 1) continue
    const element = matches[0]
    if (!element) continue
    // TeX and diagram bodies are protected source, never provider-generated markup.
    const code = document.createElement('code')
    code.textContent = slot.source
    renderWidget(
      element,
      block(
        code.outerHTML,
        slot.kind === 'diagram' ? 'diagram' : slot.display ? 'math' : 'inlineMath',
        slot.source,
        slot.syntax,
      ),
      abort.signal,
      () => {},
      undefined,
      undefined,
      { bridge, documentId },
    )
  }
  container.addEventListener(
    'click',
    (event) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!link || !container.contains(link)) return
      event.preventDefault()
      const href = link.getAttribute('href') ?? ''
      if (navigate?.(href)) return
      if (href.startsWith('#')) {
        let id: string
        try {
          id = decodeURIComponent(href.slice(1))
        } catch {
          return
        }
        const candidates = [...container.querySelectorAll<HTMLElement>('[id]')]
        const target =
          candidates.find((element) => element.id === href.slice(1)) ??
          candidates.find((element) => element.id === id)
        target?.scrollIntoView({ block: 'start' })
        if (target) {
          target.tabIndex = -1
          target.focus({ preventScroll: true })
        }
      } else void bridge.openLink(href)
    },
    { signal: abort.signal },
  )
  return () => {
    abort.abort()
    container.replaceChildren()
  }
}
