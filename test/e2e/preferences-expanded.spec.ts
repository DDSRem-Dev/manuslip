import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, expect, test } from '@playwright/test'
import { launchDesktop, openReadingOptions, waitForReading } from './helpers'

async function stop(application: ElectronApplication): Promise<void> {
  await application
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    .catch(() => {})
  await application.close()
}

const preferencesShortcut = process.platform === 'darwin' ? 'Meta+,' : 'Control+,'

test('a preference failure keeps the source display and allows retry without losing writing', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'manuslip-writing-settings-failure-'))
  const path = join(profile, 'preferences.json'),
    backup = join(profile, 'preferences-original.json')
  const application = await launchDesktop(profile)
  let blocked = false
  try {
    const page = await application.firstWindow()
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    await page.locator('.cm-content').fill('Retain this writing.')
    await rename(path, backup)
    await mkdir(path)
    blocked = true
    await page.keyboard.press(preferencesShortcut)
    await page.getByRole('button', { name: 'Editor', exact: true }).click()
    const lines = page.getByRole('checkbox', { name: 'Show line numbers', exact: true })
    await lines.click()
    await expect(page.locator('.preferences [role="alert"]')).toHaveText(
      'Unable to save preferences. Try again.',
    )
    await expect(page.locator('.cm-lineNumbers')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Editor', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(lines).toBeChecked()
    await rm(path, { recursive: true })
    await rename(backup, path)
    blocked = false
    await page.getByRole('button', { name: 'Retry saving preferences', exact: true }).click()
    await expect(lines).not.toBeChecked()
    await page.keyboard.press('Escape')
    await expect(page.locator('.cm-lineNumbers')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toContainText('Retain this writing.')
  } finally {
    if (blocked) {
      await rm(path, { recursive: true })
      await rename(backup, path)
    }
    await stop(application)
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('preferences open from welcome and persist source display and reading defaults without losing undo', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'manuslip-expanded-settings-'))
  let application = await launchDesktop(profile)
  try {
    let page = await application.firstWindow()
    await expect(page.getByRole('heading', { name: 'Start writing' })).toBeVisible()
    await page.keyboard.press(preferencesShortcut)
    await expect(page.getByRole('dialog', { name: 'Preferences', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Editor', exact: true }).click()
    const lines = page.getByRole('checkbox', { name: 'Show line numbers', exact: true })
    await lines.uncheck()
    await expect(lines).toBeEnabled()
    const wrap = page.getByRole('checkbox', { name: 'Wrap long lines', exact: true })
    await wrap.uncheck()
    await expect(wrap).toBeEnabled()
    await page.getByLabel('Tab width', { exact: true }).selectOption('8')
    await expect(page.getByLabel('Tab width', { exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Translation', exact: true }).click()
    await page.getByLabel('Default reading layout', { exact: true }).selectOption('interlinear')
    await expect(page.getByLabel('Default reading layout', { exact: true })).toBeEnabled()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    const editor = page.locator('.cm-content')
    await expect(page.locator('.cm-lineNumbers')).toHaveCount(0)
    await expect(editor).not.toHaveClass(/cm-lineWrapping/)
    await editor.focus()
    await page.keyboard.insertText('Writing survives preference changes.')
    await page.keyboard.press(preferencesShortcut)
    await page.getByRole('button', { name: 'Editor', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Wrap long lines', exact: true }).check()
    await expect(page.getByRole('checkbox', { name: 'Wrap long lines', exact: true })).toBeEnabled()
    await page.getByRole('checkbox', { name: 'Show line numbers', exact: true }).check()
    await expect(
      page.getByRole('checkbox', { name: 'Show line numbers', exact: true }),
    ).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(editor).toHaveClass(/cm-lineWrapping/)
    await expect(page.locator('.cm-lineNumbers')).toHaveCount(1)
    await expect(editor).toContainText('Writing survives preference changes.')
    await editor.focus()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
    await expect(editor).toHaveText('')
    const saved = JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8'))
    expect(saved).toMatchObject({
      editor: { lineNumbers: true, wrapLines: true, tabSize: 8 },
      reading: { layout: 'interlinear' },
    })
    await stop(application)
    application = await launchDesktop(profile)
    page = await application.firstWindow()
    expect(await page.evaluate(() => window.manuslip.bootstrap())).toMatchObject({
      ok: true,
      value: { settings: saved },
    })
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    await page.getByRole('button', { name: 'Translated preview', exact: true }).click()
    const options = await openReadingOptions(page)
    await expect(options.getByLabel('Reading layout', { exact: true })).toHaveValue('interlinear')
  } finally {
    await stop(application)
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('settings search, provider drafts and language suggestions work offline and clear unsubmitted keys', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'manuslip-settings-drafts-'))
  const application = await launchDesktop(profile)
  try {
    const page = await application.firstWindow()
    await page.getByRole('button', { name: 'Preferences', exact: true }).click()
    const search = page.getByRole('searchbox', { name: 'Find a setting', exact: true })
    await search.fill('api key')
    await expect(page.locator('.preferences-results > button')).toHaveCount(1)
    await page.locator('.preferences-results > button').click()
    const panel = page.locator('.translation-settings')
    await expect(panel.getByLabel('Provider', { exact: true })).toBeFocused()
    await expect(search).toHaveValue('')
    await panel.getByLabel('Provider', { exact: true }).selectOption('ollama')
    await panel.getByLabel('Model', { exact: true }).fill('my-local-model')
    await expect(panel.locator('datalist').first().locator('option[value="zh-CN"]')).toHaveText(
      '简体中文',
    )
    await expect(panel.locator('datalist').first().locator('option[value="zh-TW"]')).toHaveText(
      '繁體中文',
    )
    await panel.getByLabel('Target language', { exact: true }).fill('zh-TW')
    await expect(panel.locator('.translation-language-name').last()).toHaveText('繁體中文')
    await panel.getByLabel('Target language', { exact: true }).fill('zh-CN')
    await expect(panel.locator('.translation-language-name').last()).toHaveText('简体中文')
    await panel.getByLabel('Target language', { exact: true }).fill('pt-br')
    expect(await panel.locator('datalist').first().locator('option').count()).toBeGreaterThan(40)
    await panel.locator('.translation-options > summary').click()
    await panel.getByLabel('Glossary', { exact: true }).fill('world => mundo')
    await panel.getByLabel('Provider', { exact: true }).selectOption('openai-compatible')
    await panel.getByLabel('Model', { exact: true }).fill('my-remote-model')
    await panel.getByLabel('Provider', { exact: true }).selectOption('ollama')
    await expect(panel.getByLabel('Model', { exact: true })).toHaveValue('my-local-model')
    await expect(panel.getByLabel('Glossary', { exact: true })).toHaveValue('world => mundo')
    await panel.getByRole('button', { name: 'Save translation settings', exact: true }).click()
    await expect(panel.getByText('Translation settings saved.', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.manuslip.translationState())).toMatchObject({
      ok: true,
      value: {
        settings: { targetLanguage: 'pt-BR', glossary: [{ source: 'world', target: 'mundo' }] },
      },
    })
    await panel.getByLabel('Model', { exact: true }).fill('unsaved-model')
    await panel.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(panel.getByLabel('Model', { exact: true })).toHaveValue('my-local-model')
    await panel.getByLabel('Full chat endpoint', { exact: true }).fill('http://remote.invalid/chat')
    await panel.getByRole('button', { name: 'Save translation settings', exact: true }).click()
    await expect(panel.getByLabel('Full chat endpoint', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await panel.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(panel.getByLabel('Full chat endpoint', { exact: true })).not.toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await panel
      .getByRole('navigation', { name: 'Translation sections', exact: true })
      .getByRole('button', { name: 'API key', exact: true })
      .click()
    await expect(panel.getByLabel('API key', { exact: true })).toBeFocused()
    await panel.getByLabel('API key', { exact: true }).fill('dummy-unsubmitted-key')
    await page.getByRole('button', { name: 'General', exact: true }).click()
    await page.getByRole('button', { name: 'Translation', exact: true }).click()
    await expect(panel.getByLabel('API key', { exact: true })).toHaveValue('')
    await page.keyboard.press(preferencesShortcut)
    await expect(search).toBeFocused()
    await search.fill('术语表')
    await expect(page.locator('.preferences-results > button')).toHaveCount(1)
    await search.fill('unfindable-setting')
    await expect(page.locator('.preferences-results [role="status"]')).toContainText(
      'No matching settings',
    )
    await page.keyboard.press('Escape')
    await page.keyboard.press(preferencesShortcut)
    await expect(search).toHaveValue('')
  } finally {
    await stop(application)
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('hosted provider setup offers an API key while cached reading stays available without one', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'manuslip-provider-availability-'))
  const application = await launchDesktop(profile)
  try {
    const page = await application.firstWindow()
    await page.getByRole('button', { name: 'Preferences', exact: true }).click()
    await page.getByRole('button', { name: 'Translation', exact: true }).click()
    const panel = page.locator('.translation-settings')
    await panel.getByLabel('Model', { exact: true }).fill('test-model')
    await panel.getByRole('button', { name: 'Save translation settings', exact: true }).click()
    await expect(panel.getByText('API key needed', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Add API key', exact: true }).click()
    await expect(panel.getByLabel('API key', { exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    await page.locator('.cm-content').fill('The original stays available.')
    await page.getByRole('button', { name: 'Translated preview', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Add API key', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Translate', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Translate', exact: true }).click()
    await waitForReading(page)
    await expect(page.locator('.reading-article')).toContainText('The original stays available.')
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await expect(page.locator('.cm-content')).toContainText('The original stays available.')
  } finally {
    await stop(application)
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
