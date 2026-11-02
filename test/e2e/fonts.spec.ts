import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { expectBundledCjk, platformFonts } from './fonts'
import { launchDesktop } from './helpers'

test('bundled Chinese glyphs work offline in the shell, Source and Live while Latin code stays monospace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-fonts-'))
  const path = join(directory, '每一个字.md')
  const source =
    '\ufeff# 每一个字 — Manuslip\r\n\r\n简体中文，繁體中文。龘𠮷\r\n\r\n**粗体** *强调*\r\n\r\n```text\r\niiWW\r\n```\r\n'
  await writeFile(path, source)
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    await expect(page.getByRole('heading', { name: 'Start writing' })).toBeVisible()
    await application.evaluate(({ session, dialog }, path) => {
      session.defaultSession.enableNetworkEmulation({ offline: true })
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, path)
    await page.getByRole('button', { name: 'Open file…', exact: true }).first().click()
    await expect(page.getByRole('tab', { name: '每一个字.md', exact: true })).toBeVisible()
    await expectBundledCjk(page, '.document-tab[aria-selected="true"] .tab-title', 4)
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await expectBundledCjk(page, '.cm-line:first-child', 4)
    await expectBundledCjk(page, '.cm-line:nth-child(3)', 12)
    const latin = await platformFonts(page, '.cm-line:nth-child(8)')
    expect(latin.length).toBeGreaterThan(0)
    expect(latin.every((font) => !font.isCustomFont)).toBe(true)
    const widths = await page.locator('.cm-line:nth-child(8)').evaluate((element) => {
      const node = element.firstChild
      if (!node || node.nodeType !== Node.TEXT_NODE || node.textContent !== 'iiWW')
        throw new Error('Expected an unhighlighted ASCII code line')
      const range = document.createRange()
      range.setStart(node, 0)
      range.setEnd(node, 2)
      const narrow = range.getBoundingClientRect().width
      range.setStart(node, 2)
      range.setEnd(node, 4)
      return [narrow, range.getBoundingClientRect().width]
    })
    expect(Math.abs((widths[0] ?? 0) - (widths[1] ?? 0))).toBeLessThan(0.1)
    await page.screenshot({ path: test.info().outputPath('chinese-source-light.png') })
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    await expectBundledCjk(page, '.cm-line:nth-child(3)', 12)
    await page.screenshot({ path: test.info().outputPath('chinese-live-light.png') })
    await page.getByRole('button', { name: 'Preferences', exact: true }).click()
    await page.getByLabel('Appearance', { exact: true }).selectOption('dark')
    await page.getByLabel('Interface language').selectOption('zh-CN')
    await expect(page.getByRole('button', { name: '关闭偏好设置', exact: true })).toBeVisible()
    await expectBundledCjk(page, '.preferences h2', 4)
    await page.setViewportSize({ width: 320, height: 950 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath('chinese-preferences-dark-narrow.png') })
    await page.getByRole('button', { name: '关闭偏好设置', exact: true }).click()
    await page.setViewportSize({ width: 1100, height: 850 })
    await expectBundledCjk(page, '.cm-line:nth-child(3)', 12)
    await page.screenshot({ path: test.info().outputPath('chinese-live-dark.png') })
    expect(await readFile(path, 'utf8')).toBe(source)
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
