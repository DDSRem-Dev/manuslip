import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Locator, test } from '@playwright/test'
import { clickDocumentAction, launchDesktop } from './helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

function renderedText(element: Locator): Promise<string> {
  // biome-ignore lint/performance/useDomNodeTextContent: Assert rendered soft/hard breaks rather than the source text nodes.
  return element.innerText()
}
const lines = [
  '# Line-break conventions',
  '',
  'Soft first',
  'second line.',
  '',
  'Two spaces  ',
  'next line.',
  '',
  'Backslash\\',
  'next line.',
  '',
  'One space ',
  'still soft.',
  '',
  'Escaped slash\\\\',
  'still soft.',
  '',
  '> Quote first',
  '> continues softly.',
  '',
  '- Item first',
  '  continues softly.',
  '',
  'Code ` first',
  'second ` after.',
  'Projected continuation.',
  'Hard break inside projection  ',
  'Last projected line.',
  '',
  'A **strong',
  'continuation**.',
  '',
  '```text',
  'literal  ',
  'backslash\\',
  '```',
  '',
  'End',
]

for (const ending of ['\n', '\r\n', '\r']) {
  test(`Live Preview preserves source newlines through selection with ${JSON.stringify(ending)} files`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'manuslip-linebreaks-'))
    const path = join(directory, 'linebreaks.md'),
      source = lines.join(ending)
    await writeFile(path, source)
    const application = await launchDesktop(join(directory, 'profile'), [path])
    try {
      const page = await application.firstWindow(),
        errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const editor = page.getByRole('textbox', { name: 'Markdown source' })
      await page.setViewportSize({ width: 960, height: 900 })
      await page.getByRole('button', { name: 'Source', exact: true }).click()
      await editor.press(`${modifier}+End`)
      await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
      await expect(editor.locator('.cm-live-code pre')).toHaveText('literal  \nbackslash\\\n')
      const line = (start: string) => editor.locator('.cm-line').filter({ hasText: start })
      const paragraph = editor.locator('.cm-live-paragraph > .cm-live-rendered > p')
      await expect(line('Soft first')).toBeVisible()
      await expect(line('Soft first')).toHaveText('Soft first')
      await expect(line('second line.')).toHaveText('second line.')
      await expect(line('Two spaces')).toHaveText('Two spaces')
      await expect(line('Backslash')).toHaveText('Backslash')
      await expect(line('One space')).toHaveText('One space')
      await expect(line('Escaped slash')).toHaveText('Escaped slash\\')
      await expect(line('Quote first')).toHaveText('Quote first')
      await expect(line('continues softly.')).toHaveCount(2)
      await expect(line('Item first')).toHaveText('• Item first')
      await expect(paragraph.locator('code')).toHaveText('first second')
      expect(await renderedText(paragraph)).toBe(
        'Code first second after.\nProjected continuation.\nHard break inside projection\nLast projected line.',
      )
      await expect(paragraph.locator('br')).toHaveCount(3)
      await expect(line('strong')).toHaveText('A strong')
      await expect(line('continuation')).toHaveText('continuation.')
      await expect(
        editor.locator(
          '.cm-live-paragraph button, .cm-live-blockquote button, .cm-live-list button',
        ),
      ).toHaveCount(0)
      for (const width of [960, 480]) {
        await page.setViewportSize({ width, height: 900 })
        const positions = await paragraph.evaluate((element) => {
          const raw = [...document.querySelectorAll('.cm-line')].find((line) =>
            line.textContent?.startsWith('Soft first'),
          )
          if (!raw) throw new Error('Missing editable prose')
          const range = document.createRange()
          range.selectNodeContents(raw)
          return {
            projected: element.getBoundingClientRect().left,
            editable: range.getBoundingClientRect().left,
          }
        })
        expect(Math.abs(positions.projected - positions.editable)).toBeLessThanOrEqual(1)
        await expect
          .poll(() =>
            page
              .locator('.cm-scroller')
              .evaluate((element) => element.scrollWidth <= element.clientWidth),
          )
          .toBe(true)
      }
      const softRows = () =>
        Promise.all(
          ['Soft first', 'second line.'].map((text) =>
            line(text).evaluate((element) => {
              const content = element.closest('.cm-content')
              if (!content) throw new Error('Missing editor content')
              const box = element.getBoundingClientRect()
              return { top: box.top - content.getBoundingClientRect().top, height: box.height }
            }),
          ),
        )
      const before = await softRows()
      expect((before[1]?.top ?? 0) - (before[0]?.top ?? 0)).toBeCloseTo(before[0]?.height ?? 0, 1)
      await editor.press(`${modifier}+Home`)
      await editor.press('ArrowDown')
      await editor.press('ArrowDown')
      expect(await softRows()).toEqual(before)
      await editor.press('Shift+ArrowDown')
      await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('Soft first\n')
      expect(await softRows()).toEqual(before)
      await expect(line('Soft first')).toHaveText('Soft first')
      await expect(line('second line.')).toHaveText('second line.')
      await editor.press('ArrowRight')
      expect(await softRows()).toEqual(before)
      await expect(line('Soft first')).toHaveText('Soft first')
      await expect(line('second line.')).toHaveText('second line.')
      await expect(line('Two spaces')).toHaveText('Two spaces')
      await expect(line('next line.')).toHaveCount(2)
      await page.screenshot({ path: test.info().outputPath('markdown-linebreaks.png') })
      await page.getByRole('button', { name: 'Source', exact: true }).click()
      await expect
        .poll(async () => (await editor.locator('.cm-line').allTextContents()).join('\n'))
        .toBe(lines.join('\n'))
      await editor.press(`${modifier}+a`)
      await editor.press(`${modifier}+c`)
      expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe(
        lines.join('\n'),
      )
      await editor.press(`${modifier}+End`)
      await editor.press('X')
      await editor.press(`${modifier}+z`)
      await editor.press(`${modifier}+s`)
      await expect.poll(() => readFile(path, 'utf8')).toBe(source)

      const exported = join(directory, 'linebreaks.html')
      await application.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      }, exported)
      await clickDocumentAction(page, 'Export HTML…')
      await expect
        .poll(() => readFile(exported, 'utf8').catch(() => ''))
        .toContain('<p>Soft first\nsecond line.</p>')
      const html = await readFile(exported, 'utf8')
      expect(html).toContain('Two spaces<br>\nnext line.')
      expect(html).toContain('Backslash<br>\nnext line.')
      expect(html).toContain('<code>first second</code>')
      expect(html).toContain('literal  \nbackslash\\\n</code>')
      // Export retains its paragraph semantics; the live editor preserves source rows.
      await page.evaluate((html) => {
        const output = document.createElement('article')
        output.id = 'linebreak-export'
        const parsed = new DOMParser().parseFromString(html, 'text/html')
        output.replaceChildren(...parsed.body.childNodes)
        document.body.replaceChildren(output)
      }, html)
      const output = page.locator('#linebreak-export p')
      expect(await renderedText(output.filter({ hasText: 'Soft first' }))).toBe(
        'Soft first second line.',
      )
      expect(await renderedText(output.filter({ hasText: 'Two spaces' }))).toBe(
        'Two spaces\nnext line.',
      )
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
