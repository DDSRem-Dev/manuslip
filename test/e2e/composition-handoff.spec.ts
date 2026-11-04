import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchDesktop } from './helpers'

for (const mode of ['Source', 'Live Preview'])
  test(`keeps ${mode} commands guarded when composition restarts before a deferred end notification`, async () => {
    const directory = await mkdtemp(resolve('test/e2e/result/composition-handoff-'))
    if (!directory.startsWith(`${resolve('test/e2e/result')}${sep}`))
      throw new Error('Invalid test directory')
    const path = join(directory, 'source.md')
    const original = '# Original\n\nKeep this text. '
    await writeFile(path, original)
    const application = await launchDesktop(join(directory, 'profile'), [path])
    const errors: string[] = []
    try {
      const page = await application.firstWindow()
      page.on('pageerror', (error) => errors.push(error.message))
      await expect(page.getByRole('tab', { name: 'source.md', exact: true })).toBeVisible()
      await page.getByRole('button', { name: mode, exact: true }).click()
      const editor = page.getByRole('textbox', { name: 'Markdown source' })
      const exportHtml = page.getByRole('button', {
        name: 'Export HTML…',
        exact: true,
        includeHidden: true,
      })
      await editor.focus()
      await editor.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
      const ime = async (method: string, params: Record<string, unknown>) => {
        await application.evaluate(
          async ({ BrowserWindow }, { method, params }) => {
            const debug = BrowserWindow.getAllWindows()[0]?.webContents.debugger
            if (!debug) throw new Error('Missing source debugger')
            if (!debug.isAttached()) debug.attach('1.3')
            await debug.sendCommand(method, params)
          },
          { method, params },
        )
      }
      await ime('Input.imeSetComposition', { text: 'shi', selectionStart: 3, selectionEnd: 3 })
      await expect(editor).toContainText('shi')
      await expect(exportHtml).toBeDisabled()
      const handoff = await editor.evaluate(async (content) => {
        const events: { type: string; trusted: boolean }[] = []
        for (const type of ['compositionend', 'compositionstart']) {
          content.addEventListener(
            type,
            (event) => events.push({ type, trusted: event.isTrusted }),
            { once: true },
          )
        }
        // Exercise two notifications in the same task, before the earlier end microtask.
        content.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
        content.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
        await Promise.resolve()
        return { events }
      })
      await test.info().attach('composition-handoff', {
        body: JSON.stringify(handoff, null, 2),
        contentType: 'application/json',
      })
      expect(handoff.events).toEqual([
        { type: 'compositionend', trusted: false },
        { type: 'compositionstart', trusted: false },
      ])
      await expect(exportHtml).toBeDisabled()
      await ime('Input.imeSetComposition', { text: '世界', selectionStart: 2, selectionEnd: 2 })
      await ime('Input.insertText', { text: '世界' })
      await expect(exportHtml).toBeEnabled()
      await expect(editor).toContainText('世界')
      await editor.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
      await expect.poll(() => readFile(path, 'utf8')).toBe(`${original}世界`)
      await editor.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
      await expect(editor).not.toContainText('世界')
      await editor.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
      await expect.poll(() => readFile(path, 'utf8')).toBe(original)
      await editor.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y')
      await expect(editor).toContainText('世界')
      await editor.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
      await expect.poll(() => readFile(path, 'utf8')).toBe(`${original}世界`)
      expect(errors).toEqual([])
    } finally {
      await application
        .evaluate(({ BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows())
            if (!window.isDestroyed()) window.destroy()
        })
        .catch(() => {})
      await application.close()
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  })
