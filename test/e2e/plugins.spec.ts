import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { expect, test } from '@playwright/test'
import { clickDocumentAction, launchDesktop, openDocumentActions } from './helpers'
import { auditPluginInterface } from './plugin-accessibility'

for (const locale of ['en', 'zh-CN'] as const) {
  test(`${locale} local plugins review grants, inspect source and apply one undoable captured change`, async () => {
    test.setTimeout(90_000)
    const root = resolve('test/artifacts/logs'),
      directory = await mkdtemp(join(root, 'plugin-lifecycle-'))
    if (!directory.startsWith(root + sep)) throw new Error('Unsafe fixture path')
    const path = join(directory, 'writing.md'),
      profile = join(directory, 'profile'),
      original = '# Hello 中文  \r\n\r\nOriginal text.  \r\n'
    await mkdir(profile)
    await writeFile(
      join(profile, 'preferences.json'),
      JSON.stringify({ schemaVersion: 1, locale, theme: locale === 'en' ? 'light' : 'dark' }),
    )
    await writeFile(path, original)
    const application = await launchDesktop(profile, [path]),
      chinese = locale === 'zh-CN',
      info = test.info()
    try {
      const page = await application.firstWindow()
      const pluginAction = chinese ? '插件命令' : 'Plugin commands'
      const openPreferences = async () => {
        await page
          .getByRole('button', { name: chinese ? '偏好设置' : 'Preferences', exact: true })
          .click()
      }
      const closePreferences = async () => {
        await page
          .getByRole('button', {
            name: chinese ? '关闭偏好设置' : 'Close preferences',
            exact: true,
          })
          .click()
      }
      const expectPluginAction = async (available: boolean) => {
        const actions = await openDocumentActions(page)
        await expect(actions.getByRole('button', { name: pluginAction, exact: true })).toHaveCount(
          available ? 1 : 0,
        )
        await expect(actions.getByRole('button', { name: /^(Focus mode|专注模式)$/ })).toHaveCount(
          0,
        )
        await expect(actions.getByRole('checkbox', { name: /^(Typewriter|打字机)$/ })).toHaveCount(
          0,
        )
        await page.keyboard.press('Escape')
      }
      await expectPluginAction(false)
      await application.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      }, resolve('examples/plugins/writing-tools.manuslip-plugin.json'))
      await page
        .getByRole('button', { name: chinese ? '偏好设置' : 'Preferences', exact: true })
        .click()
      await page.getByRole('button', { name: chinese ? '插件' : 'Plugins', exact: true }).click()
      const settings = page.getByRole('region', { name: chinese ? '插件' : 'Plugins', exact: true })
      await settings
        .getByRole('button', {
          name: chinese ? '安装本地插件…' : 'Install local plugin…',
          exact: true,
        })
        .click()
      const review = settings.getByRole('region', {
        name: chinese ? '审核插件' : 'Review plugin',
        exact: true,
      })
      await expect(review.getByText('Writing tools', { exact: false })).toBeVisible()
      await expect(review).toBeFocused()
      await expect(review.getByRole('checkbox').first()).toBeInViewport()
      await auditPluginInterface(application, page, info, `plugins-review-${locale}`, review)
      for (const name of chinese
        ? ['读取此文档及其选区', '建议修改此文档']
        : ['Read this document and its selections', 'Propose changes to this document']) {
        await expect(review.getByRole('checkbox', { name, exact: true })).not.toBeChecked()
        await review.getByRole('checkbox', { name, exact: true }).check()
      }
      await review
        .getByRole('button', {
          name: chinese ? '按所选权限安装' : 'Install with selected access',
          exact: true,
        })
        .click()
      const installed = settings.getByRole('article', { name: 'Writing tools 1.0.0', exact: true })
      await expect(
        installed.getByText(chinese ? '已启用' : 'Enabled', { exact: true }),
      ).toBeVisible()
      await installed.scrollIntoViewIfNeeded()
      await auditPluginInterface(application, page, info, `plugins-installed-${locale}`, installed)
      await page
        .getByRole('button', { name: chinese ? '关闭偏好设置' : 'Close preferences', exact: true })
        .click()
      await clickDocumentAction(page, chinese ? '插件命令' : 'Plugin commands')
      const modal = page.getByRole('dialog', {
        name: chinese ? '插件命令' : 'Plugin commands',
        exact: true,
      })
      await modal.getByRole('button', { name: 'Count source words', exact: true }).click()
      await expect(
        modal.getByRole('textbox', { name: chinese ? '命令结果' : 'Command result', exact: true }),
      ).toHaveValue('5 source words')
      expect(await readFile(path, 'utf8')).toBe(original)
      await modal
        .getByRole('button', { name: chinese ? '丢弃结果' : 'Discard result', exact: true })
        .click()
      await modal.getByRole('button', { name: 'Trim trailing spaces', exact: true }).click()
      await expect(
        modal.getByRole('textbox', {
          name: chinese ? '建议的文档' : 'Proposed document',
          exact: true,
        }),
      ).toHaveValue('# Hello 中文\n\nOriginal text.\n')
      expect(await readFile(path, 'utf8')).toBe(original)
      await auditPluginInterface(application, page, info, `plugins-command-${locale}`)
      await modal
        .getByRole('button', { name: chinese ? '应用到文档' : 'Apply to document', exact: true })
        .click()
      await expect(modal).toHaveCount(0)
      await page.getByRole('button', { name: chinese ? '源码' : 'Source', exact: true }).click()
      const editor = page.locator('.cm-content'),
        modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
      await editor.press(`${modifier}+s`)
      await expect.poll(() => readFile(path, 'utf8')).toBe('# Hello 中文\r\n\r\nOriginal text.\r\n')
      await editor.press(`${modifier}+z`)
      await editor.press(`${modifier}+s`)
      await expect.poll(() => readFile(path, 'utf8')).toBe(original)
      await page
        .getByRole('button', { name: chinese ? '偏好设置' : 'Preferences', exact: true })
        .click()
      await installed
        .getByRole('button', { name: chinese ? '停用' : 'Disable', exact: true })
        .click()
      await expect(
        installed.getByText(chinese ? '已停用' : 'Disabled', { exact: true }),
      ).toBeVisible()
      await closePreferences()
      await expectPluginAction(false)
      await openPreferences()
      await installed
        .getByRole('button', { name: chinese ? '启用' : 'Enable', exact: true })
        .click()
      await expect(
        installed.getByText(chinese ? '已启用' : 'Enabled', { exact: true }),
      ).toBeVisible()
      await closePreferences()
      await expectPluginAction(true)
      await clickDocumentAction(page, pluginAction)
      await expect(
        modal.getByRole('button', { name: 'Count source words', exact: true }),
      ).toBeVisible()
      await modal.getByRole('button', { name: chinese ? '关闭' : 'Close', exact: true }).click()
      await openPreferences()
      await installed
        .getByRole('button', { name: chinese ? '移除' : 'Remove', exact: true })
        .click()
      await installed
        .getByRole('button', { name: chinese ? '移除插件' : 'Remove plugin', exact: true })
        .click()
      await expect(
        settings.getByText(chinese ? '尚未安装插件。' : 'No plugins installed.', { exact: true }),
      ).toBeVisible()
      expect(await page.evaluate(() => window.manuslip.plugins())).toMatchObject({
        ok: true,
        value: { plugins: [] },
      })
      await closePreferences()
      await expectPluginAction(false)
      expect(await readFile(path, 'utf8')).toBe(original)
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
