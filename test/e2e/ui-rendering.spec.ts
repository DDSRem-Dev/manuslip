import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import axe from 'axe-core'
import { launchDesktop } from './helpers'

async function desktop(
  source: string,
  run: (page: Page, application: ElectronApplication) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-ui-rendering-'))
  const path = join(directory, 'rendering.md')
  await writeFile(path, source)
  const application = await launchDesktop(join(directory, 'profile'), [path])
  try {
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByRole('textbox', { name: 'Markdown source' })).toBeVisible()
    await run(page, application)
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

test('layer motion follows each opening action, interrupts cleanly and respects reduced motion', async () => {
  await desktop('Text', async (page) => {
    const preferences = page.getByRole('button', { name: 'Preferences', exact: true })
    const dialog = page.getByRole('dialog', { name: 'Preferences', exact: true })
    const closedDialog = page.locator('.preferences-dialog')
    await preferences.click()
    await expect(dialog).toHaveAttribute('data-input-method', 'pointer')
    expect(
      await dialog.evaluate((element) => getComputedStyle(element).transitionDuration),
    ).toContain('0.18s')
    await page.keyboard.press('Tab')
    // Typing inside an open panel must not change its transition halfway through.
    await expect(dialog).toHaveAttribute('data-input-method', 'pointer')
    await page.keyboard.press('Escape')
    await expect(closedDialog).toHaveAttribute('data-input-method', 'keyboard')
    await expect(closedDialog).toHaveJSProperty('inert', true)
    expect(await closedDialog.evaluate((element) => element.getAnimations().length)).toBe(0)

    await preferences.focus()
    await preferences.press('Enter')
    await expect(dialog).toHaveAttribute('data-input-method', 'keyboard')
    expect(await dialog.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe(
      '0s',
    )
    await dialog
      .getByRole('button', { name: 'Close preferences', exact: true })
      .evaluate((element) => {
        element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        ;(element as HTMLButtonElement).click()
      })
    await expect(closedDialog).toHaveJSProperty('inert', true)
    // Reopen while the pointer exit is still running.
    await preferences.evaluate((element) => (element as HTMLButtonElement).click())
    await expect(dialog).toHaveJSProperty('inert', false)
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')

    const edit = page.getByRole('button', { name: 'Edit', exact: true })
    const popover = page.locator('.toolbar-popover[aria-label="Edit"]')
    await edit.focus()
    await edit.press('Enter')
    await expect(popover).toHaveAttribute('data-input-method', 'keyboard')
    await expect(popover).toHaveJSProperty('inert', false)
    await page.keyboard.press('Escape')
    await expect(popover).toHaveJSProperty('inert', true)

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await preferences.click()
    expect(
      await dialog.evaluate((element) => ({
        transform: getComputedStyle(element).transform,
        duration: getComputedStyle(element).transitionDuration,
        opacity: getComputedStyle(element).opacity,
      })),
    ).toEqual({ transform: 'none', duration: '0s, 0s, 0s, 0s', opacity: '1' })
    await page.keyboard.press('Escape')
  })
})

test('rendered formulas, images, scripts and nested tables keep their proportions at narrow widths', async () => {
  const wide = Array.from({ length: 35 }, (_, index) => `x_{${index}}`).join('+')
  const table = `> | ${'Column | '.repeat(10)}\n> | ${'--- | '.repeat(10)}\n> | ${'Value | '.repeat(10)}`
  const source = `# Rendering\n\nH~2~O and x^2^ :smile:.\n\n![Image](picture.png)\n\n$$\n${wide}\n$$\n\n${table}\n\nEnd`
  await desktop(source, async (page, application) => {
    // A generated non-square raster makes aspect-ratio checks meaningful.
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 800
      canvas.height = 200
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Missing canvas')
      context.fillStyle = '#464c43'
      context.fillRect(0, 0, 800, 200)
      return canvas.toDataURL('image/png')
    })
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await editor.fill(source.replace('picture.png', png))
    await editor.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    const math = page.locator('[data-render-kind="math"][role="math"]')
    await expect(math.locator('svg')).toBeAttached()
    const image = page.getByRole('img', { name: 'Image', exact: true })
    await expect(image).toHaveAttribute('data-render-state', 'ready')
    await expect(page.locator('.cm-live-inline-widget[data-kind="subscript"]')).toHaveCSS(
      'display',
      'inline',
    )
    await expect(page.locator('.cm-live-inline-widget[data-kind="superscript"]')).toHaveCSS(
      'vertical-align',
      'baseline',
    )
    await expect(page.locator('.render-table-scroll table')).toBeAttached()

    for (const width of [1100, 480, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true)
      await expect
        .poll(() =>
          image.evaluate((element) => {
            const bounds = element.getBoundingClientRect()
            return Math.abs(bounds.width / bounds.height - 4) < 0.02
          }),
        )
        .toBe(true)
      const formula = await math.locator('svg').evaluate((element) => {
        const svg = element as SVGSVGElement
        const bounds = svg.getBoundingClientRect(),
          box = svg.viewBox.baseVal
        return {
          ratio: bounds.width / bounds.height,
          expected: box.width / box.height,
          scrolls: Boolean(
            svg.parentElement && svg.parentElement.scrollWidth > svg.parentElement.clientWidth,
          ),
        }
      })
      expect(formula.ratio / formula.expected).toBeCloseTo(1, 2)
      expect(formula.scrolls).toBe(true)
      const table = page.locator('.render-table-scroll')
      expect(
        await table.evaluate((element) => element.getBoundingClientRect().width <= innerWidth),
      ).toBe(true)
      if (width <= 480)
        expect(await table.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
          true,
        )
      expect(
        await table
          .locator('th')
          .first()
          .evaluate((element) => {
            const style = getComputedStyle(element)
            return (
              element.getBoundingClientRect().height < Number.parseFloat(style.lineHeight) * 2 + 12
            )
          }),
      ).toBe(true)
      await page.screenshot({ path: test.info().outputPath(`rendering-${width}.png`) })
    }
    await page.emulateMedia({ colorScheme: 'dark' })
    await math.focus()
    await math.press('ArrowRight')
    await expect.poll(() => math.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
    await page.evaluate(axe.source)
    const violations = await page.evaluate(async () => {
      const checker = (window as unknown as { axe: typeof import('axe-core') }).axe
      return (
        await checker.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
        })
      ).violations
    })
    expect(violations).toEqual([])
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(2),
    )
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true)
  })
})

test('failed math renders a readable fallback and one retry returns to the loading state', async () => {
  await desktop('Before\n\n$\\invalidcommand{broken}$\n\nEnd', async (page) => {
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await editor.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    const math = page.locator('[data-render-kind="inlineMath"]')
    await expect(math).toHaveAttribute('data-render-state', 'error')
    await expect(math).not.toHaveAttribute('aria-busy')
    await expect(math).toContainText('\\invalidcommand{broken}')
    const retry = math.getByRole('button', { name: 'Try again', exact: true })
    await expect(retry).toBeEnabled()
    await retry.click()
    await expect(math).toHaveAttribute('data-render-state', 'error')
    await expect(math.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(1)
    await expect(math).not.toHaveAttribute('aria-busy')
  })
})
