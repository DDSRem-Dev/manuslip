import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, expect, test } from '@playwright/test'
import {
  clickDocumentAction,
  contrast,
  launchDesktop,
  selectReadingLayout,
  waitForReading,
} from './helpers'

async function stop(application: ElectronApplication) {
  await application
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows())
        if (!window.isDestroyed()) window.destroy()
    })
    .catch(() => {})
  await application.close()
}
const language = (
  lang: string,
  source: boolean,
  target: boolean,
  features = ['tag_handling', 'glossary'],
) => ({
  lang,
  status: 'stable',
  usable_as_source: source,
  usable_as_target: target,
  features: Object.fromEntries(features.map((name) => [name, { status: 'stable' }])),
})
const catalog = [
  language('en', true, false),
  language('en-US', false, true),
  language('de', true, true, ['tag_handling', 'glossary', 'formality']),
  language('zh-Hans', false, true),
  language('ar', true, true, []),
]

test('DeepL settings discover native capabilities explicitly, translate private bindings and reopen cached bilingual copies offline', async () => {
  test.setTimeout(60_000)
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-deepl-'))
  const profile = join(directory, 'profile'),
    path = join(directory, 'deepl.md')
  const source =
    '# Hello world\n\nHello *world*, `PRIVATE_ONE`, $x^2$ and [label](https://private.invalid/one "PRIVATE_TITLE").\n\nHello *world*, `PRIVATE_TWO`, $y^2$ and [label](https://private.invalid/two "PRIVATE_TITLE").\n'
  await writeFile(path, source)
  const requests: { method?: string; url?: string; auth?: string; body: string }[] = []
  const server = createServer(async (incoming, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString()
    requests.push({
      method: incoming.method,
      url: incoming.url,
      auth: incoming.headers.authorization,
      body,
    })
    response.setHeader('Content-Type', 'application/json')
    response.end(
      incoming.method === 'GET'
        ? JSON.stringify(catalog)
        : JSON.stringify({
            translations: [
              {
                text: JSON.parse(body)
                  .text[0].replaceAll('Hello', 'Guten Tag')
                  .replaceAll('world', 'Welt'),
              },
            ],
          }),
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No server')
  let application = await launchDesktop(profile, [path])
  try {
    let page = await application.firstWindow()
    await expect(page.locator('.cm-content')).toContainText('Hello world')
    await page.getByRole('button', { name: 'Preferences', exact: true }).click()
    let panel = page.locator('.translation-settings')
    await page.getByRole('button', { name: 'Translation', exact: true }).focus()
    await page.keyboard.press('Enter')
    await panel.getByLabel('Provider', { exact: true }).selectOption('deepl')
    await expect(panel.getByLabel('Model', { exact: true })).toHaveCount(0)
    await panel
      .getByLabel('Full translation endpoint', { exact: true })
      .fill(`http://127.0.0.1:${address.port}/proxy/translate?deployment=a`)
    await panel.locator('.translation-options > summary').click()
    await expect(panel.getByLabel('Temperature', { exact: true })).toHaveCount(0)
    await expect(panel.getByLabel('Glossary', { exact: true })).toHaveCount(0)
    await expect(panel.getByLabel('Formality', { exact: true })).toHaveCount(0)
    await panel
      .getByLabel('Languages endpoint (optional)', { exact: true })
      .fill(`http://127.0.0.1:${address.port}/proxy/languages?resource=translate_text`)
    await panel.getByRole('button', { name: 'Save translation settings', exact: true }).click()
    await expect(panel.getByText('Translation settings saved.', { exact: true })).toBeVisible()
    await expect(
      panel.getByRole('button', { name: 'Load supported languages', exact: true }),
    ).toBeDisabled()
    expect(requests).toHaveLength(0)
    await panel.getByLabel('API key', { exact: true }).fill('dummy-ui-deepl-key')
    await panel.getByRole('button', { name: 'Set API key', exact: true }).click()
    await expect(panel.getByLabel('API key', { exact: true })).toHaveValue('')
    await expect(
      panel.getByText('API key is available for this session.', { exact: true }),
    ).toBeVisible()
    expect(requests).toHaveLength(0)
    await panel.getByRole('button', { name: 'Load supported languages', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(panel.getByLabel('Target language', { exact: true })).toHaveJSProperty(
      'tagName',
      'SELECT',
    )
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      method: 'GET',
      url: '/proxy/languages?resource=translate_text',
      auth: 'DeepL-Auth-Key dummy-ui-deepl-key',
      body: '',
    })
    await expect(
      panel.getByLabel('Target language', { exact: true }).locator('option[value="ar"]'),
    ).toHaveCount(0)
    await panel.getByLabel('Source language', { exact: true }).selectOption('en')
    await panel.getByLabel('Target language', { exact: true }).selectOption('de')
    await expect(panel.getByLabel('Formality', { exact: true })).toBeVisible()
    await panel.getByLabel('Formality', { exact: true }).selectOption('formal')
    await panel
      .getByLabel('DeepL glossary ID', { exact: true })
      .fill('12345678-1234-1234-1234-123456789abc')
    await panel.getByLabel('Target language', { exact: true }).selectOption('en-US')
    await expect(panel.getByLabel('Formality', { exact: true })).toHaveCount(0)
    await panel.getByLabel('Target language', { exact: true }).selectOption('de')
    await panel.getByLabel('Formality', { exact: true }).selectOption('formal')
    await panel.getByRole('button', { name: 'Save translation settings', exact: true }).click()
    await expect(panel.getByText('Translation settings saved.', { exact: true })).toBeVisible()
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: 'General', exact: true }).click()
      await page.locator('#theme').selectOption(theme)
      await page.getByRole('button', { name: 'Translation', exact: true }).click()
      const field = panel.getByLabel('Target language', { exact: true })
      await field.focus()
      const colors = await field.evaluate((element) => {
        const style = getComputedStyle(element)
        return { text: style.color, background: style.backgroundColor, focus: style.outlineColor }
      })
      expect(contrast(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(colors.focus, colors.background)).toBeGreaterThanOrEqual(3)
      await page.screenshot({ path: test.info().outputPath(`deepl-settings-${theme}.png`) })
    }
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Translated preview', exact: true }).click()
    expect(requests).toHaveLength(1)
    await page.getByRole('button', { name: 'Translate', exact: true }).click()
    await waitForReading(page)
    const article = page.locator('.reading-article')
    await expect(
      article.getByRole('heading', { name: 'Guten Tag Welt', exact: true }),
    ).toBeVisible()
    await expect(article.locator('code').filter({ hasText: 'PRIVATE_ONE' })).toHaveCount(1)
    await expect(article.locator('code').filter({ hasText: 'PRIVATE_TWO' })).toHaveCount(1)
    await expect(article.locator('[role="math"]')).toHaveCount(2)
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(2)
    for (const request of requests.filter((request) => request.method === 'POST')) {
      expect(request.url).toBe('/proxy/translate?deployment=a')
      expect(request.auth).toBe('DeepL-Auth-Key dummy-ui-deepl-key')
      expect(request.body).not.toMatch(
        /PRIVATE_|private.invalid|x\^2|y\^2|dummy-ui-deepl-key|messages/,
      )
      expect(JSON.parse(request.body)).toMatchObject({
        source_lang: 'EN',
        target_lang: 'DE',
        formality: 'more',
        glossary_id: '12345678-1234-1234-1234-123456789abc',
        tag_handling_version: 'v2',
      })
    }
    await selectReadingLayout(page, 'side-by-side')
    await expect(article.locator('.reading-side-by-side')).toHaveCount(1)
    await expect(article.locator('code').filter({ hasText: 'PRIVATE_ONE' })).toHaveCount(2)
    const htmlPath = join(directory, 'deepl.html')
    await application.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
    }, htmlPath)
    await clickDocumentAction(page, 'Export reading HTML…')
    await expect(page.getByText(`Exported to ${htmlPath}`, { exact: true })).toBeVisible()
    const html = await readFile(htmlPath, 'utf8')
    expect(html).toContain('Guten Tag Welt')
    expect(html).toContain('Hello world')
    expect(html).not.toMatch(/dummy-ui-deepl-key|glossary_id/)
    expect(requests).toHaveLength(3)
    expect(await readFile(path, 'utf8')).toBe(source)
    expect(await readFile(join(profile, 'translation-settings.json'), 'utf8')).not.toMatch(
      /dummy-ui-deepl-key|PRIVATE_ONE/,
    )
    await stop(application)
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    application = await launchDesktop(profile, [path])
    page = await application.firstWindow()
    await expect(page.locator('.cm-content')).toContainText('Hello world')
    await page.getByRole('button', { name: 'Translated preview', exact: true }).click()
    await expect(page.locator('.reading-article')).toContainText('Guten Tag Welt')
    await waitForReading(page)
    await expect(page.getByRole('button', { name: 'Translate', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Translate', exact: true })).not.toBeFocused()
    expect(requests).toHaveLength(3)
    expect(await page.evaluate(() => window.manuslip.translationState())).toMatchObject({
      ok: true,
      value: { credential: 'none' },
    })
    await page.getByRole('button', { name: 'Add API key', exact: true }).click()
    panel = page.locator('.translation-settings')
    await expect(panel.getByLabel('API key', { exact: true })).toBeFocused()
    await panel.locator('.translation-options > summary').click()
    await panel.getByLabel('Formality', { exact: true }).selectOption('default')
    await panel.getByRole('button', { name: 'Remove glossary', exact: true }).click()
    await panel.getByRole('button', { name: 'Save translation settings', exact: true }).click()
    await expect(panel.getByText('Translation settings saved.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'General', exact: true }).click()
    await page.locator('#locale').selectOption('zh-CN')
    await page.getByRole('dialog').getByRole('button', { name: '翻译', exact: true }).click()
    await page.setViewportSize({ width: 320, height: 720 })
    await panel.getByLabel('完整的翻译接口地址', { exact: true }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath('deepl-settings-narrow-chinese.png') })
    await page.setViewportSize({ width: 1160, height: 780 })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.clearDeviceMetricsOverride')
    await (await application.browserWindow(page)).evaluate((window) => {
      window.setContentSize(1160, 780)
      window.webContents.setZoomFactor(2)
    })
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(580)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThanOrEqual(570)
    await panel
      .getByRole('button', { name: '载入支持的语言', exact: true })
      .scrollIntoViewIfNeeded()
    await expect(panel.getByRole('button', { name: '载入支持的语言', exact: true })).toBeInViewport(
      { ratio: 1 },
    )
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(
      await page
        .getByRole('dialog')
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true)
    await page.screenshot({ path: test.info().outputPath('deepl-settings-zoom-chinese.png') })
    expect(requests).toHaveLength(3)
  } finally {
    await stop(application)
    server.closeAllConnections()
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('DeepL quota failures retain source, report an actionable error and retry only failed units', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-deepl-quota-'))
  const path = join(directory, 'quota.md')
  const source = '# Hello reader\n\nHello quota `PRIVATE_CODE`.\n'
  await writeFile(path, source)
  let quota = true,
    metadata = 0,
    translations = 0
  const server = createServer(async (incoming, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
    response.setHeader('Content-Type', 'application/json')
    if (incoming.method === 'GET') {
      metadata++
      response.end(JSON.stringify(catalog))
      return
    }
    translations++
    const text: string = JSON.parse(Buffer.concat(chunks).toString()).text[0]
    if (quota && text.includes('quota')) {
      response.writeHead(456)
      response.end(JSON.stringify({ message: 'PRIVATE_PROVIDER_ERROR' }))
      return
    }
    response.end(
      JSON.stringify({ translations: [{ text: text.replaceAll('Hello', 'Guten Tag') }] }),
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No server')
  const application = await launchDesktop(join(directory, 'profile'), [path])
  try {
    const page = await application.firstWindow()
    await expect(page.locator('.cm-content')).toContainText('Hello reader')
    const configured = await page.evaluate(async (baseUrl) => {
      return window.manuslip.configureTranslation({
        provider: {
          adapter: 'deepl',
          version: '1',
          baseUrl,
          model: null,
          profile: null,
          options: {},
        },
        sourceLanguage: 'en',
        targetLanguage: 'de',
        glossary: [],
        formality: 'default',
        promptVersion: 'prose-translation/v1',
      })
    }, `http://127.0.0.1:${address.port}/translate`)
    expect(configured.ok).toBe(true)
    expect(metadata + translations).toBe(0)
    await page.getByRole('button', { name: 'Translated preview', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Translate', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Add API key', exact: true })).toBeVisible()
    await expect(page.getByLabel('Read in', { exact: true })).toContainText('German')
    await page.getByRole('button', { name: 'Choose languages', exact: true }).click()
    await expect(
      page.locator('.translation-settings').getByLabel('Target language', { exact: true }),
    ).toBeFocused()
    await page.getByRole('button', { name: 'Close preferences', exact: true }).click()
    await page.getByRole('button', { name: 'Add API key', exact: true }).click()
    await expect(
      page.locator('.translation-settings').getByLabel('API key', { exact: true }),
    ).toBeFocused()
    await page
      .locator('.translation-settings')
      .getByLabel('API key', { exact: true })
      .fill('dummy-cancelled-key')
    await page.getByRole('button', { name: 'Close preferences', exact: true }).click()
    await page.getByRole('button', { name: 'Add API key', exact: true }).click()
    await expect(
      page.locator('.translation-settings').getByLabel('API key', { exact: true }),
    ).toHaveValue('')
    await page.getByRole('button', { name: 'Close preferences', exact: true }).click()
    expect(metadata + translations).toBe(0)
    if (!configured.ok) throw new Error('Configuration failed')
    expect(
      await page.evaluate(
        (revision) =>
          window.manuslip.setTranslationCredential({
            settingsRevision: revision,
            key: 'dummy-quota-key',
            persist: false,
          }),
        configured.value.settingsRevision,
      ),
    ).toMatchObject({ ok: true })
    await page.getByRole('button', { name: 'Translate', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Retry failed', exact: true })).toBeVisible()
    await expect(
      page.getByText('The provider quota is exhausted. Check the account limit before retrying.', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.locator('.reading-article')).toContainText('Hello quota')
    await expect(page.locator('.reading-article')).toContainText('Guten Tag reader')
    await expect(page.locator('body')).not.toContainText('PRIVATE_PROVIDER_ERROR')
    expect(metadata).toBeGreaterThanOrEqual(1)
    expect(metadata).toBeLessThanOrEqual(2)
    expect(translations).toBe(2)
    await page.screenshot({ path: test.info().outputPath('deepl-quota.png') })
    const count = metadata
    quota = false
    await page.getByRole('button', { name: 'Retry failed', exact: true }).focus()
    await page.keyboard.press('Enter')
    await waitForReading(page)
    await expect(page.getByRole('button', { name: 'Translate', exact: true })).toBeFocused()
    await expect(page.locator('.reading-article')).toContainText('Guten Tag quota')
    expect(translations).toBe(3)
    expect(metadata).toBe(count)
    expect(await readFile(path, 'utf8')).toBe(source)
  } finally {
    await stop(application)
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
