import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve, sep } from 'node:path'
import type { TranslationSettings } from '@manuslip/translate'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import axe from 'axe-core'
import { clickDocumentAction, launchDesktop, waitForReading } from './helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const source =
  '# Notebook 笔记\r\n\r\nHello ~world~ ^**world**^ :smile:.\r\n\r\nHello ~world~ ^**world**^ :heart:.\r\n\r\nH~2~O x^2^ ~a^b^:smile:~\r\n\r\nLiteral `:smile: ^x^ ~y~` and [docs](https://example.invalid/:smile:).\r\n\r\nEnd.\r\n'
const labels = {
  en: {
    source: 'Source',
    live: 'Live Preview',
    reading: 'Translated preview',
    translate: 'Translate',
    export: 'Export HTML…',
  },
  'zh-CN': {
    source: '源码',
    live: '实时预览',
    reading: '译文预览',
    translate: '翻译',
    export: '导出 HTML…',
  },
}
async function stop(application: ElectronApplication) {
  await application
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    .catch(() => {})
  await application.close()
}

async function audit(page: Page, name: string): Promise<void> {
  await page.evaluate(axe.source)
  const result = await page.evaluate(async () => {
    const checker = (window as unknown as { axe: typeof import('axe-core') }).axe
    const result = await checker.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      },
    })
    return {
      version: result.testEngine.version,
      violations: result.violations,
      incomplete: result.incomplete,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }
  })
  await test.info().attach(`${name}-accessibility`, {
    body: JSON.stringify(result),
    contentType: 'application/json',
  })
  expect(result.violations).toEqual([])
  expect(result.overflow).toBe(false)
  await test.info().attach(`${name}-tree`, {
    body: await page.locator('body').ariaSnapshot(),
    contentType: 'text/plain',
  })
  const path = test.info().outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await test.info().attach(name, { path, contentType: 'image/png' })
}

for (const locale of ['en', 'zh-CN'] as const) {
  test(`${locale} scripts and offline emoji preserve source, translation, export and history`, async () => {
    test.setTimeout(45_000)
    const directory = await mkdtemp(resolve('test/e2e/result/extended-inline-'))
    if (!resolve(directory).startsWith(resolve('test/e2e/result') + sep))
      throw new Error('Unsafe fixture path')
    const profile = join(directory, 'profile'),
      path = join(directory, 'inline.md')
    await mkdir(profile)
    await writeFile(
      join(profile, 'preferences.json'),
      JSON.stringify({ schemaVersion: 1, locale, theme: locale === 'en' ? 'light' : 'dark' }),
    )
    await writeFile(path, source)
    const received: string[] = [],
      errors: string[] = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const raw = Buffer.concat(chunks).toString('utf8')
      received.push(raw)
      const input = JSON.parse(raw)
      response.setHeader('Content-Type', 'application/json')
      response.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: input.messages[1].content
                  .replaceAll('Hello', '你好')
                  .replaceAll('world', '世界'),
              },
            },
          ],
        }),
      )
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing loopback address')
    let application = await launchDesktop(profile, [path])
    try {
      const page = await application.firstWindow(),
        names = labels[locale]
      page.on('pageerror', (error) => errors.push(error.message))
      await page.getByRole('button', { name: names.source, exact: true }).click()
      const editor = page.locator('.cm-content')
      await expect(editor).toContainText('Hello ~world~ ^**world**^ :smile:')
      await page.getByRole('button', { name: names.live, exact: true }).click()
      await expect(
        page.locator('.cm-live-inline-widget sub').filter({ hasText: 'world' }),
      ).toHaveCount(2)
      await expect(page.locator('.cm-live-inline-widget sup strong')).toHaveCount(2)
      await expect(page.locator('.cm-live-inline-widget sub sup')).toHaveText('b')
      await expect(editor.locator('.md-emoji')).toHaveCount(3)
      await page.locator('.cm-live-inline-widget sub').filter({ hasText: 'world' }).first().click()
      await expect(editor).toContainText('~world~')
      await editor.press(`${modifier}+End`)
      await expect(
        page.locator('.cm-live-inline-widget sub').filter({ hasText: 'world' }),
      ).toHaveCount(2)
      await audit(page, 'live-wide')
      await page.keyboard.insertText('Edited 世界')
      await page.keyboard.press(`${modifier}+s`)
      const edited = `${source}Edited 世界`
      await expect.poll(() => readFile(path, 'utf8')).toBe(edited)
      await page.keyboard.press(`${modifier}+z`)
      await page.keyboard.press(`${modifier}+s`)
      await expect.poll(() => readFile(path, 'utf8')).toBe(source)
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y')
      await page.keyboard.press(`${modifier}+s`)
      await expect.poll(() => readFile(path, 'utf8')).toBe(edited)
      await page.keyboard.press(`${modifier}+z`)
      await page.keyboard.press(`${modifier}+s`)
      await expect.poll(() => readFile(path, 'utf8')).toBe(source)

      const target = join(directory, 'inline.html')
      await application.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      }, target)
      await clickDocumentAction(page, names.export)
      await expect
        .poll(async () => readFile(target, 'utf8').catch(() => ''))
        .toContain('<sub>world</sub>')
      const html = await readFile(target, 'utf8')
      expect(html).toContain('<sup><strong>world</strong></sup>')
      expect(html).toContain('title=":smile:">😄</span>')
      expect(html).toContain('<code>:smile: ^x^ ~y~</code>')
      expect(html).not.toMatch(/<script|<img[^>]+src="https?:/i)
      await test.info().attach('inline-export', { body: html, contentType: 'text/html' })

      const settings: TranslationSettings = {
        provider: {
          adapter: 'openai-compatible',
          version: '1',
          baseUrl: `http://127.0.0.1:${address.port}/chat`,
          model: 'local-test-model',
          profile: null,
          options: {},
        },
        sourceLanguage: 'auto',
        targetLanguage: 'zh-CN',
        glossary: [],
        formality: 'default',
        promptVersion: 'prose-translation/v1',
      }
      expect(
        await page.evaluate((value) => window.manuslip.configureTranslation(value), settings),
      ).toMatchObject({ ok: true })
      await page.getByRole('button', { name: names.reading, exact: true }).click()
      expect(received).toHaveLength(0)
      await page.getByRole('button', { name: names.translate, exact: true }).click()
      await waitForReading(page)
      const article = page.locator('.reading-article')
      await expect(article.locator('sub').filter({ hasText: '世界' })).toHaveCount(2)
      await expect(article.locator('sup strong')).toHaveText(['世界', '世界'])
      await expect(article.locator('.md-emoji')).toHaveText(['😄', '❤️', '😄'])
      for (const secret of [':smile:', ':heart:', '😄', '❤️', 'example.invalid'])
        expect(received.join('\n')).not.toContain(secret)
      await page.setViewportSize({ width: 420, height: 900 })
      await audit(page, 'reading-narrow')
      await expect(article).toContainText('你好')
      expect(await readFile(path, 'utf8')).toBe(source)
      expect(errors).toEqual([])
      await stop(application)
      application = await launchDesktop(profile, [path])
      const reopened = await application.firstWindow()
      await reopened.getByRole('button', { name: names.source, exact: true }).click()
      await expect(reopened.locator('.cm-content')).toContainText('~a^b^:smile:~')
      const bytes = await readFile(path)
      expect(bytes).toEqual(Buffer.from(source))
      await test.info().attach('source-save-reopen', {
        body: JSON.stringify({
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        }),
        contentType: 'application/json',
      })
    } finally {
      await stop(application)
      await new Promise<void>((done) => server.close(() => done()))
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  })
}
