import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchDesktop } from './helpers'

test('footnotes jump to rendered bodies and back across unmounted editor viewports', async () => {
  const directory = await mkdtemp(resolve('test/e2e/result/footnote-navigation-'))
  const path = join(directory, 'footnotes.md')
  const source = [
    '# Footnotes',
    'First^[**First body**] and named[^n].',
    'Second^[Second body].',
    '- List note^[List body].',
    '| Column |\n| --- |\n| Table note^[Table body]. |',
    ...Array.from({ length: 70 }, (_, index) => `Paragraph ${index + 1}. A long document.`),
    'Repeated named note[^n].',
    ...Array.from({ length: 70 }, (_, index) => `Paragraph ${index + 71}. More text.`),
    '[^n]: Named note body.',
    'End',
  ].join('\n\n')
  await writeFile(path, source)
  // Startup also accepts a relative test profile without a main-process exception.
  const application = await launchDesktop(relative(process.cwd(), join(directory, 'profile')), [
    path,
  ])
  const page = await application.firstWindow()
  try {
    await page.setViewportSize({ width: 1144, height: 850 })
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    const first = editor.locator('[data-footnote-ref]').filter({ hasText: /^1$/ })
    const firstBody = editor.locator('[data-placement="after-document"] li').filter({
      hasText: 'First body',
    })
    // The note is not mounted until CodeMirror renders the end of the document.
    await expect(first).toBeVisible()
    await expect(firstBody).toHaveCount(0)
    await first.click()
    await expect(firstBody).toBeInViewport({ ratio: 0.9 })
    await expect(firstBody).toBeFocused()
    await firstBody.locator('[data-footnote-backref]').click()
    await expect(first).toBeInViewport({ ratio: 1 })
    await expect(first).toBeFocused()

    for (const [number, body] of [
      [3, 'Second body'],
      [4, 'List body'],
      [5, 'Table body'],
    ] as const) {
      const reference = editor
        .locator('[data-footnote-ref]')
        .filter({ hasText: new RegExp(`^${number}$`) })
      const note = editor.locator('[data-placement="after-document"] li').filter({ hasText: body })
      await reference.focus()
      await reference.press('Enter')
      await expect(note).toBeInViewport({ ratio: 0.9 })
      await expect(note).toBeFocused()
      await note.locator('[data-footnote-backref]').click()
      await expect(reference).toBeInViewport({ ratio: 1 })
      await expect(reference).toBeFocused()
    }

    const named = editor.locator('[data-footnote-ref]').filter({ hasText: /^2$/ })
    await named.first().click()
    const namedBody = editor.locator('.cm-live-footnoteDefinition li').filter({
      hasText: 'Named note body',
    })
    await expect(namedBody).toBeInViewport({ ratio: 0.9 })
    await namedBody.locator('[data-footnote-backref]').last().click()
    const repeated = editor.locator('[id="user-content-fnref-n-2"]')
    await expect(repeated).toBeInViewport({ ratio: 1 })
    await expect(repeated).toBeFocused()
    await repeated.press('Enter')
    await expect(namedBody).toBeInViewport({ ratio: 0.9 })

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
    expect(await readFile(path, 'utf8')).toBe(source)
    await page.screenshot({ path: test.info().outputPath('footnote-destination.png') })
  } catch (error) {
    await page.screenshot({ path: test.info().outputPath('footnote-failure.png') }).catch(() => {})
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
})
