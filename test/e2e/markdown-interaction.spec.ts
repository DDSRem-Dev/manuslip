import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import axe from 'axe-core'
import { launchDesktop } from './helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const tableSource =
  '| Name | Detail |\n| :--- | ---: |\n| 中文 | **Quiet** |\n| Empty | |\n| Sparse |'
const diagramSource = '```mermaid\ngraph LR\n  A[Draft] --> B[Ready]\n```'
const source = [
  '# A quiet page',
  'Clear **emphasis**, `inline code` and punctuation，标点。',
  'Escaped \\* and &amp; with :smile: nearby.',
  tableSource,
  diagramSource,
  '| Other | Value |\n| -- | -- |\n| Separate | Untouched |',
  'End.',
].join('\n\n')

for (const locale of ['en', 'zh-CN'] as const) {
  test(`${locale} live cells and diagrams keep editing sessions, source history and refined styling`, async () => {
    const directory = await mkdtemp(resolve('test/artifacts/logs/markdown-interaction-'))
    const profile = join(directory, 'profile')
    const path = join(directory, 'document.md')
    await mkdir(profile)
    await writeFile(
      join(profile, 'preferences.json'),
      JSON.stringify({
        schemaVersion: 1,
        locale,
        theme: locale === 'en' ? 'light' : 'dark',
      }),
    )
    await writeFile(path, source)
    const application = await launchDesktop(profile, [path])
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await page.setViewportSize({ width: 1144, height: 1100 })
      const editor = page.locator('.cm-content:not([data-table-cell-editor])')
      const table = page.locator('.cm-live-table').first()
      const cell = page.locator('[data-table-cell-editor]')
      await expect(table.locator('td').first()).toHaveText('中文')
      await expect(
        editor.getByRole('button', { name: /^(Select source|选择源码|Edit table|编辑表格)$/ }),
      ).toHaveCount(0)
      await expect(table).toHaveCSS('border-width', '0px')
      await page.screenshot({ path: test.info().outputPath('rendered.png') })

      const escaped = editor.locator('.cm-line').filter({ hasText: 'Escaped' })
      await escaped.click()
      await editor.press('Home')
      for (let index = 0; index < 8; index++) await editor.press('ArrowRight')
      const hint = editor.locator('.cm-live-source-hint')
      await expect(hint).toHaveText('\\*')
      expect(await hint.evaluate((element) => getComputedStyle(element).color)).not.toBe(
        await editor.evaluate((element) => getComputedStyle(element).color),
      )
      await page.screenshot({ path: test.info().outputPath('escape-hint.png') })
      await editor.press('End')
      for (let index = 0; index < 8; index++) await editor.press('ArrowLeft')
      await expect(hint).toHaveText(':smile:')
      expect(
        await hint.evaluate((element) => {
          const color = getComputedStyle(element).color
          return [...element.querySelectorAll('*')].every(
            (child) => getComputedStyle(child).color === color,
          )
        }),
      ).toBe(true)
      await page.screenshot({ path: test.info().outputPath('emoji-hint.png') })
      await editor.press('End')
      await expect(hint).toHaveCount(0)
      const emoji = escaped.locator('.md-emoji')
      await expect(emoji).toHaveText('😄')
      expect(
        await emoji.evaluate((element) => Boolean(element.closest('.cm-live-inline-widget'))),
      ).toBe(false)
      await emoji.click()
      await expect(hint).toHaveText(':smile:')
      expect(await page.evaluate(() => getSelection()?.toString())).toBe('')
      await escaped.locator('.cm-live-source-glyph').click()
      await expect(hint).toHaveText(':smile:')
      await editor.press('End')
      await expect(hint).toHaveCount(0)
      await editor.press(`${modifier}+a`)
      await editor.press(`${modifier}+c`)
      expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe(source)
      await editor.press('ArrowRight')

      const cellTheme = () =>
        table.locator('th, td').evaluateAll((elements) =>
          elements.map((element) => {
            const style = getComputedStyle(element)
            return {
              background: style.backgroundColor,
              row: element.parentElement
                ? getComputedStyle(element.parentElement).backgroundColor
                : '',
              color: style.color,
              border: style.border,
              shadow: style.boxShadow,
              font: style.fontFamily,
              weight: style.fontWeight,
              align: style.textAlign,
              decoration: style.textDecorationLine,
            }
          }),
        )
      const renderedTheme = await cellTheme()
      await table.locator('td').nth(1).dblclick()
      await expect(cell).toBeFocused()
      await expect(cell).toHaveText('**Quiet**')
      const selection = await page.evaluate(() => getSelection()?.toString())
      expect(selection?.length).toBeGreaterThan(0)
      expect(selection).not.toBe('**Quiet**')
      await expect(page.locator('dialog[open]')).toHaveCount(0)
      expect(await cellTheme()).toEqual(renderedTheme)
      await expect(table.locator('.cm-live-cell-active')).toHaveCSS('box-shadow', 'none')
      await expect(table.locator('td').first()).toHaveText('中文')
      await expect(cell.locator('.cm-live-markup').first()).toHaveText('**')
      expect(
        await cell
          .locator('.cm-live-markup')
          .first()
          .evaluate((element) => getComputedStyle(element).color),
      ).not.toBe(await cell.evaluate((element) => getComputedStyle(element).color))
      await cell.press(`${modifier}+a`)
      await page.keyboard.insertText('**静かな文**')
      await expect(cell).toHaveText('**静かな文**')
      await cell.press(`${modifier}+s`)
      await expect
        .poll(() => readFile(path, 'utf8'))
        .toBe(source.replace('**Quiet**', '**静かな文**'))
      await page.screenshot({ path: test.info().outputPath('active-cell.png') })
      await cell.press(`${modifier}+z`)
      await expect(cell).toHaveText('**Quiet**')
      await expect(cell).toBeFocused()
      await cell.press('Tab')
      await expect(cell).toHaveText('Empty')
      expect(await cellTheme()).toEqual(renderedTheme)
      await cell.press('Tab')
      await expect(cell).toHaveText('')
      await page.keyboard.insertText('Filled')
      await expect(table.locator('td').nth(1)).toHaveText('Quiet')
      await cell.press(`${modifier}+z`)
      await expect(cell).toHaveText('')
      // A native save arriving during cell composition waits for the committed text.
      const ime = async (method: string, params: Record<string, unknown>) =>
        application.evaluate(
          async ({ BrowserWindow }, { method, params }) => {
            const debug = BrowserWindow.getAllWindows().find(
              (window) => !window.webContents.getURL().startsWith('manuslip-diagram:'),
            )?.webContents.debugger
            if (!debug) throw new Error('Missing editor window')
            if (!debug.isAttached()) debug.attach('1.3')
            await debug.sendCommand(method, params)
          },
          { method, params },
        )
      await ime('Input.imeSetComposition', { text: 'shi', selectionStart: 3, selectionEnd: 3 })
      await expect(cell).toHaveText('shi')
      await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()
          .find((window) => !window.webContents.getURL().startsWith('manuslip-diagram:'))
          ?.webContents.send('manuslip:command', 'save')
      })
      expect(await readFile(path, 'utf8')).not.toContain('shi')
      await ime('Input.imeSetComposition', { text: '世界', selectionStart: 2, selectionEnd: 2 })
      await ime('Input.insertText', { text: '世界' })
      await expect
        .poll(() => readFile(path, 'utf8'))
        .toBe(source.replace('| Empty | |', '| Empty | 世界|'))
      await expect(cell).toBeFocused()
      await cell.press(`${modifier}+z`)
      await expect(cell).toHaveText('')
      await cell.press('Tab')
      await expect(cell).toHaveText('Sparse')
      await cell.press('Tab')
      await expect(cell).toHaveText('')
      await page.keyboard.insertText('a | b ')
      await cell.press(`${modifier}+s`)
      await expect
        .poll(() => readFile(path, 'utf8'))
        .toBe(source.replace('| Sparse |', '| Sparse | a \\| b  |'))
      await cell.press(`${modifier}+z`)
      await expect(cell).toHaveText('')
      const otherTable = page.locator('.cm-live-table').nth(1)
      await otherTable.locator('td').last().click()
      await expect(cell).toHaveText('Untouched')
      await expect(table.locator('[data-table-cell-editor]')).toHaveCount(0)
      await cell.press('End')
      await page.keyboard.insertText(' changed')
      await cell.press(`${modifier}+s`)
      await expect
        .poll(() => readFile(path, 'utf8'))
        .toBe(source.replace('| Separate | Untouched |', '| Separate | Untouched changed |'))
      await cell.press(`${modifier}+z`)
      await expect(cell).toHaveText('Untouched')
      await table.locator('td').nth(1).click()
      await expect(cell).toHaveText('**Quiet**')
      await expect(otherTable.locator('[data-table-cell-editor]')).toHaveCount(0)

      const diagram = page.locator('.cm-live-diagram')
      await expect(diagram).toBeVisible()
      await diagram.click()
      await expect(cell).toHaveCount(0)
      await expect(editor.locator('.cm-live-edit-source').first()).toContainText('```mermaid')
      await expect(diagram).toHaveClass(/cm-live-edit-preview/)
      expect(await page.evaluate(() => getSelection()?.toString())).toBe('')
      await diagram.click()
      await expect(editor.locator('.cm-live-edit-source').first()).toContainText('```mermaid')
      await editor.locator('.cm-live-edit-source').filter({ hasText: 'A[Draft]' }).click()
      await editor.press('Home')
      await editor.press('Home')
      await editor.press('Shift+End')
      await page.keyboard.insertText('  A[Draft] --> B[Updated]')
      await editor.press(`${modifier}+s`)
      await expect.poll(() => readFile(path, 'utf8')).toBe(source.replace('B[Ready]', 'B[Updated]'))
      await expect(diagram).toHaveClass(/cm-live-edit-preview/)
      await expect(diagram.locator('svg')).toContainText('Updated')
      await expect(table).toBeVisible()
      await expect(editor.locator('.cm-live-edit-source').first()).toContainText('```mermaid')
      await editor.press(`${modifier}+z`)
      await expect(diagram.locator('svg')).toContainText('Ready')
      await page.screenshot({ path: test.info().outputPath('diagram-editing.png') })
      await table.locator('td').first().click()
      await expect(cell).toHaveText('中文')
      await cell.press('Escape')
      await expect(editor.locator('.cm-live-edit-source')).toHaveCount(0)
      await expect(diagram).toBeVisible()
      await table.focus()
      await table.press('F2')
      await expect(cell).toHaveText('Name')
      await expect(cell).toBeFocused()
      await expect(page.locator('dialog[open]')).toHaveCount(0)
      expect(await cellTheme()).toEqual(renderedTheme)
      await cell.press('Escape')

      await editor.press(`${modifier}+s`)
      await expect.poll(() => readFile(path, 'utf8')).toBe(source)
      for (const width of [480, 320]) {
        await page.setViewportSize({ width, height: 1100 })
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true)
        await page.screenshot({ path: test.info().outputPath(`rendered-${width}.png`) })
      }
      await page.evaluate(axe.source)
      expect(
        await page.evaluate(
          async () =>
            (await (window as unknown as { axe: typeof import('axe-core') }).axe.run()).violations,
        ),
      ).toEqual([])
      expect(errors).toEqual([])
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
