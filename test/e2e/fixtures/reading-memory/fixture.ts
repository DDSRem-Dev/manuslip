import type { ReadingProjection } from '@manuslip/renderer/reading'
import { reserveWidgetBytes } from '../../../../apps/desktop/src/renderer/src/preview/widgets'
import type { ReadingOperation } from '../../../../apps/desktop/src/renderer/src/translation/protocol'
import { mountReading } from '../../../../apps/desktop/src/renderer/src/translation/surface'
import { ReadingViewport } from '../../../../apps/desktop/src/renderer/src/translation/viewport'
import { virtualReadings } from '../../../../apps/desktop/src/renderer/src/translation/virtual-reading'
import type { DesktopBridge } from '../../../../apps/desktop/src/shared/contracts'
import '../../../../apps/desktop/src/renderer/src/styles.css'

const scroller = document.createElement('section'),
  article = document.createElement('article')
scroller.className = 'reading-pane'
scroller.style.height = '100vh'
article.className = 'reading-article cm-live-rendered'
scroller.append(article)
document.body.append(scroller)
const viewport = new ReadingViewport(scroller, article)
const links: string[] = []
const bridge = {
  openLink: (url: string) => {
    links.push(url)
    return Promise.resolve({ ok: true, value: null })
  },
  loadLocalImage: () => Promise.resolve({ ok: false, error: 'image-read' }),
} as unknown as DesktopBridge
let unmount: (() => void) | undefined
let budget: (() => void) | undefined
const closed: (() => void)[] = [],
  observed: WeakRef<object>[] = []

let worker: Worker | undefined
let sequence = 0
const pending = new Map<
  number,
  {
    resolve(value: unknown): void
    reject(error: Error): void
    timer: ReturnType<typeof setTimeout>
  }
>()
const diagnostic = {
  show(projection: ReadingProjection) {
    viewport.capture()
    unmount?.()
    unmount = mountReading(article, projection, 'diagnostic', false, bridge)
    observed.length = 0
    observed.push(new WeakRef(projection))
    if (projection.indexed)
      observed.push(new WeakRef(projection.indexed), new WeakRef(projection.indexed.values))
    viewport.refresh()
    viewport.restore()
  },
  reveal(id: string) {
    return virtualReadings.get(article)?.reveal(id) ?? false
  },
  clearView() {
    unmount?.()
    if (unmount) closed.push(unmount)
    unmount = undefined
    viewport.reset()
  },
  reserve(bytes: number) {
    budget?.()
    budget = bytes ? reserveWidgetBytes(bytes) : undefined
  },
  collectedView() {
    return {
      observed: observed.length,
      alive: observed.filter((ref) => ref.deref()).length,
      closed: closed.length,
    }
  },
  view() {
    return {
      rows: article.querySelectorAll('[data-reading-row]').length,
      ids: [...article.querySelectorAll<HTMLElement>('[data-reading-block]')].map(
        (node) => node.dataset.readingBlock,
      ),
      text: article.textContent,
      links: [...links],
      scrollTop: scroller.scrollTop,
      registered: virtualReadings.has(article),
    }
  },
  start() {
    diagnostic.stop()
    worker = new Worker(
      new URL(
        '../../../../apps/desktop/src/renderer/src/translation/reading.worker.ts',
        import.meta.url,
      ),
      { type: 'module' },
    )
    worker.onmessage = ({ data }) => {
      const request = pending.get(data.sequence)
      if (!request) throw new Error('Unknown reading response')
      pending.delete(data.sequence)
      clearTimeout(request.timer)
      if (data.error) request.reject(new Error(data.error))
      else request.resolve(data.value)
    }
    worker.onerror = (event) => {
      for (const request of pending.values()) {
        clearTimeout(request.timer)
        request.reject(new Error(event.message))
      }
      pending.clear()
    }
  },
  stop() {
    worker?.terminate()
    worker = undefined
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('Reading worker terminated'))
    }
    pending.clear()
  },
  async request(operation: ReadingOperation) {
    if (!worker) throw new Error('Reading worker not started')
    const id = ++sequence
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('Reading diagnostic timed out'))
      }, 30000)
      pending.set(id, { resolve, reject, timer })
    })
    const payload = operation.kind === 'prepare-packed' ? operation.payload : undefined
    worker.postMessage({ sequence: id, operation }, payload ? [payload] : [])
    return { detached: payload ? payload.byteLength === 0 : null, value: await response }
  },
}

declare global {
  interface Window {
    readingMemory: typeof diagnostic
  }
}
window.readingMemory = diagnostic
