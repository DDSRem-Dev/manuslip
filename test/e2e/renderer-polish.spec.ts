import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { launchDesktop } from './helpers'

async function documentTest(
  source: string,
  run: (page: Page, application: ElectronApplication) => Promise<void>,
) {
  const directory = await mkdtemp(resolve('test/artifacts/logs/renderer-polish-'))
  const path = join(directory, 'polish.md')
  await writeFile(path, source)
  const application = await launchDesktop(join(directory, 'profile'), [path])
  const page = await application.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await run(page, application)
    expect(await readFile(path, 'utf8')).toBe(source)
    expect(errors).toEqual([])
  } catch (error) {
    await page.screenshot({ path: test.info().outputPath('polish-failure.png') }).catch(() => {})
    throw error
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

test('inline math preserves overhanging ink and only scrolls expressions that exceed the line', async () => {
  const wide = Array.from({ length: 28 }, (_, index) => `x_{${index}}`).join('+')
  const adaptive = Array.from({ length: 13 }, (_, index) => `y_{${index}}`).join('+')
  const source = `# Typesetting\n\nAccent $\\widehat{xyz}$ and tall $\\smash{\\dfrac{a}{b}}$ text.\n\nLong $${wide}$\n\nResize $${adaptive}$\n\nEnd`
  await documentTest(source, async (page) => {
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    const accent = editor.getByRole('math', { name: '\\widehat{xyz}', exact: true })
    const smashed = editor.getByRole('math', { name: '\\smash{\\dfrac{a}{b}}', exact: true })
    const long = editor.getByRole('math', { name: wide, exact: true })
    const resized = editor.getByRole('math', { name: adaptive, exact: true })
    for (const width of [1144, 420, 1144]) {
      await page.setViewportSize({ width, height: 1000 })
      for (const formula of [accent, smashed]) {
        await expect(formula.locator('svg')).toBeVisible()
        await expect(formula).toHaveCSS('overflow', 'visible')
      }
      await expect(long).toHaveCSS('overflow-x', 'auto')
      await expect(resized).toHaveCSS('overflow-x', width === 420 ? 'auto' : 'visible')
      await expect
        .poll(() => long.evaluate((element) => element.scrollWidth > element.clientWidth))
        .toBe(true)
      await long.focus()
      await long.press('ArrowRight')
      await expect.poll(() => long.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true)
      await page.screenshot({ path: test.info().outputPath(`math-ink-${width}.png`) })
    }
  })
})

test('note rows stay in the document flow and return to references inside other note bodies', async () => {
  const source = [
    '# Footnotes',
    'Main^[Outer **body** with a named reference[^n].] text.',
    ...Array.from({ length: 70 }, (_, index) => `Paragraph ${index + 1}.`),
    '[^n]: Named destination.',
    ...Array.from({ length: 70 }, (_, index) => `Paragraph ${index + 71}.`),
    'End',
  ].join('\n\n')
  await documentTest(source, async (page) => {
    await page.setViewportSize({ width: 1144, height: 850 })
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await editor.locator('[data-footnote-ref]').filter({ hasText: /^1$/ }).click()
    const outer = editor.locator('[data-placement="after-document"]')
    await expect(outer).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(outer).toHaveCSS('border-top-width', '1px')
    const innerReference = outer.locator('[data-footnote-ref]')
    await innerReference.click()
    const inner = editor
      .locator('.cm-live-footnoteDefinition li')
      .filter({ hasText: 'Named destination.' })
    await expect(inner).toBeInViewport({ ratio: 0.9 })
    await inner.locator('[data-footnote-backref]').click()
    await expect(innerReference).toBeInViewport({ ratio: 1 })
    await expect(innerReference).toBeFocused()
    await page.screenshot({ path: test.info().outputPath('note-return.png') })
    await innerReference.click()
    await inner.locator('p').first().click()
    await expect(editor).toContainText('[^n]: Named destination.')
    await editor.press('Home')
    await editor.press('Shift+End')
    await page.keyboard.insertText('[^n]: Edited destination.')
    await expect(editor).toContainText('Edited destination.')
    await editor.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
    await expect(editor).toContainText('Named destination.')
    await editor.focus()
    await editor.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
    await outer.locator('p').first().click()
    await expect(editor).toContainText('^[Outer **body** with a named reference[^n].]')
  })
})
