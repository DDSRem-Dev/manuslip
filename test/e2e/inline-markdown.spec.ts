import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { expect, type Locator, test } from '@playwright/test'
import {
  clickDocumentAction,
  launchDesktop,
  openMarkdownExtensions,
  selectReadingLayout,
} from './helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

async function baselineAligned(formula: Locator) {
  await expect(formula.locator('svg')).toBeVisible()
  const metrics = await formula.evaluate((element) => {
    const wrapper = element.closest('.cm-live-inline-widget') ?? element
    const svg = element.querySelector('svg')
    let previous = wrapper.previousSibling
    while (previous instanceof Element && previous.classList.contains('cm-widgetBuffer'))
      previous = previous.previousSibling
    if (!svg || !previous || previous.nodeType !== Node.TEXT_NODE || !previous.parentElement)
      throw new Error('Formula must follow adjacent prose')
    const style = getComputedStyle(previous.parentElement)
    const range = document.createRange()
    range.setStart(previous, Math.max(0, (previous.textContent?.length ?? 0) - 1))
    range.setEnd(previous, previous.textContent?.length ?? 0)
    const text = range.getBoundingClientRect()
    // Measure the prose baseline independently of the formula's wrappers.
    const probe = document.createElement('span')
    // Table cells use tabular numerals, which leave the computed font shorthand empty.
    Object.assign(probe.style, {
      position: 'fixed',
      left: '-10000px',
      visibility: 'hidden',
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontStyle: style.fontStyle,
      fontWeight: style.fontWeight,
      fontStretch: style.fontStretch,
      fontVariant: style.fontVariant,
      lineHeight: style.lineHeight,
      whiteSpace: 'pre',
    })
    const label = document.createTextNode(previous.textContent ?? '')
    const axis = document.createElement('span')
    Object.assign(axis.style, {
      display: 'inline-block',
      width: '0',
      height: '0',
      verticalAlign: 'baseline',
    })
    probe.append(label, axis)
    document.body.append(probe)
    try {
      const probeRange = document.createRange()
      probeRange.selectNodeContents(label)
      const probeText = probeRange.getBoundingClientRect()
      const axisBox = axis.getBoundingClientRect()
      const expected = text.top + axisBox.top - probeText.top
      const image = svg.getBoundingClientRect()
      const box = svg.viewBox.baseVal
      return {
        baselineError: Math.abs(image.top + (image.height * -box.y) / box.height - expected),
        display: getComputedStyle(svg).display,
        height: image.height,
      }
    } finally {
      probe.remove()
    }
  })
  expect(metrics.height).toBeGreaterThan(0)
  expect(metrics.display).toBe('block')
  expect(metrics.baselineError, JSON.stringify(metrics)).toBeLessThan(0.75)
}

test('inline notes, baseline-aligned formulas and literal disclosure tags survive editing, reading and export', async () => {
  test.setTimeout(60_000)
  const directory = await mkdtemp(resolve('test/artifacts/logs/inline-markdown-'))
  const path = join(directory, 'inline.md')
  const source =
    '# Inline patch\n\nInline $x$ and $\\frac{1}{2}$ and $x_i^2$ centered.\n\nHello note^[Hello **footnote** `code ]` $y_2$] and named[^n].\n\n<details open>\n<summary>Literal title</summary>\n**Body**\n</details>\n\n[^n]: Named note.\n\nEnd\n'
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
  if (!address || typeof address === 'string') throw new Error('Missing local translation server')
  const application = await launchDesktop(join(directory, 'profile'), [path])
  try {
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1144, height: 1000 })
    const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
    const footer = editor.locator('.cm-live-footnoteDefinition[data-placement="after-document"]')
    await expect(editor.locator('[data-footnote-ref]')).toHaveText(['1', '2'])
    await expect(footer.locator('strong')).toHaveText('footnote')
    await expect(footer.locator('ol')).toHaveAttribute('start', '1')
    await expect(editor.locator('details, summary')).toHaveCount(0)
    await expect(editor).toContainText('<details open>')
    await expect(
      editor.locator('strong, .cm-live-strong').filter({ hasText: 'Body' }),
    ).toBeVisible()
    for (const value of ['x', '\\frac{1}{2}', 'x_i^2'])
      await baselineAligned(editor.getByRole('math', { name: value, exact: true }))
    await page.screenshot({ path: test.info().outputPath('inline-wide.png') })

    await editor.locator('[data-footnote-ref]').first().click()
    await expect(footer.locator('li')).toBeFocused()
    await footer.locator('li p').first().click()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await expect
      .poll(async () => (await editor.locator('.cm-line').allTextContents()).join('\n'))
      .toBe(source)
    await editor.fill(source.replace('**footnote**', '**edited**'))
    await editor.press(`${modifier}+Home`)
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    await expect(footer.locator('strong')).toHaveText('edited')
    await editor.focus()
    await editor.press(`${modifier}+z`)
    await expect(footer.locator('strong')).toHaveText('footnote')
    await editor.press(`${modifier}+Home`)

    const extensions = await openMarkdownExtensions(page)
    await extensions.getByRole('checkbox', { name: 'Render sanitized HTML', exact: true }).check()
    await page.keyboard.press('Escape')
    await expect(editor.locator('details, summary')).toHaveCount(0)
    await expect(editor).toContainText('<summary>Literal title</summary>')
    await page.setViewportSize({ width: 420, height: 1000 })
    for (const value of ['x', '\\frac{1}{2}', 'x_i^2'])
      await baselineAligned(editor.getByRole('math', { name: value, exact: true }))
    await page.screenshot({ path: test.info().outputPath('inline-narrow.png') })
    await page.setViewportSize({ width: 1144, height: 1000 })

    const target = join(directory, 'inline.html')
    await application.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, target)
    await clickDocumentAction(page, 'Export HTML…')
    await expect(page.getByText(`Exported to ${target}`, { exact: true })).toBeVisible({
      timeout: 20_000,
    })
    const html = await readFile(target, 'utf8')
    expect(html).toContain('&lt;details open&gt;')
    expect(html).not.toMatch(/<\/?(?:details|summary)(?=[\s>])/i)
    const opened = application.waitForEvent('window')
    await application.evaluate(async ({ BrowserWindow }, filePath) => {
      const window = new BrowserWindow({
        // Chromium needs a painted surface for screenshots in packaged Electron.
        show: true,
        webPreferences: {
          sandbox: true,
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: false,
        },
      })
      await window.loadFile(filePath)
    }, target)
    const exported = await opened
    for (let index = 0; index < 3; index++)
      await baselineAligned(exported.locator('[data-export-kind="math"]').nth(index))
    await expect(exported.locator('[data-footnote-ref]')).toHaveText(['1', '2'])
    await exported.screenshot({ path: test.info().outputPath('inline-export.png') })
    await exported.close()

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
    const article = page.locator('.reading-article')
    await expect(article.locator('[data-footnote-ref]')).toHaveText(['1', '2'])
    await expect(article.locator('.footnotes')).toContainText('你好 footnote')
    await expect(article.locator('.footnotes code')).toHaveText('code ]')
    await expect(article.locator('details, summary')).toHaveCount(0)
    for (const value of ['x', '\\frac{1}{2}', 'x_i^2'])
      await baselineAligned(article.getByRole('math', { name: value, exact: true }))
    await page.screenshot({ path: test.info().outputPath('inline-reading.png') })
    await selectReadingLayout(page, 'side-by-side')
    await expect(article.locator('.footnotes')).toHaveCount(2)
    await expect(article.locator('[data-footnote-ref]')).toHaveText(['1', '2', '1', '2'])
    const missing = await article.evaluate((article) =>
      [...article.querySelectorAll('a[href^="#"]')].flatMap((anchor) => {
        const id = anchor.getAttribute('href')?.slice(1) ?? ''
        return document.getElementById(id) ? [] : [id]
      }),
    )
    expect(missing).toEqual([])
    const readingTarget = join(directory, 'inline-reading.html')
    await application.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, readingTarget)
    await clickDocumentAction(page, 'Export reading HTML…')
    await expect(page.getByText(`Exported to ${readingTarget}`, { exact: true })).toBeVisible({
      timeout: 20_000,
    })
    const readingHtml = await readFile(readingTarget, 'utf8')
    const notes = await page.evaluate((html) => {
      const document = new DOMParser().parseFromString(html, 'text/html')
      return {
        text: [...document.querySelectorAll('.footnotes')].map((note) => note.textContent),
        references: [...document.querySelectorAll('[data-footnote-ref]')].map(
          (ref) => ref.textContent,
        ),
        disclosures: document.querySelectorAll('details, summary').length,
      }
    }, readingHtml)
    expect(notes.text[0]).toContain('Hello footnote')
    expect(notes.text[1]).toContain('你好 footnote')
    expect(notes.references).toEqual(['1', '2', '1', '2'])
    expect(notes.disclosures).toBe(0)
    expect(await readFile(path, 'utf8')).toBe(source)
    expect(errors).toEqual([])
  } catch (error) {
    const page = await application.firstWindow()
    await page.screenshot({ path: test.info().outputPath('inline-failure.png') }).catch(() => {})
    await test
      .info()
      .attach('failure-dom', { body: await page.content(), contentType: 'text/html' })
    throw error
  } finally {
    await application
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy()
      })
      .catch(() => {})
    await application.close()
    await new Promise<void>((done) => server.close(() => done()))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('inline math keeps a common baseline through scripts, tall fractions, CJK, headings and zoom', async () => {
  const formulas = [
    'x',
    'x^2',
    'x_i',
    'x_i^2',
    '\\frac{1}{2}',
    '\\dfrac{a}{b}',
    '\\sqrt{x+1}',
    '\\int_0^1 f(x)\\,dx',
    '\\sum_{i=1}^n i',
    '\\binom{n}{k}',
  ]
  const source = [
    '# Math layout',
    '## Heading $E=mc^2$ in prose',
    formulas.map((formula) => `Text $${formula}$ text.`).join('\n\n'),
    '中文公式 $a_j^3$ 与正文对齐。',
    '> Quoted $\\frac{x+1}{y_2}$ text.',
    '| Table |\n| --- |\n| Inline $\\sqrt{z}$ text. |',
    'End',
  ].join('\n\n')
  const directory = await mkdtemp(resolve('test/artifacts/logs/math-baseline-'))
  const path = join(directory, 'math.md')
  await writeFile(path, source)
  const application = await launchDesktop(join(directory, 'profile'), [path])
  const page = await application.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
    const all = [...formulas, 'E=mc^2', 'a_j^3', '\\frac{x+1}{y_2}', '\\sqrt{z}']
    for (const [width, fontSize, theme] of [
      [1144, 17, 'light'],
      [420, 21, 'dark'],
    ] as const) {
      await page.setViewportSize({ width, height: 2000 })
      await page.evaluate(
        ({ fontSize, theme }) => {
          document.documentElement.dataset.theme = theme
          const content = document.querySelector<HTMLElement>('.cm-content')
          if (content) content.style.fontSize = `${fontSize}px`
        },
        { fontSize, theme },
      )
      for (const value of all)
        await baselineAligned(editor.getByRole('math', { name: value, exact: true }))
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true)
      await page.screenshot({ path: test.info().outputPath(`math-baseline-${width}.png`) })
    }
    // Browser zoom exercises physical-pixel rounding as well as inherited text size.
    await page.setViewportSize({ width: 1144, height: 2000 })
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1.25)
    })
    for (const value of all)
      await baselineAligned(editor.getByRole('math', { name: value, exact: true }))
    expect(errors).toEqual([])
    expect(await readFile(path, 'utf8')).toBe(source)
  } catch (error) {
    await page
      .screenshot({ path: test.info().outputPath('math-baseline-failure.png') })
      .catch(() => {})
    throw error
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
