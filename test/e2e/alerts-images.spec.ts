import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import axe from 'axe-core'
import { clickDocumentAction, contrast, launchDesktop, openMarkdownExtensions } from './helpers'

async function openArtifact(application: ElectronApplication, path: string): Promise<Page> {
  const opened = application.waitForEvent('window')
  await application.evaluate(async ({ BrowserWindow }, path) => {
    const artifact = new BrowserWindow({
      show: true,
      width: 1100,
      height: 1100,
      webPreferences: {
        partition: 'alerts-images-artifact',
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })
    artifact.webContents.session.enableNetworkEmulation({ offline: true })
    await artifact.loadFile(path)
  }, path)
  return opened
}

async function fixture(
  theme: 'light' | 'dark',
  source: string,
  run: (page: Page, application: ElectronApplication, directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(resolve('test/artifacts/logs/alerts-images-'))
  const profile = join(directory, 'profile')
  await mkdir(profile)
  await writeFile(
    join(profile, 'preferences.json'),
    JSON.stringify({
      schemaVersion: 1,
      theme,
      locale: 'en',
      markdown: { opt: true, latex: true, mermaid: true, github: true, typora: true },
    }),
  )
  const path = join(directory, 'Document.md')
  await writeFile(path, source)
  const application = await launchDesktop(profile)
  try {
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const png = await application.evaluate(({ nativeImage }) => {
      const pixels = Buffer.alloc(800 * 200 * 4)
      for (let index = 0; index < pixels.length; index += 4)
        pixels.set(
          Math.floor(index / 4 / 800) < 100 ? [178, 193, 170, 255] : [219, 224, 210, 255],
          index,
        )
      const image = nativeImage.createFromBitmap(pixels, { width: 800, height: 200 })
      return {
        normal: image.toPNG().toString('base64'),
        small: image.resize({ width: 80 }).toPNG().toString('base64'),
      }
    })
    await mkdir(join(directory, 'assets'))
    await writeFile(join(directory, 'assets', 'picture.png'), Buffer.from(png.normal, 'base64'))
    await writeFile(join(directory, 'assets', 'small.png'), Buffer.from(png.small, 'base64'))
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, path)
    await page.getByRole('button', { name: 'Open file…', exact: true }).first().click()
    await expect(page.getByRole('textbox', { name: 'Markdown source' })).toBeVisible()
    await run(page, application, directory)
    expect(await readFile(path, 'utf8')).toBe(source)
    expect(errors).toEqual([])
  } finally {
    await application
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy()
      })
      .catch(() => {})
    await application.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

for (const theme of ['light', 'dark'] as const) {
  test(`all five alert icons render with readable titles and bodies in ${theme}`, async () => {
    const types = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']
    const source = types
      .map(
        (type) =>
          `> [!${type}]\n> **${type}** supports [links](https://example.invalid/guide) and inline ` +
          '`code`.',
      )
      .join('\n\n')
    await fixture(theme, source, async (page, application, directory) => {
      await page.setViewportSize({ width: 1100, height: 1100 })
      for (const type of types) {
        const alert = page.locator(`.markdown-alert-${type.toLowerCase()}`)
        const icon = alert.locator('.markdown-icon')
        await expect(icon).toBeVisible()
        await expect(icon).toHaveAttribute('aria-hidden', 'true')
        await expect(alert.locator('.markdown-alert-title')).toHaveText(
          type[0] + type.slice(1).toLowerCase(),
        )
        const colors = await alert.evaluate((element) => {
          // color-mix serializes as color(srgb ...); sample it before calculating WCAG luminance.
          const context = new OffscreenCanvas(1, 1).getContext('2d')
          if (!context) throw new Error('Missing color sampler')
          context.fillStyle = getComputedStyle(element).backgroundColor
          context.fillRect(0, 0, 1, 1)
          const color = context.getImageData(0, 0, 1, 1).data
          return {
            foreground: getComputedStyle(element.querySelector('.markdown-alert-title') as Element)
              .color,
            background: `rgb(${color[0]}, ${color[1]}, ${color[2]})`,
          }
        })
        expect(contrast(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5)
        expect(await icon.evaluate((element) => getComputedStyle(element).maskImage)).toContain(
          'data:image/svg+xml',
        )
      }
      await page.evaluate(axe.source)
      expect(
        await page.evaluate(
          async () =>
            (await (window as unknown as { axe: typeof import('axe-core') }).axe.run()).violations,
        ),
      ).toEqual([])
      await page.screenshot({ path: test.info().outputPath(`alerts-${theme}.png`) })
      await page.setViewportSize({ width: 400, height: 1100 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({ path: test.info().outputPath(`alerts-${theme}-narrow.png`) })
      await page.emulateMedia({ forcedColors: 'active' })
      await expect(page.locator('.markdown-icon').first()).toBeVisible()
      await page.screenshot({ path: test.info().outputPath(`alerts-${theme}-contrast.png`) })
      await page.emulateMedia({ forcedColors: 'none' })
      const target = join(directory, 'alerts.html')
      await application.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      }, target)
      await clickDocumentAction(page, 'Export HTML…')
      await expect
        .poll(() => readFile(target, 'utf8').catch(() => ''))
        .toContain('markdown-icon-note')
      const html = await readFile(target, 'utf8')
      expect(html).toContain('data:image/svg+xml')
      for (const type of types) expect(html).toContain(`markdown-icon-${type.toLowerCase()}`)
      const artifact = await openArtifact(application, target)
      for (const type of types) {
        const icon = artifact.locator(`.markdown-icon-${type.toLowerCase()}`)
        await expect(icon).toBeVisible()
        expect(await icon.evaluate((element) => getComputedStyle(element).maskImage)).toContain(
          'data:image/svg+xml',
        )
      }
      await artifact.screenshot({ path: test.info().outputPath(`alerts-${theme}-export.png`) })
      await artifact.close()
    })
  })

  test(`images preserve natural proportions and Typora sizing in ${theme} preview and export`, async () => {
    const source =
      '# Images\n\n![Natural](assets/picture.png)\n\n<img src="assets/picture.png" alt="Sized" width="240" height="60">\n\n<img src="assets/picture.png" alt="Zoom" style="zoom:50%;">\n\n<img src="assets/picture.png" alt="Styled" style="width:320px;height:auto;background-image:url(https://example.invalid/track);position:fixed;" onload="window.compromised=true">\n\n<img src="assets/small.png" alt="Percent" style="width:50%;height:auto">\n\nEnd'
    await fixture(theme, source, async (page, application, directory) => {
      const requests: string[] = []
      page.on('request', (request) => {
        if (/^https?:/.test(request.url())) requests.push(request.url())
      })
      await page.setViewportSize({ width: 1100, height: 1400 })
      const extensions = await openMarkdownExtensions(page)
      await extensions.getByRole('checkbox', { name: 'Render sanitized HTML', exact: true }).check()
      await page.keyboard.press('Escape')
      for (const [name, width] of [
        ['Sized', 240],
        ['Zoom', 400],
        ['Styled', 320],
      ] as const) {
        const image = page.getByRole('img', { name, exact: true })
        await expect(image).toHaveAttribute('data-render-state', 'ready')
        await expect
          .poll(() =>
            image.evaluate((element) => Math.round(element.getBoundingClientRect().width)),
          )
          .toBe(width)
      }
      await expect
        .poll(() =>
          page.getByRole('img', { name: 'Percent', exact: true }).evaluate((image) => {
            const host = image.closest('.cm-live-rendered')
            return host ? image.getBoundingClientRect().width / host.clientWidth : 0
          }),
        )
        .toBeCloseTo(0.5, 2)
      await expect(
        page.locator('img[onload], [style*="position:fixed"], [style*="background-image"]'),
      ).toHaveCount(0)
      expect(requests).toEqual([])
      await page.screenshot({ path: test.info().outputPath(`images-${theme}.png`) })
      for (const width of [480, 320]) {
        await page.setViewportSize({ width, height: 1400 })
        for (const name of ['Natural', 'Sized', 'Zoom', 'Styled', 'Percent']) {
          const image = page.getByRole('img', { name, exact: true })
          await expect
            .poll(() =>
              image.evaluate((element) => {
                const bounds = element.getBoundingClientRect()
                return (
                  bounds.width <= innerWidth && Math.abs(bounds.width / bounds.height - 4) < 0.02
                )
              }),
            )
            .toBe(true)
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
      }
      await page.screenshot({ path: test.info().outputPath(`images-${theme}-narrow.png`) })
      const target = join(directory, 'images.html')
      await application.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      }, target)
      await clickDocumentAction(page, 'Export HTML…')
      await expect(page.getByText(`Exported to ${target}`, { exact: true })).toBeVisible()
      const html = await readFile(target, 'utf8')
      expect(html).toContain('width="240"')
      expect(html).toContain('zoom: 0.5')
      expect(html).toContain('width: 320px')
      expect(html).not.toContain('onload=')
      expect(html).not.toContain('example.invalid/track')
      const artifact = await openArtifact(application, target)
      for (const [name, width] of [
        ['Natural', 800],
        ['Sized', 240],
        ['Zoom', 400],
        ['Styled', 320],
      ] as const) {
        const image = artifact.getByRole('img', { name, exact: true })
        await expect
          .poll(() =>
            image.evaluate((element) => ({
              loaded: element instanceof HTMLImageElement && element.naturalWidth === 800,
              width: Math.round(element.getBoundingClientRect().width),
            })),
          )
          .toEqual({ loaded: true, width })
      }
      await expect
        .poll(() =>
          artifact.getByRole('img', { name: 'Percent', exact: true }).evaluate((image) => {
            const host = image.closest('article')
            if (!host) return 0
            const style = getComputedStyle(host)
            const width =
              host.clientWidth -
              Number.parseFloat(style.paddingLeft) -
              Number.parseFloat(style.paddingRight)
            return image.getBoundingClientRect().width / width
          }),
        )
        .toBeCloseTo(0.5, 2)
      await artifact.screenshot({ path: test.info().outputPath(`images-${theme}-export.png`) })
      await artifact.setViewportSize({ width: 320, height: 1100 })
      for (const image of await artifact.getByRole('img').all())
        expect(
          await image.evaluate((element) => {
            const bounds = element.getBoundingClientRect()
            return bounds.width <= innerWidth && Math.abs(bounds.width / bounds.height - 4) < 0.02
          }),
        ).toBe(true)
      expect(
        await artifact.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true)
      await artifact.close()
    })
  })
}
