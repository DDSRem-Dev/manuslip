import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { launchDesktop } from './helpers'

async function saveAs(application: ElectronApplication, page: Page, path: string): Promise<void> {
  await application.evaluate(({ dialog, Menu }, selected) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: selected })
    const item = Menu.getApplicationMenu()
      ?.items.flatMap((entry) => entry.submenu?.items || [])
      .find((entry) => entry.accelerator === 'CmdOrCtrl+Shift+S')
    if (!item) throw new Error('Missing Save As command')
    item.click()
  }, path)
  await expect(page.getByRole('tab', { name: basename(path), exact: true })).toBeEnabled()
}

function activePair(page: Page): Promise<{ label: boolean; close: boolean; overflow: boolean }> {
  return page.locator('.document-tabs').evaluate((strip) => {
    const bounds = strip.getBoundingClientRect()
    const visible = (selector: string): boolean => {
      const element = strip.querySelector(selector)
      if (!element) return false
      const box = element.getBoundingClientRect()
      return (
        box.width >= 24 &&
        box.height >= 24 &&
        box.left >= bounds.left - 0.5 &&
        box.right <= bounds.right + 0.5 &&
        box.top >= bounds.top &&
        box.bottom <= bounds.bottom
      )
    }
    return {
      label: visible('[role="tab"][aria-selected="true"]'),
      close: visible('.tab-close.selected'),
      overflow: document.documentElement.scrollWidth > innerWidth,
    }
  })
}

for (const theme of ['light', 'dark'])
  test(`${theme} tabs keep their label and close control visible through navigation and Save As`, async () => {
    const testInfo = test.info()
    const directory = await mkdtemp(resolve('test/e2e/result/tabs-scroll-'))
    const source = '# A place to write\n\nKeep every word in this manuscript.\n'
    const files = Array.from({ length: 6 }, (_, index) =>
      join(directory, `${index + 1} - 每一份草稿都值得完整的名字 - manuscript-notes-${index}.md`),
    )
    for (const path of files) await writeFile(path, source)
    const application = await launchDesktop(join(directory, 'profile'))
    const errors: string[] = []
    try {
      const page = await application.firstWindow()
      page.on('pageerror', (error) => errors.push(error.message))
      await expect(page.getByRole('heading', { name: 'Start writing' })).toBeVisible()
      await page.getByRole('button', { name: 'Preferences', exact: true }).click()
      await page.getByLabel('Appearance', { exact: true }).selectOption(theme)
      await page.getByRole('button', { name: 'Close preferences', exact: true }).click()
      for (const path of files) {
        await application.evaluate(({ dialog }, selected) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
        }, path)
        await page.getByRole('button', { name: 'Open file…', exact: true }).first().click()
        await expect(page.getByRole('tab', { name: basename(path), exact: true })).toBeEnabled()
      }
      const observations = []
      const configurations = [
        { locale: 'en', width: 1160, zoom: 1, forcedColors: false },
        { locale: 'zh-CN', width: 320, zoom: 1, forcedColors: false },
        { locale: 'en', width: 320, zoom: 2, forcedColors: false },
        { locale: 'zh-CN', width: 580, zoom: 2, forcedColors: true },
      ]
      for (const [index, config] of configurations.entries()) {
        await page.getByRole('button', { name: /^(Preferences|偏好设置)$/, exact: true }).click()
        await page.getByLabel(/^(Interface language|界面语言)$/).selectOption(config.locale)
        await page.getByRole('button', { name: /^(Close preferences|关闭偏好设置)$/ }).click()
        await page.emulateMedia({ forcedColors: config.forcedColors ? 'active' : 'none' })
        await application.evaluate(({ BrowserWindow }, { width, zoom }) => {
          const window = BrowserWindow.getAllWindows()[0]
          if (!window) throw new Error('Missing application window')
          window.setMinimumSize(0, 0)
          window.webContents.setZoomFactor(zoom)
          window.setContentSize(width * zoom, 800 * zoom)
        }, config)
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(config.width)
        const tabs = page.getByRole('tab')
        await tabs.first().focus()
        for (const key of ['Home', 'ArrowRight', 'ArrowLeft', 'End', 'Home', 'ArrowRight']) {
          await page.keyboard.press(key)
          await expect
            .poll(() => activePair(page), `${key}: ${JSON.stringify(config)}`)
            .toEqual({
              label: true,
              close: true,
              overflow: false,
            })
          await expect(page.getByRole('tab', { selected: true })).toBeFocused()
        }
        await page.keyboard.press('Tab')
        await expect(page.locator('.tab-close.selected')).toBeFocused()
        await expect
          .poll(() => activePair(page))
          .toEqual({
            label: true,
            close: true,
            overflow: false,
          })
        await page.keyboard.press('Shift+Tab')
        await expect(page.getByRole('tab', { selected: true })).toBeFocused()
        const target = tabs.nth(2)
        const id = await target.getAttribute('id')
        await target.click()
        await expect(target).toHaveAttribute('aria-selected', 'true')
        await saveAs(application, page, join(directory, `draft-${index}.md`))
        await expect
          .poll(() => activePair(page))
          .toEqual({
            label: true,
            close: true,
            overflow: false,
          })
        const saved = join(
          directory,
          `改名后仍能看见草稿和关闭按钮 - a-long-renamed-manuscript-${index}.md`,
        )
        await saveAs(application, page, saved)
        await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('id', id || '')
        await expect(tabs).toHaveCount(6)
        await expect
          .poll(() => activePair(page), `Save As: ${JSON.stringify(config)}`)
          .toEqual({
            label: true,
            close: true,
            overflow: false,
          })
        expect(await readFile(saved, 'utf8')).toBe(source)
        observations.push({ ...config, ...(await activePair(page)) })
        await page.screenshot({ path: testInfo.outputPath(`tabs-${index}.png`) })
      }
      await page.getByRole('tab', { selected: true }).focus()
      await page.keyboard.press('Tab')
      await expect(page.locator('.tab-close.selected')).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('tab')).toHaveCount(5)
      await expect(page.getByRole('tab', { selected: true })).toBeFocused()
      await expect
        .poll(() => activePair(page))
        .toEqual({
          label: true,
          close: true,
          overflow: false,
        })
      expect(errors).toEqual([])
      await testInfo.attach('tab-visibility', {
        body: JSON.stringify(observations, null, 2),
        contentType: 'application/json',
      })
    } finally {
      await application.close()
      expect(directory.startsWith(resolve('test/e2e/result') + sep)).toBe(true)
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  })
