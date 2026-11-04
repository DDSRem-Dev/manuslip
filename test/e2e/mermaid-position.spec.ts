import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchDesktop } from './helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const value = 'flowchart TB\n A["Shared"] --> B["Shared"]\n B --> C["完成😀"]'

for (const { width, zoom, theme } of [
  { width: 1144, zoom: 1, theme: 'light' },
  { width: 420, zoom: 1.25, theme: 'dark' },
]) {
  test(`${theme} first Mermaid click maps duplicate nodes, glyphs and shapes without disturbing an active selection`, async () => {
    const directory = await mkdtemp(resolve('test/e2e/result/mermaid-position-'))
    const profile = join(directory, 'profile'),
      path = join(directory, 'diagrams.md')
    const source = `# Diagrams\n\n\`\`\`mermaid\n${value}\n\`\`\`\n\nAfter.\n`
    await mkdir(profile)
    await writeFile(
      join(profile, 'preferences.json'),
      JSON.stringify({ schemaVersion: 1, locale: 'en', theme }),
    )
    await writeFile(path, source)
    const application = await launchDesktop(profile, [path])
    try {
      const page = await application.firstWindow()
      await page.setViewportSize({ width, height: 860 })
      await application.evaluate(({ BrowserWindow }, zoom) => {
        BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(zoom)
      }, zoom)
      const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
      const diagram = editor.locator('.cm-live-diagram')
      const from = value.lastIndexOf('Shared')
      const label = diagram.locator(`text[data-source-from="${from}"]`)
      await expect(diagram.locator('svg')).toBeVisible()
      await expect(label).toHaveText('Shared')
      await expect(editor.locator('.cm-live-edit-source')).toHaveCount(0)
      await page.getByRole('button', { name: 'Source', exact: true }).focus()
      await label.hover()
      const point = await label.evaluate((element) => {
        const text = element as unknown as SVGTextContentElement
        const bounds = text.getExtentOfChar(0),
          matrix = text.getScreenCTM()
        if (!matrix) throw new Error('Missing diagram transform')
        const point = new DOMPoint(
          bounds.x + bounds.width * 0.8,
          bounds.y + bounds.height / 2,
        ).matrixTransform(matrix)
        return { x: point.x, y: point.y }
      })
      await page.mouse.click(point.x, point.y)
      await expect(editor).toBeFocused()
      expect(
        await page.evaluate(
          () => getSelection()?.focusNode?.parentElement?.closest('.cm-line')?.textContent,
        ),
      ).toBe(' A["Shared"] --> B["Shared"]')
      await page.keyboard.insertText('Q')
      await editor.press(`${modifier}+s`)
      await expect
        .poll(() => readFile(path, 'utf8'))
        .toBe(source.replace('B["Shared"]', 'B["SQhared"]'))
      await expect(diagram.locator('svg')).toContainText('SQhared')

      await editor.press('Shift+ArrowLeft')
      expect(await page.evaluate(() => getSelection()?.toString())).toBe('Q')
      await diagram.locator('text').filter({ hasText: 'Shared' }).first().click()
      await expect(editor).toBeFocused()
      expect(await page.evaluate(() => getSelection()?.toString())).toBe('Q')
      await page.keyboard.insertText('R')
      await editor.press(`${modifier}+s`)
      await expect
        .poll(() => readFile(path, 'utf8'))
        .toBe(source.replace('B["Shared"]', 'B["SRhared"]'))
      await editor.press(`${modifier}+z`)
      await editor.press(`${modifier}+z`)
      await expect(diagram.locator('svg')).toContainText('Shared')
      await editor.press('Escape')
      await expect(editor.locator('.cm-live-edit-source')).toHaveCount(0)

      const node = diagram.locator(`g[data-source-from="${from}"]`)
      const shape = node.locator('rect').first()
      await expect(shape).toBeVisible()
      await shape.click({ position: { x: 2, y: 2 } })
      await page.keyboard.insertText('Q')
      await editor.press(`${modifier}+s`)
      await expect
        .poll(() => readFile(path, 'utf8'))
        .toBe(source.replace('B["Shared"]', 'B["QShared"]'))
      await expect(diagram.locator('svg')).toContainText('QShared')
      await page.screenshot({ path: test.info().outputPath(`mermaid-position-${width}.png`) })
      await editor.press(`${modifier}+z`)
      await editor.press('Escape')
      await diagram.focus()
      await diagram.press('Space')
      await expect(editor).toBeFocused()
      expect(await page.evaluate(() => getSelection()?.toString())).toBe('')
      await expect(editor.locator('.cm-live-edit-source').first()).toHaveText('```mermaid')

      // A second family uses literal message offsets rather than flowchart IDs.
      await page.getByRole('button', { name: 'Source', exact: true }).click()
      const sequence = 'sequenceDiagram\nAlice->>Bob: Hello\nBob-->>Alice: Goodbye'
      const second = `\`\`\`mermaid\n${sequence}\n\`\`\`\n\nAfter.\n`
      await editor.fill(second)
      await editor.press(`${modifier}+Home`)
      await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
      const message = diagram.locator(`text[data-source-from="${sequence.indexOf('Goodbye')}"]`)
      await expect(message).toBeVisible()
      await message.click({ position: { x: 1, y: 2 } })
      await page.keyboard.insertText('Q')
      await editor.press(`${modifier}+s`)
      await expect.poll(() => readFile(path, 'utf8')).toBe(second.replace('Goodbye', 'QGoodbye'))
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
