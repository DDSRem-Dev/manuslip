import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { clickDocumentAction, launchDesktop, openMarkdownExtensions } from './helpers'

test('raw HTML stays opt-in and sanitized; images cannot make ambient network requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-preview-security-'))
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    const requests: string[] = []
    page.on('request', (request) => {
      if (request.url().startsWith('https:')) requests.push(request.url())
    })
    const extensions = await openMarkdownExtensions(page)
    await expect(extensions.getByLabel('Render sanitized HTML')).toBeDisabled()
    await expect(extensions.getByLabel('Load remote images…', { exact: true })).toBeDisabled()
    await page.getByRole('searchbox', { name: 'Find a setting', exact: true }).fill('remote images')
    await page
      .locator('.preferences-results')
      .getByRole('button', { name: /^Plugins/ })
      .click()
    await expect(extensions).toBeVisible()
    await expect(page.locator('#markdown-render-scope')).toContainText('Open a document')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await editor.fill(
      '# Safe\n\n<div><strong>HTML text</strong><img src="https://example.com/private.png" onerror="window.compromised=true"><script>window.compromised=true</script><a href="javascript:alert(1)">Unsafe link</a><iframe src="https://example.com"></iframe><input autofocus name="location"></div>\n\nEnd',
    )
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Home' : 'Control+Home')
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    const widget = page.locator('.cm-live-html .cm-live-rendered')
    await expect(widget).toContainText('<strong>HTML text</strong>')
    await expect(widget.locator('strong')).toHaveCount(0)
    await openMarkdownExtensions(page)
    await extensions.getByLabel('Render sanitized HTML').check()
    await page.keyboard.press('Escape')
    await expect(widget.locator('strong')).toHaveText('HTML text')
    await expect(widget.locator('script, iframe, input, [onerror], a[href], img[src]')).toHaveCount(
      0,
    )
    await expect(widget.locator('img[data-remote-image]')).toHaveCount(1)
    expect(await page.evaluate(() => 'compromised' in window)).toBe(false)
    expect(requests).toEqual([])
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await editor.fill('# Tasks\n\n- [ ] Write a note\n\nEnd')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Home' : 'Control+Home')
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Toggle task' }).check()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await expect(editor).toContainText('- [x] Write a note')
    await editor.focus()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
    await expect(editor).toContainText('- [ ] Write a note')
    await editor.fill('# Images\n\n![Remote picture](https://127.0.0.1/private.png)\n\nEnd')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Home' : 'Control+Home')
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    await openMarkdownExtensions(page)
    const permission = extensions.getByLabel('Load remote images…', { exact: true })
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    })
    await permission.click()
    await expect(permission).not.toBeChecked()
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
    })
    await permission.click()
    await expect(permission).toBeChecked()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('img', { name: 'Remote picture', exact: true })).toBeAttached()
    await expect(page.locator('.cm-live-image-error')).toHaveText('Image unavailable')
    await expect(
      page.getByRole('button', { name: 'Retry Remote picture', exact: true }),
    ).toBeVisible()
    await expect(page.locator('.cm-live-rendered img[src]')).toHaveCount(0)
    await openMarkdownExtensions(page)
    await permission.uncheck()
    await expect(permission).not.toBeChecked()
    await page.keyboard.press('Escape')
    await clickDocumentAction(page, 'New document')
    await openMarkdownExtensions(page)
    await expect(extensions.getByLabel('Render sanitized HTML')).not.toBeChecked()
    await expect(permission).not.toBeChecked()
    await page.keyboard.press('Escape')
    await page.getByRole('tab').first().click()
    await openMarkdownExtensions(page)
    await expect(extensions.getByLabel('Render sanitized HTML')).toBeChecked()
    await expect(permission).not.toBeChecked()
    expect(requests).toEqual([])
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
