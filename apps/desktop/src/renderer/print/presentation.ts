import { type SlideBoundary, slideGroups } from '@manuslip/renderer/slides'

function boundary(node: ChildNode): SlideBoundary {
  if (node.nodeType === 3) return node.textContent?.trim() ? 'content' : 'blank'
  if (node.nodeType !== 1) return 'blank'
  let element = node as HTMLElement
  if (element.classList.contains('reading-pair')) {
    const original = element.querySelector<HTMLElement>(':scope > .reading-original')
    if (original) element = original
  }
  if (
    element.classList.contains('reading-original') ||
    element.classList.contains('reading-translation')
  ) {
    if (element.children.length !== 1) return 'content'
    element = element.firstElementChild as HTMLElement
  }
  return element.tagName === 'HR' ? 'break' : element.tagName === 'H1' ? 'heading' : 'content'
}

/** Move prepared DOM nodes without copying reference IDs or splitting bilingual pairs. */
export function presentDocument(
  article: HTMLElement,
  locale: 'en' | 'zh-CN',
  reading: boolean,
): void {
  const owner = article.ownerDocument
  article.setAttribute('role', 'main')
  article.setAttribute('aria-label', locale === 'zh-CN' ? '文档幻灯片' : 'Document slides')
  article.tabIndex = 0
  const wrapper = reading
    ? article.querySelector<HTMLElement>(':scope > .reading-layout, :scope > .reading-replace')
    : null
  const groups = slideGroups([...(wrapper ?? article).childNodes], boundary)
  const before: ChildNode[] = [],
    after: ChildNode[] = []
  if (wrapper) {
    let seen = false
    for (const node of article.childNodes) {
      if (node === wrapper) {
        seen = true
        continue
      }
      ;(seen ? after : before).push(node)
    }
  }
  const slides = groups.map((nodes, index) => {
    const slide = owner.createElement('section')
    slide.className = 'presentation-slide'
    slide.setAttribute('role', 'region')
    slide.setAttribute('aria-roledescription', locale === 'zh-CN' ? '幻灯片' : 'slide')
    slide.setAttribute('aria-label', `${index + 1} / ${groups.length}`)
    slide.tabIndex = -1
    if (index === 0) slide.append(...before)
    if (wrapper) {
      const copy = wrapper.cloneNode(false) as HTMLElement
      copy.removeAttribute('id')
      copy.append(...nodes)
      slide.append(copy)
    } else slide.append(...nodes)
    if (index === groups.length - 1) slide.append(...after)
    return slide
  })
  article.replaceChildren(...slides)
  owner.body.classList.add('presentation')
  const controls = owner.createElement('nav')
  controls.id = 'presentation-controls'
  controls.setAttribute('aria-label', locale === 'zh-CN' ? '演示控制' : 'Presentation controls')
  const button = (text: string, label: string): HTMLButtonElement => {
    const element = owner.createElement('button')
    element.type = 'button'
    element.textContent = text
    element.setAttribute('aria-label', label)
    return element
  }
  const previous = button(
    locale === 'zh-CN' ? '上一张' : 'Previous',
    locale === 'zh-CN' ? '上一张幻灯片' : 'Previous slide',
  )
  const next = button(
    locale === 'zh-CN' ? '下一张' : 'Next',
    locale === 'zh-CN' ? '下一张幻灯片' : 'Next slide',
  )
  const exit = button(
    locale === 'zh-CN' ? '退出演示' : 'Exit presentation',
    locale === 'zh-CN' ? '退出演示' : 'Exit presentation',
  )
  const counter = owner.createElement('span')
  counter.setAttribute('role', 'status')
  counter.setAttribute('aria-live', 'polite')
  counter.setAttribute('aria-atomic', 'true')
  const hint = owner.createElement('span')
  hint.className = 'presentation-keys'
  hint.textContent = locale === 'zh-CN' ? '← → 翻页 · Esc 退出' : '← → Navigate · Esc Exit'
  controls.append(previous, counter, next, hint, exit)
  owner.body.append(controls)
  let current = 0
  const show = (index: number): void => {
    current = Math.max(0, Math.min(slides.length - 1, index))
    slides.forEach((slide, at) => {
      slide.hidden = at !== current
    })
    previous.disabled = current === 0
    next.disabled = current === slides.length - 1
    counter.textContent = `${current + 1} / ${slides.length}`
    article.scrollTop = 0
    if (owner.activeElement === next && next.disabled)
      previous.disabled ? exit.focus() : previous.focus()
    if (owner.activeElement === previous && previous.disabled)
      next.disabled ? exit.focus() : next.focus()
  }
  previous.addEventListener('click', () => show(current - 1))
  next.addEventListener('click', () => show(current + 1))
  exit.addEventListener('click', () => owner.defaultView?.close())
  owner.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      owner.defaultView?.close()
      return
    }
    if (event.key === ' ' && (event.target as HTMLElement)?.closest('button,a')) return
    const delta = ['ArrowRight', 'PageDown', ' '].includes(event.key)
      ? 1
      : ['ArrowLeft', 'PageUp'].includes(event.key)
        ? -1
        : 0
    if (delta || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      show(event.key === 'Home' ? 0 : event.key === 'End' ? slides.length - 1 : current + delta)
    }
  })
  article.addEventListener('click', (event) => {
    const anchor = (event.target as HTMLElement)?.closest<HTMLAnchorElement>('a[href^="#"]')
    if (!anchor) return
    let id: string
    try {
      id = decodeURIComponent(anchor.hash.slice(1))
    } catch {
      return
    }
    const target = owner.getElementById(id)
    const slide = target?.closest<HTMLElement>('.presentation-slide')
    const index = slide ? slides.indexOf(slide) : -1
    if (index < 0) return
    event.preventDefault()
    show(index)
    target?.scrollIntoView({ block: 'center' })
    slide?.focus({ preventScroll: true })
  })
  show(0)
  slides[0]?.focus({ preventScroll: true })
}
