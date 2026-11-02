import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { launchDesktop } from './helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

async function withDocument(
  source: string,
  run: (page: Page, application: ElectronApplication) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-markdown-modes-'))
  const path = join(directory, 'document.md')
  await writeFile(path, source)
  let application: ElectronApplication | undefined
  try {
    application = await launchDesktop(join(directory, 'profile'), [path])
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1280, height: 1600 })
    await expect(page.getByRole('textbox', { name: 'Markdown source' })).toBeVisible()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await editor.press(`${modifier}+End`)
    await run(page, application)
    expect(errors).toEqual([])
  } finally {
    await application
      ?.evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy()
      })
      .catch(() => {})
    await application?.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

test('Source keeps literal Markdown and uniform typography through mode changes and undo', async () => {
  const source =
    '# Heading\n\n**Strong** and *italic* and ~~strike~~ and [link](https://example.invalid)\n\n`literal **code**`\n\nEnd'
  await withDocument(source, async (page) => {
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    for (let pass = 0; pass < 2; pass++) {
      await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
      await expect(editor.locator('.cm-live-strong')).toHaveText('Strong')
      await expect(editor.locator('.cm-live-emphasis')).toHaveCSS('font-style', 'italic')
      await expect(editor.locator('.cm-live-strike')).toHaveCSS(
        'text-decoration-line',
        'line-through',
      )
      if (pass === 0) await page.screenshot({ path: test.info().outputPath('live-typography.png') })
      await page.getByRole('button', { name: 'Source', exact: true }).click()
      await expect
        .poll(async () => (await editor.locator('.cm-line').allTextContents()).join('\n'))
        .toBe(source)
      await expect(editor.locator('[class*="cm-live-"]')).toHaveCount(0)
      const unexpected = await editor.locator('.cm-line, .cm-line span').evaluateAll((nodes) => {
        const body = getComputedStyle(nodes[0]?.closest('.cm-content') as Element)
        return nodes.flatMap((node) => {
          const style = getComputedStyle(node)
          return style.fontWeight !== '400' ||
            style.fontStyle !== 'normal' ||
            style.textDecorationLine !== 'none' ||
            style.fontSize !== body.fontSize ||
            style.fontFamily !== body.fontFamily
            ? [{ text: node.textContent, weight: style.fontWeight, style: style.fontStyle }]
            : []
        })
      })
      expect(unexpected).toEqual([])
    }
    await page.screenshot({ path: test.info().outputPath('source-typography.png') })
    await editor.press(`${modifier}+End`)
    await page.keyboard.insertText(' changed')
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await editor.press(`${modifier}+z`)
    await expect
      .poll(async () => (await editor.locator('.cm-line').allTextContents()).join('\n'))
      .toBe(source)
  })
})

test('completed inline syntax stays rendered at the insertion point, inside text and across selections', async () => {
  await withDocument('', async (page, application) => {
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    const live = page.getByRole('button', { name: 'Live Preview', exact: true })
    const source = page.getByRole('button', { name: 'Source', exact: true })
    const cases = [
      ['**title**', 'title', '.cm-live-strong'],
      ['__title__', 'title', '.cm-live-strong'],
      ['*title*', 'title', '.cm-live-emphasis'],
      ['_title_', 'title', '.cm-live-emphasis'],
      ['~~title~~', 'title', '.cm-live-strike'],
      ['`title`', 'title', '.cm-live-code'],
      ['` title `', 'title', '.cm-live-code'],
      ['``title`tick``', 'title`tick', '.cm-live-code'],
      ['**标题😀**', '标题😀', '.cm-live-strong'],
      ['***title***', 'title', '.cm-live-strong'],
      ['**outer *inner* text**', 'outer inner text', '.cm-live-strong'],
    ] as const
    await live.click()
    for (const [raw, rendered, style] of cases) {
      await editor.fill('')
      await page.keyboard.type(raw)
      await expect(editor.locator('.cm-line')).toHaveText(rendered)
      await expect(editor.locator(style)).toHaveText(rendered)
      await editor.press('ArrowLeft')
      await expect(editor.locator('.cm-line')).toHaveText(rendered)
      await editor.press(`${modifier}+a`)
      await expect(editor.locator('.cm-line')).toHaveText(rendered)
      await source.click()
      await expect(editor.locator('.cm-line')).toHaveText(raw)
      await expect(editor.locator('[class*="cm-live-"]')).toHaveCount(0)
      await live.click()
      await expect(editor.locator('.cm-line')).toHaveText(rendered)
    }
    await application.evaluate(async ({ clipboard, ClipboardItem }) => {
      await clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob(['**title**'], { type: 'text/plain' }),
          'text/html': new Blob(['<p>wrong representation</p>'], { type: 'text/html' }),
        }),
      ])
    })
    await editor.fill('')
    await editor.press(`${modifier}+v`)
    await expect(editor.locator('.cm-line')).toHaveText('title')
    await expect(editor.locator('.cm-live-strong')).toHaveText('title')
    await page.screenshot({ path: test.info().outputPath('active-inline-preview.png') })
    await page.setViewportSize({ width: 720, height: 900 })
    await expect(editor.locator('strong')).toHaveText('title')
    await page.screenshot({ path: test.info().outputPath('active-inline-preview-narrow.png') })
    await source.click()
    await expect(editor.locator('.cm-line')).toHaveText('**title**')
    await editor.press(`${modifier}+z`)
    await expect(editor.locator('.cm-line')).toHaveText('')
  })
})

test('active headings and quote prefixes stay hidden while literal punctuation and unfinished syntax stay literal', async () => {
  await withDocument('', async (page) => {
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    for (const [raw, rendered] of [
      ['# Title', 'Title'],
      ['# Title ###', 'Title'],
      ['> Title', 'Title'],
      ['\\*literal\\*', '*literal*'],
      ['&amp;', '&'],
      ['**unfinished', '**unfinished'],
      ['2 * 3 = 6', '2 * 3 = 6'],
      ['`**literal** &amp;`', '**literal** &amp;'],
    ]) {
      await editor.fill('')
      await page.keyboard.type(raw || '')
      await expect(editor.locator('.cm-line')).toHaveText(rendered || '')
    }
  })
})

test('editing visible formatted text preserves its delimiters, source history and preview', async () => {
  await withDocument('**title**', async (page) => {
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    const live = page.getByRole('button', { name: 'Live Preview', exact: true })
    const source = page.getByRole('button', { name: 'Source', exact: true })
    await editor.press(`${modifier}+Home`)
    for (let position = 0; position < 4; position++) await editor.press('ArrowRight')
    await expect(page.getByText('Ln 1, Col 5', { exact: true })).toBeVisible()
    await editor.press(`${modifier}+2`)
    await expect(editor.locator('strong')).toHaveText('title')
    await expect(editor).toBeFocused()
    await expect(page.getByText('Ln 1, Col 5', { exact: true })).toBeVisible()
    await page.keyboard.type('X')
    await expect(editor.locator('.cm-line')).toHaveText('tiXtle')
    await source.click()
    await expect(editor.locator('.cm-line')).toHaveText('**tiXtle**')
    await editor.press(`${modifier}+z`)
    await live.click()
    await expect(editor.locator('.cm-line')).toHaveText('title')
    await editor.press(`${modifier}+End`)
    await page.keyboard.type('!')
    await expect(editor.locator('.cm-line')).toHaveText('title!')
    await source.click()
    await expect(editor.locator('.cm-line')).toHaveText('**title**!')
    await editor.press(`${modifier}+z`)
    await live.click()
    await expect(editor.locator('.cm-line')).toHaveText('title')
    await editor.press(`${modifier}+Home`)
    await editor.press('ArrowRight')
    await expect(page.getByText('Ln 1, Col 3', { exact: true })).toBeVisible()
    await editor.press('ArrowRight')
    await editor.press('Delete')
    await expect(editor.locator('.cm-line')).toHaveText('ttle')
    await source.click()
    await expect(editor.locator('.cm-line')).toHaveText('**ttle**')
  })
})

test('Live Preview renders punctuation, entities and resolved links while keeping code literal', async () => {
  const source = [
    '# Heading ###',
    '',
    'Setext title',
    '===',
    '',
    '\\*literal\\* &amp; &#42; &#x1F600; &lt;script&gt; &unknown;',
    '',
    '[**Guide**](https://example.invalid/guide "A title") [relative](guide.md) [section](#heading)',
    '',
    '[reference][manual] [shortcut] [missing][unknown] [unsafe](javascript:bad)',
    '',
    '<https://example.invalid/auto> <reader@example.invalid>',
    '',
    'Read [long\nlabel](https://example.invalid/multiline "A title").',
    '',
    '[Formula $x^2$](https://example.invalid/math)',
    '',
    'Hard break\\',
    'next line',
    '',
    '---',
    '',
    '> First line',
    '> Second line',
    '',
    '`\\*literal\\* &amp; [reference][manual]`',
    '',
    '```text',
    '\\*literal\\* &amp; [reference][manual]',
    '```',
    '',
    '[manual]: https://example.invalid/manual',
    '[shortcut]: https://example.invalid/shortcut',
    '',
    'End',
  ].join('\n')
  await withDocument(source, async (page) => {
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    await expect(editor.locator('.cm-live-heading')).toHaveText(['Heading', 'Setext title'])
    await expect(editor.locator('.cm-line').filter({ hasText: '*literal* & *' })).toHaveText(
      '*literal* & * 😀 <script> &unknown;',
    )
    await expect(editor.locator('script')).toHaveCount(0)
    await expect(editor.locator('a').filter({ hasText: 'Guide' })).toHaveAttribute(
      'href',
      'https://example.invalid/guide',
    )
    await expect(editor.locator('a').filter({ hasText: 'relative' })).not.toHaveAttribute('href')
    await expect(editor.locator('a').filter({ hasText: 'section' })).toHaveAttribute(
      'href',
      '#user-content-heading',
    )
    await expect(editor.locator('a').filter({ hasText: 'reference' })).toHaveAttribute(
      'href',
      'https://example.invalid/manual',
    )
    await expect(editor.locator('a').filter({ hasText: 'shortcut' })).toHaveAttribute(
      'href',
      'https://example.invalid/shortcut',
    )
    await expect(editor.locator('a').filter({ hasText: 'unsafe' })).not.toHaveAttribute('href')
    await expect(editor.locator('.cm-line').filter({ hasText: '[missing][unknown]' })).toHaveText(
      'reference shortcut [missing][unknown] unsafe',
    )
    await expect(
      editor.locator('a').filter({ hasText: 'https://example.invalid/auto' }),
    ).toHaveText('https://example.invalid/auto')
    await expect(editor.locator('a[href="https://example.invalid/multiline"]')).toHaveText(
      'long label',
    )
    await expect(
      editor.locator('a[href="https://example.invalid/math"] [role="math"] svg'),
    ).toBeVisible()
    await expect(editor.locator('.cm-line').filter({ hasText: 'Hard break' })).toHaveText(
      'Hard break',
    )
    await expect(editor.getByRole('separator')).toHaveCount(1)
    await expect(editor.locator('.cm-live-quote')).toHaveText(['First line', 'Second line'])
    await expect(
      editor.locator('.cm-live-code').filter({ hasText: '[reference]' }).first(),
    ).toHaveText('\\*literal\\* &amp; [reference][manual]')
    await expect(editor.locator('.cm-live-code pre')).toHaveText(
      '\\*literal\\* &amp; [reference][manual]\n',
    )
    await page.screenshot({ path: test.info().outputPath('live-markdown.png') })
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await expect
      .poll(async () => (await editor.locator('.cm-line').allTextContents()).join('\n'))
      .toBe(source)
    await page.setViewportSize({ width: 720, height: 900 })
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    await page.locator('.cm-scroller').evaluate((element) => {
      element.scrollTop = 0
    })
    await expect(editor.locator('.cm-live-heading').first()).toBeVisible()
    await expect
      .poll(() =>
        page
          .locator('.cm-scroller')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      )
      .toBe(true)
    await page.screenshot({ path: test.info().outputPath('live-markdown-narrow.png') })
  })
})

test('clicking a rendered reference reveals editable source and follows definition changes', async () => {
  const source = 'Read [**Guide**][manual].\n\n[manual]: https://example.invalid/old\n\nEnd'
  await withDocument(source, async (page, application) => {
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    const live = page.getByRole('button', { name: 'Live Preview', exact: true })
    const raw = page.getByRole('button', { name: 'Source', exact: true })
    await live.click()
    const guide = editor.locator('a').filter({ hasText: 'Guide' })
    await expect(guide).toHaveAttribute('href', 'https://example.invalid/old')
    await application.evaluate(({ shell }) => {
      const links: string[] = []
      Reflect.set(globalThis, '__markdownLinks', links)
      shell.openExternal = async (url) => {
        links.push(url)
      }
    })
    await guide.click({ modifiers: [modifier] })
    await expect
      .poll(() => application.evaluate(() => Reflect.get(globalThis, '__markdownLinks')))
      .toEqual(['https://example.invalid/old'])
    await expect(guide).toBeVisible()
    await guide.click()
    await expect(editor.locator('.cm-line').first()).toHaveText('Read [Guide][manual].')
    await editor.press('ArrowRight')
    await expect(editor.locator('.cm-line').first()).toHaveText('Read [Guide][manual].')
    await editor.press(`${modifier}+End`)
    await expect(guide).toBeVisible()
    await raw.click()
    await editor.fill(source.replace('/old', '/new'))
    await editor.press(`${modifier}+End`)
    await live.click()
    await expect(guide).toHaveAttribute('href', 'https://example.invalid/new')
    await raw.click()
    await editor.press(`${modifier}+z`)
    await editor.press(`${modifier}+End`)
    await live.click()
    await expect(guide).toHaveAttribute('href', 'https://example.invalid/old')
  })
})
