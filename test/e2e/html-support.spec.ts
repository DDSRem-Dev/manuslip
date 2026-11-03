import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { expect, type Locator, test } from '@playwright/test'
import axe from 'axe-core'
import {
  clickDocumentAction,
  launchDesktop,
  openMarkdownExtensions,
  selectReadingLayout,
} from './helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const source = [
  '# Hello document',
  'Inline <b>bold **Markdown**</b>, <i>italic</i>, <u>underlined</u>, <small>small print</small>, <abbr title="HyperText Markup Language">HTML</abbr> and <q cite="https://example.invalid/source">quoted</q>.',
  'Press <kbd>Ctrl</kbd> + <kbd>S</kbd>; output <samp>saved</samp>; variable <var>x</var>; <cite>A quiet document</cite>.',
  'Ruby <ruby>漢<rp>(</rp><rt>かん</rt><rp>)</rp></ruby>, H<sub>2</sub>O and x<sup>2</sup>; <bdi dir="auto">العربية</bdi> and <bdo dir="rtl">ABC</bdo>.',
  '<article>Article with a <dfn>defined term</dfn>.</article>',
  '<figure>\n<table>\n<caption>Release history</caption>\n<colgroup><col span="2"></colgroup>\n<thead><tr><th id="release" scope="col">Release</th><th id="state" scope="col">State</th></tr></thead>\n<tbody><tr><td headers="release" rowspan="2">1.0</td><td headers="state"><s>Draft</s> <ins datetime="2026-11-03">Published</ins></td></tr><tr><td headers="state">Verified</td></tr></tbody>\n<tfoot><tr><td colspan="2">One release</td></tr></tfoot>\n</table>\n<figcaption>Changes reviewed <time datetime="2026-11-03T09:30:00Z">3 November</time>.</figcaption>\n</figure>',
  '<ol reversed start="0"><li value="0">Zero</li><li value="-1">Minus one</li></ol>',
  '<div title="literal block">\n**Literal inside HTML**\n</div>',
  'Safe <b onclick="window.compromised=true" style="position:fixed">authored text</b> and <q cite="javascript:alert(1)">an invalid citation</q>.',
  'Literal `<b>code</b>` and escaped \\<i>text\\</i>.',
  'End.',
].join('\n\n')

async function basicHtml(container: Locator) {
  await expect(container.locator('b').filter({ hasText: 'bold' })).toHaveText('bold Markdown')
  await expect(container.locator('b strong')).toHaveText('Markdown')
  await expect(container.locator('i')).toHaveText('italic')
  await expect(container.locator('u')).toHaveText('underlined')
  await expect(container.locator('small')).toHaveText('small print')
  await expect(container.locator('abbr')).toHaveAttribute('title', 'HyperText Markup Language')
  await expect(container.locator('q').first()).toHaveAttribute(
    'cite',
    'https://example.invalid/source',
  )
  await expect(container.locator('q').last()).not.toHaveAttribute('cite')
  await expect(container.locator('kbd')).toHaveText(['Ctrl', 'S'])
  await expect(container.locator('kbd').first()).toHaveCSS('border-top-width', '1px')
  await expect(container.locator('samp')).toHaveText('saved')
  await expect(container.locator('var')).toHaveText('x')
  await expect(container.locator('cite')).toHaveText('A quiet document')
  await expect(container.locator('ruby rt')).toHaveText('かん')
  await expect(container.locator('ruby rp')).toHaveCount(2)
  await expect(container.locator('bdi')).toHaveAttribute('dir', 'auto')
  await expect(container.locator('bdo')).toHaveCSS('direction', 'rtl')
  await expect(container.locator('article')).toHaveCSS('padding-inline-start', '0px')
  await expect(container.locator('dfn')).toHaveText('defined term')
  await expect(container.locator('figure caption')).toHaveText('Release history')
  await expect(container.locator('col')).toHaveAttribute('span', '2')
  await expect(container.locator('th').first()).toHaveAttribute('scope', 'col')
  await expect(container.locator('td[headers]')).toHaveCount(3)
  await expect(container.locator('td[rowspan]')).toHaveAttribute('rowspan', '2')
  await expect(container.locator('tfoot td')).toHaveAttribute('colspan', '2')
  await expect(container.locator('ins')).toHaveAttribute('datetime', '2026-11-03')
  await expect(container.locator('time')).toHaveAttribute('datetime', '2026-11-03T09:30:00Z')
  await expect(container.locator('figcaption')).toHaveText('Changes reviewed 3 November.')
  await expect(container.locator('ol[reversed]')).toHaveAttribute('start', '0')
  await expect(container.locator('li').first()).toHaveAttribute('value', '0')
  await expect(container.locator('li').last()).toHaveAttribute('value', '-1')
  await expect(container.locator('div[title="literal block"]')).toHaveText(
    '**Literal inside HTML**',
  )
  await expect(container.locator('code')).toHaveText('<b>code</b>')
  await expect(
    container.locator('[onclick], [style], script, iframe, details, summary'),
  ).toHaveCount(0)
  expect(
    await container.evaluateAll((roots) => {
      return roots.every((root) => {
        return [...root.querySelectorAll('[headers]')].every((cell) => {
          return cell
            .getAttribute('headers')
            ?.split(/\s+/)
            .every((id) => {
              const header = root.ownerDocument.getElementById(id)
              return header?.tagName === 'TH' && root.contains(header)
            })
        })
      })
    }),
  ).toBe(true)
}

for (const theme of ['light', 'dark'] as const) {
  test(`basic CommonMark HTML preserves semantics, editing and reading in ${theme}`, async () => {
    test.setTimeout(60_000)
    const directory = await mkdtemp(resolve('test/artifacts/logs/html-support-'))
    const profile = join(directory, 'profile')
    const path = join(directory, 'html.md')
    await mkdir(profile)
    await writeFile(
      join(profile, 'preferences.json'),
      JSON.stringify({
        schemaVersion: 1,
        theme,
        locale: 'en',
        markdown: { opt: false, latex: false, mermaid: false, github: false, typora: false },
      }),
    )
    await writeFile(path, source)
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const input = JSON.parse(Buffer.concat(chunks).toString())
      response.setHeader('Content-Type', 'application/json')
      response.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: input.messages[1].content.replaceAll('Hello', '你好'),
              },
            },
          ],
        }),
      )
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing translation fixture')
    const application = await launchDesktop(profile, [path])
    const page = await application.firstWindow()
    const errors: string[] = []
    const requests: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => {
      if (request.url().startsWith('https:')) requests.push(request.url())
    })
    try {
      await page.setViewportSize({ width: 1144, height: 1200 })
      const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
      await expect(editor).toContainText('<b>bold')
      await expect(editor.locator('b, i, u, ruby, caption, figure')).toHaveCount(0)
      const extensions = await openMarkdownExtensions(page)
      await extensions.getByLabel('Render sanitized HTML', { exact: true }).check()
      await page.keyboard.press('Escape')
      await basicHtml(editor)
      await page.screenshot({ path: test.info().outputPath(`html-${theme}.png`) })

      await editor.locator('div[title="literal block"]').click()
      expect(await page.evaluate(() => getSelection()?.toString())).toBe('')
      const line = editor
        .locator('.cm-live-edit-source')
        .filter({ hasText: '**Literal inside HTML**' })
      await line.click()
      await editor.press('Home')
      await editor.press('Shift+End')
      await page.keyboard.insertText('**Edited inside HTML**')
      await editor.press(`${modifier}+s`)
      await expect
        .poll(() => readFile(path, 'utf8'))
        .toBe(source.replace('Literal inside HTML', 'Edited inside HTML'))
      await editor.press('Escape')
      await expect(editor.locator('div[title="literal block"]')).toHaveText(
        '**Edited inside HTML**',
      )
      await editor.press(`${modifier}+z`)
      await editor.press('ArrowRight')
      await expect(editor.locator('div[title="literal block"]')).toHaveText(
        '**Literal inside HTML**',
      )
      await editor.press(`${modifier}+s`)
      await expect.poll(() => readFile(path, 'utf8')).toBe(source)

      for (const width of [480, 320]) {
        await page.setViewportSize({ width, height: 1100 })
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true)
        await page.screenshot({ path: test.info().outputPath(`html-${theme}-${width}.png`) })
      }
      await page.setViewportSize({ width: 1144, height: 1100 })
      await page.evaluate(axe.source)
      expect(
        await page.evaluate(
          async () =>
            (await (window as unknown as { axe: typeof import('axe-core') }).axe.run()).violations,
        ),
      ).toEqual([])

      const output = join(directory, 'html.html')
      await application.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      }, output)
      await clickDocumentAction(page, 'Export HTML…')
      await expect(page.getByText(`Exported to ${output}`, { exact: true })).toBeVisible()
      const exported = await readFile(output, 'utf8')
      expect(exported).toContain('<caption>Release history</caption>')
      expect(exported).toContain('<ruby>')
      expect(exported).not.toContain('onclick=')
      const opened = application.waitForEvent('window')
      await application.evaluate(async ({ BrowserWindow }, filePath) => {
        const window = new BrowserWindow({
          show: true,
          webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
        })
        await window.loadFile(filePath)
      }, output)
      const exportedPage = await opened
      await basicHtml(exportedPage.locator('body > article'))
      await exportedPage.close()

      await page.evaluate(
        (baseUrl) =>
          window.manuslip.configureTranslation({
            provider: {
              adapter: 'openai-compatible',
              version: '1',
              baseUrl,
              model: 'fixture',
              profile: null,
              options: {},
            },
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            glossary: [],
            formality: 'default',
            promptVersion: 'prose-translation/v1',
          }),
        `http://127.0.0.1:${address.port}/chat`,
      )
      await page.getByRole('button', { name: 'Translated preview', exact: true }).click()
      await page.getByRole('button', { name: 'Translate', exact: true }).click()
      await expect(page.getByText('Reading copy ready.', { exact: true })).toBeVisible()
      await selectReadingLayout(page, 'side-by-side')
      const article = page.locator('.reading-article')
      await basicHtml(article.locator('.reading-original'))
      await basicHtml(article.locator('.reading-translation'))
      await expect(article.locator('.reading-translation h1')).toContainText('你好')
      expect(await page.evaluate(() => 'compromised' in window)).toBe(false)
      expect(requests).toEqual([])
      expect(errors).toEqual([])
    } finally {
      await application
        .evaluate(({ BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows()) window.destroy()
        })
        .catch(() => {})
      await application.close()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  })
}
