import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { contrast, launchDesktop } from './helpers'

for (const theme of ['light', 'dark'])
  test(`narrow ${theme} workspace leaves room to write and read`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'manuslip-narrow-shell-'))
    const application = await launchDesktop(join(directory, 'profile'))
    try {
      const page = await application.firstWindow()
      await expect(page.getByRole('heading', { name: 'Start writing' })).toBeVisible()
      await page.getByRole('button', { name: 'Preferences', exact: true }).click()
      await page.getByLabel('Appearance', { exact: true }).selectOption(theme)
      await page.getByRole('button', { name: 'Close preferences', exact: true }).click()
      await page.getByRole('button', { name: 'New document', exact: true }).first().click()
      await page
        .getByRole('textbox', { name: 'Markdown source', exact: true })
        .fill(
          '# A place to write\n\nKeep the words in view.\n\n- [ ] Read the draft\n- [x] Keep the source\n',
        )
      await expect(page.locator('.cm-live-heading-1')).toBeVisible()
      await page.getByRole('button', { name: 'Translated preview', exact: true }).click()
      expect(
        await page.locator('.document-toolbar').evaluate((el) => el.getBoundingClientRect().height),
      ).toBeLessThan(90)
      for (const [width, chinese] of [
        [360, false],
        [320, true],
      ] as const) {
        await application.evaluate(({ BrowserWindow }, width) => {
          const window = BrowserWindow.getAllWindows()[0]
          window?.setMinimumSize(0, 0)
          window?.setContentSize(width, 800)
        }, width)
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
        if (chinese) {
          await page.getByRole('button', { name: 'Preferences', exact: true }).click()
          await page.getByLabel('Interface language', { exact: true }).selectOption('zh-CN')
          await page.getByRole('button', { name: '关闭偏好设置', exact: true }).click()
        }
        const visibleHeight = (selector: string) =>
          page.locator(selector).evaluate((element) => {
            const rect = element.getBoundingClientRect()
            const clip = element.closest('main')?.getBoundingClientRect()
            if (!clip) throw new Error('Missing content viewport')
            return Math.max(
              0,
              Math.min(rect.bottom, clip.bottom, innerHeight) - Math.max(rect.top, clip.top, 0),
            )
          })
        await expect.poll(() => visibleHeight('.reading-pane')).toBeGreaterThanOrEqual(240)
        expect(
          await page
            .locator('.document-toolbar')
            .evaluate((el) => el.getBoundingClientRect().height),
        ).toBeLessThan(90)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
        const toggle = page.getByRole('button', {
          name: chinese ? '展开写作空间' : 'Show workspace',
          exact: true,
        })
        await expect(toggle).toHaveAttribute('aria-expanded', 'false')
        await expect(page.locator('#workspace-navigation')).toBeHidden()
        await toggle.focus()
        await page.keyboard.press('Enter')
        const close = page.getByRole('button', {
          name: chinese ? '收起写作空间' : 'Hide workspace',
          exact: true,
        })
        await expect(close).toHaveAttribute('aria-expanded', 'true')
        await expect(page.locator('#workspace-navigation')).toBeVisible()
        await page.keyboard.press('Enter')
        await expect(toggle).toBeFocused()
        await expect(page.locator('#workspace-navigation')).toBeHidden()
        const toolbar = page.locator('.document-toolbar')
        const buttons = toolbar.getByRole('button')
        await buttons.first().focus()
        for (let index = 0; index < (await buttons.count()); index++) {
          const button = buttons.nth(index)
          await expect(button).toBeFocused()
          await expect
            .poll(() =>
              button.evaluate((element) => {
                const rect = element.getBoundingClientRect()
                const clip = element.closest('.document-toolbar')?.getBoundingClientRect()
                if (!clip) throw new Error('Missing file actions')
                return rect.left >= clip.left && rect.right <= clip.right
              }),
            )
            .toBe(true)
          if (index < (await buttons.count()) - 1) await page.keyboard.press('Tab')
        }
        await page.keyboard.press('Shift+Tab')
        await expect(buttons.nth((await buttons.count()) - 2)).toBeFocused()
        await page.keyboard.press('Tab')
        const actions = toolbar.getByRole('button', {
          name: chinese ? '文档操作' : 'Document actions',
          exact: true,
        })
        await expect(actions).toBeFocused()
        await page.keyboard.press('Enter')
        const commands = page.getByRole('group', {
          name: chinese ? '文档操作' : 'Document actions',
          exact: true,
        })
        for (const name of chinese
          ? ['新建文档', '打开文件…', '打开文件夹…', '另存为…', '保存副本…']
          : ['New document', 'Open file…', 'Open folder…', 'Save As…', 'Save a copy…']) {
          await page.keyboard.press('Tab')
          const action = commands.getByRole('button', { name, exact: true })
          await expect(action).toBeFocused()
          await expect(action).toBeInViewport({ ratio: 1 })
        }
        await page.keyboard.press('Tab')
        const sync = commands.getByRole('button', { name: chinese ? '同步' : 'Sync', exact: true })
        await expect(sync).toBeFocused()
        await expect(sync).toBeInViewport({ ratio: 1 })
        await page.keyboard.press('Tab')
        const appearance = commands.getByRole('button', {
          name: chinese ? '文档外观' : 'Document appearance',
          exact: true,
        })
        await expect(appearance).toBeFocused()
        await expect(appearance).toBeInViewport({ ratio: 1 })
        await page.keyboard.press('Tab')
        const exportReading = commands.getByRole('button', {
          name: chinese ? '导出阅读副本 HTML…' : 'Export reading HTML…',
          exact: true,
        })
        await expect(exportReading).toBeFocused()
        await expect(exportReading).toBeInViewport({ ratio: 1 })
        await page.keyboard.press('Enter')
        await expect(commands).toBeHidden()
        await expect(page.locator('.export-feedback').getByRole('alert')).toHaveText(
          chinese
            ? '请先选择“翻译”，再导出阅读副本。'
            : 'Choose Translate before exporting a reading copy.',
        )
        await expect(page.locator('.export-feedback').getByRole('alert')).toBeVisible()
        await expect.poll(() => visibleHeight('.reading-pane')).toBeGreaterThanOrEqual(240)
        expect(
          await page
            .locator('.document-toolbar')
            .evaluate((el) => el.getBoundingClientRect().height),
        ).toBeLessThan(90)
        await buttons.first().focus()
        await page.screenshot({ path: test.info().outputPath(`narrow-${theme}-${width}.png`) })
      }
      await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1160, 800)
      })
      await page.getByRole('button', { name: '展开写作空间', exact: true }).click()
      const outline = page
        .getByRole('navigation', { name: '文档标题', exact: true })
        .getByRole('button')
        .first()
      await outline.focus()
      await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(360, 800)
      })
      await expect(outline).toBeFocused()
      await expect(page.locator('#workspace-navigation')).toBeVisible()
      await expect(page.getByRole('button', { name: '收起写作空间', exact: true })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
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

test('tab controls remain readable and keyboard reachable in both themes, Chinese, narrow width and zoom', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-tabs-ui-'))
  const name = '写作计划 — Research notes and references for the next edition.md'
  const path = join(directory, name)
  await writeFile(path, '# A writing project\n\nNotes that stay with this file.')
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    for (let index = 0; index < 3; index++)
      await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    await application.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
    }, path)
    await page.getByRole('button', { name: 'Open file…', exact: true }).first().click()
    const longTab = page.getByRole('tab', { name, exact: true })
    await expect(longTab).toHaveAttribute('title', path)
    await expect(page.getByRole('tab', { name, exact: true })).toBeVisible()
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: 'Preferences', exact: true }).click()
      await page.getByLabel('Appearance', { exact: true }).selectOption(theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.getByRole('button', { name: 'Close preferences' }).click()
      const pairs = await page.locator('.document-tabs button').evaluateAll((buttons) =>
        buttons.map((button) => {
          let background: Element | null = button
          while (background && getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)')
            background = background.parentElement
          return {
            text: button.textContent,
            foreground: getComputedStyle(button).color,
            background: getComputedStyle(background || document.documentElement).backgroundColor,
          }
        }),
      )
      for (const pair of pairs)
        expect(
          contrast(pair.foreground, pair.background),
          `${theme}: ${pair.text}`,
        ).toBeGreaterThanOrEqual(4.5)
      await longTab.focus()
      await page.keyboard.press('Home')
      const first = page.getByRole('tab', { name: 'Untitled 1', exact: true })
      await expect(first).toBeFocused()
      expect(await first.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('2px')
      await page.keyboard.press('End')
      await expect(longTab).toBeFocused()
      await page.screenshot({ path: test.info().outputPath(`tabs-${theme}.png`) })
    }
    await page.getByRole('button', { name: 'Preferences', exact: true }).click()
    await page.getByLabel('Interface language').selectOption('zh-CN')
    await expect(page.getByRole('button', { name: '关闭偏好设置' })).toBeVisible()
    await page.getByRole('button', { name: '关闭偏好设置' }).click()
    await expect(page.getByRole('tablist', { name: '已打开的文档' })).toBeVisible()
    for (const zoom of [2, 1]) {
      await application.evaluate(
        ({ BrowserWindow }, factor) =>
          BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(factor),
        zoom,
      )
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
      await expect(page.getByRole('button', { name: '保存', exact: true })).toBeVisible()
    }
    await page.setViewportSize({ width: 320, height: 850 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await longTab.focus()
    await page.keyboard.press('Home')
    await expect(page.getByRole('tab', { name: '未命名 1', exact: true })).toBeFocused()
    await page.keyboard.press('End')
    await expect(longTab).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: `关闭 ${name}`, exact: true })).toBeFocused()
    // Rapid navigation must retain the focused pair while activation settles input.
    for (let index = 0; index < 3; index++) {
      await page.keyboard.press('Shift+Tab')
      await expect(longTab).toBeFocused()
      await page.keyboard.press('Home')
      await page.keyboard.press('End')
      await page.keyboard.press('Tab')
      await expect(page.getByRole('button', { name: `关闭 ${name}`, exact: true })).toBeFocused()
    }
    await page.screenshot({ path: test.info().outputPath('tabs-narrow-chinese.png') })
    await page.keyboard.press('Enter')
    await expect(page.getByRole('tab')).toHaveCount(3)
    await expect(page.getByRole('textbox', { name: 'Markdown 源码' })).toBeVisible()
    const close = async (): Promise<void> =>
      application.evaluate(({ Menu }) => {
        const item = Menu.getApplicationMenu()
          ?.items.flatMap((entry) => entry.submenu?.items || [])
          .find((entry) => entry.accelerator === 'CmdOrCtrl+W')
        if (!item) throw new Error('Missing native Close document accelerator')
        item.click()
      })
    for (let index = 0; index < 3; index++) {
      await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
      await close()
      await expect(page.getByRole('tab')).toHaveCount(2 - index)
    }
    await page.getByRole('button', { name: '新建文档', exact: true }).first().click()
    await page.getByRole('button', { name: '偏好设置', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    // A native close command can arrive while the HTML preferences dialog is modal.
    await close()
    await expect(page.getByRole('tab')).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: '偏好设置', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '关闭偏好设置' }).click()
    await page.getByRole('button', { name: '新建文档', exact: true }).first().click()
    await page.getByRole('button', { name: '偏好设置', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: '关闭偏好设置' }).click()
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
