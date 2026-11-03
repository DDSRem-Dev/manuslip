import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { type ElectronApplication, expect, type Locator, type Page, test } from '@playwright/test'
import axe from 'axe-core'
import { clickDocumentAction, launchDesktop } from './helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const prefix = '# Table notes 笔记\r\n\r\n'
const suffix = '\r\n\r\n[private]: https://example.invalid/private\r\n\r\nEnd.\r\n'
const original = `${prefix}| Name | Detail |\r\n| :--- | ---: |\r\n| Alpha | \`code\\|pipe\` |\r\n| Beta | [ref][private] |${suffix}`
const expected = `${prefix}| Detail | Name | Notes |\r\n| ---: | :---: | --- |\r\n| [ref][private] | Beta | beta note |\r\n| \`code\\|pipe\` | Edited \\| 中文 :smile: | alpha note |\r\n| New | Third | **safe** [unsafe](javascript:alert(1)) |${suffix}`
const copy = {
  en: {
    source: 'Source',
    live: 'Live Preview',
    edit: 'Edit table',
    cancel: 'Cancel',
    apply: 'Apply changes',
    header: 'Header',
    row: 'Row',
    column: 'Column',
    alignment: 'Column alignment',
    below: 'Insert row below',
    above: 'Insert row above',
    removeRow: 'Remove row',
    rowDown: 'Move row down',
    rowUp: 'Move row up',
    columnAfter: 'Insert column after',
    columnBefore: 'Insert column before',
    removeColumn: 'Remove column',
    columnRight: 'Move column right',
    columnLeft: 'Move column left',
  },
  'zh-CN': {
    source: '源码',
    live: '实时预览',
    edit: '编辑表格',
    cancel: '取消',
    apply: '应用更改',
    header: '表头',
    row: '行',
    column: '列',
    alignment: '列对齐',
    below: '在下方插入行',
    above: '在上方插入行',
    removeRow: '删除行',
    rowDown: '下移行',
    rowUp: '上移行',
    columnAfter: '在右侧插入列',
    columnBefore: '在左侧插入列',
    removeColumn: '删除列',
    columnRight: '右移列',
    columnLeft: '左移列',
  },
}
async function stop(application: ElectronApplication): Promise<void> {
  await application
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    .catch(() => {})
  await application.close()
}
async function audit(page: Page, name: string): Promise<void> {
  await page.evaluate(axe.source)
  const value = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: typeof import('axe-core') }).axe.run(
      document,
      {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
        },
      },
    )
    return {
      version: result.testEngine.version,
      violations: result.violations,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }
  })
  await test.info().attach(`${name}-accessibility`, {
    body: JSON.stringify(value),
    contentType: 'application/json',
  })
  expect(value.violations).toEqual([])
  expect(value.overflow).toBe(false)
  await test.info().attach(`${name}-tree`, {
    body: await page.locator('body').ariaSnapshot(),
    contentType: 'text/plain',
  })
  const path = test.info().outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await test.info().attach(name, { path, contentType: 'image/png' })
}
for (const locale of ['en', 'zh-CN'] as const) {
  test(`${locale} visual tables stage edits, navigate cells and preserve source history and saved bytes`, async () => {
    test.setTimeout(60_000)
    const directory = await mkdtemp(resolve('test/artifacts/logs/table-editing-'))
    if (!directory.startsWith(resolve('test/artifacts/logs') + sep))
      throw new Error('Unsafe fixture path')
    const profile = join(directory, 'profile'),
      path = join(directory, 'table.md'),
      names = copy[locale]
    await mkdir(profile)
    await writeFile(
      join(profile, 'preferences.json'),
      JSON.stringify({ schemaVersion: 1, locale, theme: locale === 'en' ? 'light' : 'dark' }),
    )
    await writeFile(path, original)
    let application = await launchDesktop(profile, [path])
    const errors: string[] = []
    try {
      let page = await application.firstWindow()
      page.on('pageerror', (error) => errors.push(error.message))
      await page.getByRole('button', { name: names.source, exact: true }).click()
      let editor = page.locator('.cm-content')
      await expect(editor).toContainText('| Name | Detail |')
      await editor.press(`${modifier}+Home`)
      await editor.press('ArrowDown')
      await editor.press('ArrowDown')
      await editor.press('Home')
      await editor.press('ArrowRight')
      await clickDocumentAction(page, names.edit)
      const dialog = page.getByRole('dialog', { name: names.edit, exact: true })
      const input = (row: number, column: number): Locator =>
        dialog.getByRole('textbox', {
          name: `${row === 0 ? names.header : `${names.row} ${row}`}, ${names.column} ${column}`,
          exact: true,
        })
      const action = async (menu: string, name: string): Promise<void> => {
        await dialog.getByRole('button', { name: menu, exact: true }).click()
        await dialog
          .getByRole('group', { name: menu, exact: true })
          .getByRole('button', { name, exact: true })
          .click()
      }
      await expect(input(0, 1)).toHaveValue('Name')
      await input(1, 1).fill('Discarded')
      await action(names.row, names.below)
      await dialog.getByRole('button', { name: names.cancel, exact: true }).click()
      await expect(dialog).not.toBeVisible()
      await expect(editor).toBeFocused()
      await editor.press(`${modifier}+s`)
      await expect.poll(() => readFile(path, 'utf8')).toBe(original)
      await clickDocumentAction(page, names.edit)
      await expect(input(1, 1)).toHaveValue('Alpha')
      await dialog.getByRole('button', { name: names.apply, exact: true }).click()
      await expect(dialog).not.toBeVisible()
      await editor.press(`${modifier}+End`)
      await page.getByRole('button', { name: names.live, exact: true }).click()
      await page.locator('.cm-live-table').focus()
      await page.locator('.cm-live-table').press('F2')
      await expect(page.locator('.cm-live-table')).toBeVisible()
      await expect(page.locator('[data-table-cell-editor]')).toBeFocused()
      await expect(page.locator('[data-table-cell-editor]')).toHaveText('Name')
      await expect(dialog).not.toBeVisible()
      await clickDocumentAction(page, names.edit)
      await expect(input(0, 1)).toBeFocused()
      await input(0, 1).press(`${modifier}+1`)
      await expect(page.getByRole('button', { name: names.live, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await input(0, 1).press('Tab')
      await expect(input(0, 2)).toBeFocused()
      await input(0, 2).press('Enter')
      await expect(input(1, 2)).toBeFocused()
      await input(1, 2).press('Alt+ArrowLeft')
      await expect(input(1, 1)).toBeFocused()
      await input(1, 1).press('ArrowDown')
      await expect(input(2, 1)).toBeFocused()
      await input(2, 1).press('Shift+Enter')
      await expect(input(1, 1)).toBeFocused()
      await input(1, 1).fill('Edited | 中文 :smile:')
      await audit(page, 'table-dialog-wide')
      await action(names.row, names.rowDown)
      await expect(input(2, 1)).toHaveValue('Edited | 中文 :smile:')
      await action(names.column, names.columnRight)
      await expect(input(0, 2)).toHaveValue('Name')
      await dialog
        .getByRole('combobox', { name: names.alignment, exact: true })
        .selectOption('center')
      await action(names.column, names.columnAfter)
      await input(0, 3).fill('Notes')
      await input(1, 3).fill('beta note')
      await input(2, 3).fill('alpha note')
      await action(names.column, names.columnLeft)
      await expect(input(0, 2)).toHaveValue('Notes')
      await action(names.column, names.columnRight)
      await action(names.column, names.columnBefore)
      await expect(dialog.getByRole('textbox')).toHaveCount(12)
      await action(names.column, names.removeColumn)
      await expect(dialog.getByRole('textbox')).toHaveCount(9)
      await action(names.row, names.below)
      await input(3, 1).fill('New')
      await input(3, 2).fill('Third')
      await input(3, 3).fill('**safe** [unsafe](javascript:alert(1))')
      await action(names.row, names.rowUp)
      await expect(input(2, 1)).toHaveValue('New')
      await action(names.row, names.rowDown)
      await action(names.row, names.above)
      await expect(dialog.getByRole('textbox')).toHaveCount(15)
      await action(names.row, names.removeRow)
      await expect(dialog.getByRole('textbox')).toHaveCount(12)
      await dialog.getByRole('button', { name: names.row, exact: true }).click()
      await audit(page, 'table-menu-wide')
      await page.keyboard.press('Escape')
      await expect(dialog).toBeVisible()
      await page.setViewportSize({ width: 420, height: 900 })
      await input(3, 3).focus()
      await audit(page, 'table-dialog-narrow')
      await dialog.getByRole('button', { name: names.apply, exact: true }).click()
      await expect(dialog).not.toBeVisible()
      await expect(editor).toBeFocused()
      await editor.press(`${modifier}+s`)
      await expect.poll(() => readFile(path, 'utf8')).toBe(expected)
      await page.setViewportSize({ width: 1144, height: 715 })
      await editor.press(`${modifier}+Home`)
      await expect(page.locator('.cm-live-table th')).toHaveCount(3)
      await expect(page.locator('.cm-live-table tbody tr')).toHaveCount(3)
      await expect(page.locator('.cm-live-table .md-emoji')).toHaveText('😄')
      await expect(page.locator('.cm-live-table a[href^="javascript:"]')).toHaveCount(0)
      await page.getByRole('button', { name: names.source, exact: true }).click()
      await editor.press(`${modifier}+z`)
      await editor.press(`${modifier}+s`)
      await expect.poll(() => readFile(path, 'utf8')).toBe(original)
      await editor.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y')
      await editor.press(`${modifier}+s`)
      await expect.poll(() => readFile(path, 'utf8')).toBe(expected)
      expect(errors).toEqual([])
      await stop(application)
      application = await launchDesktop(profile, [path])
      page = await application.firstWindow()
      await page.getByRole('button', { name: names.source, exact: true }).click()
      editor = page.locator('.cm-content')
      await expect(editor).toContainText('Edited \\| 中文 :smile:')
      expect(
        createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      ).toBe(createHash('sha256').update(expected).digest('hex'))
      await test
        .info()
        .attach('saved-table', { body: await readFile(path), contentType: 'text/markdown' })
    } finally {
      await stop(application).catch(() => {})
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  })
}
for (const [kind, source, message] of [
  [
    'excess cells',
    '| A | B |\n| --- | --- |\n| one | two | hidden |\n',
    'This table cannot be edited visually. Use Source to keep its full structure.',
  ],
  [
    'row limit',
    `| A |\n| --- |\n${'| row |\n'.repeat(200)}`,
    'This table exceeds the visual editor’s limits. Use Source to edit the complete table.',
  ],
] as const) {
  test(`visual table ${kind} fallback retains complete editable source`, async () => {
    const directory = await mkdtemp(resolve('test/artifacts/logs/table-fallback-'))
    if (!directory.startsWith(resolve('test/artifacts/logs') + sep))
      throw new Error('Unsafe fixture path')
    const path = join(directory, 'table.md'),
      profile = join(directory, 'profile')
    await writeFile(path, source)
    const application = await launchDesktop(profile, [path])
    try {
      const page = await application.firstWindow()
      await page.getByRole('button', { name: 'Source', exact: true }).click()
      const editor = page.locator('.cm-content')
      await editor.press(`${modifier}+Home`)
      await editor.press('ArrowRight')
      await clickDocumentAction(page, 'Edit table')
      const dialog = page.getByRole('dialog', { name: 'Edit table', exact: true })
      await expect(dialog.getByRole('alert')).toHaveText(message)
      await expect(dialog.getByRole('textbox')).toHaveCount(0)
      await dialog.getByRole('button', { name: 'Edit source', exact: true }).click()
      await expect(dialog).not.toBeVisible()
      await expect(editor).toBeFocused()
      await editor.press(`${modifier}+s`)
      await expect.poll(() => readFile(path, 'utf8')).toBe(source)
    } finally {
      await stop(application)
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  })
}
