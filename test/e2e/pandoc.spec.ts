import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import axe from 'axe-core'
import { readPandocZip } from '../../apps/desktop/src/main/pandoc/zip'
import { clickDocumentAction, launchDesktop } from './helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const tool = process.env.MANUSLIP_TEST_PANDOC
const source =
  'token keep token\r\n\r\n# Hello export 中文\r\n\r\nEditable **strong** text 😀 and a note[^n].\r\n\r\n| Name | Detail |\r\n| --- | --- |\r\n| Original | 译文 |\r\n\r\nMath $x^2$ and $\\ce{H2O}$.\r\n\r\n```mermaid\r\nflowchart LR\r\nWrite[写作 Write]-->Share[分享 Share]\r\n```\r\n\r\n![Local red pixel](pixel.png)\r\n\r\n## Final heading\r\n\r\nComplete end marker.\r\n\r\n[^n]: Footnote content.\r\n'
async function stop(application: ElectronApplication, directory: string): Promise<void> {
  await application
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    .catch(() => {})
  await application.close()
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
async function audit(page: Page, name: string): Promise<void> {
  const info = test.info()
  await page.evaluate(axe.source)
  const result = await page.evaluate(async () => {
    const value = await (window as unknown as { axe: typeof import('axe-core') }).axe.run(
      document,
      {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
        },
      },
    )
    return {
      violations: value.violations,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }
  })
  await info.attach(`${name}-accessibility`, {
    body: JSON.stringify(result),
    contentType: 'application/json',
  })
  expect(result.violations).toEqual([])
  expect(result.overflow).toBe(false)
  await info.attach(`${name}-tree`, {
    body: await page.locator('body').ariaSnapshot(),
    contentType: 'text/plain',
  })
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await info.attach(name, { path, contentType: 'image/png' })
}
test('missing and invalid Pandoc choices keep normal export and source editing usable', async () => {
  const directory = await mkdtemp(resolve('test/e2e/result/pandoc-missing-'))
  if (!directory.startsWith(resolve('test/e2e/result') + sep))
    throw new Error('Unsafe fixture path')
  const path = join(directory, 'missing.md')
  await writeFile(path, '# Unmodified source\r\n')
  const application = await launchDesktop(join(directory, 'profile'), [path])
  try {
    const page = await application.firstWindow()
    await clickDocumentAction(page, 'Export with Pandoc…')
    const dialog = page.getByRole('dialog', { name: 'Export with Pandoc', exact: true })
    await expect(dialog.getByRole('button', { name: 'Choose Pandoc…', exact: true })).toBeEnabled()
    await expect(dialog.getByRole('button', { name: 'Export…', exact: true })).toBeDisabled()
    await application.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
    })
    await dialog.getByRole('button', { name: 'Choose Pandoc…', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Choose Pandoc…', exact: true })).toBeEnabled()
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, path)
    await dialog.getByRole('button', { name: 'Choose Pandoc…', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('Choose a working Pandoc 3 application')
    await audit(page, 'pandoc-missing')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Document actions', exact: true })).toBeFocused()
    const output = join(directory, 'normal.html')
    await application.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
    }, output)
    await clickDocumentAction(page, 'Export HTML…')
    await expect(page.getByText(`Exported to ${output}`, { exact: true })).toBeVisible()
    expect(await readFile(output, 'utf8')).toContain('Unmodified source')
    expect(await readFile(path, 'utf8')).toBe('# Unmodified source\r\n')
  } finally {
    await stop(application, directory)
  }
})

for (const locale of ['en', 'zh-CN'] as const) {
  test(`${locale} real Pandoc exports preserve editable content, rendered media and source history`, async () => {
    test.skip(
      !tool,
      'Set MANUSLIP_TEST_PANDOC to an explicitly selected local Pandoc 3 application',
    )
    test.setTimeout(120_000)
    const info = test.info()
    const directory = await mkdtemp(resolve('test/e2e/result/pandoc-native-'))
    if (!directory.startsWith(resolve('test/e2e/result') + sep))
      throw new Error('Unsafe fixture path')
    const profile = join(directory, 'profile'),
      path = join(directory, 'copy.md')
    await mkdir(profile)
    await writeFile(
      join(profile, 'preferences.json'),
      JSON.stringify({ schemaVersion: 1, locale, theme: locale === 'en' ? 'light' : 'dark' }),
    )
    await writeFile(path, source)
    const application = await launchDesktop(profile, [path])
    try {
      const page = await application.firstWindow(),
        chinese = locale === 'zh-CN'
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const pixel = await application.evaluate(({ nativeImage }) =>
        nativeImage
          .createFromBitmap(Buffer.from([0, 0, 255, 255]), { width: 1, height: 1 })
          .toPNG()
          .toString('base64'),
      )
      await writeFile(join(directory, 'pixel.png'), Buffer.from(pixel, 'base64'))
      await page.getByRole('button', { name: chinese ? '源码' : 'Source', exact: true }).click()
      const editor = page.locator('.cm-content')
      await editor.focus()
      await editor.press(`${modifier}+Home`)
      await editor.press(`${modifier}+d`)
      await editor.press(`${modifier}+d`)
      await editor.evaluate((element) => {
        ;(window as unknown as { pandocEditor: Element }).pandocEditor = element
      })
      for (const format of ['docx', 'epub', 'latex'] as const) {
        const target = join(directory, `export-${locale}.${format === 'latex' ? 'zip' : format}`)
        await application.evaluate(({ dialog }, target) => {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
        }, target)
        await clickDocumentAction(page, chinese ? '通过 Pandoc 导出…' : 'Export with Pandoc…')
        const modal = page.getByRole('dialog', {
          name: chinese ? '通过 Pandoc 导出' : 'Export with Pandoc',
          exact: true,
        })
        if (format === 'docx') {
          await application.evaluate(({ dialog }, path) => {
            dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
          }, tool as string)
          await modal
            .getByRole('button', { name: chinese ? '选择 Pandoc…' : 'Choose Pandoc…', exact: true })
            .click()
          await expect(
            modal.getByRole('button', { name: chinese ? '导出…' : 'Export…', exact: true }),
          ).toBeEnabled()
          await audit(page, `pandoc-${locale}-wide`)
          await application.evaluate(({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows().find(
              (window) =>
                !window.webContents.getURL().includes('/print/') &&
                !window.webContents.getURL().includes('/diagram/'),
            )
            window?.setMinimumSize(360, 500)
            window?.setContentSize(400, 860)
          })
          await expect.poll(() => page.evaluate(() => innerWidth)).toBe(400)
          await audit(page, `pandoc-${locale}-narrow`)
        }
        await modal
          .getByRole('combobox', { name: chinese ? '格式' : 'Format', exact: true })
          .selectOption(format)
        await modal
          .getByRole('combobox', { name: chinese ? '文档样式' : 'Document style', exact: true })
          .selectOption('numbered')
        await modal
          .getByRole('button', { name: chinese ? '导出…' : 'Export…', exact: true })
          .click()
        await expect(
          page.getByText(chinese ? `已导出至 ${target}` : `Exported to ${target}`, { exact: true }),
        ).toBeVisible({ timeout: 30_000 })
        const bytes = await readFile(target),
          files = readPandocZip(bytes)
        const text = [...files]
          .filter(([name]) => /\.(?:xml|xhtml|html|tex)$/.test(name))
          .map(([, bytes]) => bytes.toString())
          .join('\n')
        for (const content of [
          'Hello export',
          '中文',
          'Editable',
          'strong',
          'Original',
          '译文',
          'Complete end marker',
          'Footnote content',
        ])
          expect(text).toContain(content)
        const media = [...files].filter(([name]) => /\.(?:png|jpe?g)$/.test(name))
        expect(media.length).toBeGreaterThanOrEqual(4)
        expect(media.some(([, bytes]) => bytes.equals(Buffer.from(pixel, 'base64')))).toBe(true)
        await info.attach(`pandoc-${format}`, {
          body: bytes,
          contentType:
            format === 'docx'
              ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              : format === 'epub'
                ? 'application/epub+zip'
                : 'application/zip',
        })
        if (format === 'docx')
          for (let index = 0; index < media.length; index++) {
            const entry = media[index]
            if (!entry) continue
            const stats = await application.evaluate(({ nativeImage }, encoded) => {
              const image = nativeImage.createFromBuffer(Buffer.from(encoded, 'base64')),
                bitmap = image.toBitmap()
              let ink = 0
              for (let i = 0; i < bitmap.length; i += 4)
                if (
                  (bitmap[i] || 0) < 220 ||
                  (bitmap[i + 1] || 0) < 220 ||
                  (bitmap[i + 2] || 0) < 220
                )
                  ink++
              return { ...image.getSize(), empty: image.isEmpty(), ink }
            }, entry[1].toString('base64'))
            expect(stats.empty).toBe(false)
            expect(stats.ink).toBeGreaterThan(0)
            if (stats.width > 1) expect(stats.ink).toBeGreaterThan(15)
            await info.attach(`pandoc-media-${index}`, { body: entry[1], contentType: 'image/png' })
          }
        expect(await readFile(path, 'utf8')).toBe(source)
        expect(
          await editor.evaluate(
            (element) => (window as unknown as { pandocEditor: Element }).pandocEditor === element,
          ),
        ).toBe(true)
      }
      await editor.focus()
      await page.keyboard.type('X')
      await editor.press(`${modifier}+s`)
      await expect
        .poll(() => readFile(path, 'utf8'))
        .toBe(source.replace('token keep token', 'X keep X'))
      await editor.press(`${modifier}+z`)
      await editor.press(`${modifier}+s`)
      await expect.poll(() => readFile(path, 'utf8')).toBe(source)
      await clickDocumentAction(page, chinese ? '通过 Pandoc 导出…' : 'Export with Pandoc…')
      const modal = page.getByRole('dialog', {
        name: chinese ? '通过 Pandoc 导出' : 'Export with Pandoc',
        exact: true,
      })
      await modal
        .getByRole('button', {
          name: chinese ? '忘记此应用程序' : 'Forget application',
          exact: true,
        })
        .click()
      await expect(
        modal.getByRole('button', { name: chinese ? '导出…' : 'Export…', exact: true }),
      ).toBeDisabled()
      await expect(
        modal.getByRole('button', {
          name: chinese ? '选择 Pandoc…' : 'Choose Pandoc…',
          exact: true,
        }),
      ).toBeEnabled()
      expect(await page.evaluate(() => window.manuslip.pandocTool())).toMatchObject({
        ok: true,
        value: { tool: null, persisted: true },
      })
      expect(errors).toEqual([])
    } finally {
      await stop(application, directory)
    }
  })
}
