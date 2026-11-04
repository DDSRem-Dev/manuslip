import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, type Locator, test } from '@playwright/test'
import { launchDesktop } from './helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const value = [
  String.raw`\begin{aligned}`,
  String.raw`x &= a+b \\`,
  'y &= c+d',
  String.raw`\end{aligned}`,
].join('\n')

async function expectEditingVisible(preview: Locator, caretOnly = false): Promise<void> {
  await expect
    .poll(() =>
      preview.evaluate((element, caretOnly) => {
        const panel = element.closest('.cm-live-preview-panel')
        const editor = element.closest('.cm-editor')
        const scroller = editor?.querySelector('.cm-scroller')
        const first =
          caretOnly || panel
            ? getSelection()?.focusNode?.parentElement?.closest('.cm-line')
            : scroller?.querySelector('.cm-live-edit-start, .cm-live-inline-math-source')
        const viewport = scroller?.getBoundingClientRect(),
          source = first?.getBoundingClientRect(),
          preview = element.getBoundingClientRect()
        const panelBounds = editor?.getBoundingClientRect()
        return Boolean(
          viewport &&
            source &&
            source.top >= viewport.top - 1 &&
            (panel
              ? panelBounds && preview.bottom <= panelBounds.bottom + 1
              : preview.bottom <= viewport.bottom + 1),
        )
      }, caretOnly),
    )
    .toBe(true)
}

for (const { width, height, zoom, theme } of [
  { width: 1144, height: 700, zoom: 1, theme: 'light' },
  { width: 420, height: 600, zoom: 1.25, theme: 'dark' },
]) {
  for (const kind of ['display', 'inline', 'diagram', 'long']) {
    test(`${theme} opening ${kind} near the viewport bottom keeps source and preview in view`, async () => {
      const directory = await mkdtemp(resolve('test/e2e/result/latex-viewport-'))
      const profile = join(directory, 'profile'),
        path = join(directory, 'equation.md')
      const paragraph = Array.from({ length: 25 }, (_, at) => `Paragraph ${at}.\n\n`).join('')
      const expression =
        kind === 'diagram'
          ? 'flowchart LR\nA[Alpha] --> B[Beta]'
          : kind === 'inline'
            ? 'x_i^2'
            : kind === 'long'
              ? value.replace(
                  'x &=',
                  `${Array.from({ length: 24 }, (_, at) => `% source comment ${at}\n`).join('')}x &=`,
                )
              : value
      const block =
        kind === 'diagram'
          ? `\`\`\`mermaid\n${expression}\n\`\`\``
          : kind === 'inline'
            ? `Before $${expression}$ after.`
            : `$$\n${expression}\n$$`
      const source = `${paragraph}${block}\n\n${paragraph}`
      await mkdir(profile)
      await writeFile(
        join(profile, 'preferences.json'),
        JSON.stringify({ schemaVersion: 1, locale: 'en', theme }),
      )
      await writeFile(path, source)
      const application = await launchDesktop(profile, [path])
      try {
        const page = await application.firstWindow()
        await page.setViewportSize({ width, height })
        await application.evaluate(({ BrowserWindow }, zoom) => {
          BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(zoom)
        }, zoom)
        const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
        const math =
          kind === 'diagram'
            ? editor.locator('.cm-live-diagram .cm-live-rendered')
            : editor.getByRole('math', { name: expression, exact: true })
        await page.locator('.cm-scroller').evaluate((element) => {
          element.scrollTop = (element.scrollHeight - element.clientHeight) / 2
        })
        await math.scrollIntoViewIfNeeded()
        await expect(math.locator('svg')).toBeVisible()
        await math.evaluate((element) => {
          const scroller = element.closest('.cm-scroller')
          if (!scroller) throw new Error('Missing editor scroller')
          scroller.scrollTop +=
            element.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom + 16
        })
        await page.getByRole('button', { name: 'Source', exact: true }).focus()
        if (kind === 'diagram') {
          const label = math.locator(`text[data-source-from="${expression.indexOf('Beta')}"]`)
          await label.click({ position: { x: 1, y: 2 } })
        } else {
          const symbol = math
            .locator(`[data-source-from="${kind === 'inline' ? 4 : expression.indexOf('x &=')}"]`)
            .last()
          await symbol.hover()
          const point = await symbol.evaluate((element) => {
            const box = element.getBoundingClientRect()
            return { x: box.left + box.width * 0.8, y: box.top + box.height / 2 }
          })
          await page.mouse.click(point.x, point.y)
        }
        await expect(editor).toBeFocused()
        const preview = page.locator('.cm-live-edit-preview')
        await expect(preview.locator('svg')).toBeVisible()
        await expectEditingVisible(preview, kind === 'long')
        await page.keyboard.insertText('Q')
        await editor.press(`${modifier}+s`)
        const needle = kind === 'diagram' ? 'Beta' : kind === 'inline' ? 'x_i^2' : 'x &='
        const replacement = kind === 'diagram' ? 'QBeta' : kind === 'inline' ? 'x_i^2Q' : 'xQ &='
        await expect.poll(() => readFile(path, 'utf8')).toBe(source.replace(needle, replacement))
        await expect(preview.locator('svg')).toBeVisible()
        await expectEditingVisible(preview, kind === 'long')
        await page.setViewportSize({ width, height: height - 80 })
        await expectEditingVisible(preview, kind === 'long')
        await page.screenshot({ path: test.info().outputPath(`${kind}-viewport-${width}.png`) })

        // A wheel gesture takes control of the viewport. A later resize must not
        // pull an intentionally scrolled-away preview back under the caret.
        const scroller = page.locator('.cm-scroller')
        const before = await scroller.evaluate((element) => element.scrollTop)
        const bounds = await scroller.boundingBox()
        if (!bounds) throw new Error('Missing scroller bounds')
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 20)
        await page.mouse.wheel(0, -220)
        await expect
          .poll(() => scroller.evaluate((element) => element.scrollTop))
          .toBeLessThan(before - 150)
        const manual = await scroller.evaluate((element) => element.scrollTop)
        await page.setViewportSize({ width, height })
        if (await page.locator('.cm-live-preview-panel').count()) {
          await expect
            .poll(() => scroller.evaluate((element) => element.scrollTop))
            .toBeCloseTo(manual, 0)
          await expect(preview).toBeVisible()
        } else
          await expect
            .poll(() =>
              preview.evaluate((element) => {
                const viewport = element.closest('.cm-scroller')?.getBoundingClientRect()
                return Boolean(viewport && element.getBoundingClientRect().bottom > viewport.bottom)
              }),
            )
            .toBe(true)

        await page.getByRole('button', { name: 'Source', exact: true }).click()
        await editor.fill(source)
        await editor.press(`${modifier}+Home`)
        await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
        await scroller.evaluate((element) => {
          element.scrollTop = (element.scrollHeight - element.clientHeight) / 2
        })
        await math.scrollIntoViewIfNeeded()
        const focusable = kind === 'diagram' ? editor.locator('.cm-live-diagram') : math
        await focusable.focus()
        await focusable.press('Enter')
        await expect(editor).toBeFocused()
        await expect(preview.locator('svg')).toBeVisible()
        await expectEditingVisible(preview, kind === 'long')
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
}
