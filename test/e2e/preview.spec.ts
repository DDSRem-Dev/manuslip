import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchDesktop } from './helpers'

test('Live Preview uses a worker and preserves source, selection and undo across mode switches', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-preview-'))
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(message.text())
    })
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    const source =
      '# Heading\n\n**Strong** text\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```js\nconst x = 1\n```\n\n$\\ce{H2O}$\n\nEnd'
    await editor.fill(source)
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${modifier}+Home`)
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    await expect(page.locator('.cm-live-table table')).toContainText('A')
    await expect(page.locator('.cm-live-code pre')).toContainText('const x = 1')
    await expect(page.locator('.cm-live-code .tok-keyword')).toHaveText('const')
    await expect(page.locator('[role="math"] svg path').first()).toBeAttached()
    await expect(page.locator('.cm-live-strong')).toHaveText('Strong')
    await page.screenshot({ path: test.info().outputPath('live-preview.png') })
    await expect(page.getByText('Updating preview…', { exact: true })).toHaveCount(0)
    expect(
      await page.evaluate(
        () => performance.getEntriesByName('manuslip:packed-preview-apply').length,
      ),
    ).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await expect
      .poll(async () => (await editor.locator('.cm-line').allTextContents()).join('\n'))
      .toBe(source)
    await expect(page.getByText('Ln 1, Col 1', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    await expect(page.locator('.cm-live-table table')).toBeVisible()
    await editor.focus()
    await page.keyboard.press(`${modifier}+End`)
    await page.keyboard.type(' more')
    await expect(page.locator('.cm-live-table table')).toBeVisible()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await expect
      .poll(async () => (await editor.locator('.cm-line').allTextContents()).join('\n'))
      .toBe(`${source} more`)
    await editor.focus()
    await page.keyboard.press(`${modifier}+z`)
    await expect
      .poll(async () => (await editor.locator('.cm-line').allTextContents()).join('\n'))
      .toBe(source)
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await expect(page.getByText('Updating preview…', { exact: true })).toHaveCount(0)
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

test('exhausting packed widget leases falls back to editable source without losing content', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-preview-capacity-'))
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1200, height: 32000 })
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    const source = `# Many visible tables\n\n${'| A | B |\n| - | - |\n| 1 | 2 |\n\n'.repeat(150)}`
    await editor.fill(source)
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Source', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect
      .poll(async () => (await editor.locator('.cm-line').allTextContents()).join('\n'))
      .toBe(source)
    await editor.focus()
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${modifier}+End`)
    await page.keyboard.type('Still editable')
    await expect(editor).toContainText('Still editable')
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
