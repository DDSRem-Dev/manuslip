import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { clickDocumentAction, launchDesktop, selectReadingLayout } from './helpers'
import { auditPluginInterface } from './plugin-accessibility'

test('captured reading conventions survive setting changes, layout and export until explicit refresh', async () => {
  const directory = await mkdtemp(resolve('test/e2e/result/reading-conventions-'))
  const path = join(directory, 'reading.md')
  const source =
    '---\ntitle: YAML_METADATA_PRIVATE\n...\n\n# Hello reader\n\n==Hello== ~~deleted~~ $x^2$.\n'
  await writeFile(path, source)
  const profile = join(directory, 'profile')
  await mkdir(profile)
  await writeFile(
    join(profile, 'preferences.json'),
    JSON.stringify({
      schemaVersion: 1,
      theme: 'light',
      locale: 'en',
      markdown: { opt: true, latex: true, mermaid: true, github: false, typora: true },
    }),
  )
  let calls = 0
  const payloads: string[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const text: string = JSON.parse(Buffer.concat(chunks).toString()).messages[1].content
    calls++
    payloads.push(text)
    response.setHeader('Content-Type', 'application/json')
    response.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: text.replaceAll('Hello', '你好') },
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
  try {
    const page = await application.firstWindow()
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
    await expect(article.locator('mark')).toHaveText('你好')
    await expect(article.locator('del')).toHaveText('deleted')
    await expect(article.getByRole('math')).toHaveCount(1)
    await expect(article).not.toContainText('YAML_METADATA_PRIVATE')
    expect(payloads.join('\n')).not.toContain('YAML_METADATA_PRIVATE')
    const requests = calls
    await page.getByRole('button', { name: 'Preferences', exact: true }).click()
    await page.getByRole('button', { name: 'Plugins', exact: true }).click()
    for (const name of ['Opt', 'LaTeX', 'Typora']) {
      await page.getByRole('checkbox', { name, exact: true }).uncheck()
      await expect(page.getByText('Preferences saved', { exact: true })).toBeVisible()
    }
    await page.getByRole('button', { name: 'Close preferences', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Refresh translation', exact: true }),
    ).toBeVisible()
    await selectReadingLayout(page, 'interlinear')
    await expect(article.locator('mark')).toHaveCount(2)
    await expect(article.locator('del')).toHaveCount(2)
    await expect(article.getByRole('math')).toHaveCount(2)
    await expect(article).not.toContainText('YAML_METADATA_PRIVATE')
    const output = join(directory, 'captured.html')
    await application.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
    }, output)
    await clickDocumentAction(page, 'Export reading HTML…')
    await page.getByRole('button', { name: 'Export this copy', exact: true }).click()
    await expect.poll(() => readFile(output, 'utf8').catch(() => '')).toContain('<mark')
    expect(await readFile(output, 'utf8')).toContain('<svg')
    expect(await readFile(output, 'utf8')).toContain('<del>deleted</del>')
    expect(await readFile(output, 'utf8')).not.toContain('YAML_METADATA_PRIVATE')
    expect(calls).toBe(requests)
    await page.getByRole('button', { name: 'Refresh translation', exact: true }).click()
    await expect(page.getByText('Reading copy ready.', { exact: true })).toBeVisible()
    await expect(article.locator('mark')).toHaveCount(0)
    await expect(article.locator('del')).toHaveCount(0)
    await expect(article.getByRole('math')).toHaveCount(0)
    await expect(article).toContainText('==你好== ~~deleted~~ $x^2$.')
    await expect(article).toContainText('YAML_METADATA_PRIVATE')
    expect(await readFile(path, 'utf8')).toBe(source)
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

test('built-in convention settings update preview and export and persist across restart', async () => {
  test.setTimeout(90_000)
  const directory = await mkdtemp(resolve('test/e2e/result/conventions-'))
  const profile = join(directory, 'profile')
  const path = join(directory, 'conventions.md')
  const source =
    '---\ntitle: YAML_METADATA_PRIVATE\n---\n\n# Guide {#start}\n\n[TOC]\n\n==**Highlight**== and ~~deleted~~ H~2~O x^2^.\n\n"Smart" -- punctuation...\n\n> [!TIP]\n> Useful information.\n\nhttps://example.invalid/path\n\nInline $x^2$.\n\n```mermaid\nflowchart LR\nA[Write] --> B[Read]\n```\n\n## Destination\n\nA note[^中文] and again[^中文].\n\n[^中文]: Footnote body.\n'
  await writeFile(path, source)
  let application = await launchDesktop(profile, [path])
  try {
    let page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    let editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
    await expect(editor.locator('mark')).toHaveText('Highlight')
    await expect(editor.locator('del')).toHaveText('deleted')
    await expect(editor.getByRole('math')).toHaveCount(1)
    await expect(editor.locator('.cm-live-diagram svg')).toHaveCount(1)
    await expect(editor.locator('.markdown-alert, .markdown-toc')).toHaveCount(0)
    await expect(editor).toContainText('“Smart” — punctuation…')
    await page.screenshot({ path: test.info().outputPath('conventions-default.png') })

    await page.getByRole('button', { name: 'Preferences', exact: true }).click()
    await page.getByRole('button', { name: 'Plugins', exact: true }).click()
    for (const name of ['Opt', 'LaTeX', 'Mermaid'])
      await expect(page.getByRole('checkbox', { name, exact: true })).toBeChecked()
    for (const name of ['GitHub', 'Typora'])
      await expect(page.getByRole('checkbox', { name, exact: true })).not.toBeChecked()
    await page.screenshot({ path: test.info().outputPath('markdown-settings.png') })
    for (const name of ['Opt', 'LaTeX', 'Mermaid']) {
      await page.getByRole('checkbox', { name, exact: true }).uncheck()
      await expect(page.getByText('Preferences saved', { exact: true })).toBeVisible()
    }
    for (const name of ['GitHub', 'Typora']) {
      await page.getByRole('checkbox', { name, exact: true }).check()
      await expect(page.getByText('Preferences saved', { exact: true })).toBeVisible()
    }
    await page.getByRole('button', { name: 'Close preferences', exact: true }).click()
    await expect(editor.locator('mark')).toHaveCount(0)
    await expect(editor.locator('del')).toHaveCount(0)
    await expect(editor).toContainText('~~deleted~~')
    await expect(editor.getByRole('math')).toHaveCount(0)
    await expect(editor.locator('.cm-live-diagram svg')).toHaveCount(0)
    await expect(editor.locator('pre > code.language-mermaid')).toContainText('flowchart LR')
    await expect(editor.locator('.markdown-alert-tip')).toContainText('Useful information.')
    await expect(editor.locator('.markdown-toc')).toBeVisible()
    await expect(
      editor.getByRole('link', { name: 'https://example.invalid/path', exact: true }),
    ).toHaveAttribute('href', 'https://example.invalid/path')
    await editor
      .locator('.markdown-toc')
      .getByRole('link', { name: 'Destination', exact: true })
      .click()
    const destinationLine = source.slice(0, source.indexOf('## Destination')).split('\n').length
    await expect(page.locator('.editor-cursor-position')).toHaveText(`Ln ${destinationLine}, Col 1`)
    await page.screenshot({ path: test.info().outputPath('conventions-github-typora.png') })
    const reference = editor.locator('[data-footnote-ref]').first()
    const note = editor.locator('.cm-live-footnoteDefinition li').first()
    await reference.click()
    await expect(note).toBeFocused()
    await expect(note).toBeInViewport({ ratio: 0.9 })
    await editor.locator('[data-footnote-backref]').first().click()
    await expect(reference).toBeFocused()
    await expect(reference).toBeInViewport({ ratio: 1 })

    const target = join(directory, 'conventions.html')
    await application.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, target)
    await clickDocumentAction(page, 'Export HTML…')
    await expect.poll(() => readFile(target, 'utf8').catch(() => '')).toContain('markdown-toc')
    const html = await readFile(target, 'utf8')
    expect(html).not.toContain('YAML_METADATA_PRIVATE')
    expect(html).toContain('markdown-alert-tip')
    expect(html).toContain('==<strong>Highlight</strong>==')
    expect(html).toContain('~~deleted~~')
    expect(html).not.toContain('<del>')
    expect(html).toContain('$x^2$')
    expect(html).toContain('flowchart LR')
    expect(html).toContain('id="user-content-start"')
    expect(html).toContain('href="#user-content-start"')
    const missingFragments = await page.evaluate((html) => {
      const document = new DOMParser().parseFromString(html, 'text/html')
      return [...document.querySelectorAll('a[href^="#"]')].flatMap((anchor) => {
        const href = anchor.getAttribute('href')?.slice(1) ?? ''
        return document.getElementById(href) ? [] : [href]
      })
    }, html)
    expect(missingFragments).toEqual([])
    expect(await readFile(path, 'utf8')).toBe(source)
    expect(errors).toEqual([])

    const closed = application.waitForEvent('close')
    await application.evaluate(({ app }) => app.exit(0))
    await closed
    const saved = JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8'))
    expect(saved.markdown).toEqual({
      opt: false,
      latex: false,
      mermaid: false,
      github: true,
      typora: true,
    })
    application = await launchDesktop(profile, [path])
    page = await application.firstWindow()
    editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
    await expect(editor.locator('.markdown-toc')).toBeVisible()
    await expect(editor.locator('mark')).toHaveCount(0)
    await expect(editor.locator('del')).toHaveCount(0)
    await page.getByRole('button', { name: 'Preferences', exact: true }).click()
    await page.getByRole('button', { name: 'Plugins', exact: true }).click()
    await page.getByRole('button', { name: 'Reset extensions', exact: true }).click()
    await expect(editor.locator('del')).toHaveText('deleted')
    await expect(page.getByRole('checkbox', { name: 'LaTeX', exact: true })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'GitHub', exact: true })).not.toBeChecked()
    await page.setViewportSize({ width: 420, height: 900 })
    await expect(page.getByRole('checkbox', { name: 'Typora', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath('markdown-settings-narrow.png') })
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

test('the LaTeX gallery renders complete offline formulas in preview and HTML export', async () => {
  const directory = await mkdtemp(resolve('test/e2e/result/latex-gallery-'))
  const source = await readFile(
    resolve('packages/renderer/test/fixtures/markdown/latex.md'),
    'utf8',
  )
  const path = join(directory, 'LaTeX.md')
  await writeFile(path, source)
  const application = await launchDesktop(join(directory, 'profile'), [path])
  try {
    const page = await application.firstWindow()
    const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
    const inline = editor.getByRole('math', { name: 'E = mc^2', exact: true })
    await expect(inline.locator('svg path')).not.toHaveCount(0)
    // The exponent follows an equality break; its path must survive as part of the same image.
    expect(await inline.locator('path').count()).toBeGreaterThanOrEqual(5)
    await page.screenshot({ path: test.info().outputPath('latex-gallery.png') })
    const target = join(directory, 'gallery.html')
    await application.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, target)
    await clickDocumentAction(page, 'Export HTML…')
    await expect(page.getByText(`Exported to ${target}`, { exact: true })).toBeVisible({
      timeout: 20_000,
    })
    const html = await readFile(target, 'utf8')
    expect((html.match(/<svg/g) ?? []).length).toBeGreaterThanOrEqual(20)
    expect(html).not.toMatch(/<script|data-export-slot|(?:href|src)="https?:/)
    expect(await readFile(path, 'utf8')).toBe(source)
    await test.info().attach('latex-export', { body: html, contentType: 'text/html' })
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

for (const [locale, theme] of [
  ['en', 'light'],
  ['zh-CN', 'dark'],
] as const) {
  test(`conventions and their settings remain accessible in ${locale} ${theme}`, async () => {
    const directory = await mkdtemp(resolve('test/e2e/result/convention-accessibility-'))
    const profile = join(directory, 'profile')
    const path = join(directory, 'Guide.md')
    await mkdir(profile)
    await writeFile(
      join(profile, 'preferences.json'),
      JSON.stringify({
        schemaVersion: 1,
        locale,
        theme,
        markdown: { opt: true, latex: true, mermaid: true, github: true, typora: true },
      }),
    )
    await writeFile(
      path,
      '---\ntitle: "中文 Guide"\nsummary: |\n  ```\n---\n# Guide {#guide}\n\n[TOC]\n\n==Highlight==\n\n> [!TIP]\n> Advice.\n\n## 中文标题\n\nEnd',
    )
    const application = await launchDesktop(profile, [path])
    try {
      const page = await application.firstWindow()
      await expect(page.locator('.cm-live-frontmatter')).toHaveCount(3)
      await expect(page.locator('.markdown-alert-tip')).toBeVisible()
      await auditPluginInterface(application, page, test.info(), 'conventions')
      await page.emulateMedia({ forcedColors: 'active' })
      await expect(page.locator('mark')).toBeVisible()
      await expect(page.locator('.cm-live-frontmatter').first()).toHaveCSS(
        'border-top-style',
        'solid',
      )
      await expect(page.locator('.markdown-alert-tip')).toHaveCSS(
        'border-inline-start-style',
        'solid',
      )
      await page.screenshot({ path: test.info().outputPath('conventions-forced-colors.png') })
      await page.emulateMedia({ forcedColors: 'none' })
      await page.getByRole('button', { name: /^(Preferences|偏好设置)$/, exact: true }).click()
      await page.getByRole('button', { name: /^(Plugins|插件)$/, exact: true }).click()
      await page
        .getByRole('searchbox', {
          name: locale === 'en' ? 'Find a setting' : '查找设置',
          exact: true,
        })
        .fill(locale === 'en' ? 'Load remote images' : '远程图片')
      await page
        .locator('.preferences-results')
        .getByRole('button', { name: locale === 'en' ? /^Plugins/ : /^插件/ })
        .click()
      await expect(
        page.getByRole('group', {
          name: locale === 'en' ? 'Markdown extensions' : 'Markdown 扩展',
          exact: true,
        }),
      ).toBeVisible()
      await expect(page.locator('#markdown-typora-hint')).toHaveText(
        locale === 'en' ? 'Front matter · Table of contents' : '前置元数据 · 目录',
      )
      await expect(
        page.getByRole('checkbox', {
          name: locale === 'en' ? 'Render sanitized HTML' : '渲染经安全过滤的 HTML',
          exact: true,
        }),
      ).toBeEnabled()
      await expect(
        page.getByRole('checkbox', {
          name: locale === 'en' ? 'Load remote images…' : '加载远程图片…',
          exact: true,
        }),
      ).toBeEnabled()
      await expect(page.locator('#markdown-opt-hint')).toHaveText(
        locale === 'en' ? 'Highlight · Strikethrough' : '高亮 · 删除线',
      )
      await auditPluginInterface(
        application,
        page,
        test.info(),
        'settings',
        page.getByRole('checkbox', {
          name: locale === 'en' ? 'Load remote images…' : '加载远程图片…',
          exact: true,
        }),
      )
      await page.getByRole('checkbox', { name: 'Opt', exact: true }).focus()
      await page.keyboard.press('Space')
      await expect(page.getByRole('checkbox', { name: 'Opt', exact: true })).not.toBeChecked()
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
}
