import { virtualReadings } from './virtual-reading'

interface Anchor {
  id: string
  offset: number
  order: readonly string[]
  index: number
}
/** One native scroller; observing height changes never sends scroll commands to another pane. */
export class ReadingViewport {
  private anchor: Anchor | null = null
  private atStart = true
  private scrollTop = 0
  private blocks: HTMLElement[] = []
  private byId = new Map<string, HTMLElement>()
  private order: string[] = []
  private readonly observer: ResizeObserver
  private readonly abort = new AbortController()
  constructor(
    private readonly scroller: HTMLElement,
    private readonly article: HTMLElement,
  ) {
    scroller.addEventListener('scroll', () => this.capture(), {
      signal: this.abort.signal,
      passive: true,
    })
    this.observer = new ResizeObserver(() => this.restore())
    this.observer.observe(article)
    this.observer.observe(scroller)
    scroller.addEventListener(
      'reading-rows',
      () => {
        this.refresh()
        this.scrollTop = -1
        this.capture()
      },
      { signal: this.abort.signal },
    )
    const controls = scroller.querySelector('.reading-controls')
    if (controls) this.observer.observe(controls)
  }
  capture(): void {
    // Layout changes can move blocks without the reader scrolling. Preserve that anchor.
    if (this.scroller.scrollTop === this.scrollTop) return
    this.scrollTop = this.scroller.scrollTop
    this.atStart = this.scroller.scrollTop <= 1
    const top = this.scroller.getBoundingClientRect().top
    let low = 0,
      high = this.blocks.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if ((this.blocks[middle]?.getBoundingClientRect().bottom ?? 0) <= top) low = middle + 1
      else high = middle
    }
    const block = this.blocks[low]
    if (!block) return
    this.anchor = {
      id: block.dataset.readingBlock ?? '',
      offset: top - block.getBoundingClientRect().top,
      order: this.order,
      index: this.order.indexOf(block.dataset.readingBlock ?? ''),
    }
  }
  refresh(): void {
    this.blocks = [...this.article.querySelectorAll<HTMLElement>('[data-reading-block]')]
    this.order = [
      ...(virtualReadings.get(this.article)?.order ??
        this.blocks.map((block) => block.dataset.readingBlock ?? '')),
    ]
    this.byId = new Map(this.blocks.map((block) => [block.dataset.readingBlock ?? '', block]))
  }
  restore(): void {
    if (this.atStart) {
      this.scroller.scrollTop = 0
      this.scrollTop = 0
      return
    }
    const anchor = this.anchor
    if (!anchor) return
    if (!this.byId.has(anchor.id) && virtualReadings.get(this.article)?.reveal(anchor.id))
      this.refresh()
    const exact = this.byId.get(anchor.id)
    let target = exact
    for (let index = anchor.index + 1; !target && index < anchor.order.length; index++)
      target = this.byId.get(anchor.order[index] ?? '')
    for (let index = anchor.index - 1; !target && index >= 0; index--)
      target = this.byId.get(anchor.order[index] ?? '')
    if (!target) return
    this.scroller.scrollTop +=
      target.getBoundingClientRect().top -
      this.scroller.getBoundingClientRect().top +
      (exact ? anchor.offset : 0)
    this.scrollTop = this.scroller.scrollTop
  }
  dispose(): void {
    this.anchor = null
    this.abort.abort()
    this.observer.disconnect()
  }
  reset(): void {
    this.anchor = null
    this.atStart = true
    this.refresh()
    this.restore()
  }
}
