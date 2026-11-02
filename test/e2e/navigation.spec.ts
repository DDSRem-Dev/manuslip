import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { clickDocumentAction, contrast, launchDesktop } from './helpers'

async function menu(
  application: ElectronApplication,
  label: string,
  accelerator: string,
): Promise<void> {
  await application.evaluate(
    ({ Menu }, { label, accelerator }) => {
      const items =
        Menu.getApplicationMenu()?.items.flatMap((item) => item.submenu?.items || []) || []
      const item = items.find((item) => item.label === label)
      if (!item || item.accelerator !== accelerator) throw new Error('Missing navigation command')
      item.click()
    },
    { label, accelerator },
  )
}
async function cleanup(application: ElectronApplication, directory: string): Promise<void> {
  await application
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    .catch(() => {})
  await application.close()
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
async function checkContrast(page: Page): Promise<void> {
  const pairs = await page
    .locator(
      '.workspace-search :is(summary, label, input[type=search], select, p, button, bdi, small, span), .document-outline :is(summary, button, p)',
    )
    .evaluateAll((elements) =>
      elements
        .filter(
          (element) =>
            element.getBoundingClientRect().height > 0 && !element.closest('button:disabled'),
        )
        .map((element) => {
          let background: Element | null = element
          while (background && getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)')
            background = background.parentElement
          return {
            text: element.textContent,
            foreground: getComputedStyle(element).color,
            background: getComputedStyle(background || document.documentElement).backgroundColor,
          }
        }),
    )
  expect(pairs.length).toBeGreaterThan(0)
  for (const pair of pairs)
    expect(contrast(pair.foreground, pair.background), pair.text || '').toBeGreaterThanOrEqual(4.5)
  console.log(
    'Navigation minimum text contrast:',
    Math.min(...pairs.map((pair) => contrast(pair.foreground, pair.background))).toFixed(2),
  )
}

test('workspace search finds unexpanded paths, opens Unicode matches and preserves dirty tabs', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'manuslip-navigation-')))
  const root = join(directory, '写作项目')
  await mkdir(join(root, 'chapters'), { recursive: true })
  await writeFile(join(root, 'notes.md'), '# Intro\n😀 中文 NEEDLE rest\n')
  await writeFile(join(root, 'chapters', 'notes.md'), '# Other\nneedle here\n')
  await writeFile(join(root, 'chapters', 'Writing-notes.md'), '# Writing\nNested document\n')
  await writeFile(join(root, 'Content-only.md'), 'notes notes\nnotes notes\n')
  await writeFile(join(root, 'many.md'), 'overflow-only\n'.repeat(510))
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await editor.fill('draft retained while searching')
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, root)
    await clickDocumentAction(page, 'Open folder…')
    await menu(application, 'Find file…', 'CmdOrCtrl+P')
    let query = page.getByRole('searchbox', { name: 'Find a file', exact: true })
    await expect(query).toBeFocused()
    await query.fill('wrnt')
    const results = page.locator('.search-results button')
    await expect(results).toHaveCount(1)
    await expect(results.first()).toHaveText('chapters/Writing-notes.md')
    await expect(page.locator('#workspace-search-mode')).toHaveValue('filename')
    await query.fill('notes')
    await expect(results).toHaveCount(3)
    expect((await results.allTextContents()).sort()).toEqual([
      'chapters/Writing-notes.md',
      'chapters/notes.md',
      'notes.md',
    ])
    for (const path of [
      'chapters/Writing-notes.md',
      ...(process.platform === 'win32' ? ['chapters\\Writing-notes.md'] : []),
    ]) {
      await query.fill(path)
      await expect(results).toHaveCount(1)
      await expect(results.first()).toHaveText('chapters/Writing-notes.md')
    }
    await query.fill('not-present-anywhere')
    await expect(page.locator('.workspace-search [role=status]')).toContainText(
      'Try a shorter query',
    )
    await query.fill('wrnt')
    await expect(results).toHaveCount(1)
    await results.first().click()
    await expect(editor).toContainText('Nested document')
    await page.getByRole('tab', { name: 'Untitled 1', exact: false }).click()
    await expect(editor).toHaveText('draft retained while searching')
    await menu(application, 'Search workspace…', 'CmdOrCtrl+Shift+F')
    query = page.getByRole('searchbox', { name: 'Find a file', exact: true })
    await expect(query).toBeFocused()
    await expect(page.locator('#workspace-search-mode')).toHaveValue('filename')
    await query.fill('NEEDLE')
    await expect(results).toHaveCount(0)
    await expect(page.locator('.workspace-search [role=status]')).toContainText('No matches')
    await page.locator('#workspace-search-mode').selectOption('text')
    query = page.getByRole('searchbox', { name: 'Find text in files', exact: true })
    await query.focus()
    await expect(query).toBeFocused()
    await query.fill('NEEDLE')
    await expect(results).toHaveCount(2)
    await expect(results).toContainText(['notes.md', 'notes.md'])
    await page.getByRole('checkbox', { name: 'Match case', exact: true }).check()
    await expect(results).toHaveCount(1)
    await expect(results.first()).toContainText('Line 2')
    await results.first().click()
    await expect(page.getByRole('tab', { name: 'notes.md', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('NEEDLE')
    await expect(page.getByText('Ln 2, Col 13', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await editor.fill('# Intro\nunsaved line instead\n')
    await results.first().click()
    await expect(page.locator('.workspace-search [role=alert]')).toContainText(
      'differs from the saved file',
    )
    await expect(editor).toContainText('unsaved line instead')
    await expect(page.getByRole('tab')).toHaveCount(3)
    await page.getByRole('button', { name: 'Close search', exact: true }).click()
    await expect(
      page
        .getByRole('navigation', { name: 'Document headings' })
        .getByRole('button', { name: 'Intro', exact: true }),
    ).toBeEnabled()
    await checkContrast(page)
    await page.screenshot({ path: test.info().outputPath('navigation-light.png') })
    await page.getByRole('button', { name: 'Preferences', exact: true }).click()
    await page.getByLabel('Appearance', { exact: true }).selectOption('dark')
    await menu(application, 'Search workspace…', 'CmdOrCtrl+Shift+F')
    query = page.getByRole('searchbox', { name: 'Find a file', exact: true })
    await expect(query).toBeFocused()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await checkContrast(page)
    await page.screenshot({ path: test.info().outputPath('navigation-dark.png') })
    await page.getByRole('button', { name: 'Preferences', exact: true }).click()
    await page.getByLabel('Interface language').selectOption('zh-CN')
    await page.getByRole('button', { name: '关闭偏好设置', exact: true }).click()
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(2),
    )
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByRole('searchbox', { name: '查找文件', exact: true })).toBeVisible()
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1),
    )
    await page.setViewportSize({ width: 320, height: 950 })
    await menu(application, '搜索工作区…', 'CmdOrCtrl+Shift+F')
    await expect(page.locator('#workspace-search-mode')).toHaveValue('filename')
    await page.locator('#workspace-search-mode').selectOption('text')
    const input = page.getByRole('searchbox', { name: '在文件中查找文本', exact: true })
    await input.focus()
    await expect(input).toBeFocused()
    await expect
      .poll(async () => {
        const bounds = await input.boundingBox()
        return bounds && bounds.y >= 0 && bounds.y + bounds.height < 950
      })
      .toBe(true)
    expect(await input.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('2px')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath('navigation-narrow-chinese.png') })
    await input.fill('overflow-only')
    await expect(page.locator('.workspace-search')).toContainText('已达到搜索上限')
    await expect(results).toHaveCount(50)
    await page.getByRole('button', { name: '显示更多结果', exact: true }).click()
    await expect(results).toHaveCount(100)
    expect(errors).toEqual([])
  } finally {
    await cleanup(application, directory)
  }
})

test('Source outline pages whole-document headings and jumps without losing undo or counts', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'manuslip-outline-')))
  const path = join(directory, 'outline.md')
  const source =
    '# Start\n\n' +
    Array.from(
      { length: 205 },
      (_, index) => `## Section ${index + 1}\n\nText for section.\n\n`,
    ).join('') +
    '## Final heading\n\nLast paragraph.'
  await writeFile(path, source)
  const application = await launchDesktop(join(directory, 'profile'), [path])
  try {
    const page = await application.firstWindow()
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await expect(page.getByRole('tab', { name: 'outline.md', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await page.getByRole('button', { name: 'Show workspace', exact: true }).click()
    const outline = page.getByRole('navigation', { name: 'Document headings' })
    await expect(outline.locator('li button')).toHaveCount(200)
    await outline.getByRole('button', { name: 'Show more headings', exact: true }).click()
    await expect(outline.locator('li button')).toHaveCount(207)
    const finalLine = source.slice(0, source.indexOf('## Final heading')).split('\n').length
    await outline.getByRole('button', { name: 'Final heading', exact: true }).click()
    await expect(editor).toBeFocused()
    await expect(page.getByText(`Ln ${finalLine}, Col 1`, { exact: true })).toBeVisible()
    await expect(editor.locator('.cm-line').filter({ hasText: '## Final heading' })).toBeVisible()
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${modifier}+End`)
    await page.keyboard.insertText('\n\n## Added in Source')
    await expect(
      outline.getByRole('button', { name: 'Added in Source', exact: true }),
    ).toBeEnabled()
    await expect(page.locator('.editor-status')).toContainText('Characters')
    await outline.getByRole('button', { name: 'Added in Source', exact: true }).click()
    await page.keyboard.press(`${modifier}+z`)
    await expect(outline.getByRole('button', { name: 'Added in Source', exact: true })).toHaveCount(
      0,
    )
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    await outline.getByRole('button', { name: 'Section 1', exact: true }).click()
    await expect(page.getByText('Ln 3, Col 1', { exact: true })).toBeVisible()
  } finally {
    await cleanup(application, directory)
  }
})
