import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import axe from 'axe-core'
import { launchDesktop } from './helpers'

test('folder disclosure, closing, and catalog hierarchy preserve unsaved writing', async () => {
  const directory = await mkdtemp(resolve('test/artifacts/logs/workspace-design-e2e-'))
  const folder = join(directory, 'Writing notes')
  await mkdir(folder)
  const path = join(folder, 'Notes.md')
  const source = '# Notebook\n\n## First part\n\n#### Detail\n\n## Second part\n'
  const draft = `${source}\nKeep this unsaved writing.\n`
  await writeFile(path, source)
  const application = await launchDesktop(join(directory, 'profile'), [path])
  try {
    const page = await application.firstWindow()
    await expect(page.getByRole('tab', { name: 'Notes.md', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
    await editor.fill(draft)
    await page.getByRole('button', { name: 'Show workspace', exact: true }).click()
    const fileSearch = page.locator('.workspace-file-search')
    await expect(fileSearch).toBeHidden()
    await application.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
    }, folder)
    const openFolder = page.getByRole('button', { name: 'Open folder…', exact: true })
    await openFolder.click()
    await expect(fileSearch).toBeVisible()
    const root = page.locator('.workspace-root')
    const rootPath = root.locator(':scope > .directory-content > .workspace-path')
    await expect(rootPath).toHaveText(folder)
    await expect(page.locator('.workspace-path')).toHaveCount(1)
    const folderToggle = root.getByRole('button', { name: 'Writing notes', exact: true })
    await folderToggle.click()
    await expect(rootPath).toHaveCount(0)
    await expect(root.getByRole('button', { name: 'Close folder', exact: true })).toBeVisible()
    await folderToggle.focus()
    await page.keyboard.press('Enter')
    await expect(rootPath).toHaveText(folder)
    await page.evaluate(axe.source)
    expect(
      await page.evaluate(async () => {
        const result = await (window as unknown as { axe: typeof axe }).axe.run(
          '.workspace-browser',
          { runOnly: ['nested-interactive', 'button-name', 'aria-valid-attr-value'] },
        )
        return result.violations.map(({ id }) => id)
      }),
    ).toEqual([])

    const headings = page.getByRole('navigation', { name: 'Document headings', exact: true })
    const notebook = headings.getByRole('button', { name: 'Notebook', exact: true }).locator('..')
    await expect(notebook.locator(':scope > ul > li > button')).toHaveText([
      'First part',
      'Second part',
    ])
    const firstPart = headings
      .getByRole('button', { name: 'First part', exact: true })
      .locator('..')
    await expect(firstPart.locator(':scope > ul > li > button')).toHaveText(['Detail'])

    await folderToggle.focus()
    await page.keyboard.press('Tab')
    await expect(root.getByRole('button', { name: 'Close folder', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(root).toHaveCount(0)
    await expect(openFolder).toBeFocused()
    await expect(fileSearch).toBeHidden()
    await expect(editor.locator('.cm-line')).toHaveText(draft.split('\n'))
    await expect(page.getByRole('tab', { name: 'Notes.md', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: /^Untitled \d+ Unsaved changes$/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await application.evaluate(({ Menu }) => {
      const command = Menu.getApplicationMenu()
        ?.items.flatMap((item) => item.submenu?.items ?? [])
        .find((item) => item.accelerator === 'CmdOrCtrl+P')
      if (!command) throw new Error('Missing file search command')
      command.click()
    })
    await expect(
      page.locator('.workspace-search').getByRole('button', { name: 'Open folder…', exact: true }),
    ).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(fileSearch).toBeHidden()
    await expect(openFolder).toBeFocused()
    await page.locator('.recent-workspaces > summary').click()
    await page.locator('.recent-workspaces button').filter({ hasText: 'Writing notes' }).click()
    await expect(rootPath).toHaveText(folder)
    await expect(fileSearch).toBeVisible()
    await folderToggle.click()
    await root.getByRole('button', { name: 'Close folder', exact: true }).click()
    await expect(root).toHaveCount(0)
    await expect(fileSearch).toBeHidden()
    await expect(editor.locator('.cm-line')).toHaveText(draft.split('\n'))
    expect(await readFile(path, 'utf8')).toBe(source)

    await page.clock.install({ time: new Date(2026, 10, 2, 9, 5) })
    await page.clock.pauseAt(new Date(2026, 10, 2, 9, 5, 59))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    const clock = page.locator('.local-time')
    await expect(clock).toHaveText('09:05')
    await expect(clock).toHaveAttribute('title', 'Local time')
    await page.clock.runFor(1000)
    await expect(clock).toHaveText('09:06')
    await page.clock.setSystemTime(new Date(2026, 10, 2, 23, 59, 59))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(clock).toHaveText('23:59')
    await page.clock.runFor(1000)
    await expect(clock).toHaveText('00:00')
    await expect(clock).toHaveAttribute('datetime', '00:00')
  } finally {
    await application
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy()
      })
      .catch(() => {})
    await application.close()
  }
})
