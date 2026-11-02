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

test('file search chooses a folder and live listings preserve pagination through workspace switches', async () => {
  const directory = await mkdtemp(resolve('test/artifacts/logs/workspace-live-'))
  const first = join(directory, 'First folder'),
    second = join(directory, 'Second folder')
  const chapters = join(first, 'chapters')
  await mkdir(chapters, { recursive: true })
  await mkdir(second)
  await Promise.all(
    Array.from({ length: 205 }, (_, index) =>
      writeFile(join(chapters, `Chapter ${index + 1}.md`), '# A chapter'),
    ),
  )
  await writeFile(join(second, 'other.md'), '# Other folder')
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
    await editor.fill('# Draft\n\nKeep this unsaved writing.')
    await page.getByRole('button', { name: 'Show workspace', exact: true }).click()
    await expect(page.locator('.workspace-file-search')).toBeHidden()
    await application.evaluate(({ Menu }) => {
      const command = Menu.getApplicationMenu()
        ?.items.flatMap((item) => item.submenu?.items ?? [])
        .find((item) => item.accelerator === 'CmdOrCtrl+P')
      if (!command) throw new Error('Missing file search command')
      command.click()
    })
    const choose = page
      .locator('.workspace-search')
      .getByRole('button', { name: 'Open folder…', exact: true })
    await expect(choose).toBeFocused()
    await application.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
    }, first)
    await choose.click()
    await expect(page.locator('#workspace-query')).toBeFocused()
    await page.locator('#workspace-query').fill('Chapter 205')
    await expect(page.locator('.search-results')).toContainText('Chapter 205.md')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Find a file', exact: true })).toBeFocused()
    const files = page.getByRole('navigation', { name: 'Workspace files', exact: true })
    const chapterFolder = files
      .locator('.file-directory')
      .filter({ has: page.locator('summary > bdi', { hasText: /^chapters$/ }) })
      .last()
    await chapterFolder.locator('summary').click()
    await expect(chapterFolder.locator('.file-entry')).toHaveCount(200)
    await chapterFolder.getByRole('button', { name: 'Show more files', exact: true }).click()
    await expect(chapterFolder.locator('.file-entry')).toHaveCount(205)
    await writeFile(join(chapters, '000-added.md'), '# Added externally')
    await expect(chapterFolder.locator('.file-entry')).toHaveCount(206)
    await expect(
      chapterFolder.getByRole('button', { name: 'Chapter 205.md', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Hide workspace', exact: true }).click()
    await page.getByRole('button', { name: 'Show workspace', exact: true }).click()
    await expect(chapterFolder.locator('.file-entry')).toHaveCount(206)
    await application.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
    }, second)
    await page.getByRole('button', { name: 'Open folder…', exact: true }).click()
    await expect(files.getByRole('button', { name: 'other.md', exact: true })).toBeVisible()
    await writeFile(join(first, 'old-workspace.md'), '# Changed after switching')
    await expect(files).not.toContainText('old-workspace.md')
    await expect(files).not.toContainText('chapters')
    await expect(page.locator('.workspace-notices [role=alert]')).toHaveCount(0)
    await expect(editor).toContainText('Keep this unsaved writing.')
    await expect(
      page
        .getByRole('navigation', { name: 'Document headings' })
        .getByRole('button', { name: 'Draft', exact: true }),
    ).toBeVisible()
  } finally {
    await application
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy()
      })
      .catch(() => {})
    await application.close()
  }
})
