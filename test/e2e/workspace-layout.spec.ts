import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { clickDocumentAction, launchDesktop } from './helpers'

test('workspace search restores a hidden sidebar and preferences preserve writing and translation drafts', async () => {
  const directory = await mkdtemp(resolve('test/artifacts/logs/workspace-layout-'))
  const folder = join(directory, 'Notes')
  await mkdir(folder)
  const path = join(folder, 'Notebook.md')
  const original = '# Notebook\n\nA local document.\n'
  await writeFile(path, original)
  const application = await launchDesktop(join(directory, 'profile'), [path])
  try {
    const page = await application.firstWindow()
    const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
    await expect(editor).toContainText('A local document.')
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    const draft = '# Notebook\n\nKeep this unsaved writing.\n'
    await editor.fill(draft)
    await application.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
    }, folder)
    await clickDocumentAction(page, 'Open folder…')
    await page.getByRole('button', { name: 'Hide workspace', exact: true }).click()
    await expect(page.locator('.sidebar')).toBeHidden()
    await application.evaluate(({ Menu }) => {
      const command = Menu.getApplicationMenu()
        ?.items.flatMap((item) => item.submenu?.items ?? [])
        .find((item) => item.accelerator === 'CmdOrCtrl+P')
      if (!command) throw new Error('Missing file search command')
      command.click()
    })
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(page.locator('#workspace-query')).toBeFocused()
    await page.locator('#workspace-query').fill('Notebook')
    await expect(page.locator('.search-results')).toContainText('Notebook.md')
    await page.getByRole('button', { name: 'Preferences', exact: true }).click()
    await page.getByRole('button', { name: 'Translation', exact: true }).click()
    const model = page.locator('.translation-settings').getByLabel('Model', { exact: true })
    await model.fill('unsaved-model-choice')
    await page.getByRole('button', { name: 'Plugins', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Install local plugin…', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Translation', exact: true }).click()
    await expect(model).toHaveValue('unsaved-model-choice')
    await page.getByRole('button', { name: 'Close preferences', exact: true }).click()
    await expect(editor.locator('.cm-line')).toHaveText(draft.split('\n'))
    await page.getByRole('button', { name: 'Hide workspace', exact: true }).click()
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window?.setMinimumSize(0, 0)
      window?.setContentSize(390, 844)
    })
    await expect(page.locator('.sidebar')).toBeHidden()
    await page.getByRole('button', { name: 'Show workspace', exact: true }).click()
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Preferences', exact: true })).toBeInViewport({
      ratio: 1,
    })
    await expect(editor.locator('.cm-line')).toHaveText(draft.split('\n'))
  } finally {
    await application
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy()
      })
      .catch(() => {})
    await application.close()
  }
})
