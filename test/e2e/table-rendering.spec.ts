import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { expect, type Locator, test } from '@playwright/test'
import { clickDocumentAction, launchDesktop, selectReadingLayout, waitForReading } from './helpers'

const source = `# Table rendering

Tables belong in the document flow.

| Item | Status | Amount | Notes |
| :--- | :---: | ---: | --- |
| [Paper][ref] | Ready | 1,240.00 | **Strong** |
| A longer description that wraps when space is limited | Draft | 85.50 | $x^2$ |
| Empty |

> | Name | Count |
> | :---: | ---: |
> | 中文 :smile: | 2 |

| Name | Detail |
| --- | --- |
| Identifier | \`${'unbroken_identifier_'.repeat(9)}\` |

End.

[ref]: https://example.com
`

async function expectAlignment(table: Locator): Promise<void> {
  await expect(table).toBeVisible()
  const alignments = ['left', 'center', 'right', 'start']
  for (const row of await table.locator('tr').all()) {
    const cells = row.locator('th, td')
    await expect(cells).toHaveCount(alignments.length)
    for (const [index, alignment] of alignments.entries())
      await expect(cells.nth(index)).toHaveCSS('text-align', alignment)
  }
}

for (const locale of ['en', 'zh-CN'] as const) {
  test(`${locale} tables preserve alignment, document flow and keyboard scrolling`, async () => {
    const directory = await mkdtemp(resolve('test/e2e/result/table-rendering-'))
    const profile = join(directory, 'profile')
    const path = join(directory, 'tables.md')
    await mkdir(profile)
    await writeFile(path, source)
    await writeFile(
      join(profile, 'preferences.json'),
      JSON.stringify({ schemaVersion: 1, locale, theme: locale === 'en' ? 'light' : 'dark' }),
    )
    const application = await launchDesktop(profile, [path])
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await page
        .getByRole('button', { name: locale === 'en' ? 'Live Preview' : '实时预览', exact: true })
        .click()
      const table = page.locator('.cm-live-table table').first()
      await expectAlignment(table)
      await expect(table.locator('tbody tr').last().locator('td')).toHaveText(['Empty', '', '', ''])
      await expect(table.locator('a')).toHaveAttribute('href', 'https://example.com/')
      await expect(table.getByRole('math')).toHaveAttribute('aria-label', 'x^2')
      const nested = page.locator('.cm-live-blockquote table')
      await expect(nested.locator('td').first()).toHaveCSS('text-align', 'center')
      await expect(nested.locator('td').last()).toHaveCSS('text-align', 'right')
      await expect(nested.locator('.md-emoji')).toHaveText('😄')
      const regionName = locale === 'en' ? 'Table' : '表格'
      await expect(page.getByRole('group', { name: regionName, exact: true })).toHaveCount(3)
      const scroll = page.locator('.cm-live-table .render-table-scroll').last()
      for (const width of [1144, 768, 480, 320]) {
        await page.setViewportSize({ width, height: 1000 })
        await table.scrollIntoViewIfNeeded()
        await expectAlignment(table)
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true)
        await page.screenshot({ path: test.info().outputPath(`tables-${width}.png`) })
        await scroll.focus()
        await expect(scroll).toBeFocused()
        await expect.poll(() => scroll.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
        await scroll.press('ArrowRight')
        await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
        await scroll.evaluate((el) => {
          el.scrollLeft = 0
        })
      }
      await page.setViewportSize({ width: 1144, height: 1000 })
      await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(2)
      })
      await expectAlignment(table)
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true)
      await page.screenshot({ path: test.info().outputPath('tables-zoom.png') })
      await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1)
      })
      await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
      await table.evaluate((element) => element.setAttribute('dir', 'rtl'))
      await expectAlignment(table)
      await scroll.focus()
      await scroll.press('ArrowRight')
      await expect.poll(() => scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
      await page.screenshot({ path: test.info().outputPath('tables-contrast-rtl.png') })
      await table.evaluate((element) => element.removeAttribute('dir'))
      await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' })
      await table.locator('th').first().click()
      await page.locator('[data-table-cell-editor]').press('Escape')
      await page.locator('.cm-live-table').first().focus()
      await page.locator('.cm-live-table').first().press('F2')
      await expect(page.locator('[data-table-cell-editor]')).toBeFocused()
      await expect(page.locator('[data-table-cell-editor]')).toHaveText('Item')
      await expectAlignment(table)
      await clickDocumentAction(page, locale === 'en' ? 'Edit table' : '编辑表格')
      const dialog = page.getByRole('dialog', {
        name: locale === 'en' ? 'Edit table' : '编辑表格',
        exact: true,
      })
      await expect(dialog.locator('input[data-row="0"][data-column="2"]')).toHaveCSS(
        'text-align',
        'right',
      )
      await dialog.locator('input[data-row="1"][data-column="1"]').focus()
      await dialog
        .getByRole('combobox', { name: locale === 'en' ? 'Column alignment' : '列对齐' })
        .selectOption('right')
      await expect(dialog.locator('input[data-row="0"][data-column="1"]')).toHaveCSS(
        'text-align',
        'right',
      )
      await expect(dialog.locator('input[data-row="1"][data-column="1"]')).toHaveCSS(
        'text-align',
        'right',
      )
      await dialog
        .getByRole('button', { name: locale === 'en' ? 'Cancel' : '取消', exact: true })
        .click()
      await expectAlignment(table)
      expect(await readFile(path, 'utf8')).toBe(source)
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
}

test('reading copies and HTML exports retain table alignment on screen and in print', async () => {
  const directory = await mkdtemp(resolve('test/e2e/result/table-reading-'))
  const path = join(directory, 'tables.md')
  await writeFile(path, source)
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const content: string = JSON.parse(Buffer.concat(chunks).toString()).messages[1].content
    response.setHeader('Content-Type', 'application/json')
    response.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: content.replaceAll('Ready', '就绪') },
          },
        ],
      }),
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing local fixture server')
  const application = await launchDesktop(join(directory, 'profile'), [path])
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
    await waitForReading(page)
    const article = page.locator('.reading-article')
    await expectAlignment(article.locator('table').first())
    await expect(article.locator('table').first()).toContainText('就绪')
    await expect(article.getByRole('group', { name: 'Table', exact: true })).toHaveCount(3)
    for (const layout of ['side-by-side', 'interlinear', 'replace']) {
      await selectReadingLayout(page, layout)
      const tables = article.locator('table').filter({ hasText: '1,240.00' })
      await expect(tables).toHaveCount(layout === 'replace' ? 1 : 2)
      for (const table of await tables.all()) await expectAlignment(table)
    }
    await page.screenshot({ path: test.info().outputPath('reading-tables.png') })
    const output = join(directory, 'tables.html')
    await application.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, output)
    await clickDocumentAction(page, 'Export reading HTML…')
    await expect.poll(() => readFile(output, 'utf8').catch(() => '')).toContain('<table>')
    const artifactPromise = application.waitForEvent('window')
    await application.evaluate(async ({ BrowserWindow }, path) => {
      // Paint the independent export renderer before taking its print screenshot.
      const window = new BrowserWindow({ show: true })
      await window.loadFile(path)
    }, output)
    const artifact = await artifactPromise
    await expectAlignment(artifact.locator('table').first())
    await artifact.emulateMedia({ media: 'print' })
    await expectAlignment(artifact.locator('table').first())
    await artifact.screenshot({ path: test.info().outputPath('export-tables.png') })
    expect(await readFile(path, 'utf8')).toBe(source)
  } finally {
    await application
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy()
      })
      .catch(() => {})
    await application.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
