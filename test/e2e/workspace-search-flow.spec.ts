import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { clickDocumentAction, launchDesktop } from './helpers'
import { stop } from './recovery-helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
async function openFolder(application: ElectronApplication, page: Page, root: string) {
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, root)
  await clickDocumentAction(page, 'Open folder…')
  await page.getByRole('button', { name: 'Find a file', exact: true }).click()
  const panel = page.locator('.workspace-search')
  await panel.getByLabel('Search for', { exact: true }).selectOption('text')
  return panel
}

test('native search pages real results, edits the selected UTF-16 match and restores the saved tab after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-search-flow-'))
  const profile = join(directory, 'profile'),
    root = join(directory, 'workspace'),
    path = join(root, 'chapters', 'unicode.md')
  const utf16 = (text: string) =>
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
  await mkdir(join(root, 'chapters'), { recursive: true })
  await mkdir(join(root, '.git'))
  await writeFile(join(root, '.gitignore'), 'ignored.md\n')
  await writeFile(join(root, 'ignored.md'), 'needle ignored')
  await writeFile(join(root, '.hidden.md'), 'needle hidden')
  await Promise.all(
    Array.from({ length: 56 }, (_, index) =>
      writeFile(join(root, `note-${index}.md`), `needle ${index}\n`),
    ),
  )
  await writeFile(path, utf16('# 世界\r\n😀 needle 中文\r\n'))
  let application = await launchDesktop(profile)
  try {
    let page = await application.firstWindow()
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    let editor = page.getByRole('textbox', { name: 'Markdown source' })
    await editor.fill('A draft kept while searching')
    const panel = await openFolder(application, page, root)
    await panel.locator('#workspace-query').fill('needle')
    await expect(panel.getByRole('status')).toHaveText('57 results')
    const results = panel.locator('.search-results button')
    await expect(results).toHaveCount(50)
    await panel.getByRole('button', { name: 'Show more results', exact: true }).click()
    await expect(results).toHaveCount(57)
    await expect(results.nth(50)).toBeFocused()
    await expect(panel.locator('.search-results')).not.toContainText('ignored.md')
    await expect(panel.locator('.search-results')).not.toContainText('.hidden.md')
    await panel.getByRole('button', { name: /chapters\/unicode\.md/ }).click()
    await expect(editor).toBeFocused()
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('needle')
    await page.keyboard.insertText('replaced')
    await editor.press(`${modifier}+s`)
    await expect.poll(() => readFile(path)).toEqual(utf16('# 世界\r\n😀 replaced 中文\r\n'))
    await page.getByRole('tab', { name: 'Untitled 1', exact: false }).click()
    await expect(editor).toHaveText('A draft kept while searching')
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    })
    await page.getByRole('button', { name: 'Close Untitled 1', exact: true }).click()
    await expect(page.getByRole('tab')).toHaveCount(1)
    await application.close()

    application = await launchDesktop(profile)
    page = await application.firstWindow()
    editor = page.getByRole('textbox', { name: 'Markdown source' })
    await expect(page.getByRole('tab', { name: 'unicode.md', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await expect(editor).toContainText('😀 replaced 中文')
    await page.getByRole('button', { name: 'Show workspace', exact: true }).click()
    await page.getByRole('button', { name: 'Find a file', exact: true }).click()
    const restoredPanel = page.locator('.workspace-search')
    await restoredPanel.getByLabel('Search for', { exact: true }).selectOption('text')
    await restoredPanel.locator('#workspace-query').fill('replaced')
    await expect(restoredPanel.getByRole('status')).toHaveText('1 result')
    await restoredPanel.locator('.search-results button').click()
    await expect(page.getByRole('tab')).toHaveCount(1)
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('replaced')
    expect(await readFile(path)).toEqual(utf16('# 世界\r\n😀 replaced 中文\r\n'))
  } finally {
    await stop(application)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('opening a stale native search result shows current disk text and a new query selects the correct match', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-search-stale-flow-'))
  const root = join(directory, 'workspace'),
    path = join(root, 'writing.md')
  await mkdir(root)
  await writeFile(path, '# Heading\n\nBefore needle after.\n')
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    const panel = await openFolder(application, page, root)
    await panel.locator('#workspace-query').fill('needle')
    await expect(panel.getByRole('status')).toHaveText('1 result')
    await writeFile(path, '# Current disk\n\nExternal replacement 世界.\n')
    await panel.locator('.search-results button').click()
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await expect(editor).toContainText('External replacement 世界.')
    await expect(panel.getByRole('alert')).toContainText('this line differs from the saved file')
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('')
    await panel.locator('#workspace-query').fill('replacement')
    await expect(panel.getByRole('status')).toHaveText('1 result')
    await panel.locator('.search-results button').click()
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toBe('replacement')
    await expect(panel.getByRole('alert')).toHaveCount(0)
    await page.keyboard.insertText('revision')
    await editor.press(`${modifier}+s`)
    await expect
      .poll(() => readFile(path, 'utf8'))
      .toBe('# Current disk\n\nExternal revision 世界.\n')
    await expect(page.getByRole('tab')).toHaveCount(2)
  } finally {
    await stop(application)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
