import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, expect, type Locator, test } from '@playwright/test'
import { launchDesktop, selectReadingLayout, waitForReading } from './helpers'

const source = [
  '# Hello reader',
  '**Bold text**, *emphasis*, `PRIVATE_CODE` and [link](https://example.invalid/).',
  '- First item\n- Second item',
  'Source paragraph. '.repeat(180),
  '## Hello section',
  'Middle paragraph. '.repeat(180),
  '## Hello section',
  'Last paragraph. '.repeat(180),
  `> ## Hello nested first\n>\n> Nested paragraph.\n>\n> ## Hello nested last\n>\n> ${'Nested paragraph. '.repeat(80)}`,
].join('\n\n')

async function stop(application: ElectronApplication) {
  await application
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    .catch(() => {})
  await application.close()
}

async function expectHeadingPosition(heading: Locator): Promise<void> {
  await expect(heading).toBeInViewport({ ratio: 1 })
  await expect(heading).toBeFocused()
  await expect
    .poll(() =>
      heading.evaluate((element) => {
        const controls = element.closest('.reading-pane')?.querySelector('.reading-controls')
        return element.getBoundingClientRect().top - (controls?.getBoundingClientRect().bottom ?? 0)
      }),
    )
    .toBeGreaterThanOrEqual(0)
}

test('unconfigured translated preview renders Markdown and catalog jumps keep it open', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-reading-source-'))
  const path = join(directory, 'reading.md')
  await writeFile(path, source)
  const application = await launchDesktop(join(directory, 'profile'), [path])
  try {
    const page = await application.firstWindow()
    await expect(page.locator('.cm-content')).toContainText('Hello reader')
    await page.getByRole('button', { name: 'Show workspace', exact: true }).click()
    const mode = page.getByRole('button', { name: 'Translated preview', exact: true })
    await mode.click()
    const article = page.locator('.reading-article')
    await expect(article.getByRole('heading', { name: 'Hello reader', exact: true })).toBeVisible()
    await expect(article.locator('strong')).toHaveText('Bold text')
    await expect(article.locator('em')).toHaveText('emphasis')
    await expect(article.locator('code')).toHaveText('PRIVATE_CODE')
    await expect(article.locator('li')).toHaveCount(2)
    await expect(article.getByRole('link', { name: 'link', exact: true })).toHaveAttribute(
      'href',
      'https://example.invalid/',
    )
    await expect(page.locator('.reading-placeholder')).toHaveCount(0)
    const headings = page.getByRole('navigation', { name: 'Document headings' })
    const duplicate = headings.getByRole('button', { name: 'Hello section', exact: true })
    await duplicate.last().click()
    const last = article.getByRole('heading', { name: 'Hello section', exact: true }).last()
    await expectHeadingPosition(last)
    await expect(mode).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.source-editor')).toBeHidden()
    await headings.getByRole('button', { name: 'Hello reader', exact: true }).click()
    await expectHeadingPosition(article.getByRole('heading', { name: 'Hello reader', exact: true }))
    await duplicate.last().focus()
    await page.keyboard.press('Enter')
    await expectHeadingPosition(last)
    await headings.getByRole('button', { name: 'Hello nested last', exact: true }).click()
    await expectHeadingPosition(
      article.getByRole('heading', { name: 'Hello nested last', exact: true }),
    )
    await duplicate.last().click()
    await expectHeadingPosition(last)
    await page.screenshot({ path: test.info().outputPath('source-preview-catalog.png') })
    await page.getByRole('button', { name: 'Hide workspace', exact: true }).click()
    await page.setViewportSize({ width: 420, height: 820 })
    await article.evaluate((element) => {
      const pane = element.closest('.reading-pane')
      if (pane) pane.scrollTop = 0
    })
    await expect(
      article.getByRole('heading', { name: 'Hello reader', exact: true }),
    ).toBeInViewport()
    expect(
      await page.locator('body').evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(420)
    await page.screenshot({ path: test.info().outputPath('source-preview-narrow.png') })
    expect(await readFile(path, 'utf8')).toBe(source)
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
    await editor.fill('# Updated source\n\n**Updated body**')
    await mode.click()
    await expect(
      article.getByRole('heading', { name: 'Updated source', exact: true }),
    ).toBeVisible()
    await expect(article.locator('strong')).toHaveText('Updated body')
  } finally {
    await stop(application)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('catalog navigation stays in each translated reading layout and uses source positions for duplicate titles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-reading-navigation-'))
  const path = join(directory, 'reading.md')
  await writeFile(path, source)
  let calls = 0
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    calls++
    response.setHeader('Content-Type', 'application/json')
    response.end(
      JSON.stringify({
        done: true,
        done_reason: 'stop',
        message: {
          role: 'assistant',
          content: input.messages[1].content.replaceAll('Hello', 'Bonjour'),
        },
      }),
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
    const configured = await page.evaluate(
      (baseUrl) =>
        window.manuslip.configureTranslation({
          provider: {
            adapter: 'ollama',
            version: '1',
            baseUrl,
            model: 'fake',
            profile: null,
            options: {},
          },
          sourceLanguage: 'en',
          targetLanguage: 'fr',
          glossary: [],
          formality: 'default',
          promptVersion: 'prose-translation/v1',
        }),
      `http://127.0.0.1:${address.port}/api/chat`,
    )
    expect(configured.ok).toBe(true)
    const mode = page.getByRole('button', { name: 'Translated preview', exact: true })
    await mode.click()
    const article = page.locator('.reading-article')
    await expect(article.getByRole('heading', { name: 'Hello reader', exact: true })).toBeVisible()
    expect(calls).toBe(0)
    await page.getByRole('button', { name: 'Translate', exact: true }).click()
    await waitForReading(page)
    await expect(
      article.getByRole('heading', { name: 'Bonjour reader', exact: true }),
    ).toBeVisible()
    const translatedCalls = calls
    expect(translatedCalls).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Show workspace', exact: true }).click()
    const headings = page.getByRole('navigation', { name: 'Document headings' })
    for (const layout of ['replace', 'side-by-side', 'interlinear']) {
      await selectReadingLayout(page, layout)
      await expect(article.locator(`.reading-${layout}`)).toBeVisible()
      await headings.getByRole('button', { name: 'Hello section', exact: true }).last().click()
      const last =
        layout === 'replace'
          ? article.getByRole('heading', { name: 'Bonjour section', exact: true }).last()
          : article.getByRole('heading', { name: 'Hello section', exact: true }).last()
      await expectHeadingPosition(last)
      await expect(mode).toHaveAttribute('aria-pressed', 'true')
      await expect(page.locator('.source-editor')).toBeHidden()
      await headings.getByRole('button', { name: 'Hello nested last', exact: true }).click()
      await expectHeadingPosition(
        article.getByRole('heading', {
          name: layout === 'replace' ? 'Bonjour nested last' : 'Hello nested last',
          exact: true,
        }),
      )
      await headings.getByRole('button', { name: 'Hello reader', exact: true }).click()
      await expectHeadingPosition(
        article.getByRole('heading', {
          name: layout === 'replace' ? 'Bonjour reader' : 'Hello reader',
          exact: true,
        }),
      )
    }
    expect(calls).toBe(translatedCalls)
    expect(await readFile(path, 'utf8')).toBe(source)
  } finally {
    await stop(application)
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
