import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, type Locator, test } from '@playwright/test'
import axe from 'axe-core'
import { launchDesktop } from './helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const source =
  '# Inline equations\n\nBefore $x_i^2$ after, with $y$ nearby.\nFollowing source line.\n\nA longer introduction with 中文 and several words before $a+b$ in a wrapping paragraph.\n\n$$\nz^2\n$$\n\nEnd.\n'

async function expectAligned(raw: Locator, preview: Locator): Promise<void> {
  await expect
    .poll(async () => {
      const start = await raw.first().evaluate((element) => {
        const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()
        if (!text) throw new Error('Missing formula source')
        const range = document.createRange()
        range.setStart(text, 0)
        range.setEnd(text, 1)
        return range.getBoundingClientRect().left
      })
      const formula = await preview.getByRole('math').boundingBox()
      return formula ? Math.abs(start - formula.x) : Infinity
    })
    .toBeLessThan(0.75)
}

for (const theme of ['light', 'dark']) {
  test(`${theme} editing inline math keeps a preview directly below its source line`, async () => {
    const directory = await mkdtemp(resolve('test/e2e/result/inline-math-preview-'))
    const profile = join(directory, 'profile')
    const path = join(directory, 'equations.md')
    await mkdir(profile)
    await writeFile(
      join(profile, 'preferences.json'),
      JSON.stringify({ schemaVersion: 1, locale: 'en', theme }),
    )
    await writeFile(path, source)
    const application = await launchDesktop(profile, [path])
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await page.setViewportSize({ width: 1144, height: 1000 })
      const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
      const preview = editor.locator('.cm-live-inlineMath.cm-live-edit-preview')
      const raw = editor.locator('.cm-live-inline-math-source')
      const line = editor.locator('.cm-line').filter({ hasText: /^Before / })
      const next = editor.locator('.cm-line').filter({ hasText: 'Following source line.' })
      const display = editor.locator('.cm-live-math')
      await expect(editor.getByRole('math', { name: 'x_i^2', exact: true })).toBeVisible()
      await expect(display.getByRole('math', { name: 'z^2', exact: true })).toBeVisible()
      await expect(preview).toHaveCount(0)

      await editor.getByRole('math', { name: 'x_i^2', exact: true }).click()
      await expect(line).toContainText('$x_i^2$')
      await expect(preview.getByRole('math', { name: 'x_i^2', exact: true })).toBeVisible()
      await expect(editor.getByRole('math', { name: 'y', exact: true })).toBeVisible()
      await expect(editor).toBeFocused()
      expect(await page.evaluate(() => getSelection()?.toString())).toBe('')
      await expect(raw).toHaveText('$x_i^2$')
      const sourceStyle = await raw.evaluate((element) => {
        const style = getComputedStyle(element)
        return { background: style.backgroundColor, font: style.fontFamily, size: style.fontSize }
      })
      expect(sourceStyle.background).not.toBe('rgba(0, 0, 0, 0)')
      await expectAligned(raw, preview)
      const positions = await Promise.all([
        line.boundingBox(),
        preview.boundingBox(),
        next.boundingBox(),
      ])
      expect(positions.every(Boolean)).toBe(true)
      const [sourceBox, previewBox, nextBox] = positions
      if (!sourceBox || !previewBox || !nextBox) throw new Error('Missing equation layout')
      expect(previewBox.y).toBeGreaterThanOrEqual(sourceBox.y + sourceBox.height - 1)
      expect(nextBox.y).toBeGreaterThanOrEqual(previewBox.y + previewBox.height - 1)
      expect(previewBox.y - sourceBox.y - sourceBox.height).toBeLessThan(2)
      await page.screenshot({ path: test.info().outputPath('inline-editing.png') })

      await preview.locator('svg').click()
      await expect(preview.locator('svg')).toBeVisible()
      await expect(line).toContainText('$x_i^2$')
      await expect(editor).toBeFocused()
      expect(await page.evaluate(() => getSelection()?.toString())).toBe('')

      const digit = await line.evaluate((element) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
          const start = text.textContent?.indexOf('2') ?? -1
          if (start < 0) continue
          const range = document.createRange()
          range.setStart(text, start)
          range.setEnd(text, start + 1)
          const box = range.getBoundingClientRect()
          return { x: box.right - 0.1, y: box.top + box.height / 2 }
        }
        throw new Error('Missing editable exponent')
      })
      await page.mouse.click(digit.x, digit.y)
      await editor.press('Backspace')
      await page.keyboard.insertText('3')
      await expect(line).toContainText('$x_i^3$')
      await expect(preview.getByRole('math', { name: 'x_i^3', exact: true })).toBeVisible()
      await expectAligned(raw, preview)
      await editor.press(`${modifier}+s`)
      await expect.poll(() => readFile(path, 'utf8')).toBe(source.replace('x_i^2', 'x_i^3'))
      await editor.press(`${modifier}+z`)
      await expect(preview.getByRole('math', { name: 'x_i^2', exact: true })).toBeVisible()
      await expect(display).not.toHaveClass(/cm-live-edit-preview/)

      await page.getByRole('button', { name: 'Source', exact: true }).click()
      await expect(preview).toHaveCount(0)
      await expect
        .poll(async () => (await editor.locator('.cm-line').allTextContents()).join('\n'))
        .toBe(source)
      await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
      await expect(preview).toHaveCount(0)
      await editor.getByRole('math', { name: 'x_i^2', exact: true }).click()
      await expect(preview.locator('svg')).toBeVisible()

      for (const width of [480, 320]) {
        await page.setViewportSize({ width, height: 1000 })
        await expect(preview.locator('svg')).toBeVisible()
        await expectAligned(raw, preview)
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true)
        await page.screenshot({ path: test.info().outputPath(`inline-editing-${width}.png`) })
      }
      await page.evaluate(axe.source)
      expect(
        await page.evaluate(
          async () =>
            (await (window as unknown as { axe: typeof import('axe-core') }).axe.run()).violations,
        ),
      ).toEqual([])

      await editor.press('Escape')
      await editor.getByRole('math', { name: 'a+b', exact: true }).click()
      await expect(raw).toHaveText('$a+b$')
      for (const width of [320, 480, 1144]) {
        await page.setViewportSize({ width, height: 1000 })
        await expectAligned(raw, preview)
      }
      await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1.25)
      })
      await expectAligned(raw, preview)
      await page.screenshot({ path: test.info().outputPath('inline-editing-zoom.png') })
      await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1)
      })

      await editor.press('Escape')
      await expect(preview).toHaveCount(0)
      await expect(raw).toHaveCount(0)
      await expect(editor.getByRole('math', { name: 'x_i^2', exact: true })).toBeVisible()
      await editor.getByRole('math', { name: 'x_i^2', exact: true }).click()
      await expect(preview.locator('svg')).toBeVisible()
      await editor.press('End')
      await expect(preview).toHaveCount(0)
      await expect(editor.getByRole('math', { name: 'x_i^2', exact: true })).toBeVisible()
      await display.getByRole('math', { name: 'z^2', exact: true }).click()
      const displaySource = editor.locator('.cm-live-edit-source').first()
      await expect(displaySource).toHaveCSS('background-color', sourceStyle.background)
      await expect(displaySource).toHaveCSS('font-family', sourceStyle.font)
      await expect(displaySource).toHaveCSS('font-size', sourceStyle.size)
      await editor.press('Escape')
      await editor.press(`${modifier}+a`)
      await editor.press(`${modifier}+c`)
      expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe(source)
      await editor.press('ArrowRight')
      await editor.press(`${modifier}+s`)
      await expect.poll(() => readFile(path, 'utf8')).toBe(source)
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
  })
}
