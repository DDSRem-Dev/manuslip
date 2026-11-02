import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchDesktop } from './helpers'

const original = '# Pending input\n\nKeep this text. '
const pending = 'pending 世界'
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('HTML export includes input pending in the editor DOM observer', async () => {
  await mkdir('test/artifacts/logs', { recursive: true })
  const directory = await mkdtemp(resolve('test/artifacts/logs/export-input-'))
  const path = join(directory, 'source.md')
  const target = join(directory, 'pending.html')
  await writeFile(path, original)
  const application = await launchDesktop(join(directory, 'profile'), [path])
  try {
    const page = await application.firstWindow()
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await expect(editor).toContainText('Keep this text.')
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await editor.focus()
    await editor.press(`${modifier}+End`)
    await application.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
    }, target)
    // Keep input and the command in one task, before the DOM observer can deliver it.
    const result = await page.evaluate((pending) => {
      const content = document.querySelector('.cm-content')
      const button = [...document.querySelectorAll('button')].find(
        (element) => element.textContent === 'Export HTML…',
      )
      if (!content || !button) throw new Error('Missing export/source controls')
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
      let last: Text | null = null
      for (let node = walker.nextNode(); node; node = walker.nextNode()) last = node as Text
      if (!last) throw new Error('Missing source text')
      last.appendData(pending)
      getSelection()?.collapse(last, last.length)
      content.dispatchEvent(
        new InputEvent('input', { inputType: 'insertText', data: pending, bubbles: true }),
      )
      button.click()
      return content.textContent
    }, pending)
    expect(result).toContain(pending)
    await expect(page.getByText(`Exported to ${target}`, { exact: false })).toBeVisible()
    const html = await readFile(target, 'utf8')
    await test.info().attach('pending-input-export', { body: html, contentType: 'text/html' })
    expect(html).toContain(`Keep this text. ${pending}`)
    await editor.press(`${modifier}+z`)
    await expect(editor).not.toContainText(pending)
    await editor.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y')
    await expect(editor).toContainText(pending)
    await editor.press(`${modifier}+s`)
    await expect.poll(() => readFile(path, 'utf8')).toBe(original + pending)
  } finally {
    await application
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy()
      })
      .catch(() => {})
    await application.close()
  }
})
