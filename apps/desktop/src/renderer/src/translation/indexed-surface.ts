import {
  type ReadingProjection,
  readingIndexWrapper,
  readingProjectionBytes,
} from '@manuslip/renderer/reading'
import { createSanitizer } from '@manuslip/renderer/sanitize'
import { reserveWidgetBytes } from '../preview/widgets'
import { virtualReadings } from './virtual-reading'

interface Id {
  side: number
  value: string
}
type MountRow = (
  element: HTMLElement,
  projection: ReadingProjection,
  scope: (element: HTMLElement) => void,
  navigate: (href: string) => boolean,
) => () => void
/** A window of whole semantic pairs. Estimated offscreen heights are replaced by measured
 * row heights; navigation uses identities and never proportional document/line offsets.
 */
export function mountIndexedReading(
  container: HTMLElement,
  projection: ReadingProjection,
  mount: MountRow,
): () => void {
  const candidate = projection.indexed
  if (!candidate || readingProjectionBytes(projection) > 8 * 1024 * 1024)
    throw new Error('translation-view-limit')
  let index: NonNullable<ReadingProjection['indexed']> = candidate
  const scroller = container.closest<HTMLElement>('.reading-pane')
  if (!scroller) throw new Error('Missing reading scroller')
  const abort = new AbortController(),
    releases: (() => void)[] = []
  const active = new Map<number, { element: HTMLElement; dispose(): void }>()
  let frame = 0,
    stopped = false
  const release = () => {
    if (stopped) return
    stopped = true
    abort.abort(null)
    cancelAnimationFrame(frame)
    observer?.disconnect()
    observer = undefined
    virtualReadings.delete(container)
    for (const row of active.values()) row.dispose()
    active.clear()
    container.replaceChildren()
    for (const free of releases.reverse()) free()
    releases.length = 0
    index = { values: [], order: [], anchors: [], pairs: [] }
    projection = { html: '', slots: [] }
  }
  let observer: ResizeObserver | undefined
  try {
    releases.push(
      reserveWidgetBytes(
        73728 +
          index.order.length * 384 +
          (projection.blocks?.length ?? 0) * 128 +
          index.values.length * 128,
      ),
    )
    const sanitizer = createSanitizer(window)
    const identifiers: Id[][] = [],
      slots: ReadingProjection['slots'][] = []
    // Sanitize each unique value before indexing IDs. These fragments expire immediately;
    // only bounded string metadata survives. No image/math/diagram work starts here.
    for (const value of index.values) {
      const free = reserveWidgetBytes(value.length * 4)
      try {
        const fragment = sanitizer.markdown(value, true)
        const ids: Id[] = []
        for (const [side, name] of ['original', 'translation'].entries())
          for (const cell of fragment.querySelectorAll<HTMLElement>(`.reading-${name}`)) {
            if (cell.parentElement?.closest('.reading-original, .reading-translation')) continue
            for (const element of cell.querySelectorAll<HTMLElement>('[id]')) {
              releases.push(reserveWidgetBytes(256 + element.id.length * 4))
              ids.push({ side, value: element.id })
            }
          }
        identifiers.push(ids)
        const names = new Set(
          [...fragment.querySelectorAll('[data-export-slot]')].map((element) =>
            element.getAttribute('data-export-slot'),
          ),
        )
        const selected = projection.slots.filter((slot) => names.has(slot.id))
        releases.push(reserveWidgetBytes(64 + selected.length * 16))
        slots.push(selected)
      } finally {
        free()
      }
    }
    const prefixes = [0, 1].map(() => `reading-${crypto.randomUUID()}-`)
    const targets = new Map<string, number>()
    for (let row = 0; row < index.order.length; row++)
      for (const id of identifiers[index.order[row] ?? -1] ?? []) {
        const key = prefixes[id.side] + id.value
        if (!targets.has(key)) {
          releases.push(reserveWidgetBytes(192 + key.length * 2))
          targets.set(key, row)
        }
      }
    const scope = (host: HTMLElement) => {
      for (const [side, name] of ['original', 'translation'].entries())
        for (const cell of host.querySelectorAll<HTMLElement>(`.reading-${name}`)) {
          if (cell.parentElement?.closest('.reading-original, .reading-translation')) continue
          const prefix = prefixes[side] ?? ''
          for (const element of cell.querySelectorAll<HTMLElement>('[id]'))
            element.id = prefix + element.id
          for (const element of cell.querySelectorAll<HTMLElement>(
            '[href], [aria-describedby], [aria-labelledby]',
          )) {
            const href = element.getAttribute('href')
            if (href?.startsWith('#'))
              try {
                const literal = prefix + href.slice(1)
                const scoped = targets.has(literal)
                  ? literal
                  : prefix + decodeURIComponent(href.slice(1))
                if (targets.has(scoped)) element.setAttribute('href', `#${scoped}`)
              } catch {}
            for (const attribute of ['aria-describedby', 'aria-labelledby']) {
              const value = element.getAttribute(attribute)
              if (value)
                element.setAttribute(
                  attribute,
                  value
                    .split(/\s+/)
                    .map((id) => (targets.has(prefix + id) ? prefix + id : id))
                    .join(' '),
                )
            }
          }
        }
    }
    const count = index.order.length,
      heights = new Float64Array(count),
      offsets = new Float64Array(count + 1)
    // Initial estimates affect scrollbar geometry only; anchors and jumps use exact IDs.
    for (let row = 0; row < count; row++) heights[row] = 120
    const sum = () => {
      for (let row = 0; row < count; row++)
        offsets[row + 1] = (offsets[row] ?? 0) + (heights[row] ?? 0)
    }
    sum()
    const root = document.createElement('div'),
      before = document.createElement('div'),
      after = document.createElement('div')
    root.className = readingIndexWrapper(projection)
    for (const spacer of [before, after]) {
      spacer.setAttribute('aria-hidden', 'true')
      spacer.style.pointerEvents = 'none'
    }
    root.append(before, after)
    container.replaceChildren(root)
    const position = () =>
      Math.max(0, scroller.getBoundingClientRect().top - root.getBoundingClientRect().top)
    const locate = (top: number) => {
      let low = 0,
        high = count
      while (low < high) {
        const mid = (low + high) >>> 1
        if ((offsets[mid + 1] ?? 0) <= top) low = mid + 1
        else high = mid
      }
      return Math.min(low, Math.max(0, count - 1))
    }
    let forced: number | undefined,
      initial = true
    const navigate = (href: string) => {
      if (!href.startsWith('#')) return false
      let id: string
      try {
        id = targets.has(href.slice(1)) ? href.slice(1) : decodeURIComponent(href.slice(1))
      } catch {
        return false
      }
      const row = targets.get(id)
      if (row === undefined) return false
      reveal(row)
      const target = [
        ...(active.get(row)?.element.querySelectorAll<HTMLElement>('[id]') ?? []),
      ].find((element) => element.id === id)
      if (target) {
        target.scrollIntoView({ block: 'start' })
        target.tabIndex = -1
        target.focus({ preventScroll: true })
      }
      return true
    }
    const schedule = () => {
      if (!frame && !stopped)
        frame = requestAnimationFrame(() => {
          frame = 0
          render()
        })
    }
    const render = () => {
      if (stopped) return
      const current = forced ?? locate(position()),
        start = Math.max(0, current - 3)
      let end = Math.min(count, current + 4)
      while (
        end < count &&
        end - start < 64 &&
        (offsets[end] ?? 0) < position() + scroller.clientHeight * 2
      )
        end++
      forced = undefined
      for (const [row, mounted] of active)
        if (row < start || row >= end) {
          if (mounted.element.contains(document.activeElement))
            container.focus({ preventScroll: true })
          observer?.unobserve(mounted.element)
          mounted.dispose()
          mounted.element.remove()
          active.delete(row)
        }
      for (let row = start; row < end; row++)
        if (!active.has(row)) {
          const value = index.order[row] ?? -1,
            html = index.values[value]
          if (html === undefined) throw new Error('Invalid reading row')
          const element = document.createElement('div')
          element.className = index.pairs[row] ? 'reading-pair' : 'reading-row'
          const dispose = mount(
            element,
            { html, slots: slots[value] ?? [], blocks: [] },
            scope,
            navigate,
          )
          const anchor = projection.blocks?.[index.anchors[row] ?? -1]
          if (anchor) element.dataset.readingBlock = anchor.id
          element.dataset.readingRow = String(row)
          active.set(row, { element, dispose })
          observer?.observe(element)
        }
      const ordered = [...active].sort(([a], [b]) => a - b)
      let next: ChildNode = after
      for (const [, row] of ordered.reverse()) {
        if (row.element.nextSibling !== next) root.insertBefore(row.element, next)
        next = row.element
      }
      before.style.height = `${offsets[start] ?? 0}px`
      after.style.height = `${(offsets[count] ?? 0) - (offsets[end] ?? 0)}px`
      const anchor = locate(position()),
        old = offsets[anchor] ?? 0
      let changed = false
      for (const [row, mounted] of active) {
        const height = mounted.element.getBoundingClientRect().height
        if (Math.abs(height - (heights[row] ?? 0)) > 0.5) {
          heights[row] = height
          changed = true
        }
      }
      if (changed) {
        sum()
        scroller.scrollTop += (offsets[anchor] ?? 0) - old
        before.style.height = `${offsets[start] ?? 0}px`
        after.style.height = `${(offsets[count] ?? 0) - (offsets[end] ?? 0)}px`
        schedule()
      }
      if (!initial) scroller.dispatchEvent(new Event('reading-rows'))
      initial = false
    }
    const reveal = (row: number) => {
      forced = row
      scroller.scrollTop += (offsets[row] ?? 0) - position()
      render()
    }
    const byId = new Map(
      (projection.blocks ?? []).map((block, blockIndex) => [block.id, blockIndex]),
    )
    const rows = new Map(index.anchors.map((block, row) => [block, row]))
    virtualReadings.set(container, {
      order: (projection.blocks ?? []).map((block) => block.id),
      reveal(id) {
        const block = byId.get(id),
          row = block === undefined ? undefined : rows.get(block)
        if (row === undefined) return false
        reveal(row)
        return true
      },
    })
    observer = new ResizeObserver(schedule)
    observer.observe(scroller)
    scroller.addEventListener('scroll', schedule, { passive: true, signal: abort.signal })
    root.addEventListener(
      'focusin',
      (event) => {
        const row =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>('[data-reading-row]')
            : null
        if (row) {
          forced = Number(row.dataset.readingRow)
          schedule()
        }
      },
      { signal: abort.signal },
    )
    render()
    return release
  } catch (error) {
    release()
    throw error
  }
}
