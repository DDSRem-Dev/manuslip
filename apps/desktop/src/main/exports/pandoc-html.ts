import { rasterLimits, rasterSize } from '@manuslip/renderer/raster'
import type { BrowserWindow } from 'electron'
import { exportLimits } from '../../shared/export-contracts'
import { FileOperationError } from '../files/errors'

const paint = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
async function prepareImages(limits: {
  decoded: number
  asset: number
  assets: number
  side: number
  pixels: number
}): Promise<{ decoded: number; compressed: number; error?: string }> {
  let decoded = 0,
    compressed = 0
  const seen = new Set<string>()
  for (const image of document.querySelectorAll<HTMLImageElement>('#document img')) {
    decoded += image.naturalWidth * image.naturalHeight * 4
    if (!Number.isSafeInteger(decoded) || decoded > limits.decoded)
      return { decoded, compressed, error: 'export-limit' }
    if (/^data:image\/(gif|webp);base64,/.test(image.src)) {
      if (
        image.naturalWidth > limits.side ||
        image.naturalHeight > limits.side ||
        image.naturalWidth * image.naturalHeight > limits.pixels
      )
        return { decoded, compressed, error: 'export-image-limit' }
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) return { decoded, compressed, error: 'export-render' }
      context.drawImage(image, 0, 0)
      image.src = canvas.toDataURL('image/png')
      canvas.width = canvas.height = 0
      await image.decode()
    }
    if (!seen.has(image.src)) {
      const bytes = Math.ceil(((image.src.length - image.src.indexOf(',') - 1) * 3) / 4)
      if (bytes > limits.asset) return { decoded, compressed, error: 'export-limit' }
      compressed += bytes
      seen.add(image.src)
    }
    if (compressed > limits.assets) return { decoded, compressed, error: 'export-limit' }
  }
  return { decoded, compressed }
}
function measure(index: number): {
  x: number
  y: number
  width: number
  height: number
  scale: number
  viewportWidth: number
  viewportHeight: number
} {
  const element = document.querySelectorAll('[data-export-kind]')[index]?.querySelector('svg')
  if (!element) throw new Error('export-render')
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  const rect = element.getBoundingClientRect(),
    x = Math.floor(rect.x),
    y = Math.floor(rect.y)
  return {
    x,
    y,
    width: Math.ceil(rect.right) - x,
    height: Math.ceil(rect.bottom) - y,
    scale: devicePixelRatio,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
  }
}
function replace(index: number, data: string, width: number, height: number): void {
  const element = document.querySelectorAll('[data-export-kind]')[index]
  if (!element) throw new Error('export-render')
  const image = document.createElement('img')
  image.src = data
  image.alt = element.getAttribute('aria-label') || ''
  image.width = width
  image.height = height
  element.replaceChildren(image)
}
function serialize(): string {
  const article = document.querySelector('#document')?.cloneNode(true) as HTMLElement | undefined
  if (!article) throw new Error('export-render')
  for (const layout of article.querySelectorAll('.reading-side-by-side')) {
    const table = document.createElement('table'),
      body = document.createElement('tbody')
    const first = layout.querySelector('.reading-pair')
    if (first) {
      const head = table.createTHead(),
        row = head.insertRow()
      for (const column of first.children) {
        const cell = document.createElement('th')
        cell.scope = 'col'
        cell.textContent = column.getAttribute('aria-label') || ''
        row.append(cell)
      }
    }
    for (const pair of layout.querySelectorAll(':scope > .reading-pair')) {
      const row = body.insertRow()
      for (const column of [...pair.children]) {
        const cell = row.insertCell()
        cell.style.width = '50%'
        cell.append(column)
      }
    }
    table.append(body)
    layout.replaceWith(table)
  }
  for (const column of article.querySelectorAll('.reading-interlinear .reading-pair > div')) {
    const label = document.createElement('p'),
      strong = document.createElement('strong')
    strong.textContent = column.getAttribute('aria-label') || ''
    label.append(strong)
    column.prepend(label)
  }
  return article.innerHTML
}

/** Capture actual painted SVGs, including bundled fonts, before handing HTML to Pandoc. */
export async function preparePandocHtml(
  window: BrowserWindow,
  signal: AbortSignal,
): Promise<string> {
  const contents = window.webContents
  const alive = (): void => {
    signal.throwIfAborted()
    if (window.isDestroyed() || contents.isDestroyed())
      throw new FileOperationError('export-render')
  }
  alive()
  contents.setZoomFactor(1)
  const count: unknown = await contents.executeJavaScript(
    "document.querySelectorAll('[data-export-kind]').length",
  )
  if (
    typeof count !== 'number' ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > exportLimits.slots
  )
    throw new FileOperationError('export-limit')
  const budget: Awaited<ReturnType<typeof prepareImages>> = await contents.executeJavaScript(
    `(${prepareImages.toString()})(${JSON.stringify({ decoded: exportLimits.decoded, asset: exportLimits.asset, assets: exportLimits.assets, side: rasterLimits.side, pixels: rasterLimits.pixels })})`,
  )
  alive()
  if (budget.error)
    throw new FileOperationError(
      budget.error === 'export-image-limit'
        ? 'export-image-limit'
        : budget.error === 'export-limit'
          ? 'export-limit'
          : 'export-render',
    )
  if (
    !Number.isSafeInteger(budget.decoded) ||
    !Number.isSafeInteger(budget.compressed) ||
    budget.decoded < 0 ||
    budget.compressed < 0 ||
    budget.decoded > exportLimits.decoded ||
    budget.compressed > exportLimits.assets
  )
    throw new FileOperationError('export-limit')
  let { decoded, compressed } = budget
  for (let index = 0; index < count; index++) {
    alive()
    let rect: ReturnType<typeof measure> | undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      rect = await contents.executeJavaScript(`(${measure.toString()})(${index})`)
      alive()
      if (!rect) throw new FileOperationError('export-render')
      try {
        rasterSize(rect.width, rect.height, rect.scale)
      } catch {
        throw new FileOperationError('export-image-limit')
      }
      const width = Math.max(643, rect.width + 64),
        height = Math.max(1000, rect.height + 64)
      if (width > rasterLimits.side || height > rasterLimits.side)
        throw new FileOperationError('export-image-limit')
      if (
        rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.width <= rect.viewportWidth &&
        rect.y + rect.height <= rect.viewportHeight
      )
        break
      if (attempt === 2) throw new FileOperationError('export-image-limit')
      window.setContentSize(width, height)
      await contents.executeJavaScript(paint)
    }
    if (!rect) throw new FileOperationError('export-render')
    const planned = rasterSize(rect.width, rect.height, rect.scale)
    if (decoded + planned.pixelWidth * planned.pixelHeight * 4 > exportLimits.decoded)
      throw new FileOperationError('export-limit')
    await contents.executeJavaScript(paint)
    alive()
    const image = await contents.capturePage(
      { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      { stayHidden: true, stayAwake: true },
    )
    alive()
    if (image.isEmpty()) throw new FileOperationError('export-render')
    const size = image.getSize()
    let actual: ReturnType<typeof rasterSize>
    try {
      actual = rasterSize(size.width, size.height)
    } catch {
      throw new FileOperationError('export-image-limit')
    }
    decoded += actual.pixelWidth * actual.pixelHeight * 4
    if (decoded > exportLimits.decoded) throw new FileOperationError('export-limit')
    const bytes = image.toPNG()
    compressed += bytes.length
    if (
      bytes.length > exportLimits.asset ||
      compressed > exportLimits.assets ||
      (compressed * 4) / 3 > exportLimits.html
    )
      throw new FileOperationError('export-limit')
    await contents.executeJavaScript(
      `(${replace.toString()})(${index},${JSON.stringify(`data:image/png;base64,${bytes.toString('base64')}`)},${rect.width},${rect.height})`,
    )
  }
  alive()
  const html: unknown = await contents.executeJavaScript(`(${serialize.toString()})()`)
  alive()
  if (typeof html !== 'string' || Buffer.byteLength(html) > exportLimits.html)
    throw new FileOperationError('export-limit')
  return html
}
