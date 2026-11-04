import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import axe from 'axe-core'
import { clickDocumentAction, launchDesktop } from './helpers'

for (const [locale, theme, width, height] of [
  ['en', 'light', 1144, 715],
  ['zh-CN', 'dark', 400, 860],
] as const) {
  test(`export feedback appears at the bottom right for five seconds in ${locale} ${theme}`, async () => {
    const directory = await mkdtemp(resolve('test/e2e/result/export-feedback-'))
    const profile = join(directory, 'profile')
    const path = join(directory, 'Notes.md')
    const target = join(directory, 'A readable exported copy with a long file name.html')
    await mkdir(profile)
    await writeFile(
      join(profile, 'preferences.json'),
      JSON.stringify({ schemaVersion: 1, locale, theme }),
    )
    await writeFile(path, '# Notes\n\nKeep writing while exporting.\n')
    const application = await launchDesktop(profile, [path])
    try {
      const page = await application.firstWindow()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await application.evaluate(
        ({ BrowserWindow, dialog }, { width, height, target }) => {
          const window = BrowserWindow.getAllWindows()[0]
          window?.setMinimumSize(360, 500)
          window?.setContentSize(width, height)
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
        },
        { width, height, target },
      )
      await page
        .getByRole('button', { name: locale === 'en' ? 'Source' : '源码', exact: true })
        .click()
      const editor = page.locator('.cm-content[contenteditable="true"]')
      const area = page.locator('.cm-editor')
      const bounds = await area.boundingBox()
      await clickDocumentAction(page, locale === 'en' ? 'Export HTML…' : '导出 HTML…')
      const feedback = page.locator('.export-feedback')
      await expect(feedback).toContainText(
        locale === 'en' ? `Exported to ${target}` : `已导出至 ${target}`,
      )
      await expect(feedback).toBeVisible()
      const shown = Date.now()
      expect((await area.boundingBox())?.height).toBeCloseTo(bounds?.height ?? 0, 1)
      const position = await feedback.boundingBox()
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      expect(position).not.toBeNull()
      expect(
        Math.abs(viewport.width - (position?.x ?? 0) - (position?.width ?? 0) - 16),
      ).toBeLessThan(1)
      expect(
        Math.abs(viewport.height - (position?.y ?? 0) - (position?.height ?? 0) - 48),
      ).toBeLessThan(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await expect(page.getByRole('button', { name: /^(Cancel export|取消导出)$/ })).toHaveCount(0)
      await editor.focus()
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
      await page.keyboard.type('Still editing.')
      await expect(editor).toBeFocused()
      await page.evaluate(axe.source)
      const violations = await page.evaluate(async () => {
        const result = await (window as unknown as { axe: typeof import('axe-core') }).axe.run(
          document,
        )
        return result.violations
      })
      expect(violations).toEqual([])
      await page.screenshot({ path: test.info().outputPath('export-feedback.png') })
      await expect(feedback).toBeHidden({ timeout: 6_000 })
      expect(Date.now() - shown).toBeGreaterThanOrEqual(4_500)
      await expect(editor).toBeFocused()
      await clickDocumentAction(page, locale === 'en' ? 'New document' : '新建文档')
      await page.getByRole('tab', { name: /Notes\.md/ }).click()
      await expect(feedback).toBeHidden()
      await clickDocumentAction(page, locale === 'en' ? 'Export HTML…' : '导出 HTML…')
      await expect(feedback).toContainText(
        locale === 'en' ? `Exported to ${target}` : `已导出至 ${target}`,
      )
      await expect(feedback).toBeVisible()
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
